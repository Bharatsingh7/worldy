/**
 * Physics engine worker — owns public/wasm/physics.wasm and runs the simulation clock.
 *
 * Modes
 *   swe : full shallow-water physics with event-driven local time stepping (EDLTS)
 *   hbg : hierarchical basin-graph dynamics (whole-region floods, much faster)
 * plus an "instant" query (where rain finally collects).
 *
 * The worker advances the model in wall-clock slices (≈ 40 ms of compute each), applies
 * time-varying forcing, and posts frames at ≤ 15 fps with depth/speed arrays transferred.
 */
import { instantiate } from '../compute/wasm';

const ready = instantiate(`${import.meta.env.BASE_URL}wasm/physics.wasm`);
const FRAME_MS = 66;
const BUDGET_MS = 40;

let S = null; // current simulation
let base = 0;

const F = { z: 0, h: 1, qx: 2, qy: 3, phi: 4, manning: 5, rainMul: 6, ks: 7, psid: 8, wx: 10, wy: 11, dp: 12, temp: 13, hmax: 14, tArrive: 15 };

/** Piecewise-linear value of a [[t, v], …] series at time t. */
function series(points, t) {
  if (!points?.length) return 0;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    if (t <= t1) {
      const [t0, v0] = points[i - 1];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
    }
  }
  return points[points.length - 1][1];
}

function init(w, cfg) {
  if (!base) base = w.mark();
  w.release(base);
  const { nx, ny, dx, dy } = cfg.grid;
  const n = nx * ny;
  const sim = w.x.sim_create(nx, ny, dx, dy);
  const set = (field, arr) => arr && w.view(Float64Array, w.x.sim_ptr(sim, F[field]), n).set(arr);
  set('z', cfg.grid.z);
  set('h', cfg.grid.h0);
  set('phi', cfg.grid.phi);
  set('manning', cfg.grid.manning);
  set('rainMul', cfg.grid.rainMul);
  set('ks', cfg.grid.ks);
  set('psid', cfg.grid.psid);
  if (cfg.lava) w.view(Float64Array, w.x.sim_ptr(sim, F.temp), n).fill(25);
  for (const [k, v] of Object.entries(cfg.params || {})) w.x.sim_set(sim, Number(k), v);
  (cfg.bc || [1, 1, 1, 1]).forEach((b, i) => w.x.sim_set(sim, 20 + i, b));
  (cfg.bcLevel || []).forEach((v, i) => w.x.sim_set(sim, 30 + i, v));
  for (const inf of cfg.inflows || []) w.x.sim_inflow(sim, inf.cell, series(inf.q, 0));

  let hbg = 0;
  if (cfg.mode === 'hbg' || cfg.wantInstant) {
    hbg = w.x.hbg_build(w.x.sim_ptr(sim, F.z), cfg.grid.phi ? w.x.sim_ptr(sim, F.phi) : 0, nx, ny, dx, dy, cfg.seaLevel ?? -1e9, 1);
    w.x.hbg_dyn_reset(hbg);
  }
  const depthPtr = w.reserve(Float32Array, n);
  const speedPtr = w.reserve(Float32Array, n);
  const dirtyPtr = w.reserve(Uint8Array, Math.ceil(nx / 16) * Math.ceil(ny / 16));
  const statsPtr = w.reserve(Float64Array, 16);
  const scratch = w.mark();
  w.x.sim_start(sim, 0);
  S = { w, cfg, sim, hbg, n, nx, ny, depthPtr, speedPtr, dirtyPtr, statsPtr, scratch, t: 0, running: false, speed: cfg.speed || 60, timer: null, peak: 0, outflowHbg: 0, rainHbg: 0 };
  applyForcing(0);
  postFrame(true);
}

function applyForcing(t) {
  const { w, sim, cfg } = S;
  const f = cfg.forcing || {};
  S.rain = Math.max(0, series(f.rain, t)) / 1000 / 3600; // mm/h → m/s
  w.x.sim_set(sim, 3, S.rain);
  for (const inf of cfg.inflows || []) w.x.sim_inflow(sim, inf.cell, Math.max(0, series(inf.q, t)));
  if (f.level) f.level.forEach((ser, side) => ser && w.x.sim_set(sim, 30 + side, series(ser, t)));
  // anything newly forced (rain starting, an inflow opening) must be awake to respond
  if (cfg.mode !== 'hbg') w.x.sim_wake_forced(sim);
}

