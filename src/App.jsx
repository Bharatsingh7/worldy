import React, { useState, useCallback, useEffect, useRef } from 'react';
import Globe from './components/Globe';
import LayerPanel from './components/LayerPanel';
import StatusBar from './components/StatusBar';
import NavControls from './components/NavControls';
import SearchBar from './components/SearchBar';
import FlightPanel from './components/FlightPanel';
import FlightInfoCard from './components/FlightInfoCard';
import OverlayList from './components/OverlayList';
import SettingsPanel from './components/SettingsPanel';
import DataLayersPanel from './components/DataLayersPanel';
import InfoCard from './components/InfoCard';
import ToolsPanel from './components/ToolsPanel';
import ResultCard from './components/ResultCard';
import useTools from './tools/useTools';
import { boundsOf } from './tools/grid';
import { Rectangle } from 'cesium';
import { readHash, applyHashView, syncHash } from './urlState';
import { loadPerfMode, savePerfMode } from './perf';
import { flyToSafe } from './camera';
import useFlights from './flights/useFlights';
import useDataLayers from './datalayers/useDataLayers';
import usePicking from './usePicking';

/**
 * Worldy — Main application shell.
 *
 * Layout: top bar (brand + search) · right side panel (Map / Layers / Tools / Settings)
 * · info cards bottom-left · nav controls bottom-right · status bar along the bottom.
 */
export default function App() {
  // Globe state
  const [viewer, setViewer] = useState(null);
  const [creditContainer, setCreditContainer] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showLoading, setShowLoading] = useState(true);

  // Layer state
  const [activeImageryId, setActiveImageryId] = useState(() => readHash()?.map || 'esri-satellite');
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

  // Shareable URL: restore the view from #@lat,lon,… and keep it updated
  const imageryRef = useRef(activeImageryId);
  useEffect(() => {
    imageryRef.current = activeImageryId;
  }, [activeImageryId]);
  useEffect(() => {
    if (!viewer) return;
    const v = readHash();
    if (v) applyHashView(viewer, v);
    return syncHash(viewer, () => imageryRef.current);
  }, [viewer]);

  const flights = useFlights(viewer);
  const dataLayers = useDataLayers(viewer);

  const tools = useTools(viewer, { getLayer: dataLayers.get });

  // One card at a time: picking a layer item closes the flight card and vice versa
  const { select } = flights;
  const [picked, setPicked] = usePicking(viewer, { onPick: () => select(null), isBusy: tools.isBusy });
  useEffect(() => {
    if (flights.selectedId) setPicked(null);
  }, [flights.selectedId, setPicked]);

  // Let the picked layer highlight its item (e.g. satellite track + footprint)
  const { get: getLayer } = dataLayers;
  useEffect(() => {
    if (!picked) return;
    const layer = getLayer(picked.layerId);
    layer?.setSelected?.(picked.key);
    return () => layer?.setSelected?.(null);
  }, [picked, getLayer]);
  const pickedLayer = picked ? getLayer(picked.layerId) : null;

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

  // Keyboard shortcuts: L panel · Esc close card · H home · N north · +/- zoom · / search
  const { cancelDraw } = tools;
  useEffect(() => {
    const click = (id) => document.getElementById(id)?.click();
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea')) return;
      const actions = {
        Escape: () => {
          cancelDraw();
          select(null);
          setPicked(null);
        },
        l: () => setIsPanelOpen((p) => !p),
        h: () => click('btn-home'),
        n: () => click('btn-north'),
        '+': () => click('btn-zoom-in'),
        '=': () => click('btn-zoom-in'),
        '-': () => click('btn-zoom-out'),
        '/': () => document.getElementById('search-input')?.focus(),
        p: () => click('btn-shot'),
      };
      const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select, setPicked, cancelDraw]);

  const focusShape = useCallback(
    (shape) => {
      const [w, s, e, n] = boundsOf(shape.points, 0.6, 3000);
      viewer?.camera.flyTo({ destination: Rectangle.fromDegrees(w, s, e, n), duration: 1.5 });
    },
    [viewer]
  );

  return (
    <div className={`app-shell ${flights.selectedId || pickedLayer || tools.selected ? 'has-flight' : ''}`} id="app-shell">
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
          <span className="brand-version">v2.0</span>
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
            id: 'layers',
            label: 'Layers',
            badge: Object.values(dataLayers.enabled).filter(Boolean).length + (flights.enabled ? 1 : 0) + activeOverlays.length,
            content: (
              <DataLayersPanel
                dataLayers={dataLayers}
                flights={flights}
                flightsSettings={<FlightPanel flights={flights} embedded />}
                overlays={
                  <OverlayList
                    activeOverlays={activeOverlays}
                    onOverlayToggle={handleOverlayToggle}
                    overlayOpacity={overlayOpacity}
                    onOverlayOpacityChange={handleOverlayOpacity}
                  />
                }
              />
            ),
          },
          { id: 'tools', label: 'Tools', badge: tools.shapes.length, content: <ToolsPanel tools={tools} onFocus={focusShape} /> },
          { id: 'settings', label: 'Settings', content: <SettingsPanel perfMode={perfMode} onPerfModeChange={handlePerfMode} /> },
        ]}
        isOpen={isPanelOpen}
        onToggle={() => setIsPanelOpen((p) => !p)}
      />

      {/* Cards: selected flight / picked layer item / tool results */}
      <div className="card-dock">
        <FlightInfoCard flights={flights} />
        {pickedLayer && (
          <InfoCard
            layer={pickedLayer}
            itemKey={picked.key}
            onClose={() => setPicked(null)}
            onFlyTo={(d) => flyToSafe(viewer, { lon: d.lon, lat: d.lat, range: Math.max((d.altM || 0) * 2, 40_000) })}
          />
        )}
        <ResultCard tools={tools} onFlyTo={(lon, lat) => flyToSafe(viewer, { lon, lat, range: 8000 })} />
      </div>

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
