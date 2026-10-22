import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import aisRelay from './server/aisRelay.js';

// These services don't send CORS headers, so the browser reaches them through these proxies.
const proxy = {
  '/api/opensky': {
    target: 'https://opensky-network.org',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/opensky/, '/api'),
  },
  '/api/adsb': {
    target: 'https://api.adsb.lol',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/adsb/, ''),
  },
  '/api/etopo': {
    target: 'https://upwell.pfeg.noaa.gov',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/etopo/, '/erddap/griddap'),
  },
};

export default defineConfig(({ mode }) => {
  // AISSTREAM_KEY (no VITE_ prefix) stays on the server — never shipped to the browser
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), cesium(), aisRelay(env.AISSTREAM_KEY)],
    server: {
      port: 3000,
      open: true,
      proxy,
    },
    preview: {
      proxy,
    },
    build: {
      chunkSizeWarningLimit: 4000,
    },
    // The terrain worker imports Cesium's LERC decoder directly
    optimizeDeps: { include: ['lerc'] },
  };
});
