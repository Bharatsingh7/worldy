import React from 'react';
import { PERF_MODES } from '../perf';

/**
 * Settings tab — performance mode and a short explanation of where GPU load comes from.
 */
export default function SettingsPanel({ perfMode, onPerfModeChange }) {
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
    </div>
  );
}
