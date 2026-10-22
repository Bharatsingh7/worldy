/**
 * Analytic checks for the physics engine (run: node wasm/test/swe.test.mjs).
 *   1. Lake at rest over rough terrain and random building porosity stays at rest.
 *   2. Ritter dry dam-break: depth profile and front vs the exact solution.
 *   3. Mass conservation with event-driven local time stepping (closed basin).
 *   4. EDLTS vs global time stepping: same answer, fewer block updates.
 */
import fs from 'node:fs';
import { instantiate } from '../../src/compute/wasm.js';

const file = new URL('../../public/wasm/physics.wasm', import.meta.url);
const bytes = fs.readFileSync(file);
const w = await instantiate(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
const F = { z: 0, h: 1, qx: 2, qy: 3, phi: 4 };
const field = (s, f, n) => w.view(Float64Array, w.x.sim_ptr(s, f), n);
const stats = (s) => {
  const p = w.reserve(Float64Array, 12);
  w.x.sim_stats(s, p);
  return w.get(Float64Array, p, 12);
};
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failed++;
};

// 1. Lake at rest
{
  const m = w.mark();
  const nx = 64, ny = 64, n = nx * ny;
  const s = w.x.sim_create(nx, ny, 5, 5);
  const z = field(s, F.z, n), h = field(s, F.h, n), phi = field(s, F.phi, n);
  for (let i = 0; i < n; i++) {
    z[i] = 6 * rnd() + 4 * Math.sin(i / 50);
    h[i] = Math.max(0, 8 - z[i]);
    phi[i] = rnd() < 0.2 ? 0.3 + 0.7 * rnd() : 1;
  }
  for (let k = 20; k < 24; k++) w.x.sim_set(s, k, 0); // walls
  w.x.sim_start(s, 0);
  w.x.sim_advance(s, 300, 1e7);
  const qx = field(s, F.qx, n), qy = field(s, F.qy, n), hh = field(s, F.h, n), zz = field(s, F.z, n);
  let maxQ = 0, maxEta = 0;
  for (let i = 0; i < n; i++) {
    maxQ = Math.max(maxQ, Math.abs(qx[i]), Math.abs(qy[i]));
    if (hh[i] > 1e-3) maxEta = Math.max(maxEta, Math.abs(hh[i] + zz[i] - 8));
  }
  check('lake at rest (rough bed + porosity)', maxQ < 1e-10 && maxEta < 1e-10, `max|q| = ${maxQ.toExponential(2)}, max|η−8| = ${maxEta.toExponential(2)}`);
  w.release(m);
}

// 2. Ritter dam-break
{
  const m = w.mark();
  const nx = 800, ny = 2, n = nx * ny, dx = 0.5, x0 = 200, h0 = 1, T = 20;
  const s = w.x.sim_create(nx, ny, dx, dx);
  const h = field(s, F.h, n), manning = field(s, 5, n);
  for (let i = 0; i < n; i++) {
    h[i] = ((i % nx) + 0.5) * dx < x0 ? h0 : 0;
    manning[i] = 0; // Ritter's solution is frictionless
  }
  w.x.sim_set(s, 20, 0); w.x.sim_set(s, 22, 0); // N/S walls
  w.x.sim_set(s, 12, 0.5);
  w.x.sim_start(s, 0);
  w.x.sim_advance(s, T, 1e7);
  const g = 9.81, c0 = Math.sqrt(g * h0), hh = field(s, F.h, n);
  let err = 0, norm = 0, front = 0;
  for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * dx - x0;
    let exact = 0;
    if (x <= -c0 * T) exact = h0;
    else if (x <= 2 * c0 * T) exact = (2 * c0 - x / T) ** 2 / (9 * g);
    err += Math.abs(hh[i] - exact);
    norm += exact;
    if (hh[i] > 1e-3) front = x;
  }
  const exactFront = 2 * c0 * T;
  check('Ritter dam-break', err / norm < 0.05, `L1 rel. error ${(100 * err / norm).toFixed(2)}%, front ${front.toFixed(1)} m vs ${exactFront.toFixed(1)} m (exact front is a zero-depth tip)`);
  w.release(m);
}

