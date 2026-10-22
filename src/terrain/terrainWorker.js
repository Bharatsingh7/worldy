/**
 * Terrain worker: decodes Esri LERC tiles (with their validity mask, which Cesium ignores)
 * and cleans them in the C core (wasm/terrain/clean.c): fill no-data, remove spikes,
 * optional bare-earth, add the EGM96 geoid so heights are ellipsoidal.
 */
import Lerc from 'lerc';
import { instantiate } from '../compute/wasm';

const base = import.meta.env.BASE_URL;
const ready = (async () => {
  const w = await instantiate(`${base}wasm/worldy.wasm`);
  const g = await (await fetch(`${base}geoid/egm96-1deg.bin`)).arrayBuffer();
  w.x.geoid_set(w.put(new Int16Array(g)));
  return { w, mark: w.mark() };
})();

self.onmessage = async ({ data: { id, buffer, rect, flags } }) => {
  try {
    const { w, mark } = await ready;
    const d = Lerc.decode(buffer);
    if (!d || d.statistics?.[0]?.minValue === Number.MAX_VALUE) throw new Error('Invalid tile data');
    const px = d.pixels[0];
    w.release(mark);
    const hp = w.put(px instanceof Float32Array ? px : Float32Array.from(px));
    const mp = d.maskData ? w.put(d.maskData) : 0;
    const st = w.reserve(Float64Array, 4);
    w.x.ter_clean(hp, mp, d.width, d.height, rect[0], rect[1], rect[2], rect[3], flags, st);
    const heights = w.get(Float32Array, hp, px.length);
    self.postMessage({ id, heights, width: d.width, height: d.height }, [heights.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
