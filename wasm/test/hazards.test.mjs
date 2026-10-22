/**
 * Checks for the hazard modules (run: node wasm/test/hazards.test.mjs).
 *   Okada: Okada (1985) Table 2 values.  Cyclone: peak wind at Rmax, sensible magnitude.
 *   Wildfire: circular without wind; with wind the burned shape's length/breadth ≈ Anderson's LB.
 *   Plume: mass conserved (no decay) while it drifts downwind.
 */
import fs from 'node:fs';
import { instantiate } from '../../src/compute/wasm.js';

const bytes = fs.readFileSync(new URL('../../public/wasm/physics.wasm', import.meta.url));
const w = await instantiate(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failed++;
};

// Okada
{
  const ss = w.x.okada_uz_raw(2, 3, 4, 70, 3, 2, 1, 0, 0), ds = w.x.okada_uz_raw(2, 3, 4, 70, 3, 2, 0, 1, 0), tf = w.x.okada_uz_raw(2, 3, 4, 70, 3, 2, 0, 0, 1);
  const ok = Math.abs(ss + 2.747e-3) < 5e-7 && Math.abs(ds + 3.564e-2) < 5e-6 && Math.abs(tf - 3.214e-3) < 5e-7;
  check('Okada (1985) check values', ok, `uz strike ${ss.toExponential(4)}, dip ${ds.toExponential(4)}, tensile ${tf.toExponential(4)}`);
}

// Cyclone: radial profile through the centre
{
  const m = w.mark();
  const nx = 401, ny = 1, n = nx * ny;
  const wx = w.reserve(Float64Array, n), wy = w.reserve(Float64Array, n), dp = w.reserve(Float64Array, n), rain = w.reserve(Float64Array, n);
  const p = w.reserve(Float64Array, 2);
  w.x.cyc_params(65, 20, p);
  const [rmax, B] = w.get(Float64Array, p, 2);
  // east-west line through the eye at 20°N, 4° wide
  w.x.cyc_fields(20, 90, 65, rmax, B, 0, 0, 88, 19.999, 92, 20.001, nx, ny, wx, wy, dp, rain);
  const sx = w.get(Float64Array, wx, n), sy = w.get(Float64Array, wy, n);
  let best = 0, at = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.hypot(sx[i], sy[i]);
    if (s > best) { best = s; at = i; }
  }
  const rAt = Math.abs((at + 0.5) / nx * 4 - 2) * 111.32 * Math.cos(20 * Math.PI / 180);
  check('Holland cyclone: peak wind at Rmax', Math.abs(rAt - rmax) < 0.25 * rmax && best > 38 && best < 75, `(10-min surface wind) Cat 3 (Δp 65 hPa): peak ${best.toFixed(1)} m/s (${(best * 3.6).toFixed(0)} km/h) at ${rAt.toFixed(1)} km, Rmax ${rmax.toFixed(1)} km, B ${B.toFixed(2)}`);
  w.release(m);
}

// Wildfire
function burn(wind) {
  const nx = 201, ny = 201, n = nx * ny;
  const z = w.put(new Float64Array(n));
  const burnable = w.put(new Uint8Array(n).fill(1));
  const ign = new Uint8Array(n);
  ign[100 * nx + 100] = 1;
  const ip = w.put(ign);
  const t = w.reserve(Float32Array, n), st = w.reserve(Float64Array, 4);
  w.x.fire_spread(z, burnable, ip, nx, ny, 10, 10, wind, 90, 0, 0.06, 1800, t, st);
  const arr = w.get(Float32Array, t, n);
  const [, head, lb] = w.get(Float64Array, st, 4);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) if (arr[i] <= 600) { const x = i % nx, y = Math.floor(i / nx); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { len: x1 - x0 + 1, wid: y1 - y0 + 1, head, lb };
}
{
  const m = w.mark();
  const calm = burn(0);
  check('wildfire, no wind: circular', Math.abs(calm.len / calm.wid - 1) < 0.08, `extent ${calm.len}×${calm.wid} cells after 10 min, ROS ${calm.head.toFixed(1)} m/min`);
  const windy = burn(8);
  const ratio = windy.len / windy.wid;
  check('wildfire, 8 m/s wind: ellipse ≈ Anderson LB', Math.abs(ratio - windy.lb) / windy.lb < 0.1, `length/breadth ${ratio.toFixed(2)} vs LB ${windy.lb.toFixed(2)}, head ROS ${windy.head.toFixed(0)} m/min (short grass, 6% moisture)`);
  w.release(m);
}

// Plume
{
  const m = w.mark();
  const nx = 200, ny = 100, n = nx * ny;
  const c = w.reserve(Float64Array, n), tmp = w.reserve(Float64Array, n);
  w.view(Float64Array, c, n).fill(0);
  let mass = 0;
  for (let k = 0; k < 30; k++) mass = w.x.plume_step(c, tmp, nx, ny, 50, 50, 3, 0, 20, 0, 50 * nx + 20, k < 10 ? 1 : 0, 60);
  const cc = w.get(Float64Array, c, n);
  let cx = 0, tot = 0;
  for (let i = 0; i < n; i++) { cx += (i % nx) * cc[i]; tot += cc[i]; }
  const centreKm = ((cx / tot - 20) * 50) / 1000;
  check('plume: mass conserved, drifts downwind', Math.abs(mass - 600) / 600 < 0.02 && centreKm > 3, `mass ${mass.toFixed(1)} of 600 released, centre ${centreKm.toFixed(1)} km downwind after 30 min`);
  w.release(m);
}
process.exit(failed ? 1 : 0);
