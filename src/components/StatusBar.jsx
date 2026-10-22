import React, { useEffect, useRef, useState } from 'react';
import { Math as CesiumMath, defined } from 'cesium';

/** Camera readout refresh interval (ms) — no need to re-render React every frame. */
const REFRESH_MS = 250;

/**
 * Bottom bar — camera position (lat/lon/altitude), FPS, tracked flights,
 * and the data attribution credits.
 */
export default function StatusBar({ viewer, creditContainer, flightCount, simulated }) {
  const [cameraInfo, setCameraInfo] = useState({ lat: '0.0000', lon: '0.0000', alt: '—' });
  const [fps, setFps] = useState(0);
  const creditsRef = useRef(null);

  useEffect(() => {
    if (!viewer) return;

    let frames = 0;
    let lastTick = performance.now();

    const onFrame = () => {
      frames++;
      const now = performance.now();
      if (now - lastTick < REFRESH_MS) return;

      const carto = viewer.camera.positionCartographic;
      if (defined(carto)) {
        setCameraInfo({
          lat: CesiumMath.toDegrees(carto.latitude).toFixed(4),
          lon: CesiumMath.toDegrees(carto.longitude).toFixed(4),
          alt: formatAltitude(carto.height),
        });
      }
      setFps(Math.round((frames * 1000) / (now - lastTick)));
      frames = 0;
      lastTick = now;
    };

    return viewer.scene.postRender.addEventListener(onFrame);
  }, [viewer]);

  // Mount Cesium's credit element in the bar
  useEffect(() => {
    if (creditContainer && creditsRef.current) creditsRef.current.appendChild(creditContainer);
  }, [creditContainer]);

  return (
    <footer className="status-bar glass-panel" id="status-bar">
      <div className="status-readout">
        <div className="status-dot" />
        <div className="status-item">
          <span className="label">LAT</span> {cameraInfo.lat}°
        </div>
        <div className="status-item">
          <span className="label">LON</span> {cameraInfo.lon}°
        </div>
        <div className="status-item">
          <span className="label">ALT</span> {cameraInfo.alt}
        </div>
        <div className="status-item">
          <span className="label">FPS</span> {fps}
        </div>
        {flightCount != null && (
          <div className="status-item">
            <span className="label">✈</span> {flightCount.toLocaleString()}
            {simulated && <span className="sim-badge">SIM</span>}
          </div>
        )}
      </div>
      <div className="status-credits" ref={creditsRef} />
    </footer>
  );
}

function formatAltitude(meters) {
  if (meters > 1_000_000) return `${(meters / 1_000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
  if (meters > 1_000) return `${(meters / 1_000).toFixed(1)} km`;
  return `${meters.toFixed(0)} m`;
}
