/**
 * OSM buildings for a simulation area: footprints + heights from Overpass (cached),
 * rasterised into storage porosity φ for the solver (water flows around them), and
 * rendered as one batched extruded primitive on the corrected terrain.
 */
import {
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  Cartesian3,
} from 'cesium';
import { overpass, bboxQL } from '../datalayers/overpass';
import { cached } from '../datalayers/cache';

const MAX_AREA_KM2 = 40;

function heightOf(tags) {
  const h = parseFloat(tags.height);
  if (Number.isFinite(h)) return h;
  const lv = parseFloat(tags['building:levels']);
  return Number.isFinite(lv) ? lv * 3.2 + 1 : 9;
}

/** Buildings in bounds: [{ ring: [[lon, lat], …], height }]. Empty for very large areas. */
export async function fetchBuildings(bounds) {
  const [w, s, e, n] = bounds;
  const km2 = (e - w) * 111 * Math.cos(((s + n) / 2) * (Math.PI / 180)) * (n - s) * 111;
  if (km2 > MAX_AREA_KM2) return { list: [], skipped: true };
  const key = `bld:${bounds.map((v) => v.toFixed(4)).join(',')}`;
  const { value } = await cached(key, 30 * 86400e3, () =>
    overpass(`[out:json][timeout:60];way["building"](${bboxQL(bounds)});out geom tags 20000;`)
  );
  const list = value
    .filter((el) => el.geometry?.length >= 4)
    .map((el) => ({ ring: el.geometry.map((p) => [p.lon, p.lat]), height: heightOf(el.tags || {}) }));
  return { list, skipped: false };
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Storage porosity per cell from building coverage (3×3 sub-samples per cell):
 * φ = 1 − 0.97·covered, so a fully built-up cell becomes a wall (φ < 0.05 blocks flow).
 */
export function porosityFrom(buildings, grid) {
  const { nx, ny, bounds } = grid;
  const [w, s, e, n] = bounds;
  const cover = new Float32Array(nx * ny);
  const cw = (e - w) / nx;
  const ch = (n - s) / ny;
  for (const b of buildings) {
    let bw = Infinity, bs = Infinity, be = -Infinity, bn = -Infinity;
    for (const [lon, lat] of b.ring) {
      bw = Math.min(bw, lon); be = Math.max(be, lon); bs = Math.min(bs, lat); bn = Math.max(bn, lat);
    }
    const x0 = Math.max(0, Math.floor((bw - w) / cw)), x1 = Math.min(nx - 1, Math.floor((be - w) / cw));
    const y0 = Math.max(0, Math.floor((n - bn) / ch)), y1 = Math.min(ny - 1, Math.floor((n - bs) / ch));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        let hits = 0;
        for (let a = 0; a < 3; a++)
          for (let c = 0; c < 3; c++) {
            const lon = w + (x + (c + 0.5) / 3) * cw;
            const lat = n - (y + (a + 0.5) / 3) * ch;
            if (inRing(lon, lat, b.ring)) hits++;
          }
        cover[y * nx + x] = Math.min(1, cover[y * nx + x] + hits / 9);
      }
  }
  const phi = new Float64Array(nx * ny);
  let built = 0;
  for (let i = 0; i < phi.length; i++) {
    phi[i] = 1 - 0.97 * cover[i];
    if (cover[i] > 0.5) built++;
  }
  return { phi, cover, builtCells: built };
}

/** Batched extruded buildings standing on the grid's ground heights (ellipsoidal). */
export function buildingsPrimitive(buildings, grid, groundAt) {
  const instances = [];
  const color = ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString('#d9d4c7').withAlpha(0.92));
  for (const b of buildings) {
    if (b.ring.length < 4) continue;
    const [lon, lat] = b.ring[0];
    const base = groundAt(lon, lat);
    instances.push(
      new GeometryInstance({
        geometry: new PolygonGeometry({
          polygonHierarchy: new PolygonHierarchy(b.ring.slice(0, -1).map(([x, y]) => Cartesian3.fromDegrees(x, y))),
          height: base,
          extrudedHeight: base + b.height,
          vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color },
      })
    );
  }
  if (!instances.length) return null;
  return new Primitive({
    geometryInstances: instances,
    appearance: new PerInstanceColorAppearance({ translucent: false, closed: true }),
    asynchronous: true,
    releaseGeometryInstances: true,
  });
}
