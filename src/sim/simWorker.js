/**
 * Physics engine worker — owns public/wasm/physics.wasm and runs the simulation clock.
 *
 * Kinds of run
 *   flow  : shallow-flow physics — mode 'swe' (EDLTS) or 'hbg' (basin-graph); optional Okada
 *           initial uplift (tsunami), moving cyclone forcing (wind, pressure, rain), tracers
 *   fire  : Rothermel + minimum-travel-time arrival field, played back over time
 *   plume : advection–diffusion of a released substance
 * plus an "instant" query (where rain finally collects).
 *
 * The worker advances the model in wall-clock slices (≈ 40 ms of compute each), applies
 * time-varying forcing, and posts frames at ≤ 15 fps with arrays transferred.
 */
import { instantiate } from '../compute/wasm';

const ready = instantiate(`${import.meta.env.BASE_URL}wasm/physics.wasm`);
const FRAME_MS = 66;
const BUDGET_MS = 40;
const F = { z: 0, h: 1, qx: 2, qy: 3, phi: 4, manning: 5, rainMul: 6, ks: 7, psid: 8, wx: 10, wy: 11, dp: 12, temp: 13, hmax: 14, tArrive: 15 };

let S = null;
let base = 0;

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

/** Position along a polyline [[lon, lat], …] at fraction f (by length), with heading. */
function alongTrack(track, f) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < track.length; i++) {
    const [a, b] = [track[i - 1], track[i]];
    const d = Math.hypot((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]);
    seg.push(d);
    total += d;
  }
  let s = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (s <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, s / seg[i]) : 0;
      const [a, b] = [track[i], track[i + 1]];
      return { lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, dirLon: b[0] - a[0], dirLat: b[1] - a[1], totalDeg: total };
    }
    s -= seg[i];
  }
  return { lon: track[0][0], lat: track[0][1], dirLon: 0, dirLat: 0, totalDeg: total };
}

function init(w, cfg) {
  if (!base) base = w.mark();
  w.release(base);
  const { nx, ny, dx, dy } = cfg.grid;
  const n = nx * ny;
  const kind = cfg.kind || 'flow';
  S = { w, cfg, kind, n, nx, ny, t: 0, running: false, speed: cfg.speed || 60, timer: null, peak: 0, outflowHbg: 0, rainHbg: 0, rain: 0 };
  S.depthPtr = w.reserve(Float32Array, n);
  S.speedPtr = w.reserve(Float32Array, n);
  S.statsPtr = w.reserve(Float64Array, 16);

  if (kind === 'fire') {
    const z = w.put(Float64Array.from(cfg.grid.z));
    const burnable = w.put(Uint8Array.from(cfg.fire.burnable));
    const ign = w.put(Uint8Array.from(cfg.fire.ignition));
    const tArr = w.reserve(Float32Array, n);
    const st = w.reserve(Float64Array, 4);
    w.x.fire_spread(z, burnable, ign, nx, ny, dx, dy, cfg.fire.wind, cfg.fire.windTo, cfg.fire.fuel, cfg.fire.moisture, cfg.duration, tArr, st);
    S.arrival = w.get(Float32Array, tArr, n);
    const [, headRos, lb] = w.get(Float64Array, st, 4);
    S.fireInfo = { headRos, lb };
    postFrame(true);
    return;
  }

  if (kind === 'plume') {
    S.c = w.reserve(Float64Array, n);
    S.tmp = w.reserve(Float64Array, n);
    w.view(Float64Array, S.c, n).fill(0);
    postFrame(true);
    return;
  }

  const sim = w.x.sim_create(nx, ny, dx, dy);
  S.sim = sim;
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

  const z = w.view(Float64Array, w.x.sim_ptr(sim, F.z), n);
  const h = w.view(Float64Array, w.x.sim_ptr(sim, F.h), n);
  if (cfg.okada) {
    // Tsunami: seafloor uplift from the Okada fault model becomes the initial sea surface
    const o = cfg.okada;
    const [W, Ss, E, N] = cfg.bounds;
    const up = w.reserve(Float32Array, n);
    S.uplift = w.x.okada_grid(o.lat, o.lon, o.depth, o.strike, o.dip, o.rake, o.slip, o.L, o.W, W, Ss, E, N, nx, ny, up);
    const uz = w.get(Float32Array, up, n);
    for (let i = 0; i < n; i++) if (z[i] < 0) h[i] = Math.max(0, -z[i] + uz[i]);
  } else if (cfg.seaAtRest) {
    for (let i = 0; i < n; i++) if (z[i] < 0) h[i] = -z[i];
  }

  if (cfg.cyclone) {
    w.x.sim_ptr(sim, F.wx); // allocates wind / pressure fields
    S.cycRain = w.reserve(Float64Array, n);
  }

  if (cfg.mode === 'hbg') {
    S.hbg = w.x.hbg_build(w.x.sim_ptr(sim, F.z), cfg.grid.phi ? w.x.sim_ptr(sim, F.phi) : 0, nx, ny, dx, dy, cfg.seaLevel ?? -1e9, 1);
    w.x.hbg_dyn_reset(S.hbg);
  }

  if (cfg.tracers) {
    const k = cfg.tracers.count;
    S.trX = w.reserve(Float32Array, k);
    S.trY = w.reserve(Float32Array, k);
    S.trAge = w.reserve(Float32Array, k);
    w.view(Float32Array, S.trAge, k).fill(1e9); // spawn on first step
    S.trU = w.reserve(Float64Array, n);
    S.trV = w.reserve(Float64Array, n);
    S.trMask = w.reserve(Uint8Array, n);
  }

  S.dirtyPtr = w.reserve(Uint8Array, Math.ceil(nx / 16) * Math.ceil(ny / 16));
  w.x.sim_start(sim, 0);
  applyForcing(0);
  postFrame(true);
}

