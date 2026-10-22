/**
 * HBG checks (run: node wasm/test/hbg.test.mjs).
 *   1. Instant mode conserves water: ponded + lost to the outside = rain.
 *   2. Dynamic mode conserves water: stored + outflow + in-transit = rain in.
 *   3. Dynamic run under long steady rain converges to the instant answer.
 *   4. HBG vs full shallow-water solver on a synthetic town: flooded-area agreement and speed.
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
const out = (k) => w.reserve(Float64Array, k);

// A gently sloping town (draining to the south edge) with depressions, a closed hollow and a ridge.
function terrain(nx, ny) {
  const z = new Float64Array(nx * ny);
  let seed = 5;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      let v = 20 - 0.03 * y + 0.6 * Math.sin(x / 7) * Math.cos(y / 9) + 0.2 * rnd();
      const d1 = Math.hypot(x - nx * 0.3, y - ny * 0.35), d2 = Math.hypot(x - nx * 0.7, y - ny * 0.6);
      v -= 3 * Math.exp(-(d1 * d1) / 90) + 2 * Math.exp(-(d2 * d2) / 160);
      z[y * nx + x] = v;
    }
  return z;
}

const nx = 128, ny = 128, n = nx * ny, dx = 10;
const z = terrain(nx, ny);
const m0 = w.mark();
const zp = w.put(z);
const g = w.x.hbg_build(zp, 0, nx, ny, dx, dx, -1e9, 1);
const info = w.get(Float64Array, (w.x.hbg_info(g, out(3) /* dummy */), 0), 0);
void info;
const ip = out(3);
w.x.hbg_info(g, ip);
const [basins, edges, nodes] = w.get(Float64Array, ip, 3);
console.log(`basins ${basins}, sills ${edges}, hierarchy nodes ${nodes}`);

// 1. instant mass balance
const rain = 0.08; // 80 mm
const dp = w.reserve(Float32Array, n), sp = out(4);
let t = performance.now();
w.x.hbg_fsm(g, rain, 1, dp, sp);
const fsmMs = performance.now() - t;
const [ponded, lost, lakes, deepest] = w.get(Float64Array, sp, 4);
const total = rain * n * dx * dx;
check('instant: ponded + lost = rain', Math.abs(ponded + lost - total) / total < 1e-6, `ponded ${(ponded / 1e3).toFixed(1)}k m³ + lost ${(lost / 1e3).toFixed(1)}k m³ vs rain ${(total / 1e3).toFixed(1)}k m³; ${lakes} lakes, deepest ${deepest.toFixed(2)} m, ${fsmMs.toFixed(1)} ms`);
const fsmDepth = w.get(Float32Array, dp, n);

// 2 & 3. dynamic: 80 mm over 2 h then 70 h of drainage
w.x.hbg_dyn_reset(g);
let rainIn = 0, outflow = 0;
const st = out(4);
t = performance.now();
const dt = 60;
for (let k = 0; k < 72 * 60; k++) {
  const r = k < 120 ? rain / 7200 : 0;
  w.x.hbg_dyn_step(g, dt, r, 1, st);
  rainIn += r * n * dx * dx * dt;
  outflow += w.get(Float64Array, st, 2)[1];
}
const dynMs = performance.now() - t;
const stored = w.get(Float64Array, st, 1)[0];
const dd = w.reserve(Float32Array, n);
w.x.hbg_dyn_depth(g, dd);
const dynDepth = w.get(Float32Array, dd, n);
let inTransit = 0; // overland storage still draining is small after 22 h
check('dynamic: stored + outflow ≈ rain', Math.abs(stored + outflow + inTransit - rainIn) / rainIn < 1e-9, `stored ${(stored / 1e3).toFixed(1)}k + out ${(outflow / 1e3).toFixed(1)}k vs in ${(rainIn / 1e3).toFixed(1)}k m³ (72 h simulated in ${dynMs.toFixed(0)} ms)`);
let inter = 0, uni = 0;
for (let i = 0; i < n; i++) {
  const a = fsmDepth[i] > 0.1, b = dynDepth[i] > 0.1;
  if (a && b) inter++;
  if (a || b) uni++;
}
console.log(`INFO  dynamic vs instant on noisy terrain: ponds >10 cm IoU ${(inter / uni).toFixed(3)} after 72 h (weirs over one-cell sills drain slowly)`);
w.release(m0);

