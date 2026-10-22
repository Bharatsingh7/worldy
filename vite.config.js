import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// OpenSky and adsb.lol don't send CORS headers, so the browser reaches them through these proxies.
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
};

export default defineConfig({
  plugins: [
    react(),
    cesium(),
  ],
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
});
