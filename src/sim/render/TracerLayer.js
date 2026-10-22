/**
 * Flow / wind tracer particles: one cheap point per particle, repositioned each frame from the
 * grid coordinates the physics worker sends (it advects them in C).
 */
import { Cartesian3, Color, NearFarScalar, PointPrimitiveCollection } from 'cesium';

export default class TracerLayer {
  constructor(viewer, grid, { count, height = 0, color = '#ffffff' }) {
    this.viewer = viewer;
    this.grid = grid;
    this.height = height;
    this.coll = viewer.scene.primitives.add(new PointPrimitiveCollection());
    const c = Color.fromCssColorString(color).withAlpha(0.85);
    const scale = new NearFarScalar(2e3, 1.6, 2e6, 0.6);
    this.points = Array.from({ length: count }, () =>
      this.coll.add({ position: Cartesian3.ZERO, pixelSize: 2.5, color: c, scaleByDistance: scale, show: false })
    );
    this.scratch = new Cartesian3();
  }

  update(xs, ys, depth) {
    const { nx, ny, bounds, ground } = this.grid;
    const [w, s, e, n] = bounds;
    for (let k = 0; k < this.points.length; k++) {
      const x = xs[k];
      const y = ys[k];
      const p = this.points[k];
      if (!(x >= 0 && y >= 0 && x < nx && y < ny)) {
        p.show = false;
        continue;
      }
      const c = Math.floor(y) * nx + Math.floor(x);
      const lon = w + (x / nx) * (e - w);
      const lat = n - (y / ny) * (n - s);
      const hgt = this.height ? Math.max(this.height, ground[c] + 200) : ground[c] + (depth ? depth[c] : 0) + 0.3;
      p.position = Cartesian3.fromDegrees(lon, lat, hgt, undefined, this.scratch);
      p.show = true;
    }
  }

  destroy() {
    this.viewer.scene.primitives.remove(this.coll);
  }
}
