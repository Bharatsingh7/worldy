/**
 * Flight prediction — pure great-circle math, no Cesium.
 *
 *  positionAt   : dead-reckoning between data polls (smooth live motion)
 *  forecast     : where a flight will be N seconds ahead (follows its route when known)
 *  projectRoute : distance, progress and ETA toward the destination airport
 */

const R = 6371008.8; // mean Earth radius (m)
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Max seconds to extrapolate stale live data before freezing it. */
const MAX_LIVE_EXTRAPOLATION = 120;
/** ~3° glide slope: metres of track per metre of altitude lost. */
const GLIDE_RATIO = 19;

export function distance(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

/** Point reached travelling distM metres from (lat, lon) on an initial bearing. */
export function destinationPoint(lat, lon, bearingDeg, distM) {
  const d = distM / R;
  const b = bearingDeg * RAD;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * DEG, lon: ((l2 * DEG + 540) % 360) - 180 };
}

/** n+1 evenly spaced points along the great circle from a to b. */
export function greatCircle(a, b, n = 64) {
  const total = distance(a.lat, a.lon, b.lat, b.lon);
  if (total < 1) return [a, b];
  // Travelling a fixed initial bearing traces the great circle
  const hdg = bearing(a.lat, a.lon, b.lat, b.lon);
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(destinationPoint(a.lat, a.lon, hdg, (total * i) / n));
  return pts;
}

/** Live position: extrapolate from the last report along the current track. */
export function positionAt(f, nowMs) {
  if (f.onGround || f.speedMs < 1) return { lat: f.lat, lon: f.lon, altM: f.altM, headingDeg: f.headingDeg };
  const dt = Math.max(0, Math.min(MAX_LIVE_EXTRAPOLATION, (nowMs - f.ts) / 1000));
  const p = destinationPoint(f.lat, f.lon, f.headingDeg, f.speedMs * dt);
  return { ...p, altM: Math.max(0, f.altM + f.vertRateMs * Math.min(dt, 30)), headingDeg: f.headingDeg };
}

/**
 * Is the route consistent with where the aircraft actually is?
 * (Callsign routes are schedules and are sometimes stale or wrong.)
 */
export function routeIsPlausible(f, route) {
  if (!route) return false;
  const { origin: o, destination: d } = route;
  const total = distance(o.lat, o.lon, d.lat, d.lon);
  const via = distance(o.lat, o.lon, f.lat, f.lon) + distance(f.lat, f.lon, d.lat, d.lon);
  return via <= total * 1.25 + 200_000;
}

/**
 * Predicted position `seconds` after the last report.
 * With a plausible route the aircraft flies the great circle to the destination,
 * descending on a ~3° slope and stopping at the airport; otherwise it holds its track.
 */
export function forecast(f, seconds, route) {
  if (f.onGround || f.speedMs < 1) return { lat: f.lat, lon: f.lon, altM: f.altM, headingDeg: f.headingDeg, landed: false };
  const travelled = f.speedMs * seconds;

  if (route && routeIsPlausible(f, route)) {
    const dest = route.destination;
    const remaining = distance(f.lat, f.lon, dest.lat, dest.lon);
    if (travelled >= remaining) {
      return { lat: dest.lat, lon: dest.lon, altM: 0, headingDeg: f.headingDeg, landed: true };
    }
    const hdg = bearing(f.lat, f.lon, dest.lat, dest.lon);
    const p = destinationPoint(f.lat, f.lon, hdg, travelled);
    const left = remaining - travelled;
    const climbed = f.altM + Math.max(0, f.vertRateMs) * Math.min(seconds, 600);
    const altM = Math.min(climbed, Math.max(f.altM, 11_000), left / GLIDE_RATIO);
    return { ...p, altM: Math.max(0, altM), headingDeg: bearing(p.lat, p.lon, dest.lat, dest.lon), landed: false };
  }

  const p = destinationPoint(f.lat, f.lon, f.headingDeg, travelled);
  const altM = Math.max(0, f.altM + f.vertRateMs * Math.min(seconds, 300));
  return { ...p, altM, headingDeg: f.headingDeg, landed: false };
}

/** Progress and ETA along the route, or null when there's no plausible route. */
export function projectRoute(f, route, nowMs = Date.now()) {
  if (!routeIsPlausible(f, route)) return null;
  const { origin: o, destination: d } = route;
  const pos = positionAt(f, nowMs);
  const total = distance(o.lat, o.lon, d.lat, d.lon);
  const remaining = distance(pos.lat, pos.lon, d.lat, d.lon);
  const etaMs = f.speedMs > 30 ? nowMs + (remaining / f.speedMs) * 1000 : null;
  return {
    totalM: total,
    remainingM: remaining,
    progress: Math.max(0, Math.min(1, 1 - remaining / total)),
    etaMs,
  };
}
