/**
 * Grids for analysis: bounds of a shape, terrain / bathymetry sampling into
 * Float32 grids (row 0 = north), and draping an RGBA result onto the globe
 * inside a rectangle only.
 */

import {
  Cartographic,
  ImageryLayer,
  Rectangle,
  SingleTileImageryProvider,
  sampleTerrain,
} from 'cesium';
import { TERRAIN_OPTIONS } from '../layers';

const R = 6371008.8;
const RAD = Math.PI / 180;

/** [west, south, east, north] of a list of [lon, lat]; pads point-like shapes to `minSpanM`. */
export function boundsOf(points, padFrac = 0, minSpanM = 0) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of points) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  const midLat = (s + n) / 2;
  const minLat = minSpanM / (R * RAD);
  const minLon = minLat / Math.max(0.1, Math.cos(midLat * RAD));
  const padLat = Math.max((n - s) * padFrac, (minLat - (n - s)) / 2, 0);
  const padLon = Math.max((e - w) * padFrac, (minLon - (e - w)) / 2, 0);
  return [w - padLon, Math.max(-89.9, s - padLat), e + padLon, Math.min(89.9, n + padLat)];
}

/** Grid size (≤ maxCells on the long side) and cell size in metres for bounds. */
export function gridSpec([w, s, e, n], maxCells = 128) {
  const midLat = (s + n) / 2;
  const widthM = (e - w) * RAD * R * Math.cos(midLat * RAD);
  const heightM = (n - s) * RAD * R;
  const scale = maxCells / Math.max(widthM, heightM);
  const width = Math.max(8, Math.round(widthM * scale));
  const height = Math.max(8, Math.round(heightM * scale));
  return { width, height, dx: widthM / width, dy: heightM / height, widthM, heightM };
}

let elevationProvider = null;

/** Keyless Esri World Elevation provider (shared; used even when 3D terrain is off). */
export function getElevationProvider() {
  elevationProvider ||= Promise.resolve(TERRAIN_OPTIONS.find((t) => t.id === 'esri-world').createProvider());
  return elevationProvider;
}

/** Sample ground heights on a width×height grid over bounds. */
export async function sampleHeights(bounds, width, height, cellM) {
  const [w, s, e, n] = bounds;
  const provider = await getElevationProvider();
  // Pick the tile level whose resolution (≈156 km / 2^L per pixel at 256 px) matches the cell size
  const level = Math.max(0, Math.min(14, Math.round(Math.log2(156543 / Math.max(cellM, 1)))));
  const cartos = [];
  for (let y = 0; y < height; y++) {
    const lat = n - ((y + 0.5) * (n - s)) / height;
    for (let x = 0; x < width; x++) cartos.push(Cartographic.fromDegrees(w + ((x + 0.5) * (e - w)) / width, lat));
  }
  const res = await sampleTerrain(provider, level, cartos);
  const out = new Float32Array(width * height);
  for (let i = 0; i < res.length; i++) out[i] = Number.isFinite(res[i].height) ? res[i].height : 0;
  return out;
}

/** Heights along a path (list of [lon, lat]), `count` evenly spaced samples. */
export async function sampleProfile(points, count = 120) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [lo1, la1] = points[i - 1];
    const [lo2, la2] = points[i];
    const d = haversine(la1, lo1, la2, lo2);
    segs.push({ a: points[i - 1], b: points[i], d, start: total });
    total += d;
  }
  const cartos = [];
  const dist = [];
  for (let k = 0; k < count; k++) {
    const t = (total * k) / (count - 1);
    const seg = segs.find((sg) => t <= sg.start + sg.d) || segs[segs.length - 1];
    const f = seg.d ? (t - seg.start) / seg.d : 0;
    cartos.push(Cartographic.fromDegrees(seg.a[0] + (seg.b[0] - seg.a[0]) * f, seg.a[1] + (seg.b[1] - seg.a[1]) * f));
    dist.push(t);
  }
  const provider = await getElevationProvider();
  const level = Math.max(0, Math.min(14, Math.round(Math.log2(156543 / Math.max(total / count, 1)))));
  const res = await sampleTerrain(provider, level, cartos);
  return { dist, heights: res.map((c) => (Number.isFinite(c.height) ? c.height : 0)), total };
}

export function haversine(lat1, lon1, lat2, lon2) {
  const a =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * ETOPO 1-arc-minute elevation incl. ocean depth (NOAA ERDDAP, via the dev proxy),
 * resampled to ≤ maxCells per side. Returns { grid, width, height, bounds }.
 */
export async function sampleBathymetry([w, s, e, n], maxCells = 180) {
  const stride = Math.max(1, Math.ceil((Math.max(e - w, n - s) * 60) / maxCells));
  const q = `altitude[(${s.toFixed(3)}):${stride}:(${n.toFixed(3)})][(${w.toFixed(3)}):${stride}:(${e.toFixed(3)})]`;
  const res = await fetch(`/api/etopo/etopo180.json?${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`Bathymetry ${res.status}`);
  const rows = (await res.json()).table.rows; // [lat, lon, alt], lat ascending then lon
  const lats = [...new Set(rows.map((r) => r[0]))];
  const lons = [...new Set(rows.map((r) => r[1]))];
  const width = lons.length;
  const height = lats.length;
  const grid = new Float32Array(width * height);
  rows.forEach((r, i) => {
    const yAsc = Math.floor(i / width);
    const x = i % width;
    grid[(height - 1 - yAsc) * width + x] = r[2];
  });
  const half = stride / 120;
  return {
    grid,
    width,
    height,
    bounds: [lons[0] - half, lats[0] - half, lons[width - 1] + half, lats[height - 1] + half],
  };
}

/** Drape an RGBA grid over bounds as an imagery layer (removed with viewer.imageryLayers.remove). */
export async function addRasterOverlay(viewer, rgba, width, height, [w, s, e, n], alpha = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const provider = await SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), {
    rectangle: Rectangle.fromDegrees(w, s, e, n),
    tileWidth: width,
    tileHeight: height,
  });
  const layer = new ImageryLayer(provider, { alpha });
  viewer.imageryLayers.add(layer);
  viewer.scene.requestRender();
  return layer;
}

/** Cell index at lon/lat in a grid over bounds (or -1). */
export function cellAt([w, s, e, n], width, height, lon, lat) {
  const x = Math.floor(((lon - w) / (e - w)) * width);
  const y = Math.floor(((n - lat) / (n - s)) * height);
  return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x;
}
