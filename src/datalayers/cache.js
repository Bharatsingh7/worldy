/**
 * Tiny IndexedDB key-value cache with expiry — for data sources that rate-limit
 * (CelesTrak allows one download per group every 2 h) or rarely change.
 */

const DB = 'worldy-cache';
const STORE = 'kv';
let dbPromise = null;

function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

/** { value, savedAt } or undefined. */
export const cacheGet = (key) => tx('readonly', (s) => s.get(key)).catch(() => undefined);
export const cacheSet = (key, value) => tx('readwrite', (s) => s.put({ value, savedAt: Date.now() }, key)).catch(() => {});

/**
 * Return cached data younger than maxAgeMs, otherwise fetch fresh; if the fetch fails,
 * fall back to stale cache. Resolves { value, savedAt, stale }.
 */
export async function cached(key, maxAgeMs, fetcher) {
  const hit = await cacheGet(key);
  if (hit && Date.now() - hit.savedAt < maxAgeMs) return { ...hit, stale: false };
  try {
    const value = await fetcher();
    cacheSet(key, value);
    return { value, savedAt: Date.now(), stale: false };
  } catch (err) {
    if (hit) return { ...hit, stale: true };
    throw err;
  }
}
