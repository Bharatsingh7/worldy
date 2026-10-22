/**
 * Shareable view in the URL hash: #@lat,lon,heightM,headingDeg,pitchDeg&map=imageryId
 * Updated after the camera stops moving; restored on load.
 */
import { Cartesian3, Math as CesiumMath } from 'cesium';

export function readHash() {
  const m = window.location.hash.match(/^#@(-?[\d.]+),(-?[\d.]+),([\d.]+),(-?[\d.]+),(-?[\d.]+)(?:&map=([\w-]+))?/);
  if (!m) return null;
  const [lat, lon, h, heading, pitch] = m.slice(1, 6).map(Number);
  return { lat, lon, h, heading, pitch, map: m[6] };
}

export function applyHashView(viewer, v) {
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(v.lon, v.lat, v.h),
    orientation: { heading: CesiumMath.toRadians(v.heading), pitch: CesiumMath.toRadians(v.pitch), roll: 0 },
  });
}

/** Keep the hash in sync with the camera; returns a remover. */
export function syncHash(viewer, getMap) {
  const write = () => {
    const c = viewer.camera.positionCartographic;
    const deg = CesiumMath.toDegrees;
    const hash = `#@${deg(c.latitude).toFixed(4)},${deg(c.longitude).toFixed(4)},${Math.round(c.height)},${deg(viewer.camera.heading).toFixed(1)},${deg(viewer.camera.pitch).toFixed(1)}&map=${getMap()}`;
    window.history.replaceState(null, '', hash);
  };
  return viewer.camera.moveEnd.addEventListener(write);
}