function applyCyclone(t) {
  const { w, sim, cfg, n } = S;
  const c = cfg.cyclone;
  const p = alongTrack(c.track, t / cfg.duration);
  // forward motion (m/s) from the track length and the time it takes
  const speedMs = (p.totalDeg * 111320) / cfg.duration;
  const coslat = Math.cos((p.lat * Math.PI) / 180);
  const norm = Math.hypot(p.dirLon * coslat, p.dirLat) || 1;
  const vtx = (speedMs * p.dirLon * coslat) / norm;
  const vty = (speedMs * p.dirLat) / norm;
  const [W, Ss, E, N] = cfg.bounds;
  // weakening after landfall: the pressure deficit decays with an e-folding time of ~9 h
  const cx = Math.floor(((p.lon - W) / (E - W)) * S.nx);
  const cy = Math.floor(((N - p.lat) / (N - Ss)) * S.ny);
  const ci = Math.max(0, Math.min(n - 1, cy * S.nx + cx));
  if (cfg.grid.z[ci] > 0) S.overLand = (S.overLand || 0) + 600;
  const dp = c.dpHpa * Math.exp(-(S.overLand || 0) / (9 * 3600));
  const vmax = w.x.cyc_fields(p.lat, p.lon, dp, c.rmaxKm, c.B, vtx, vty, W, Ss, E, N, S.nx, S.ny, w.x.sim_ptr(sim, F.wx), w.x.sim_ptr(sim, F.wy), w.x.sim_ptr(sim, F.dp), S.cycRain);
  const rain = w.view(Float64Array, S.cycRain, n);
  let rmax = 0;
  for (let i = 0; i < n; i++) if (rain[i] > rmax) rmax = rain[i];
  const mul = w.view(Float64Array, w.x.sim_ptr(sim, F.rainMul), n);
  // rain only matters for flooding on land; over the sea it's just more ocean
  for (let i = 0; i < n; i++) mul[i] = rmax > 0 && cfg.grid.z[i] >= 0 ? rain[i] / rmax : 0;
  S.rain = rmax / 1000 / 3600;
  w.x.sim_set(sim, 3, S.rain);
  S.eye = { lon: p.lon, lat: p.lat, vmax, dp };
}

function applyForcing(t) {
  const { w, sim, cfg } = S;
  const f = cfg.forcing || {};
  if (cfg.cyclone) {
    if (t - (S.lastCyc ?? -1e9) >= 600) {
      applyCyclone(t);
      S.lastCyc = t;
    }
  } else {
    S.rain = Math.max(0, series(f.rain, t)) / 1000 / 3600; // mm/h → m/s
    w.x.sim_set(sim, 3, S.rain);
  }
  for (const inf of cfg.inflows || []) w.x.sim_inflow(sim, inf.cell, Math.max(0, series(inf.q, t)));
  if (f.level) f.level.forEach((ser, side) => ser && w.x.sim_set(sim, 30 + side, series(ser, t)));
  if (cfg.mode !== 'hbg') w.x.sim_wake_forced(sim);
}

