/**
 * FlightLayer — renders aircraft on the Cesium globe with raw primitives
 * (one BillboardCollection for ~10k planes) and draws the selected flight's
 * past track, predicted path and origin/destination airports.
 *
 * Positions are dead-reckoned on the shared 8 Hz ticker (not every frame) and one
 * render is requested per tick, so the GPU idles between updates.
 */

import {
  BillboardCollection,
  PolylineCollection,
  LabelCollection,
  PointPrimitiveCollection,
  Cartesian2,
  Cartesian3,
  Color,
  HeadingPitchRange,
  HorizontalOrigin,
  LabelStyle,
  Material,
  Matrix4,
  NearFarScalar,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  Math as CesiumMath,
} from 'cesium';

import { positionAt, forecast, greatCircle, routeIsPlausible, distance } from './predict';
import { onTick } from '../ticker';

export const FLIGHT_COLORS = {
  civil: '#ffc94d',
  military: '#ff5c5c',
  ground: '#8892a8',
  selected: '#ffffff',
};

const RAD = Math.PI / 180;
const PATH_COLOR = Color.fromCssColorString('#6c8cff');
const FUTURE_COLOR = Color.fromCssColorString('#ffc94d');

/** Top-down airliner silhouette pointing north, tinted with `color`. */
function planeIcon(color, size = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.scale(size / 32, size / 32);
  g.fillStyle = color;
  g.strokeStyle = 'rgba(0,0,0,0.65)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(16, 2);
  g.bezierCurveTo(17.6, 2, 18, 4, 18, 6);
  g.lineTo(18, 12);
  g.lineTo(29, 18.5);
  g.lineTo(29, 21);
  g.lineTo(18, 17.5);
  g.lineTo(18, 24);
  g.lineTo(21.5, 27);
  g.lineTo(21.5, 29);
  g.lineTo(16, 27.5);
  g.lineTo(10.5, 29);
  g.lineTo(10.5, 27);
  g.lineTo(14, 24);
  g.lineTo(14, 17.5);
  g.lineTo(3, 21);
  g.lineTo(3, 18.5);
  g.lineTo(14, 12);
  g.lineTo(14, 6);
  g.bezierCurveTo(14, 4, 14.4, 2, 16, 2);
  g.closePath();
  g.fill();
  g.stroke();
  return c;
}

export const categoryOf = (f) => (f.military ? 'military' : f.onGround ? 'ground' : 'civil');

const scratch = new Cartesian3();

/** Per-frame time budget (ms) for repositioning planes at globe scale. */
const FRAME_BUDGET_MS = 4;
/** Below this camera height only planes inside the view are moved, every frame. */
const VIEW_CULL_HEIGHT = 1_500_000;

export default class FlightLayer {
  constructor(viewer, { onPick }) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.onPick = onPick;

    this.icons = Object.fromEntries(
      Object.entries(FLIGHT_COLORS).map(([k, col]) => [k, planeIcon(col, k === 'selected' ? 40 : 32)])
    );

    this.billboards = this.scene.primitives.add(new BillboardCollection({ scene: this.scene }));
    this.paths = this.scene.primitives.add(new PolylineCollection());
    this.points = this.scene.primitives.add(new PointPrimitiveCollection());
    this.labels = this.scene.primitives.add(new LabelCollection({ scene: this.scene }));

    /** @type {Map<string, {flight: object, billboard: object}>} */
    this.items = new Map();
    this.order = []; // round-robin update list
    this.cursor = 0;
    this.filter = () => true;
    this.routes = new Map();
    this.forecastSec = 0;
    this.selected = null; // { id, route, track }
    this.follow = false;
    this.lastPathUpdate = 0;

    this.stopTicker = onTick(() => {
      this.update();
      this.scene.requestRender();
    });

    this.handler = new ScreenSpaceEventHandler(this.scene.canvas);
    this.handler.setInputAction((e) => {
      const picked = this.scene.pick(e.position);
      const id = picked?.id?.worldyFlight;
      if (id) this.onPick(id);
    }, ScreenSpaceEventType.LEFT_CLICK);

