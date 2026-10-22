/**
 * Mouse drawing on the globe (terrain-aware) and display of saved shapes.
 *
 *  point     one click
 *  line      click to add, double-click / right-click to finish
 *  polygon   same as line (closed)
 *  rect      two corner clicks
 *  circle    centre click, then a click on the edge
 *
 * Shapes are plain data: { id, name, type, points: [[lon, lat], ...], center?, radiusM? }
 * (circles also carry a 72-point ring in `points` for analysis).
 */

import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorMaterialProperty,
  HeightReference,
  LabelStyle,
  PolygonHierarchy,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  Math as CesiumMath,
} from 'cesium';
import { destinationPoint } from '../flights/predict';
import { haversine } from './grid';

const ACCENT = Color.fromCssColorString('#6c8cff');
const SELECTED = Color.fromCssColorString('#ffc94d');

const toLonLat = (c) => {
  const k = Cartographic.fromCartesian(c);
  return [CesiumMath.toDegrees(k.longitude), CesiumMath.toDegrees(k.latitude)];
};

export function circleRing([lon, lat], radiusM, n = 72) {
  const ring = [];
  for (let i = 0; i < n; i++) {
    const p = destinationPoint(lat, lon, (360 * i) / n, radiusM);
    ring.push([p.lon, p.lat]);
  }
  return ring;
}

export function rectRing([a, b]) {
  const [w, e] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [s, n] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return [[w, s], [e, s], [e, n], [w, n]];
}

export default class DrawTool {
  constructor(viewer) {
    this.viewer = viewer;
    this.active = null;
    this.shapeEntities = new Map();
    // Cesium's default double-click zooms to entities — it fights with finishing a line
    viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  }

  get drawing() {
    return !!this.active;
  }

  /** Ground position under a screen point (terrain if loaded, else ellipsoid). */
  pickGround(pos) {
    const scene = this.viewer.scene;
    const ray = this.viewer.camera.getPickRay(pos);
    return (ray && scene.globe.pick(ray, scene)) || this.viewer.camera.pickEllipsoid(pos);
  }

  /** Begin drawing; resolves with the finished shape geometry, or null if cancelled. */
  start(type) {
    this.cancel();
    return new Promise((resolve) => {
      const viewer = this.viewer;
      const pts = [];
      let mouse = null;
      const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      const live = () => (mouse ? [...pts, mouse] : pts);
      const entities = [];
      const add = (e) => entities.push(viewer.entities.add(e));

      if (type === 'line' || type === 'polygon') {
        add({
          polyline: {
            positions: new CallbackProperty(() => (type === 'polygon' && live().length > 2 ? [...live(), live()[0]] : live()), false),
            width: 2.5,
            material: ACCENT,
            clampToGround: true,
          },
        });
      }
      if (type === 'polygon') {
        add({
          polygon: {
            hierarchy: new CallbackProperty(() => new PolygonHierarchy(live()), false),
            material: new ColorMaterialProperty(ACCENT.withAlpha(0.18)),
          },
        });
      }
      if (type === 'rect') {
        add({
          rectangle: {
            coordinates: new CallbackProperty(
              () => (pts.length && mouse ? Rectangle.fromCartesianArray([pts[0], mouse]) : undefined),
              false
            ),
            material: ACCENT.withAlpha(0.18),
            outline: false,
          },
        });
      }
      if (type === 'circle') {
        const radius = () => (pts.length && mouse ? Math.max(1, Cartesian3.distance(pts[0], mouse)) : 1);
        add({
          position: new CallbackProperty(() => pts[0], false),
          ellipse: {
            semiMajorAxis: new CallbackProperty(radius, false),
            semiMinorAxis: new CallbackProperty(radius, false),
            material: ACCENT.withAlpha(0.18),
          },
        });
      }

      viewer.container.dataset.drawing = '1'; // other click handlers stand down while drawing
      const finish = (ok) => {
        delete viewer.container.dataset.drawing;
        handler.destroy();
        entities.forEach((e) => viewer.entities.remove(e));
        this.active = null;
        viewer.scene.requestRender();
        if (!ok) return resolve(null);
        const ll = pts.map(toLonLat);
        if (type === 'circle') {
          const radiusM = haversine(ll[0][1], ll[0][0], ll[1][1], ll[1][0]);
          return resolve({ type, center: ll[0], radiusM, points: circleRing(ll[0], radiusM) });
        }
        if (type === 'rect') return resolve({ type, points: rectRing(ll) });
        resolve({ type, points: ll });
      };

      const needed = { point: 1, rect: 2, circle: 2 }[type];
      handler.setInputAction((e) => {
        const c = this.pickGround(e.position);
        if (!c) return;
        pts.push(c);
        if (needed && pts.length >= needed) finish(true);
        viewer.scene.requestRender();
      }, ScreenSpaceEventType.LEFT_CLICK);

      handler.setInputAction((e) => {
        mouse = this.pickGround(e.endPosition) || mouse;
        viewer.scene.requestRender();
      }, ScreenSpaceEventType.MOUSE_MOVE);

      const complete = () => {
        // A double-click also produced two single clicks at the same spot — drop the duplicate
        if (pts.length > 1 && Cartesian3.distance(pts[pts.length - 1], pts[pts.length - 2]) < 1) pts.pop();
        const min = type === 'polygon' ? 3 : 2;
        if (pts.length >= min) finish(true);
      };
      if (!needed) {
        handler.setInputAction(complete, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        handler.setInputAction(complete, ScreenSpaceEventType.RIGHT_CLICK);
      }

      this.active = { cancel: () => finish(false) };
    });
  }

  cancel() {
    this.active?.cancel();
  }

  /** Show saved shapes; the selected one is highlighted. */
  sync(shapes, selectedId) {
    const viewer = this.viewer;
    for (const [id, ents] of this.shapeEntities) {
      if (!shapes.some((s) => s.id === id)) {
        ents.forEach((e) => viewer.entities.remove(e));
        this.shapeEntities.delete(id);
      }
    }
    for (const shape of shapes) {
      const old = this.shapeEntities.get(shape.id);
      if (old) old.forEach((e) => viewer.entities.remove(e));
      const sel = shape.id === selectedId;
      const col = sel ? SELECTED : ACCENT;
      const positions = shape.points.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat));
      const ents = [];
      const label = {
        text: shape.name,
        font: '600 12px Inter, sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      };
      if (shape.type === 'point') {
        ents.push(
          viewer.entities.add({
            position: positions[0],
            point: {
              pixelSize: 10,
              color: col,
              outlineColor: Color.BLACK,
              outlineWidth: 2,
              heightReference: HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label,
          })
        );
      } else {
        const closed = shape.type !== 'line';
        if (closed) {
          ents.push(viewer.entities.add({ polygon: { hierarchy: positions, material: col.withAlpha(sel ? 0.22 : 0.12) } }));
        }
        ents.push(
          viewer.entities.add({
            polyline: { positions: closed ? [...positions, positions[0]] : positions, width: sel ? 3 : 2, material: col, clampToGround: true },
          })
        );
        const [lon, lat] = shape.center || shape.points[0];
        ents.push(viewer.entities.add({ position: Cartesian3.fromDegrees(lon, lat), label }));
      }
      this.shapeEntities.set(shape.id, ents);
    }
    viewer.scene.requestRender();
  }

  destroy() {
    this.cancel();
    for (const ents of this.shapeEntities.values()) ents.forEach((e) => this.viewer.entities.remove(e));
  }
}