/** Advance tracer particles through the current flow or wind field. */
function stepTracers(dtVisual) {
  const { w, sim, cfg, n, nx, ny } = S;
  const k = cfg.tracers.count;
  const u = w.view(Float64Array, S.trU, n);
  const v = w.view(Float64Array, S.trV, n);
  const mask = w.view(Uint8Array, S.trMask, n);
  if (cfg.tracers.source === 'wind') {
    const wx = w.view(Float64Array, w.x.sim_ptr(sim, F.wx), n);
    const wy = w.view(Float64Array, w.x.sim_ptr(sim, F.wy), n);
    for (let i = 0; i < n; i++) {
      u[i] = wx[i];
      v[i] = -wy[i];
      mask[i] = Math.abs(wx[i]) + Math.abs(wy[i]) > 3 ? 1 : 0;
    }
  } else {
    const h = w.view(Float64Array, w.x.sim_ptr(sim, F.h), n);
    const qx = w.view(Float64Array, w.x.sim_ptr(sim, F.qx), n);
    const qy = w.view(Float64Array, w.x.sim_ptr(sim, F.qy), n);
    for (let i = 0; i < n; i++) {
      const wet = h[i] > 0.05;
      u[i] = wet ? qx[i] / h[i] : 0;
      v[i] = wet ? qy[i] / h[i] : 0;
      mask[i] = wet && Math.abs(u[i]) + Math.abs(v[i]) > 0.05 ? 1 : 0;
    }
  }
  // visual step: fast enough to see motion, at most ~1.5 cells per frame for the fastest flow
  let vmax = 0.1;
  for (let i = 0; i < n; i += 7) vmax = Math.max(vmax, Math.abs(u[i]), Math.abs(v[i]));
  const dt = Math.min(dtVisual, (1.5 * Math.min(cfg.grid.dx, cfg.grid.dy)) / vmax);
  w.x.tracers_step(S.trX, S.trY, S.trAge, k, S.trU, S.trV, S.trMask, nx, ny, cfg.grid.dx, cfg.grid.dy, dt, 40 * dt);
  return { x: w.get(Float32Array, S.trX, k), y: w.get(Float32Array, S.trY, k) };
}

function postFrame(force = false) {
  const { w, n, cfg, kind } = S;
  let depth;
  let speed = null;
  let extra = {};

  if (kind === 'fire') {
    depth = new Float32Array(n);
    let burning = 0;
    let burnt = 0;
    for (let i = 0; i < n; i++) {
      const a = S.arrival[i];
      if (!(a <= S.t)) continue;
      if (S.t - a < 900) {
        depth[i] = 1;
        burning++;
      } else {
        depth[i] = 0.35;
        burnt++;
      }
    }
    const cell = cfg.grid.dx * cfg.grid.dy;
    extra = { burningArea: burning * cell, burntArea: (burnt + burning) * cell, headRos: S.fireInfo.headRos, lb: S.fireInfo.lb };
  } else if (kind === 'plume') {
    const c = w.view(Float64Array, S.c, n);
    depth = new Float32Array(n);
    let cmax = 0;
    for (let i = 0; i < n; i++) if (c[i] > cmax) cmax = c[i];
    let area = 0;
    for (let i = 0; i < n; i++) {
      const r = c[i] / (cmax || 1);
      depth[i] = r > 1e-4 ? Math.max(0, 1 + Math.log10(r) / 4) : 0;
      if (depth[i] > 0.02) area++;
    }
    extra = { plumeArea: area * cfg.grid.dx * cfg.grid.dy };
  } else if (cfg.mode === 'hbg') {
    w.x.hbg_dyn_depth(S.hbg, S.depthPtr);
    depth = w.get(Float32Array, S.depthPtr, n);
  } else {
    const changed = w.x.sim_frame(S.sim, S.depthPtr, S.speedPtr, S.dirtyPtr);
    const now = performance.now();
    if (!changed && !force && now - (S.lastPost || 0) < 1000) return; // heartbeat keeps the clock moving
    S.lastPost = now;
    depth = w.get(Float32Array, S.depthPtr, n);
    speed = w.get(Float32Array, S.speedPtr, n);
  }
  const transfer = [depth.buffer];
  if (speed) transfer.push(speed.buffer);

  let stats;
  if (kind === 'flow') {
    w.x.sim_stats(S.sim, S.statsPtr);
    const st = w.get(Float64Array, S.statsPtr, 12);
    let maxD = 0;
    let wet = 0;
    const z = cfg.grid.z;
    for (let i = 0; i < n; i++) {
      const land = !cfg.ocean || z[i] >= 0; // over the sea "depth" is the ocean itself
      if (land && depth[i] > maxD) maxD = depth[i];
      if (land && depth[i] > 0.05) wet++;
    }
    S.peak = Math.max(S.peak, maxD);
    stats = {
      t: S.t,
      rainRate: S.rain * 3600 * 1000,
      volume: st[1],
      rainIn: cfg.mode === 'hbg' ? S.rainHbg : st[2],
      outflow: cfg.mode === 'hbg' ? S.outflowHbg : st[5],
      events: st[6],
      awake: st[7],
      maxDepth: maxD,
      peakDepth: S.peak,
      wetArea: wet * cfg.grid.dx * cfg.grid.dy,
      eye: S.eye,
      uplift: S.uplift,
    };
  } else {
    stats = { t: S.t, ...extra };
  }
  let tracers = null;
  if (cfg.tracers && kind === 'flow') {
    tracers = stepTracers((S.speed * FRAME_MS) / 1000);
    transfer.push(tracers.x.buffer, tracers.y.buffer);
  }
  const probes = kind === 'flow' ? (cfg.probes || []).map((c) => ({ cell: c, depth: depth[c], speed: speed ? speed[c] : 0 })) : [];
  self.postMessage({ type: 'frame', depth, speed, stats, probes, tracers }, transfer);
}

