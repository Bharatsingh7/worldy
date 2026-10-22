/**
 * Shared animation ticker for moving objects (planes, ships, satellites).
 *
 * The globe renders on demand; instead of recomputing thousands of positions
 * every frame, subscribers run a few times per second and request one render.
 * Paused while the tab is hidden.
 */

const subscribers = new Map(); // fn -> { interval, last }
let timer = null;
const BASE_MS = 125; // 8 Hz

function run() {
  if (document.hidden) return;
  const now = Date.now();
  for (const [fn, s] of subscribers) {
    if (now - s.last >= s.interval) {
      s.last = now;
      fn(now);
    }
  }
}

/** Call fn(nowMs) every `intervalMs` (≥125 ms). Returns an unsubscribe function. */
export function onTick(fn, intervalMs = BASE_MS) {
  subscribers.set(fn, { interval: Math.max(BASE_MS, intervalMs), last: 0 });
  if (!timer) timer = setInterval(run, BASE_MS);
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
