/**
 * Simulation grid for a drawn area: terrain heights (above sea level) for the solver,
 * ellipsoidal ground heights for rendering on the corrected 3D terrain, and cell size.
 */
import { boundsOf, gridSpec, sampleHeights } from '../tools/grid';
import { geoidN, loadGeoid } from '../terrain/geoid';

export async function prepareGrid(shape, maxCells, { padFrac = 0.05, minSpanM = 800 } = {}) {
  const bounds = boundsOf(shape.points, padFrac, minSpanM);
  const spec = gridSpec(bounds, maxCells);
  const msl = await sampleHeights(bounds, spec.width, spec.height, Math.max(spec.dx, spec.dy));
  await loadGeoid();
  const [w, s, e, n] = bounds;
  const { width: nx, height: ny } = spec;
  const z = new Float64Array(nx * ny);
  const ground = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    const lat = n - ((y + 0.5) * (n - s)) / ny;
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      const lon = w + ((x + 0.5) * (e - w)) / nx;
      z[i] = msl[i];
      ground[i] = msl[i] + geoidN(lat, lon);
    }
  }
  return { nx, ny, dx: spec.dx, dy: spec.dy, bounds, z, ground, cellSize: Math.max(spec.dx, spec.dy) };
}

/** Grid cell under a lon/lat (or -1). */
export function cellOf(grid, lon, lat) {
  const [w, s, e, n] = grid.bounds;
  const x = Math.floor(((lon - w) / (e - w)) * grid.nx);
  const y = Math.floor(((n - lat) / (n - s)) * grid.ny);
  return x < 0 || y < 0 || x >= grid.nx || y >= grid.ny ? -1 : y * grid.nx + x;
}

/** Lon/lat of a cell centre. */
export function cellLonLat(grid, c) {
  const [w, s, e, n] = grid.bounds;
  const x = c % grid.nx;
  const y = Math.floor(c / grid.nx);
  return [w + ((x + 0.5) * (e - w)) / grid.nx, n - ((y + 0.5) * (n - s)) / grid.ny];
}