// 3 & 4. Closed basin: mass conservation, EDLTS vs global step
function basin(lts) {
  const nx = 160, ny = 160, n = nx * ny;
  const s = w.x.sim_create(nx, ny, 10, 10);
  const z = field(s, F.z, n), h = field(s, F.h, n);
  seed = 11;
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      // valley sloping south-east with bumps; a deep reservoir in one corner
      z[i] = 0.05 * (nx - x) + 0.05 * (ny - y) + 2 * Math.sin(x / 9) * Math.cos(y / 13) + rnd();
      if (x < 30 && y < 30) h[i] = Math.max(0, 25 - z[i]);
    }
  for (let k = 20; k < 24; k++) w.x.sim_set(s, k, 0);
  w.x.sim_set(s, 1, lts);
  w.x.sim_start(s, 0);
  const v0 = w.x.sim_volume(s);
  const t0 = performance.now();
  w.x.sim_advance(s, 600, 1e8);
  const ms = performance.now() - t0;
  const st = stats(s);
  return { s, n, v0, v1: w.x.sim_volume(s), ms, events: st[6], h: w.get(Float64Array, w.x.sim_ptr(s, F.h), n) };
}
{
  const m = w.mark();
  const a = basin(1);
  const b = basin(0);
  const massErr = Math.abs(a.v1 - a.v0) / a.v0;
  check('mass conservation (EDLTS, closed basin)', massErr < 1e-12, `relative error ${massErr.toExponential(2)} (V0 = ${(a.v0 / 1e6).toFixed(3)} million m³)`);
  let diff = 0, norm = 0;
  for (let i = 0; i < a.n; i++) {
    diff += Math.abs(a.h[i] - b.h[i]);
    norm += b.h[i];
  }
  check('EDLTS ≈ global stepping', diff / norm < 0.03, `L1 difference ${(100 * diff / norm).toFixed(2)}%; block updates ${a.events} vs ${b.events} (${(b.events / a.events).toFixed(1)}× fewer), ${a.ms.toFixed(0)} ms vs ${b.ms.toFixed(0)} ms`);
  w.release(m);
}

// 5. Rainfall-runoff on a hillside with a river: where EDLTS should shine (shallow sheet flow + deep channel)
function catchment(lts) {
  const nx = 256, ny = 256, n = nx * ny;
  const s = w.x.sim_create(nx, ny, 10, 10);
  const z = field(s, F.z, n), h = field(s, F.h, n);
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      const d = Math.abs(x - nx / 2);
      z[i] = 0.02 * (ny - y) * 10 + 0.08 * d * 10 * (d > 6 ? 1 : 0) - (d <= 6 ? 4 : 0);
      if (d <= 6) h[i] = 3; // river channel
    }
  w.x.sim_set(s, 20, 0); w.x.sim_set(s, 21, 0); w.x.sim_set(s, 23, 0); // walls N/E/W, open S
  w.x.sim_set(s, 3, 50 / 1000 / 3600); // 50 mm/h on the upper third only
  const rain = field(s, 6, n);
  for (let i = 0; i < n; i++) rain[i] = Math.floor(i / nx) < ny / 3 ? 1 : 0;
  w.x.sim_set(s, 1, lts);
  w.x.sim_start(s, 0);
  const t0 = performance.now();
  w.x.sim_advance(s, 900, 1e8);
  const ms = performance.now() - t0;
  const st = stats(s);
  const v = w.x.sim_volume(s);
  return { ms, events: st[6], balance: Math.abs(v - (st[2] + st[3] - st[4] - st[5]) - 0) , v, st, h: w.get(Float64Array, w.x.sim_ptr(s, F.h), n), n };
}
{
  const m = w.mark();
  const a = catchment(1);
  const a0 = a.st; // rain in, outflow
  const b = catchment(0);
  let diff = 0, norm = 0;
  for (let i = 0; i < a.n; i++) { diff += Math.abs(a.h[i] - b.h[i]); norm += b.h[i]; }
  check('catchment: EDLTS vs dense solver', diff / norm < 0.03, `L1 difference ${(100 * diff / norm).toFixed(2)}%, ${a.ms.toFixed(0)} ms vs ${b.ms.toFixed(0)} ms (${(b.ms / a.ms).toFixed(1)}× faster), block updates ${a.events} vs ${b.events}; rain in ${(a0[2] / 1e3).toFixed(1)}k m³, outflow ${(a0[5] / 1e3).toFixed(1)}k m³`);
  w.release(m);
}

process.exit(failed ? 1 : 0);
