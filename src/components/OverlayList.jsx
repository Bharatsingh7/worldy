import React from 'react';
import { OVERLAY_LAYERS } from '../layers';

/**
 * Transparent tile overlays (labels, borders, transit) with per-overlay opacity.
 */
export default function OverlayList({ activeOverlays, onOverlayToggle, overlayOpacity, onOverlayOpacityChange }) {
  return OVERLAY_LAYERS.map((layer) => {
    const on = activeOverlays.includes(layer.id);
    return (
      <div key={layer.id} className={`overlay-item ${on ? 'on' : ''}`}>
        <div id={`overlay-${layer.id}`} className="toggle-row" onClick={() => onOverlayToggle(layer.id)}>
          <div className="toggle-row-info">
            <div className="toggle-row-icon">{layer.icon}</div>
            <div>
              <div className="toggle-row-label">{layer.name}</div>
              <div className="toggle-row-sublabel">{layer.description}</div>
            </div>
          </div>
          <div className={`toggle-switch ${on ? 'on' : ''}`} />
        </div>
        {on && (
          <div className="slider-row">
            <span className="slider-label">Opacity</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={overlayOpacity[layer.id] ?? 1}
              onChange={(e) => onOverlayOpacityChange(layer.id, parseFloat(e.target.value))}
            />
            <span className="slider-value">{Math.round((overlayOpacity[layer.id] ?? 1) * 100)}%</span>
          </div>
        )}
      </div>
    );
  });
}
