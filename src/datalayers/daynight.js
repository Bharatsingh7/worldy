import { Cartesian3, Color, PolylineCollection, Material, PointPrimitiveCollection } from 'cesium';
import { BaseLayer } from './BaseLayer';
import { destinationPoint } from '../flights/predict';

/** Sub-solar point (lat, lon in degrees) — NOAA low-precision solar position. */
export function subsolarPoint(date = new Date()) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const eps = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  const lon = (((ra * 180) / Math.PI - gmst + 540) % 360) - 180;
  return { lat: (dec * 180) / Math.PI, lon };
}

/** Day/night terminator line, sub-solar point, and real sun lighting while on. */
class DayNightLayer extends BaseLayer {
  constructor(viewer, ctx) {
    super(viewer, ctx);
    this.lines = viewer.scene.primitives.add(new PolylineCollection());
    this.sun = viewer.scene.primitives.add(new PointPrimitiveCollection());
    this.prevLighting = viewer.scene.globe.enableLighting;
    viewer.scene.globe.enableLighting = true;
    this.every(5 * 60e3, () => this.draw());
  }

  draw() {
    const s = subsolarPoint();
    // Terminator = great circle 90° (~10,008 km) from the sub-solar point
    const quarter = (Math.PI / 2) * 6371008.8;
    const pts = [];
    for (let b = 0; b <= 360; b += 3) {
      const p = destinationPoint(s.lat, s.lon, b, quarter);
      pts.push(Cartesian3.fromDegrees(p.lon, p.lat, 2000));
    }
    this.lines.removeAll();
    this.lines.add({
      positions: pts,
      width: 2,
      material: Material.fromType('PolylineGlow', { color: Color.fromCssColorString('#ffcf6b'), glowPower: 0.25 }),
    });
    this.sun.removeAll();
    this.sun.add({ position: Cartesian3.fromDegrees(s.lon, s.lat, 1000), pixelSize: 12, color: Color.fromCssColorString('#ffd84d') });
    this.message = `Sun overhead at ${s.lat.toFixed(1)}°, ${s.lon.toFixed(1)}°`;
    this.setStatus('ok', this.message);
    this.render();
  }

  dispose() {
    this.viewer.scene.primitives.remove(this.lines);
    this.viewer.scene.primitives.remove(this.sun);
    this.viewer.scene.globe.enableLighting = this.prevLighting;
  }
}

export default {
  id: 'daynight',
  name: 'Day / night',
  group: 'Sky',
  icon: '🌗',
  note: 'Terminator line and the point where the sun is overhead; turns on sun lighting.',
  create: (viewer, ctx) => new DayNightLayer(viewer, ctx),
};
