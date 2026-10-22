/**
 * Compute worker — hosts the C core (worldy.wasm) off the main thread.
 * Messages: { id, op, args } → { id, result } | { id, error }.
 * Large typed arrays are transferred, not copied.
 */
import { instantiate } from './wasm';

const ready = instantiate(`${import.meta.env.BASE_URL}wasm/worldy.wasm`);

let rootMark = 0;
let sats = { ptr: 0, count: 0, mark: 0 };

const F64 = Float64Array;
const F32 = Float32Array;
const U8 = Uint8Array;

/** Run fn with scratch memory that is freed afterwards (satellite records are kept). */
function scratch(w, fn) {
  const m = w.mark();
  try {
    return fn();
  } finally {
    w.release(m);
  }
}

const ops = {
  // ── Satellites ──
  'sat:init'(w, { elements }) {
    w.release(rootMark);
    const n = elements.length / 8;
    const ptr = w.x.sat_init(w.put(elements), n);
    const deep = new U8(n);
    for (let i = 0; i < n; i++) deep[i] = w.x.sat_is_deep(ptr, i);
    sats = { ptr, count: n, mark: w.mark() };
    return { count: n, deep };
  },
  'sat:propagate'(w, { jd }) {
    return scratch(w, () => {
      const out = w.reserve(F64, sats.count * 3);
      w.x.sat_propagate(sats.ptr, sats.count, jd, out);
      return w.get(F64, out, sats.count * 3);
    });
  },
  'sat:track'(w, { index, jd0, stepSec, count }) {
    return scratch(w, () => {
      const out = w.reserve(F64, count * 3);
      const n = w.x.sat_track(sats.ptr, index, jd0, stepSec, count, out);
      return w.get(F64, out, n * 3);
    });
  },
  'sat:passes'(w, { index, jd0, hours, lat, lon, alt, minEl, max }) {
    return scratch(w, () => {
      const out = w.reserve(F64, max * 4);
      const n = w.x.sat_passes(sats.ptr, index, jd0, hours, lat, lon, alt, minEl, out, max);
      return w.get(F64, out, n * 4);
    });
  },

  // ── Geometry ──
  'geo:measure'(w, { pts, closed }) {
    return scratch(w, () => {
      const p = w.put(pts);
      const n = pts.length / 2;
      return {
        area: closed && n >= 3 ? w.x.geo_poly_area(p, n) : 0,
        length: n >= 2 ? w.x.geo_path_length(p, n, closed ? 1 : 0) : 0,
      };
    });
  },
  'geo:mask'(w, { pts, bounds, width, height }) {
    return scratch(w, () => {
      const out = w.reserve(U8, width * height);
      const [west, south, east, north] = bounds;
      w.x.geo_poly_mask(w.put(pts), pts.length / 2, west, south, east, north, width, height, out);
      return w.get(U8, out, width * height);
    });
  },

  // ── Terrain ──
  'grid:analyze'(w, { heights, width, height, dx, dy, mask }) {
    return scratch(w, () => {
      const n = width * height;
      const h = w.put(heights);
      const m = mask ? w.put(mask) : 0;
      const st = w.reserve(F64, 4);
      const count = w.x.ter_stats(h, m, n, st);
      const [min, max, mean, std] = w.get(F64, st, 4);
      const slope = w.reserve(F32, n);
      w.x.ter_slope(h, width, height, dx, dy, slope);
      const sl = w.view(F32, slope, n);
      let slopeSum = 0;
      let slopeMax = 0;
      for (let i = 0; i < n; i++) {
        if (mask && !mask[i]) continue;
        slopeSum += sl[i];
        if (sl[i] > slopeMax) slopeMax = sl[i];
      }
      const rgba = w.reserve(U8, n * 4);
      w.x.ter_render(h, m, width, height, dx, dy, min, max, rgba);
      return {
        count,
        min,
        max,
        mean,
        std,
        slopeMean: count ? slopeSum / count : 0,
        slopeMax,
        rgba: w.get(Uint8ClampedArray, rgba, n * 4),
      };
    });
  },
  'grid:viewshed'(w, { heights, width, height, dx, dy, ox, oy, obsH, targetH }) {
    return scratch(w, () => {
      const n = width * height;
      const out = w.reserve(U8, n);
      const visible = w.x.ter_viewshed(w.put(heights), width, height, dx, dy, ox, oy, obsH, targetH, out);
      const vis = w.view(U8, out, n);
      const rgba = new Uint8ClampedArray(n * 4);
      for (let i = 0; i < n; i++) {
        if (vis[i]) rgba.set([46, 204, 113, 120], 4 * i);
        else rgba.set([231, 76, 60, 90], 4 * i);
      }
      return { visible, total: n, rgba };
    });
  },

  // ── Simulations ──
  'sim:landslide'(w, { heights, width, height, dx, dy, release, depth }) {
    return scratch(w, () => {
      const n = width * height;
      const dep = w.reserve(F32, n);
      const st = w.reserve(F64, 7);
      w.x.ls_run(w.put(heights), width, height, dx, dy, w.put(release), depth, dep, st);
      const s = w.get(F64, st, 7);
      const rgba = w.reserve(U8, n * 4);
      w.x.ras_colorize(dep, n, 0, Math.max(1, s[5]), 1, rgba);
      return {
        stats: { volume: s[0], hl: s[1], reachAngle: s[2], area: s[3], runout: s[4], maxDeposit: s[5], lost: s[6] },
        deposit: w.get(F32, dep, n),
        rgba: w.get(Uint8ClampedArray, rgba, n * 4),
      };
    });
  },
  'sim:tsunamiSource'(w, { mw }) {
    return scratch(w, () => {
      const o = w.reserve(F64, 5);
      w.x.tsu_source(mw, o);
      const [m0, lengthKm, widthKm, slip, amplitude] = w.get(F64, o, 5);
      return { m0, lengthKm, widthKm, slip, amplitude };
    });
  },
  'sim:tsunamiTravel'(w, { bathy, width, height, bounds, srcLat, srcLon, a0, srcRadiusM }) {
    return scratch(w, () => {
      const n = width * height;
      const [west, south, east, north] = bounds;
      const t = w.reserve(F32, n);
      const a = w.reserve(F32, n);
      const st = w.reserve(F64, 2);
      const code = w.x.tsu_travel(w.put(bathy), width, height, west, south, east, north, srcLat, srcLon, a0, srcRadiusM, t, a, st);
      if (code !== 0) throw new Error('The source must be in the ocean.');
      const times = w.get(F32, t, n);
      let tMax = 0;
      for (const v of times) if (v > tMax) tMax = v;
      const rgba = w.reserve(U8, n * 4);
      w.x.ras_colorize(t, n, 0, tMax, 3, rgba);
      const [srcDepth, reached] = w.get(F64, st, 2);
      return { times, amp: w.get(F32, a, n), rgba: w.get(Uint8ClampedArray, rgba, n * 4), srcDepth, reached, tMax };
    });
  },
  'sim:inundate'(w, { heights, width, height, dx, dy, runup, manning }) {
    return scratch(w, () => {
      const n = width * height;
      const dep = w.reserve(F32, n);
      const st = w.reserve(F64, 4);
      const seaCells = w.x.tsu_inundate(w.put(heights), width, height, dx, dy, runup, manning, dep, st);
      const [area, inland, maxDepth, xmax] = w.get(F64, st, 4);
      const rgba = w.reserve(U8, n * 4);
      w.x.ras_colorize(dep, n, 0, Math.max(1, maxDepth), 2, rgba);
      return {
        stats: { area, inland, maxDepth, xmax, seaCells },
        depth: w.get(F32, dep, n),
        rgba: w.get(Uint8ClampedArray, rgba, n * 4),
      };
    });
  },
  'sim:flood'(w, { heights, width, height, dx, dy, rise, seedX = -1, seedY = -1 }) {
    return scratch(w, () => {
      const n = width * height;
      const dep = w.reserve(F32, n);
      const st = w.reserve(F64, 3);
      w.x.fl_fill(w.put(heights), width, height, dx, dy, rise, seedX, seedY, dep, st);
      const [area, maxDepth, cells] = w.get(F64, st, 3);
      const rgba = w.reserve(U8, n * 4);
      w.x.ras_colorize(dep, n, 0, Math.max(0.5, maxDepth), 2, rgba);
      return { stats: { area, maxDepth, cells }, depth: w.get(F32, dep, n), rgba: w.get(Uint8ClampedArray, rgba, n * 4) };
    });
  },
};

/** Collect the ArrayBuffers in a result so they can be transferred. */
function transferables(value, out = []) {
  if (ArrayBuffer.isView(value)) out.push(value.buffer);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) transferables(v, out);
  return out;
}

self.onmessage = async ({ data: { id, op, args } }) => {
  try {
    const w = await ready;
    if (!rootMark) rootMark = w.mark();
    const result = ops[op](w, args);
    self.postMessage({ id, result }, transferables(result));
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
