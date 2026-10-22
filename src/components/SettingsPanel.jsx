import React from 'react';
import { PERF_MODES } from '../perf';

/**
 * Settings tab — performance mode and a short explanation of where GPU load comes from.
 */
export default function SettingsPanel({ perfMode, onPerfModeChange, bareEarth, onBareEarthChange }) {
  return (
    <div className="settings-panel">
      <section className="layer-section">
        <div className="layer-section-title">Performance</div>
        <div className="mode-list">
          {Object.entries(PERF_MODES).map(([id, m]) => (
            <button
              key={id}
              className={`mode-card ${perfMode === id ? 'active' : ''}`}
              onClick={() => onPerfModeChange(id)}
            >
              <span className="mode-name">{m.label}</span>
              <span className="mode-desc">{m.description}</span>
            </button>
          ))}
        </div>
        <p className="hint">
          The globe only redraws when something changes. Moving planes, ships and satellites update 8 times a
          second, and heavy maths (orbits, terrain, simulations) runs in compiled C (WebAssembly) off the main
          thread. GPU load is set by the mode above: resolution, anti-aliasing and tile detail.
        </p>
      </section>

      <section className="layer-section">
        <div className="layer-section-title">Terrain</div>
        <div className="toggle-row" onClick={() => onBareEarthChange(!bareEarth)}>
          <div className="toggle-row-info">
            <div className="toggle-row-icon">🏞️</div>
            <div>
              <div className="toggle-row-label">Bare-earth terrain</div>
              <div className="toggle-row-sublabel">Remove tree and building bumps on flat ground</div>
            </div>
          </div>
          <div className={`toggle-switch ${bareEarth ? 'on' : ''}`} />
        </div>
        <p className="hint">
          Elevation is always corrected for the geoid (sea level vs. the WGS84 ellipsoid, up to ±100 m), no-data holes
          and spikes are rebuilt, and Everest is no longer capped at 8,700 m. Bare-earth only touches slopes under
          10°, so mountains keep their measured shape.
        </p>
      </section>
    </div>
  );
}
