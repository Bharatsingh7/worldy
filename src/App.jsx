import React, { useState, useCallback, useRef } from 'react';
import Globe from './components/Globe';
import LayerPanel from './components/LayerPanel';
import StatusBar from './components/StatusBar';
import NavControls from './components/NavControls';
import SearchBar from './components/SearchBar';

/**
 * Worldy — Main application shell.
 * Orchestrates the globe, layer panel, status bar, and nav controls.
 */
export default function App() {
  // Globe state
  const [viewer, setViewer] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showLoading, setShowLoading] = useState(true);

  // Layer state
  const [activeImageryId, setActiveImageryId] = useState('esri-satellite');
  const [activeOverlays, setActiveOverlays] = useState([]);
  const [activeTerrainId, setActiveTerrainId] = useState('ellipsoid');
  const [terrainExaggeration, setTerrainExaggeration] = useState(1);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  const handleViewerReady = useCallback((v) => {
    setViewer(v);
  }, []);

  const handleLoaded = useCallback(() => {
    setIsLoaded(true);
    // Fade out loading screen
    setTimeout(() => setShowLoading(false), 800);
  }, []);

  const handleOverlayToggle = useCallback((overlayId) => {
    setActiveOverlays((prev) =>
      prev.includes(overlayId)
        ? prev.filter((id) => id !== overlayId)
        : [...prev, overlayId]
    );
  }, []);

  return (
    <div className="app-shell" id="app-shell">
      {/* 3D Globe */}
      <Globe
        activeImageryId={activeImageryId}
        activeOverlays={activeOverlays}
        activeTerrainId={activeTerrainId}
        terrainExaggeration={terrainExaggeration}
        onViewerReady={handleViewerReady}
        onLoaded={handleLoaded}
      />

      {/* Brand */}
      <div className="brand-mark glass-panel" id="brand-mark">
        <span className="brand-name">Worldy</span>
        <span className="brand-version">v1.0</span>
      </div>

      {/* Search Bar */}
      <SearchBar viewer={viewer} />

      {/* Layer Switcher */}
      <LayerPanel
        activeImageryId={activeImageryId}
        onImageryChange={setActiveImageryId}
        activeOverlays={activeOverlays}
        onOverlayToggle={handleOverlayToggle}
        activeTerrainId={activeTerrainId}
        onTerrainChange={setActiveTerrainId}
        terrainExaggeration={terrainExaggeration}
        onTerrainExaggerationChange={setTerrainExaggeration}
        isOpen={isPanelOpen}
        onToggle={() => setIsPanelOpen((p) => !p)}
      />

      {/* Navigation Controls */}
      <NavControls viewer={viewer} />

      {/* Status Bar */}
      <StatusBar viewer={viewer} />

      {/* Loading Overlay */}
      {showLoading && (
        <div className={`loading-overlay ${isLoaded ? 'fade-out' : ''}`}>
          <div className="loading-spinner" />
          <div className="loading-text">Initializing Globe…</div>
        </div>
      )}
    </div>
  );
}
