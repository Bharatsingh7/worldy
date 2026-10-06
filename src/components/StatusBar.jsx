import React, { useEffect, useState } from 'react';
import {
  Math as CesiumMath,
  Cartographic,
  Cartesian3,
  defined,
} from 'cesium';

/**
 * Status bar — shows camera position (lat/lon/altitude),
 * FPS counter, and globe readiness status.
 */
export default function StatusBar({ viewer }) {
  const [cameraInfo, setCameraInfo] = useState({
    lat: 0,
    lon: 0,
    alt: 0,
  });
  const [fps, setFps] = useState(60);

  useEffect(() => {
    if (!viewer) return;

    let frameCount = 0;
    let lastTime = performance.now();
    let rafId;

    const update = () => {
      // Camera position
      const camera = viewer.camera;
      const carto = Cartographic.fromCartesian(camera.positionWC);
      if (defined(carto)) {
        setCameraInfo({
          lat: CesiumMath.toDegrees(carto.latitude).toFixed(4),
          lon: CesiumMath.toDegrees(carto.longitude).toFixed(4),
          alt: formatAltitude(carto.height),
        });
      }

      // FPS
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastTime = now;
      }

      rafId = requestAnimationFrame(update);
    };

    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, [viewer]);

  return (
    <div className="status-bar glass-panel" id="status-bar">
      <div className="status-dot" />
      <div className="status-item">
        <span className="label">LAT</span> {cameraInfo.lat}°
      </div>
      <div className="status-separator" />
      <div className="status-item">
        <span className="label">LON</span> {cameraInfo.lon}°
      </div>
      <div className="status-separator" />
      <div className="status-item">
        <span className="label">ALT</span> {cameraInfo.alt}
      </div>
      <div className="status-separator" />
      <div className="status-item">
        <span className="label">FPS</span> {fps}
      </div>
    </div>
  );
}

function formatAltitude(meters) {
  if (meters > 1_000_000) return `${(meters / 1_000_000).toFixed(1)}M m`;
  if (meters > 1_000) return `${(meters / 1_000).toFixed(1)} km`;
  return `${meters.toFixed(0)} m`;
}
