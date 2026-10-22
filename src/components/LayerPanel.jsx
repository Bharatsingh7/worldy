import React, { useState } from 'react';
import { OVERLAY_LAYERS, TERRAIN_OPTIONS, getLayersByCategory, CATEGORIES } from '../layers';

const TABS = [
  { id: 'map', label: 'Map' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'flights', label: 'Flights' },
];

const LayersIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

/**
 * Side panel — tabs for base map, overlays and flights.
 * Collapses to a single floating button.
 */
export default function LayerPanel({
  activeImageryId,
  onImageryChange,
  activeOverlays,
  onOverlayToggle,
  overlayOpacity,
  onOverlayOpacityChange,
  activeTerrainId,
  onTerrainChange,
  terrainExaggeration,
  onTerrainExaggerationChange,
  flightsTab,
  isOpen,
  onToggle,
}) {
  const [tab, setTab] = useState('map');
  const layersByCategory = getLayersByCategory();
  const worldTerrain = TERRAIN_OPTIONS.find((t) => t.id !== 'ellipsoid');
  const terrainOn = activeTerrainId !== 'ellipsoid';

  if (!isOpen) {
    return (
      <button id="panel-toggle-fab" className="panel-fab glass-panel" onClick={onToggle} title="Open panel (L)">
        <LayersIcon width="20" height="20" />
      </button>
    );
  }

  return (
    <aside className="side-panel glass-panel" id="layer-panel">
      {/* Header: tabs + close */}
      <div className="side-panel-header">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === 'overlays' && activeOverlays.length > 0 && <span className="tab-badge">{activeOverlays.length}</span>}
            </button>
          ))}
        </div>
        <button className="panel-toggle-btn" onClick={onToggle} title="Close panel (L)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="side-panel-body">
        {tab === 'map' && (
          <>
            {Object.entries(layersByCategory).map(([catKey, layers]) => (
              <section className="layer-section" key={catKey}>
                <div className="layer-section-title">{CATEGORIES[catKey]?.label || catKey}</div>
                <div className="tile-grid">
                  {layers.map((layer) => (
                    <button
                      key={layer.id}
                      id={`layer-${layer.id}`}
                      className={`map-tile ${activeImageryId === layer.id ? 'active' : ''}`}
                      onClick={() => onImageryChange(layer.id)}
                      title={`${layer.name} — ${layer.description}`}
                    >
                      <span className="map-tile-icon">{layer.icon}</span>
                      <span className="map-tile-name">{layer.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}

            {worldTerrain && (
              <section className="layer-section">
                <div className="layer-section-title">Terrain</div>
                <div
                  className="toggle-row"
                  id={`terrain-${worldTerrain.id}`}
                  onClick={() => onTerrainChange(terrainOn ? 'ellipsoid' : worldTerrain.id)}
                >
                  <div className="toggle-row-info">
                    <div className="toggle-row-icon">{worldTerrain.icon}</div>
                    <div>
                      <div className="toggle-row-label">3D {worldTerrain.name}</div>
                      <div className="toggle-row-sublabel">{worldTerrain.description}</div>
                    </div>
                  </div>
                  <div className={`toggle-switch ${terrainOn ? 'on' : ''}`} />
                </div>
                {terrainOn && (
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
              </section>
            )}
          </>
        )}

        {tab === 'overlays' && (
          <section className="layer-section">
            <div className="layer-section-title">Stack on top of the base map</div>
            {OVERLAY_LAYERS.map((layer) => {
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
            })}
          </section>
        )}

        {tab === 'flights' && flightsTab}
      </div>
    </aside>
  );
}
