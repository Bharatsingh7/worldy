/**
 * Promise API for the compute worker, plus a main-thread instance of the same
 * wasm for tiny synchronous batches (dead reckoning on the animation ticker).
 */
import { instantiate } from './wasm';

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data: { id, result, error } }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(result);
  };
  return worker;
}

/** Run an operation in the worker: compute('sim:landslide', {...}). */
export function compute(op, args = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, op, args });
  });
}

let mainWasm = null;
let mainWasmPromise = null;

/** Main-thread wasm instance (null until loaded; call loadMainWasm() once). */
export const getMainWasm = () => mainWasm;

export function loadMainWasm() {
  mainWasmPromise ||= instantiate(`${import.meta.env.BASE_URL}wasm/worldy.wasm`).then((w) => (mainWasm = w));
  return mainWasmPromise;
}
