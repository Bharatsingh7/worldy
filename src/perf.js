/**
 * Performance modes — the GPU cost of the globe is set almost entirely by these
 * render settings (resolution, anti-aliasing, tile detail, frame rate), not by JS.
 */

export const PERF_MODES = {
  eco: {
    label: 'Eco',
    description: 'Lowest GPU use. Softer image, 30 fps cap, no lighting.',
    resolutionScale: 0.75,
    msaa: 1,
    fxaa: false,
    sse: 4,
    fps: 30,
    lighting: false,
    groundAtmosphere: false,
    tileCache: 200,
    preloadSiblings: false,
  },
  balanced: {
    label: 'Balanced',
    description: 'Sharp enough for most use at a fraction of the GPU load.',
    resolutionScale: 1,
    msaa: 1,
    fxaa: true,
    sse: 2,
    fps: 45,
    lighting: true,
    groundAtmosphere: true,
    tileCache: 400,
    preloadSiblings: false,
  },
  quality: {
    label: 'Quality',
    description: 'Full screen resolution, 4× MSAA, finest tiles. Heavy.',
    resolutionScale: window.devicePixelRatio || 1,
    msaa: 4,
    fxaa: false,
    sse: 1.5,
    fps: 60,
    lighting: true,
    groundAtmosphere: true,
    tileCache: 1000,
    preloadSiblings: true,
  },
};

const STORAGE_KEY = 'worldy.perfMode';

export function loadPerfMode() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && PERF_MODES[v]) return v;
  } catch {
    // storage unavailable — fall through to default
  }
  return 'balanced';
}

export function savePerfMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function applyPerfMode(viewer, mode) {
  const m = PERF_MODES[mode] || PERF_MODES.balanced;
  const scene = viewer.scene;
  const globe = scene.globe;

  viewer.resolutionScale = m.resolutionScale;
  viewer.targetFrameRate = m.fps;
  scene.msaaSamples = m.msaa;
  scene.postProcessStages.fxaa.enabled = m.fxaa;
  globe.maximumScreenSpaceError = m.sse;
  globe.tileCacheSize = m.tileCache;
  globe.preloadSiblings = m.preloadSiblings;
  globe.enableLighting = m.lighting;
  globe.showGroundAtmosphere = m.groundAtmosphere;
  scene.requestRender();
}
