/**
 * Loader for the C compute core (public/wasm/worldy.wasm, built by wasm/build.sh).
 * Works on the main thread and in workers. Maths imports come from JS Math.
 */

const env = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  exp: Math.exp,
  log: Math.log,
  pow: Math.pow,
};

export async function instantiate(source) {
  const bytes = source instanceof ArrayBuffer ? source : await (await fetch(source)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, { env });
  return wrap(instance.exports);
}

/** Thin helpers for moving typed arrays in and out of wasm memory. */
function wrap(x) {
  const mem = () => x.memory.buffer;
  return {
    x,
    mark: () => x.wmark(),
    release: (m) => x.wrelease(m),
    /** Copy a typed array into wasm memory; returns its pointer. */
    put(arr) {
      const ptr = x.walloc(arr.byteLength);
      new arr.constructor(mem(), ptr, arr.length).set(arr);
      return ptr;
    },
    /** Reserve `length` elements of type T; returns pointer. */
    reserve(T, length) {
      return x.walloc(length * T.BYTES_PER_ELEMENT);
    },
    /** View (not copy) of wasm memory — re-create after any allocation. */
    view(T, ptr, length) {
      return new T(mem(), ptr, length);
    },
    /** Copy out of wasm memory. */
    get(T, ptr, length) {
      return new T(mem(), ptr, length).slice();
    },
  };
}
