import React, { useState, useCallback } from 'react';
import { IMAGERY_LAYERS, OVERLAY_LAYERS, TERRAIN_OPTIONS, getLayersByCategory, CATEGORIES } from '../layers';

/**
 * Layer Switcher Panel — glassmorphism side panel
 * for toggling imagery, overlays, and terrain.
 */
export default function LayerPanel({
  activeImageryId,
  onImageryChange,
  activeOverlays,
  onOverlayToggle,
  activeTerrainId,
  onTerrainChange,
  terrainExaggeration,
  onTerrainExaggerationChange,
  isOpen,
  onToggle,
}) {
  const layersByCategory = getLayersByCategory();

  if (!isOpen) {
    return (
      <button
        id="panel-toggle-fab"
        className="panel-fab glass-panel"
        onClick={onToggle}
        title="Open layer panel"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      </button>
    );
  }

  return (
    <div className="layer-panel glass-panel" id="layer-panel">
      {/* Header */}
      <div className="layer-panel-header">
        <div className="layer-panel-title">
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          Layers
        </div>
        <button className="panel-toggle-btn" onClick={onToggle} title="Close panel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Imagery Sections by Category */}
      {Object.entries(layersByCategory).map(([catKey, layers]) => (
        <div className="layer-section" key={catKey}>
          <div className="layer-section-title">
            {CATEGORIES[catKey]?.label || catKey}
          </div>
          {layers.map((layer) => (
            <div
              key={layer.id}
              id={`layer-${layer.id}`}
              className={`layer-card ${activeImageryId === layer.id ? 'active' : ''}`}
              onClick={() => onImageryChange(layer.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onImageryChange(layer.id)}
            >
              <div className="layer-card-preview">{layer.icon}</div>
              <div className="layer-card-info">
                <div className="layer-card-name">{layer.name}</div>
                <div className="layer-card-desc">{layer.description}</div>
              </div>
              <div className="layer-card-radio" />
            </div>
          ))}
        </div>
      ))}

      {/* Overlays */}
      <div className="layer-section">
        <div className="layer-section-title">Overlays</div>
        {OVERLAY_LAYERS.map((layer) => (
          <div
            key={layer.id}
            id={`overlay-${layer.id}`}
            className="toggle-row"
            onClick={() => onOverlayToggle(layer.id)}
          >
            <div className="toggle-row-info">
              <div className="toggle-row-icon">{layer.icon}</div>
              <div>
                <div className="toggle-row-label">{layer.name}</div>
                <div className="toggle-row-sublabel">{layer.description}</div>
              </div>
            </div>
            <div className={`toggle-switch ${activeOverlays.includes(layer.id) ? 'on' : ''}`} />
          </div>
        ))}
      </div>

      {/* Terrain */}
      <div className="layer-section">
        <div className="layer-section-title">Terrain</div>
        {TERRAIN_OPTIONS.map((terrain) => (
          <div
            key={terrain.id}
            id={`terrain-${terrain.id}`}
            className={`layer-card ${activeTerrainId === terrain.id ? 'active' : ''}`}
            onClick={() => onTerrainChange(terrain.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onTerrainChange(terrain.id)}
          >
            <div className="layer-card-preview">{terrain.icon}</div>
            <div className="layer-card-info">
              <div className="layer-card-name">{terrain.name}</div>
              <div className="layer-card-desc">{terrain.description}</div>
            </div>
            <div className="layer-card-radio" />
          </div>
        ))}

        {/* Terrain Exaggeration Slider */}
        {activeTerrainId !== 'ellipsoid' && (
          <div className="slider-row">
            <span className="slider-label">Exaggeration</span>
            <input
              type="range"
              id="terrain-exaggeration"
              min="1"
              max="10"
              step="0.5"
              value={terrainExaggeration}
              onChange={(e) => onTerrainExaggerationChange(parseFloat(e.target.value))}
            />
            <span className="slider-value">{terrainExaggeration}×</span>
          </div>
        )}
      </div>
    </div>
  );
}
