/**
 * OpenStreetMap Overpass API client with mirror fallback and backoff
 * (public servers are often at capacity and answer 429/504).
 */

// Only mirrors that send CORS headers
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const TIMEOUT_MS = 30_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run an Overpass QL query; returns the `elements` array. */
export async function overpass(query, { signal, attempts = 3 } = {}) {
  let lastErr;
  for (let a = 0; a < attempts; a++) {
    const url = MIRRORS[a % MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()).elements || [];
      lastErr = new Error(`Overpass ${res.status}`);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
    }
    await sleep(1000 * 2 ** a);
  }
  throw lastErr;
}

/** "south,west,north,east" for Overpass from [west, south, east, north] degrees. */
export const bboxQL = ([w, s, e, n]) => `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;

/** Position of an element returned with `out center`. */
export const elementLatLon = (el) => (el.lat != null ? { lat: el.lat, lon: el.lon } : el.center ? { lat: el.center.lat, lon: el.center.lon } : null);
