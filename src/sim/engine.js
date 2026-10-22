/**
 * Main-thread handle on the physics worker (simWorker.js).
 */
export default class PhysicsEngine {
  constructor({ onFrame, onDone, onInstant, onError, onMaxima } = {}) {
    this.worker = new Worker(new URL('./simWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'frame') onFrame?.(data);
      else if (data.type === 'done') onDone?.(data);
      else if (data.type === 'instant') onInstant?.(data);
      else if (data.type === 'maxima') onMaxima?.(data);
      else if (data.type === 'error') onError?.(new Error(data.message));
    };
  }

  post(op, args = {}, transfer = []) {
    this.worker.postMessage({ op, ...args }, transfer);
  }

  init(cfg) {
    this.post('init', { cfg });
  }
  run(speed) {
    this.post('run', { speed });
  }
  pause() {
    this.post('pause');
  }
  setSpeed(speed) {
    this.post('speed', { speed });
  }
  setProbes(cells) {
    this.post('probes', { cells });
  }
  instant(rainMm, runoff = 1) {
    this.post('instant', { rainMm, runoff });
  }
  maxima() {
    this.post('maxima');
  }
  destroy() {
    this.worker.terminate();
  }
}
