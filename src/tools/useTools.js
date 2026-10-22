import { useState, useEffect, useRef, useCallback } from 'react';
import { ImageryLayer, Rectangle } from 'cesium';

import DrawTool from './DrawTool';
import { AREAS, LENGTHS, compare } from './references';
import {
  boundsOf,
  gridSpec,
  sampleHeights,
  sampleProfile,
  sampleBathymetry,
  addRasterOverlay,
  cellAt,
} from './grid';
import { compute } from '../compute/client';
import { overpass, bboxQL, elementLatLon } from '../datalayers/overpass';
import { IMAGERY_LAYERS } from '../layers';

const STORAGE_KEY = 'worldy.shapes';
/** Terrain heights at or below this count as sea (elevation models put the sea at ~0 ± noise). */
const SEA_LEVEL = 0.5;
const TYPE_LABEL = { point: 'Point', line: 'Line', polygon: 'Area', rect: 'Rectangle', circle: 'Circle' };
export const isArea = (s) => s.type === 'polygon' || s.type === 'rect' || s.type === 'circle';

function loadShapes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

const flat = (points) => new Float64Array(points.flat());

function pointInPoly(lon, lat, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Height grid + polygon mask for a shape's bounds. */
async function terrainGrid(shape, bounds, maxCells) {
  const spec = gridSpec(bounds, maxCells);
  const heights = await sampleHeights(bounds, spec.width, spec.height, Math.max(spec.dx, spec.dy));
  const mask = isArea(shape)
    ? await compute('geo:mask', { pts: flat(shape.points), bounds, width: spec.width, height: spec.height })
    : null;
  return { ...spec, bounds, heights, mask };
}

/** Clear pixels outside the mask. */
function clipRgba(rgba, mask) {
  if (!mask) return rgba;
  for (let i = 0; i < mask.length; i++) if (!mask[i]) rgba[4 * i + 3] = 0;
  return rgba;
}

/** Named settlements from OSM inside bounds, with an optional per-point filter. */
async function settlementsIn(bounds, keep = () => true) {
  const els = await overpass(`[out:json][timeout:25];node["place"~"^(city|town|village|hamlet|suburb)$"](${bboxQL(bounds)});out 400;`);
  return els
    .filter((e) => e.tags?.name && keep(e.lon, e.lat))
    .map((e) => ({ name: e.tags.name, kind: e.tags.place, lat: e.lat, lon: e.lon, pop: Number(e.tags.population) || 0 }))
    .sort((a, b) => b.pop - a.pop);
}

const NEARBY_CATEGORIES = [
  { label: 'Settlements', test: (t) => t.place },
  { label: 'Hospitals', test: (t) => t.amenity === 'hospital' },
  { label: 'Schools & universities', test: (t) => t.amenity === 'school' || t.amenity === 'university' },
  { label: 'Police & fire stations', test: (t) => t.amenity === 'police' || t.amenity === 'fire_station' },
  { label: 'Airports', test: (t) => t.aeroway === 'aerodrome' },
  { label: 'Power plants', test: (t) => t.power === 'plant' },
  { label: 'Lakes & reservoirs', test: (t) => t.natural === 'water' },
  { label: 'Military sites', test: (t) => t.landuse === 'military' || t.military },
  { label: 'Attractions & museums', test: (t) => t.tourism === 'attraction' || t.tourism === 'museum' },
];

/**
 * Drawn shapes and everything you can do with them: measure & compare, elevation,
 * nearby features, apply a map, viewshed, satellites overhead, and the landslide /
 * flood / tsunami simulations (all heavy maths in the C core).
 */
export default function useTools(viewer, { getLayer }) {
  const [shapes, setShapes] = useState(loadShapes);
  const [selectedId, setSelectedId] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [results, setResults] = useState({});
  const toolRef = useRef(null);
  const overlays = useRef(new Map());
  const shapesRef = useRef(shapes);

  useEffect(() => {
    if (!viewer) return;
    const tool = new DrawTool(viewer);
    toolRef.current = tool;
    return () => {
      tool.destroy();
      toolRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    shapesRef.current = shapes;
    toolRef.current?.sync(shapes, selectedId);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shapes));
    } catch {
      // ignore
    }
  }, [shapes, selectedId, viewer]);

  const isBusy = useCallback(() => !!toolRef.current?.drawing, []);

  const patch = useCallback((id, kind, value) => {
    setResults((r) => ({ ...r, [id]: { ...r[id], [kind]: value } }));
  }, []);

  const setOverlay = useCallback(
    (id, kind, layer) => {
      const key = `${id}:${kind}`;
      const old = overlays.current.get(key);
      if (old) viewer.imageryLayers.remove(old);
      if (layer) overlays.current.set(key, layer);
      else overlays.current.delete(key);
      viewer.scene.requestRender();
    },
    [viewer]
  );

  /** Run an analysis, tracking busy/error state under results[id][kind]. */
  const run = useCallback(
    async (shape, kind, fn) => {
      patch(shape.id, kind, { busy: true });
      try {
        patch(shape.id, kind, await fn());
      } catch (err) {
        patch(shape.id, kind, { error: err.message || String(err) });
      }
    },
    [patch]
  );

  /** Look up settlements in the affected zone after the result is shown (OSM can be slow). */
  const addSettlements = useCallback(
    (id, kind, bounds, keep) => {
      settlementsIn(bounds, keep)
        .catch(() => null)
        .then((list) => setResults((r) => (r[id]?.[kind] && !r[id][kind].busy ? { ...r, [id]: { ...r[id], [kind]: { ...r[id][kind], settlements: list } } } : r)));
    },
    []
  );

  // ── Measure & compare ───────────────────────────────
  const measure = useCallback(
    (shape) =>
      run(shape, 'measure', async () => {
        if (shape.type === 'point') return { lon: shape.points[0][0], lat: shape.points[0][1] };
        const closed = isArea(shape);
        const { area, length } = await compute('geo:measure', { pts: flat(shape.points), closed });
        return {
          area,
          length,
          radius: shape.radiusM,
          compare: closed ? compare(area / 1e6, AREAS, 'km2') : compare(length / 1000, LENGTHS, 'km'),
        };
      }),
    [run]
  );

  // ── Drawing ─────────────────────────────────────────
  const draw = useCallback(
    async (type) => {
      if (!toolRef.current) return;
      setDrawing(type);
      const geom = await toolRef.current.start(type);
      setDrawing(null);
      if (!geom) return;
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const n = shapesRef.current.filter((s) => s.type === type).length + 1;
      const shape = { id, name: `${TYPE_LABEL[type]} ${n}`, ...geom };
      setShapes((list) => [...list, shape]);
      setSelectedId(id);
      measure(shape);
    },
    [measure]
  );

  const cancelDraw = useCallback(() => toolRef.current?.cancel(), []);

  const remove = useCallback(
    (id) => {
      for (const key of [...overlays.current.keys()]) if (key.startsWith(`${id}:`)) setOverlay(id, key.split(':')[1], null);
      setShapes((list) => list.filter((s) => s.id !== id));
      setResults((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      setSelectedId((sel) => (sel === id ? null : sel));
    },
    [setOverlay]
  );

  const rename = useCallback((id, name) => setShapes((list) => list.map((s) => (s.id === id ? { ...s, name } : s))), []);

  const clearResult = useCallback(
    (id, kind) => {
      setOverlay(id, kind, null);
      if (kind === 'tsunami') setOverlay(id, 'tsunamiTime', null);
      patch(id, kind, undefined);
    },
    [setOverlay, patch]
  );

  // ── Elevation ───────────────────────────────────────
  const elevation = useCallback(
    (shape) =>
      run(shape, 'elevation', async () => {
        if (shape.type === 'line') {
          const { dist, heights, total } = await sampleProfile(shape.points, 160);
          let gain = 0;
          let loss = 0;
          for (let i = 1; i < heights.length; i++) {
            const d = heights[i] - heights[i - 1];
            if (d > 0) gain += d;
            else loss -= d;
          }
          return { profile: { dist, heights, total }, min: Math.min(...heights), max: Math.max(...heights), gain, loss };
        }
        const bounds = boundsOf(shape.points, 0.02, shape.type === 'point' ? 6000 : 0);
        const g = await terrainGrid(shape, bounds, 128);
        const r = await compute('grid:analyze', { heights: g.heights, width: g.width, height: g.height, dx: g.dx, dy: g.dy, mask: g.mask });
        setOverlay(shape.id, 'elevation', await addRasterOverlay(viewer, r.rgba, g.width, g.height, bounds, 0.9));
        return { min: r.min, max: r.max, mean: r.mean, std: r.std, slopeMean: r.slopeMean, slopeMax: r.slopeMax, cellM: Math.max(g.dx, g.dy) };
      }),
    [run, setOverlay, viewer]
  );

  // ── Nearby features ─────────────────────────────────
  const nearby = useCallback(
    (shape) =>
      run(shape, 'nearby', async () => {
        const bounds = boundsOf(shape.points, 0, shape.type === 'point' ? 5000 : 0);
        const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
        const b = bboxQL(bounds);
        const detail =
          span > 1.5
            ? ''
            : `nwr["amenity"~"^(hospital|school|university|police|fire_station)$"](${b});nwr["natural"="water"]["name"](${b});nwr["landuse"="military"](${b});nwr["tourism"~"^(attraction|museum)$"](${b});`;
        const els = await overpass(
          `[out:json][timeout:30];(node["place"~"^(city|town|village|suburb)$"](${b});nwr["aeroway"="aerodrome"](${b});nwr["power"="plant"](${b});${detail});out center tags 2000;`
        );
        const inside = (lon, lat) => (isArea(shape) ? pointInPoly(lon, lat, shape.points) : true);
        const items = [];
        for (const el of els) {
          const p = elementLatLon(el);
          if (!p || !inside(p.lon, p.lat)) continue;
          const cat = NEARBY_CATEGORIES.find((c) => c.test(el.tags || {}));
          if (cat) items.push({ ...p, cat: cat.label, name: el.tags.name || '(unnamed)', pop: Number(el.tags.population) || 0 });
        }
        const counts = NEARBY_CATEGORIES.map((c) => [c.label, items.filter((i) => i.cat === c.label).length]).filter(([, n]) => n);
        items.sort((a, b) => b.pop - a.pop || (a.name === '(unnamed)') - (b.name === '(unnamed)'));
        return { counts, items: items.slice(0, 40), coarse: span > 1.5 };
      }),
    [run]
  );

  // ── Apply a base map to this area only ─────────────
  const applyMap = useCallback(
    (shape, imageryId) =>
      run(shape, 'applied', async () => {
        const def = IMAGERY_LAYERS.find((l) => l.id === imageryId);
        const provider = await def.createProvider();
        const [w, s, e, n] = boundsOf(shape.points);
        const layer = new ImageryLayer(provider, { rectangle: Rectangle.fromDegrees(w, s, e, n) });
        viewer.imageryLayers.add(layer);
        setOverlay(shape.id, 'applied', layer);
        return { name: def.name };
      }),
    [run, setOverlay, viewer]
  );

  // ── Viewshed (point) ────────────────────────────────
  const viewshed = useCallback(
    (shape, { radiusM = 5000, obsH = 2 } = {}) =>
      run(shape, 'viewshed', async () => {
        const bounds = boundsOf(shape.points, 0, radiusM * 2);
        const g = await terrainGrid(shape, bounds, 128);
        const ox = Math.floor(g.width / 2);
        const oy = Math.floor(g.height / 2);
        const r = await compute('grid:viewshed', { heights: g.heights, width: g.width, height: g.height, dx: g.dx, dy: g.dy, ox, oy, obsH, targetH: 0 });
        setOverlay(shape.id, 'viewshed', await addRasterOverlay(viewer, r.rgba, g.width, g.height, bounds, 1));
        return { pct: (100 * r.visible) / r.total, km2: (r.visible * g.dx * g.dy) / 1e6, radiusM, obsH, ground: g.heights[oy * g.width + ox] };
      }),
    [run, setOverlay, viewer]
  );

  // ── Satellites overhead (point) ─────────────────────
  const overhead = useCallback(
    (shape) =>
      run(shape, 'overhead', async () => {
        const sats = getLayer('satellites');
        if (!sats) throw new Error('Turn on the Satellites layer (Layers tab) first.');
        const [lon, lat] = shape.points[0];
        return { list: sats.visibleFrom(lat, lon, 10), at: Date.now() };
      }),
    [run, getLayer]
  );

  // ── Landslide ───────────────────────────────────────
  const landslide = useCallback(
    (shape, { depth }) =>
      run(shape, 'landslide', async () => {
        const bounds = boundsOf(shape.points, 1.5, 6000);
        const g = await terrainGrid({ type: 'release-grid' }, bounds, 160); // no mask: whole runout window
        const release = await compute('geo:mask', { pts: flat(shape.points), bounds, width: g.width, height: g.height });
        if (!release.some(Boolean)) throw new Error('Area is too small for the terrain grid — draw a larger release area.');
        const r = await compute('sim:landslide', { heights: g.heights, width: g.width, height: g.height, dx: g.dx, dy: g.dy, release, depth });
        setOverlay(shape.id, 'landslide', await addRasterOverlay(viewer, r.rgba, g.width, g.height, bounds, 1));
        addSettlements(shape.id, 'landslide', bounds, (lon, lat) => r.deposit[cellAt(bounds, g.width, g.height, lon, lat)] > 0.2);
        return { ...r.stats, depth, cellM: Math.max(g.dx, g.dy) };
      }),
    [run, setOverlay, viewer, addSettlements]
  );

  // ── Flood / sea-level rise ──────────────────────────
  const flood = useCallback(
    (shape, { rise }) =>
      run(shape, 'flood', async () => {
        const bounds = boundsOf(shape.points, 0.02);
        const g = await terrainGrid(shape, bounds, 160);
        let seedX = -1;
        let seedY = -1;
        const hasSea = g.heights.some((h, i) => h <= SEA_LEVEL && (!g.mask || g.mask[i]));
        if (!hasSea) {
          // No sea in the area: flood from its lowest point instead (river / basin flood)
          let low = Infinity;
          g.heights.forEach((h, i) => {
            if ((!g.mask || g.mask[i]) && h < low) {
              low = h;
              seedX = i % g.width;
              seedY = Math.floor(i / g.width);
            }
          });
        }
        const r = await compute('sim:flood', { heights: g.heights, width: g.width, height: g.height, dx: g.dx, dy: g.dy, rise, seedX, seedY });
        let cells = 0;
        let maxDepth = 0;
        r.depth.forEach((d, i) => {
          if (d > 0 && (!g.mask || g.mask[i])) {
            cells++;
            if (d > maxDepth) maxDepth = d;
          }
        });
        setOverlay(shape.id, 'flood', await addRasterOverlay(viewer, clipRgba(r.rgba, g.mask), g.width, g.height, bounds, 1));
        addSettlements(shape.id, 'flood', bounds, (lon, lat) => r.depth[cellAt(bounds, g.width, g.height, lon, lat)] > 0.1);
        return { rise, mode: hasSea ? 'sea' : 'local', areaKm2: (cells * g.dx * g.dy) / 1e6, maxDepth };
      }),
    [run, setOverlay, viewer, addSettlements]
  );

  // ── Tsunami ─────────────────────────────────────────
  const tsunami = useCallback(
    (shape, { source, mw, manning }) =>
      run(shape, 'tsunami', async () => {
        const [srcLon, srcLat] = source.center || source.points[0];
        const area = boundsOf(shape.points);
        const pad = 1.5;
        let region = [
          Math.min(area[0], srcLon) - pad,
          Math.min(area[1], srcLat) - pad,
          Math.max(area[2], srcLon) + pad,
          Math.max(area[3], srcLat) + pad,
        ];
        if (region[2] - region[0] > 30 || region[3] - region[1] > 30) throw new Error('Source and coast must be within ~25° of each other.');
        region = [Math.max(-180, region[0]), Math.max(-80, region[1]), Math.min(180, region[2]), Math.min(80, region[3])];

        const src = await compute('sim:tsunamiSource', { mw });
        const bathy = await sampleBathymetry(region, 200);
        const travel = await compute('sim:tsunamiTravel', {
          bathy: bathy.grid,
          width: bathy.width,
          height: bathy.height,
          bounds: bathy.bounds,
          srcLat,
          srcLon,
          a0: src.amplitude,
          srcRadiusM: (src.lengthKm * 1000) / 2,
        });
        setOverlay(shape.id, 'tsunamiTime', await addRasterOverlay(viewer, travel.rgba, bathy.width, bathy.height, bathy.bounds, 0.55));

        // Offshore wave at the coast of the analysis area: shallow ocean cells in/near it
        const near = [area[0] - 0.25, area[1] - 0.25, area[2] + 0.25, area[3] + 0.25];
        let arrival = Infinity;
        let coastAmp = 0;
        const [bw, bs, be, bn] = bathy.bounds;
        for (let i = 0; i < bathy.grid.length; i++) {
          const t = travel.times[i];
          if (!(t >= 0)) continue;
          const lon = bw + ((i % bathy.width) + 0.5) * ((be - bw) / bathy.width);
          const lat = bn - (Math.floor(i / bathy.width) + 0.5) * ((bn - bs) / bathy.height);
          if (lon < near[0] || lon > near[2] || lat < near[1] || lat > near[3]) continue;
          arrival = Math.min(arrival, t);
          if (bathy.grid[i] > -200) coastAmp = Math.max(coastAmp, travel.amp[i]);
        }
        if (!Number.isFinite(arrival)) throw new Error('The wave cannot reach this area by sea (blocked by land) — move the source or the area.');
        if (!coastAmp) coastAmp = Math.max(...travel.amp.filter((a, i) => travel.times[i] === arrival));

        // Run-up on land ≈ 2 × the offshore amplitude (typical run-up/amplitude ratio)
        const runup = Math.min(40, Math.max(0.3, 2 * coastAmp));
        const g = await terrainGrid(shape, area, 160);
        const inund = await compute('sim:inundate', { heights: g.heights, width: g.width, height: g.height, dx: g.dx, dy: g.dy, runup, manning });
        setOverlay(shape.id, 'tsunami', await addRasterOverlay(viewer, clipRgba(inund.rgba, g.mask), g.width, g.height, area, 1));
        addSettlements(shape.id, 'tsunami', area, (lon, lat) => inund.depth[cellAt(area, g.width, g.height, lon, lat)] > 0.1);
        return {
          mw,
          manning,
          source: src,
          srcDepth: travel.srcDepth,
          arrivalMin: arrival / 60,
          coastAmp,
          runup,
          ...inund.stats,
          seaInArea: inund.stats.seaCells > 0,
        };
      }),
    [run, setOverlay, viewer, addSettlements]
  );

  const selected = shapes.find((s) => s.id === selectedId) || null;

  return {
    shapes,
    selected,
    select: setSelectedId,
    drawing,
    draw,
    cancelDraw,
    remove,
    rename,
    results,
    clearResult,
    isBusy,
    actions: { measure, elevation, nearby, applyMap, viewshed, overhead, landslide, flood, tsunami },
  };
}