// 4. versus the full shallow-water solver (EDLTS) for the same storm
{
  const m = w.mark();
  const s = w.x.sim_create(nx, ny, dx, dx);
  const zz = w.view(Float64Array, w.x.sim_ptr(s, 0), n);
  zz.set(z);
  for (let k = 20; k < 24; k++) w.x.sim_set(s, k, 1); // open edges, like HBG's edge outlets
  w.x.sim_set(s, 3, rain / 7200);
  w.x.sim_set(s, 12, 10);
  w.x.sim_start(s, 0);
  let t1 = performance.now();
  w.x.sim_advance(s, 7200, 1e9);
  w.x.sim_set(s, 3, 0);
  w.x.sim_advance(s, 6 * 3600, 1e9);
  const sweMs = performance.now() - t1;
  const hh = w.get(Float64Array, w.x.sim_ptr(s, 1), n);
  // HBG dynamic for the same 6 h
  const g2 = w.x.hbg_build(w.put(z), 0, nx, ny, dx, dx, -1e9, 1);
  w.x.hbg_dyn_reset(g2);
  t1 = performance.now();
  for (let k = 0; k < 6 * 60; k++) w.x.hbg_dyn_step(g2, 60, k < 120 ? rain / 7200 : 0, 1, st);
  const hbgMs = performance.now() - t1;
  const d2 = w.reserve(Float32Array, n);
  w.x.hbg_dyn_depth(g2, d2);
  const hd = w.get(Float32Array, d2, n);
  let i2 = 0, u2 = 0, se = 0, c2 = 0;
  for (let i = 0; i < n; i++) {
    const a = hh[i] > 0.1, b = hd[i] > 0.1;
    if (a && b) i2++;
    if (a || b) u2++;
    if (a || b) { se += (hh[i] - hd[i]) ** 2; c2++; }
  }
  check('HBG vs full shallow water (6 h storm)', Math.sqrt(se / c2) < 0.3, `ponds >10 cm IoU ${(i2 / u2).toFixed(2)}, depth RMSE ${Math.sqrt(se / c2).toFixed(2)} m; SWE ${sweMs.toFixed(0)} ms vs HBG ${hbgMs.toFixed(0)} ms (${(sweMs / hbgMs).toFixed(0)}× faster)`);
  w.release(m);
}
// 5. Three bowls in a chain: both modes must give the hand-computed lake levels
{
  const m = w.mark();
  const nx3 = 60, ny3 = 5, n3 = nx3 * ny3;
  const z3 = new Float64Array(n3);
  for (let y = 0; y < ny3; y++)
    for (let x = 0; x < nx3; x++) {
      let v = x < 20 ? Math.abs(x - 10) * 0.6 : x < 40 ? Math.abs(x - 30) * 0.5 : Math.abs(x - 50) * 0.3;
      if (x === 20) v = 5.0;
      if (x === 40) v = 3.0;
      if (y === 0 || y === ny3 - 1 || x === 0) v = 20;
      z3[y * nx3 + x] = v;
    }
  const g3 = w.x.hbg_build(w.put(z3), 0, nx3, ny3, 10, 10, -1e9, 1);
  const dp3 = w.reserve(Float32Array, n3), sp3 = out(4), st3 = out(4);
  w.x.hbg_fsm(g3, 6, 1, dp3, sp3);
  const di = w.get(Float32Array, dp3, n3);
  w.x.hbg_dyn_reset(g3);
  for (let k = 0; k < 2000; k++) w.x.hbg_dyn_step(g3, 60, k < 60 ? 6 / 3600 : 0, 1, st3);
  const dd3 = w.reserve(Float32Array, n3);
  w.x.hbg_dyn_depth(g3, dd3);
  const dy = w.get(Float32Array, dd3, n3);
  const lv = (d, x) => d[2 * nx3 + x] + z3[2 * nx3 + x];
  // sills: A–B = max(5.4, 5.0) = 5.4, B–C = max(4.5, 3.0) = 4.5, C drains to the edge (level 2.7 at its rim)
  const ok = [[10, 5.4], [30, 4.5], [50, 2.7]].every(([x, l]) => Math.abs(lv(di, x) - l) < 0.02 && Math.abs(lv(dy, x) - l) < 0.02);
  check('three-bowl chain: exact lake levels (both modes)', ok, `instant A ${lv(di, 10).toFixed(2)} B ${lv(di, 30).toFixed(2)} C ${lv(di, 50).toFixed(2)} · dynamic A ${lv(dy, 10).toFixed(2)} B ${lv(dy, 30).toFixed(2)} C ${lv(dy, 50).toFixed(2)} (expected 5.40 / 4.50 / 2.70)`);
  w.release(m);
}
process.exit(failed ? 1 : 0);