    let lastHover = 0;
    this.handler.setInputAction((e) => {
      const now = performance.now();
      if (now - lastHover < 120) return;
      lastHover = now;
      const picked = this.scene.pick(e.endPosition);
      this.scene.canvas.style.cursor = picked?.id?.worldyFlight ? 'pointer' : '';
    }, ScreenSpaceEventType.MOUSE_MOVE);
  }

  /** Sync billboards with the flight map (add / update / remove). */
  setFlights(flights) {
    for (const [id, item] of this.items) {
      if (!flights.has(id)) {
        this.billboards.remove(item.billboard);
        this.items.delete(id);
      }
    }
    for (const [id, flight] of flights) {
      let item = this.items.get(id);
      if (!item) {
        const billboard = this.billboards.add({
          id: { worldyFlight: id },
          position: Cartesian3.fromDegrees(flight.lon, flight.lat, flight.altM),
          alignedAxis: Cartesian3.UNIT_Z,
          scaleByDistance: new NearFarScalar(2.0e5, 1.0, 1.5e7, 0.45),
          width: 22,
          height: 22,
        });
        item = { flight, billboard, category: null };
        this.items.set(id, item);
      }
      item.flight = flight;
    }
    this.order = [...this.items.entries()];
    this.cursor = 0;
    this.refreshStyles();
  }

  setFilter(filter) {
    this.filter = filter;
    this.refreshStyles();
  }

  setRoutes(routes) {
    this.routes = routes;
  }

  setForecast(minutes) {
    this.forecastSec = minutes * 60;
    this.lastPathUpdate = 0;
  }

  setSelected(selection) {
    const prev = this.selected?.id;
    this.selected = selection;
    if (!selection && this.follow) this.setFollow(false);
    if (prev !== selection?.id) this.refreshStyles();
    this.lastPathUpdate = 0;
  }

  setFollow(follow) {
    this.follow = follow;
    this.followStarted = false;
    if (!follow) this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  }

  refreshStyles() {
    const selId = this.selected?.id;
    for (const [id, item] of this.items) {
      const isSel = id === selId;
      const cat = isSel ? 'selected' : categoryOf(item.flight);
      if (item.category !== cat) {
        item.billboard.image = this.icons[cat];
        item.billboard.width = item.billboard.height = isSel ? 34 : 22;
        item.category = cat;
      }
      item.billboard.show = isSel || this.filter(item.flight);
    }
  }

  positionOf(flight, now) {
    if (this.forecastSec > 0) {
      const sec = (now - flight.ts) / 1000 + this.forecastSec;
      return forecast(flight, sec, this.routes.get(flight.callsign));
    }
    return positionAt(flight, now);
  }

  move(item, now) {
    const p = this.positionOf(item.flight, now);
    item.billboard.position = Cartesian3.fromDegrees(p.lon, p.lat, p.altM, undefined, scratch);
    item.billboard.rotation = -CesiumMath.toRadians(p.headingDeg);
    return p;
  }

  update() {
    const now = Date.now();
    const camera = this.viewer.camera;
    const selId = this.selected?.id;
    const selItem = selId && this.items.get(selId);
    const selPos = selItem ? this.move(selItem, now) : null;

    // Zoomed in: move only what's on screen, every frame (smooth close-up motion)
    const rect = camera.positionCartographic.height < VIEW_CULL_HEIGHT ? camera.computeViewRectangle() : undefined;
    if (rect) {
      const pad = 0.02; // ~1° in radians
      const w = rect.west - pad, e = rect.east + pad, s = rect.south - pad, n = rect.north + pad;
      const wraps = w > e;
      for (const item of this.items.values()) {
        if (!item.billboard.show || item === selItem) continue;
        const lat = item.flight.lat * RAD;
        const lon = item.flight.lon * RAD;
        if (lat < s || lat > n) continue;
        if (wraps ? lon < w && lon > e : lon < w || lon > e) continue;
        this.move(item, now);
      }
    } else {
      // Globe view: sweep through all planes round-robin within a time budget;
      // the few-ms lag per plane is far below a pixel at this scale
      const start = performance.now();
      const order = this.order;
      for (let n = 0; n < order.length && performance.now() - start < FRAME_BUDGET_MS; n += 64) {
        for (let k = 0; k < 64 && n + k < order.length; k++) {
          if (this.cursor >= order.length) this.cursor = 0;
          const item = order[this.cursor++][1];
          if (item.billboard.show && item !== selItem) this.move(item, now);
        }
      }
    }

    if (now - this.lastPathUpdate > 1000) {
      this.lastPathUpdate = now;
      this.drawSelection(selPos);
    }

    if (this.follow && selPos) {
      const target = Cartesian3.fromDegrees(selPos.lon, selPos.lat, selPos.altM);
      // First frame: camera is still in world space; afterwards keep the user's zoom
      const range = this.followStarted
        ? Cartesian3.magnitude(camera.position)
        : Math.min(Cartesian3.distance(camera.positionWC, target), 300_000);
      this.followStarted = true;
      camera.lookAt(target, new HeadingPitchRange(camera.heading, camera.pitch, range));
    }
  }

  /** Past track (solid), predicted path (dashed) and airports for the selected flight. */
  drawSelection(shown) {
    this.paths.removeAll();
    this.points.removeAll();
    this.labels.removeAll();
    const sel = this.selected;
    const item = sel && this.items.get(sel.id);
    if (!item || !shown) return;
    const f = item.flight;
    // Paths split at the live position, so a forecast plane sits on the dashed part
    const pos = positionAt(f, Date.now());

    const toCart = (p) => Cartesian3.fromDegrees(p.lon, p.lat, p.altM ?? 0);

    // Past
    const past = [...(sel.track?.length ? sel.track : item.flight.trail || [])];
    if (past.length) {
      this.paths.add({
        positions: [...past, pos].map(toCart),
        width: 2.5,
        material: Material.fromType('Color', { color: PATH_COLOR }),
      });
    }

    // Future
    const route = sel.route;
    let future;
    if (route && routeIsPlausible(f, route)) {
      // Cruise, then descend on a ~3° slope into the destination
      const n = 64;
      const total = distance(pos.lat, pos.lon, route.destination.lat, route.destination.lon);
      future = greatCircle(pos, route.destination, n).map((p, i) => ({
        ...p,
        altM: Math.min(pos.altM, (total * (n - i)) / n / 19),
      }));
    } else if (!f.onGround && f.speedMs > 1) {
      // No known destination: project the current track 30 min ahead
      const base = (Date.now() - f.ts) / 1000;
      const minutes = Math.max(30, this.forecastSec / 60 + 10);
      future = Array.from({ length: minutes + 1 }, (_, m) => forecast(f, base + m * 60));
    }
    if (future?.length > 1) {
      this.paths.add({
        positions: future.map(toCart),
        width: 2,
        material: Material.fromType('PolylineDash', { color: FUTURE_COLOR, dashLength: 12 }),
      });
    }

    // Airports
    if (route) {
      for (const [ap, color] of [[route.origin, PATH_COLOR], [route.destination, FUTURE_COLOR]]) {
        const position = Cartesian3.fromDegrees(ap.lon, ap.lat, 0);
        this.points.add({ position, pixelSize: 9, color, outlineColor: Color.BLACK, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY });
        this.labels.add({
          position,
          text: ap.iata || ap.icao,
          font: '600 12px Inter, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(9, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
    }
  }

  /** Current (possibly forecast) position of a flight, for flying the camera to it. */
  locate(id) {
    const item = this.items.get(id);
    return item ? this.positionOf(item.flight, Date.now()) : null;
  }

  destroy() {
    this.setFollow(false);
    this.stopTicker();
    this.handler.destroy();
    this.scene.canvas.style.cursor = '';
    for (const p of [this.billboards, this.paths, this.points, this.labels]) this.scene.primitives.remove(p);
  }
}
