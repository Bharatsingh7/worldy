import React, { useState, useCallback, useEffect } from 'react';
import Globe from './components/Globe';
import LayerPanel from './components/LayerPanel';
import StatusBar from './components/StatusBar';
import NavControls from './components/NavControls';
import SearchBar from './components/SearchBar';
import FlightPanel from './components/FlightPanel';
import FlightInfoCard from './components/FlightInfoCard';
import OverlayList from './components/OverlayList';
import SettingsPanel from './components/SettingsPanel';
import { loadPerfMode, savePerfMode } from './perf';
import useFlights from './flights/useFlights';

/**
 * Worldy — Main application shell.
 *
 * Layout: top bar (brand + search) · right side panel (Map / Overlays / Flights)
 * · flight card bottom-left · nav controls bottom-right · status bar along the bottom.
 */
export default function App() {
  // Globe state
  const [viewer, setViewer] = useState(null);
  const [creditContainer, setCreditContainer] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showLoading, setShowLoading] = useState(true);

  // Layer state
  const [activeImageryId, setActiveImageryId] = useState('esri-satellite');
  const [activeOverlays, setActiveOverlays] = useState([]);
  const [overlayOpacity, setOverlayOpacity] = useState({});
  const [activeTerrainId, setActiveTerrainId] = useState('ellipsoid');
  const [terrainExaggeration, setTerrainExaggeration] = useState(1);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [perfMode, setPerfMode] = useState(loadPerfMode);

  const handlePerfMode = useCallback((mode) => {
    setPerfMode(mode);
    savePerfMode(mode);
  }, []);

  const flights = useFlights(viewer);

  const handleViewerReady = useCallback((v, credits) => {
    if (import.meta.env.DEV) window.__worldyViewer = v; // for debugging / automated checks
    setViewer(v);
    setCreditContainer(credits);
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

  const handleOverlayOpacity = useCallback((overlayId, value) => {
    setOverlayOpacity((prev) => ({ ...prev, [overlayId]: value }));
  }, []);

  // Keyboard shortcuts: L panel · Esc close flight · H home · N north · +/- zoom · / search
  const { select } = flights;
  useEffect(() => {
    const click = (id) => document.getElementById(id)?.click();
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea')) return;
      const actions = {
        Escape: () => select(null),
        l: () => setIsPanelOpen((p) => !p),
        h: () => click('btn-home'),
        n: () => click('btn-north'),
        '+': () => click('btn-zoom-in'),
        '=': () => click('btn-zoom-in'),
        '-': () => click('btn-zoom-out'),
        '/': () => document.getElementById('search-input')?.focus(),
      };
      const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);

  return (
    <div className={`app-shell ${flights.selectedId ? 'has-flight' : ''}`} id="app-shell">
      {/* 3D Globe */}
      <Globe
        activeImageryId={activeImageryId}
        activeOverlays={activeOverlays}
        overlayOpacity={overlayOpacity}
        activeTerrainId={activeTerrainId}
        terrainExaggeration={terrainExaggeration}
        perfMode={perfMode}
        onViewerReady={handleViewerReady}
        onLoaded={handleLoaded}
      />

      {/* Top bar: brand + search */}
      <header className="top-bar">
        <div className="brand-mark glass-panel" id="brand-mark">
          <span className="brand-name">Worldy</span>
          <span className="brand-version">v1.1</span>
        </div>
        <SearchBar viewer={viewer} />
      </header>

      {/* Side panel */}
      <LayerPanel
        activeImageryId={activeImageryId}
        onImageryChange={setActiveImageryId}
        activeTerrainId={activeTerrainId}
        onTerrainChange={setActiveTerrainId}
        terrainExaggeration={terrainExaggeration}
        onTerrainExaggerationChange={setTerrainExaggeration}
        tabs={[
          {
            id: 'overlays',
            label: 'Overlays',
            badge: activeOverlays.length,
            content: (
              <OverlayList
                activeOverlays={activeOverlays}
                onOverlayToggle={handleOverlayToggle}
                overlayOpacity={overlayOpacity}
                onOverlayOpacityChange={handleOverlayOpacity}
              />
            ),
          },
          { id: 'flights', label: 'Flights', content: <FlightPanel flights={flights} /> },
          { id: 'settings', label: 'Settings', content: <SettingsPanel perfMode={perfMode} onPerfModeChange={handlePerfMode} /> },
        ]}
        isOpen={isPanelOpen}
        onToggle={() => setIsPanelOpen((p) => !p)}
      />

      {/* Selected flight */}
      <FlightInfoCard flights={flights} />

      {/* Navigation Controls */}
      <NavControls viewer={viewer} />

      {/* Status Bar */}
      <StatusBar
        viewer={viewer}
        creditContainer={creditContainer}
        flightCount={flights.enabled ? flights.stats.shown : null}
        simulated={flights.forecastMin > 0}
      />

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