function postFrame(force = false) {
  const { w, sim, hbg, n, cfg } = S;
  let depth;
  let speed = null;
  if (cfg.mode === 'hbg') {
    w.x.hbg_dyn_depth(hbg, S.depthPtr);
    depth = w.get(Float32Array, S.depthPtr, n);
  } else {
    const changed = w.x.sim_frame(sim, S.depthPtr, S.speedPtr, S.dirtyPtr);
    const now = performance.now();
    if (!changed && !force && now - (S.lastPost || 0) < 1000) return; // heartbeat keeps the clock moving
    S.lastPost = now;
    depth = w.get(Float32Array, S.depthPtr, n);
    speed = w.get(Float32Array, S.speedPtr, n);
  }
  w.x.sim_stats(sim, S.statsPtr);
  const st = w.get(Float64Array, S.statsPtr, 12);
  let maxD = 0;
  let wet = 0;
  for (let i = 0; i < n; i++) {
    if (depth[i] > maxD) maxD = depth[i];
    if (depth[i] > 0.05) wet++;
  }
  S.peak = Math.max(S.peak, maxD);
  const probes = (cfg.probes || []).map((c) => ({ cell: c, depth: depth[c], speed: speed ? speed[c] : 0 }));
  const stats = {
    t: S.t,
    rainRate: S.rain * 3600 * 1000,
    volume: cfg.mode === 'hbg' ? st[1] : st[1],
    rainIn: cfg.mode === 'hbg' ? S.rainHbg : st[2],
    inflowIn: st[3],
    infiltrated: st[4],
    outflow: cfg.mode === 'hbg' ? S.outflowHbg : st[5],
    events: st[6],
    awake: st[7],
    maxDepth: maxD,
    peakDepth: S.peak,
    wetArea: wet * cfg.grid.dx * cfg.grid.dy,
    dtBase: st[10],
  };
  self.postMessage({ type: 'frame', depth, speed, stats, probes }, speed ? [depth.buffer, speed.buffer] : [depth.buffer]);
}

function tick() {
  if (!S?.running) return;
  const start = performance.now();
  const { w, sim, hbg, cfg } = S;
  const target = S.t + (S.speed * FRAME_MS) / 1000;
  const end = cfg.duration ?? Infinity;
  if (cfg.mode === 'hbg') {
    const st = S.statsPtr;
    while (S.t < Math.min(target, end) && performance.now() - start < BUDGET_MS) {
      const dt = Math.min(60, Math.min(target, end) - S.t);
      applyForcing(S.t);
      w.x.hbg_dyn_step(hbg, dt, S.rain, cfg.runoff ?? 1, st);
      const r = w.get(Float64Array, st, 2);
      S.outflowHbg += r[1];
      S.rainHbg += S.rain * S.n * cfg.grid.dx * cfg.grid.dy * dt;
      S.t += dt;
    }
  } else {
    // advance in sub-slices so forcing updates at least every 30 s of sim time
    while (S.t < Math.min(target, end) && performance.now() - start < BUDGET_MS) {
      const sliceEnd = Math.min(target, end, S.t + 30);
      applyForcing(S.t);
      S.t = w.x.sim_advance(sim, sliceEnd, 4000);
      if (S.t < sliceEnd - 1e-9) break; // event budget used up; continue next tick
    }
  }
  postFrame();
  if (S.t >= end) {
    S.running = false;
    self.postMessage({ type: 'done', t: S.t });
    return;
  }
  S.timer = setTimeout(tick, Math.max(0, FRAME_MS - (performance.now() - start)));
}

function snapshot(field) {
  const { w, sim, n } = S;
  return w.get(Float64Array, w.x.sim_ptr(sim, F[field]), n);
}

const ops = {
  init,
  run({ speed }) {
    if (!S) return;
    if (speed) S.speed = speed;
    if (!S.running) {
      S.running = true;
      tick();
    }
  },
  pause() {
    if (!S) return;
    S.running = false;
    clearTimeout(S.timer);
  },
  speed({ speed }) {
    if (S) S.speed = speed;
  },
  probes({ cells }) {
    if (S) S.cfg.probes = cells;
  },
  instant({ rainMm, runoff }) {
    const { w, n } = S;
    if (!S.hbg) {
      S.hbg = w.x.hbg_build(w.x.sim_ptr(S.sim, F.z), 0, S.nx, S.ny, S.cfg.grid.dx, S.cfg.grid.dy, S.cfg.seaLevel ?? -1e9, 1);
    }
    const st = w.reserve(Float64Array, 4);
    w.x.hbg_fsm(S.hbg, rainMm / 1000, runoff, S.depthPtr, st);
    const depth = w.get(Float32Array, S.depthPtr, n);
    const [ponded, lost, lakes, deepest] = w.get(Float64Array, st, 4);
    self.postMessage({ type: 'instant', depth, stats: { ponded, lost, lakes, deepest } }, [depth.buffer]);
  },
  maxima() {
    self.postMessage({ type: 'maxima', hmax: snapshot('hmax'), tArrive: snapshot('tArrive') });
  },
};

self.onmessage = async ({ data }) => {
  try {
    const w = await ready;
    if (data.op === 'init') init(w, data.cfg);
    else ops[data.op]?.(data);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
