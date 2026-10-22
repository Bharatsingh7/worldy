/**
 * Common pieces for data layers: status reporting, options, and a cheap
 * point renderer (PointPrimitiveCollection — far lighter than billboards).
 *
 * A layer instance exposes:
 *   status / message / count       shown in the Layers tab
 *   options + optionSchema()       generic settings UI (chips)
 *   describe(key)                  info card content for a picked item
 *   setSelected(key)               optional highlight (tracks, footprints)
 *   destroy()
 */

import { Cartesian3, Color, Ellipsoid, EllipsoidalOccluder, NearFarScalar, PointPrimitiveCollection } from 'cesium';

const colorCache = new Map();
export const color = (css) => {
  let c = colorCache.get(css);
  if (!c) colorCache.set(css, (c = Color.fromCssColorString(css)));
  return c;
};

export class BaseLayer {
  constructor(viewer, ctx, defaults = {}) {
    this.viewer = viewer;
    this.ctx = ctx;
    this.status = 'loading';
    this.message = '';
    this.count = 0;
    this.options = { ...defaults };
    this.timers = [];
    this.abort = new AbortController();
  }

  setStatus(status, message = '') {
    this.status = status;
    this.message = message;
    this.ctx.changed();
  }

  setOption(key, value) {
    this.options[key] = value;
    this.onOptions?.(key);
    this.ctx.changed();
  }

  /** Repeat fn every ms (first run immediately); paused while the tab is hidden. */
  every(ms, fn) {
    const run = async () => {
      if (this.abort.signal.aborted) return;
      if (!document.hidden) {
        try {
          await fn();
        } catch (err) {
          if (!this.abort.signal.aborted) this.setStatus('error', err.message || String(err));
        }
      }
      if (!this.abort.signal.aborted) this.timers.push(setTimeout(run, document.hidden ? 5000 : ms));
    };
    run();
  }

  render() {
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  optionSchema() {
    return [];
  }

  describe() {
    return null;
  }

  destroy() {
    this.abort.abort();
    this.timers.forEach(clearTimeout);
    this.dispose?.();
    this.render();
  }
}

/**
 * A set of coloured points keyed by id, pickable as { worldyLayer, key }.
 *
 * Surface markers skip depth testing (otherwise the globe clips them into half-discs
 * near the horizon) and are instead hidden when behind the Earth, re-checked only
 * after the camera has moved.
 */
export class PointSet {
  constructor(viewer, layerId, { near = 1.5e5, far = 2.0e7, farScale = 0.5, surface = true } = {}) {
    this.viewer = viewer;
    this.layerId = layerId;
    this.surface = surface;
    this.scale = new NearFarScalar(near, 1.0, far, farScale);
    this.coll = viewer.scene.primitives.add(new PointPrimitiveCollection());
    this.points = [];
    if (surface) {
      this.lastCam = new Cartesian3();
      this.occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, Cartesian3.ZERO);
      this.onPreRender = () => this.cull();
      viewer.scene.preRender.addEventListener(this.onPreRender);
    }
  }

  /** Hide points on the far side of the globe (only recomputed when the camera moved). */
  cull(force = false) {
    const cam = this.viewer.camera.positionWC;
    if (!force && Cartesian3.distanceSquared(cam, this.lastCam) < 1e6) return;
    Cartesian3.clone(cam, this.lastCam);
    this.occluder.cameraPosition = cam;
    for (const p of this.points) p.show = this.occluder.isPointVisible(p.position);
  }

  /** Replace all points. items: [{ key, lon, lat, alt?, color, size?, outline? }] */
  set(items) {
    this.coll.removeAll();
    this.points = items.map((it) =>
      this.coll.add({
        id: { worldyLayer: this.layerId, key: it.key },
        position: Cartesian3.fromDegrees(it.lon, it.lat, it.alt ?? 0),
        color: color(it.color),
        pixelSize: it.size ?? 6,
        outlineColor: color(it.outline ?? 'rgba(0,0,0,0.6)'),
        outlineWidth: 1,
        scaleByDistance: this.scale,
        disableDepthTestDistance: this.surface ? Number.POSITIVE_INFINITY : 0,
      })
    );
    if (this.surface) this.cull(true);
    this.viewer.scene.requestRender();
  }

  /** Move point i to an ECEF position (metres); NaN hides it. */
  setPositionECEF(i, x, y, z, scratch) {
    const p = this.points[i];
    if (!p) return;
    if (Number.isNaN(x)) {
      p.show = false;
      return;
    }
    scratch.x = x;
    scratch.y = y;
    scratch.z = z;
    p.position = scratch;
    p.show = true;
  }

  destroy() {
    if (this.onPreRender) this.viewer.scene.preRender.removeEventListener(this.onPreRender);
    this.viewer.scene.primitives.remove(this.coll);
  }
}
