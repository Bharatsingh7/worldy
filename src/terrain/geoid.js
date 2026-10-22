/**
 * EGM96 geoid undulation lookup on the main thread (bilinear on the 1° grid) —
 * converts between ellipsoidal heights (Cesium) and heights above sea level (what people expect).
 */
let grid = null;
let loading = null;

export function loadGeoid() {
  loading ||= fetch(`${import.meta.env.BASE_URL}geoid/egm96-1deg.bin`)
    .then((r) => r.arrayBuffer())
    .then((b) => (grid = new Int16Array(b)));
  return loading;
}

/** N in metres (0 until loaded). Height above sea level = ellipsoidal height − N. */
export function geoidN(lat, lon) {
  if (!grid) return 0;
  const fr = 90 - lat;
  const fc = (((lon + 180) % 360) + 360) % 360;
  const r = Math.min(179, Math.floor(fr));
  const c = Math.floor(fc);
  const tr = fr - r;
  const tc = fc - c;
  const at = (rr, cc) => grid[rr * 360 + (cc % 360)] * 0.01;
  return (1 - tr) * ((1 - tc) * at(r, c) + tc * at(r, c + 1)) + tr * ((1 - tc) * at(r + 1, c) + tc * at(r + 1, c + 1));
}

const BARE_KEY = 'worldy.bareEarth';

/** Bare-earth terrain setting (remove tree/building bumps on flat ground); default on. */
export function loadBareEarth() {
  try {
    return localStorage.getItem(BARE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveBareEarth(on) {
  try {
    localStorage.setItem(BARE_KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
}