function tick() {
  if (!S?.running) return;
  const start = performance.now();
  const { w, cfg, kind } = S;
  const target = S.t + (S.speed * FRAME_MS) / 1000;
  const end = cfg.duration ?? Infinity;
  if (kind === 'fire') {
    S.t = Math.min(target, end);
  } else if (kind === 'plume') {
    const p = cfg.plume;
    while (S.t < Math.min(target, end) && performance.now() - start < BUDGET_MS) {
      const dt = Math.min(60, Math.min(target, end) - S.t);
      const rate = S.t < p.releaseS ? p.rate : 0;
      w.x.plume_step(S.c, S.tmp, S.nx, S.ny, cfg.grid.dx, cfg.grid.dy, p.u, p.v, p.K, p.lambda, p.srcCell, rate, dt);
      S.t += dt;
    }
  } else if (cfg.mode === 'hbg') {
    const st = S.statsPtr;
    while (S.t < Math.min(target, end) && performance.now() - start < BUDGET_MS) {
      const dt = Math.min(60, Math.min(target, end) - S.t);
      applyForcing(S.t);
      w.x.hbg_dyn_step(S.hbg, dt, S.rain, cfg.runoff ?? 1, st);
      const r = w.get(Float64Array, st, 2);
      S.outflowHbg += r[1];
      S.rainHbg += S.rain * S.n * cfg.grid.dx * cfg.grid.dy * dt;
      S.t += dt;
    }
  } else {
    // advance in slices so forcing updates at least every 30 s of simulated time
    while (S.t < Math.min(target, end) && performance.now() - start < BUDGET_MS) {
      const sliceEnd = Math.min(target, end, S.t + 30);
      applyForcing(S.t);
      S.t = w.x.sim_advance(S.sim, sliceEnd, 4000);
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

const ops = {
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
    if (!S.hbg) S.hbg = w.x.hbg_build(w.x.sim_ptr(S.sim, F.z), 0, S.nx, S.ny, S.cfg.grid.dx, S.cfg.grid.dy, S.cfg.seaLevel ?? -1e9, 1);
    const st = w.reserve(Float64Array, 4);
    w.x.hbg_fsm(S.hbg, rainMm / 1000, runoff, S.depthPtr, st);
    const depth = w.get(Float32Array, S.depthPtr, n);
    const [ponded, lost, lakes, deepest] = w.get(Float64Array, st, 4);
    self.postMessage({ type: 'instant', depth, stats: { ponded, lost, lakes, deepest } }, [depth.buffer]);
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
