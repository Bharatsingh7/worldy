/**
 * Esri World Elevation 3D, corrected.
 *
 * Wraps Cesium's ArcGISTiledElevationTerrainProvider and fixes what it gets wrong:
 *  - datum: Esri heights are above mean sea level, Cesium needs ellipsoidal heights
 *    (adds the EGM96 geoid, −107…+85 m) — terrain no longer floats or sinks vs. everything else;
 *  - LERC no-data cells (Cesium ignores the mask) and single-cell spikes are rebuilt;
 *  - heights are no longer clamped to the service's −450…8700 m metadata range (Everest is 8849);
 *  - optional bare-earth estimate removes tree/building bumps on flat ground.
 * Cleaning runs in C inside a small pool of workers.
 */
import {
  ArcGISTiledElevationTerrainProvider,
  HeightmapEncoding,
  HeightmapTerrainData,
  Math as CesiumMath,
} from 'cesium';

const FLAG_DESPIKE = 1;
const FLAG_BARE = 2;
const FLAG_GEOID = 4;
const STRUCTURE = { elementMultiplier: 1.0, lowestEncodedHeight: -12000, highestEncodedHeight: 12000 };
const POOL_SIZE = 2;

let pool = null;
let nextId = 1;
const pending = new Map();

function worker() {
  if (!pool) {
    pool = Array.from({ length: POOL_SIZE }, () => {
      const wk = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
      wk.onmessage = ({ data }) => {
        const p = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) p?.reject(new Error(data.error));
        else p?.resolve(data);
      };
      return wk;
    });
  }
  return pool[nextId % POOL_SIZE];
}

function clean(buffer, rect, flags) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker().postMessage({ id, buffer, rect, flags }, [buffer]);
  });
}

export default class CleanTerrainProvider {
  static async fromUrl(url, { bareEarth = true } = {}) {
    return new CleanTerrainProvider(await ArcGISTiledElevationTerrainProvider.fromUrl(url), { bareEarth });
  }

  constructor(inner, { bareEarth }) {
    this.inner = inner;
    this.flags = FLAG_DESPIKE | FLAG_GEOID | (bareEarth ? FLAG_BARE : 0);
  }

  get errorEvent() {
    return this.inner.errorEvent;
  }
  get credit() {
    return this.inner.credit;
  }
  get tilingScheme() {
    return this.inner.tilingScheme;
  }
  get hasWaterMask() {
    return false;
  }
  get hasVertexNormals() {
    return false;
  }
  get availability() {
    return this.inner.availability;
  }

  getLevelMaximumGeometricError(level) {
    return this.inner.getLevelMaximumGeometricError(level);
  }

  getTileDataAvailable(x, y, level) {
    return this.inner.getTileDataAvailable(x, y, level);
  }

  loadTileDataAvailability(x, y, level) {
    return this.inner.loadTileDataAvailability(x, y, level);
  }

  requestTileGeometry(x, y, level, request) {
    const promise = this.inner.requestTileGeometry(x, y, level, request);
    if (!promise) return undefined;
    const r = this.tilingScheme.tileXYToRectangle(x, y, level);
    const rect = [r.west, r.south, r.east, r.north].map(CesiumMath.toDegrees);
    return promise.then(async (data) => {
      // data._buffer is the raw LERC byte stream fetched by the inner provider
      const { heights, width, height } = await clean(data._buffer, rect, this.flags);
      return new HeightmapTerrainData({
        buffer: heights,
        width,
        height,
        childTileMask: data._childTileMask,
        structure: STRUCTURE,
        encoding: HeightmapEncoding.NONE,
      });
    });
  }
}
