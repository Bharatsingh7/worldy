import React, { useRef, useEffect } from 'react';
import { Viewer, SceneMode, Color, Cartesian3 } from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

import { IMAGERY_LAYERS, OVERLAY_LAYERS, TERRAIN_OPTIONS } from '../layers';
import { applyPerfMode } from '../perf';
import { installGroundGuard } from '../camera';

/** Resolve a provider factory result that may or may not be a Promise. */
const resolveProvider = (result) => Promise.resolve(result);

/**
 * Core Globe component — creates and manages the CesiumJS Viewer.
 * Handles imagery switching, overlays, terrain, and performance tuning.
 */
export default function Globe({
  activeImageryId,
  activeOverlays,
  overlayOpacity,
  activeTerrainId,
  terrainExaggeration,
  bareEarth,
  perfMode,
  onViewerReady,
  onLoaded,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const baseLayerRef = useRef(null);
  const baseRequestRef = useRef(0);
  const overlayLayersRef = useRef({});
  const overlayOpacityRef = useRef(overlayOpacity);

  // ── Initialize Viewer ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    // Credits are rendered into the status bar (attribution is required by OSM/Esri/NASA)
    const creditContainer = document.createElement('div');
    creditContainer.className = 'worldy-credits';

    const viewer = new Viewer(containerRef.current, {
      // Disable all default UI widgets — we have our own
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer,

      // Scene settings
      sceneMode: SceneMode.SCENE3D,
      scene3DOnly: true,

      // Render only when something changes (camera, tiles, data) — the big GPU saver
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,

      // Don't add default imagery — we'll add our own
      baseLayer: false,
    });

    // ── Performance Tuning ──────────────────────────────
    const scene = viewer.scene;
    const globe = scene.globe;

    // Resolution, anti-aliasing, tile detail, lighting, frame cap
    applyPerfMode(viewer, perfMode);

    // Depth testing against terrain
    globe.depthTestAgainstTerrain = true;

    // Smooth tile loading
    globe.preloadAncestors = true;

    // Globe base color (oceans when no tiles loaded)
    globe.baseColor = Color.fromCssColorString('#0a1628');

    // Fog for distance
    scene.fog.enabled = true;
    scene.fog.density = 2.0e-4;
    scene.fog.minimumBrightness = 0.03;

    // Background — deep space
    scene.backgroundColor = Color.fromCssColorString('#000000');

    // Logarithmic depth buffer for z-fighting prevention
    scene.logarithmicDepthBuffer = true;

    // Camera constraints
    scene.screenSpaceCameraController.minimumZoomDistance = 250; // ~250m minimum
    scene.screenSpaceCameraController.maximumZoomDistance = 50000000; // 50,000 km max

    // Smooth inertia
    scene.screenSpaceCameraController.inertiaSpin = 0.9;
    scene.screenSpaceCameraController.inertiaTranslate = 0.9;
    scene.screenSpaceCameraController.inertiaZoom = 0.8;

    // Initial camera position — nice overview
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(30, 20, 20000000),
    });

    // Never let the camera end up inside the terrain
    const removeGuard = installGroundGuard(viewer);

    viewerRef.current = viewer;
    onViewerReady(viewer, creditContainer);

    // Signal loaded after tiles start rendering
    const removeListener = globe.tileLoadProgressEvent.addEventListener((remaining) => {
      if (remaining === 0) {
        onLoaded();
        removeListener();
      }
    });

    // Fallback: signal loaded after 3s regardless
    const timeout = setTimeout(() => onLoaded(), 3000);

    return () => {
      clearTimeout(timeout);
      removeGuard();
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // ── Switch Base Imagery ────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const layerDef = IMAGERY_LAYERS.find((l) => l.id === activeImageryId);
    if (!layerDef) return;

    // Ignore late-resolving providers if the user has switched again meanwhile
    const requestId = ++baseRequestRef.current;

    resolveProvider(layerDef.createProvider())
      .then((provider) => {
        if (viewer.isDestroyed() || requestId !== baseRequestRef.current) return;
        const layers = viewer.imageryLayers;
        if (baseLayerRef.current) layers.remove(baseLayerRef.current);
        baseLayerRef.current = layers.addImageryProvider(provider, 0);
        viewer.scene.requestRender();
      })
      .catch((err) => console.warn(`Imagery "${layerDef.id}" failed:`, err));
  }, [activeImageryId]);

  // ── Manage Overlays ────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const layers = viewer.imageryLayers;
    const current = overlayLayersRef.current;

    // Remove overlays that are no longer active
    for (const [overlayId, cesiumLayer] of Object.entries(current)) {
      if (!activeOverlays.includes(overlayId)) {
        if (cesiumLayer !== 'pending') layers.remove(cesiumLayer);
        delete current[overlayId];
      }
    }
    viewer.scene.requestRender();

    // Add new overlays
    for (const overlayId of activeOverlays) {
      if (current[overlayId]) continue; // already added or loading

      const overlayDef = OVERLAY_LAYERS.find((o) => o.id === overlayId);
      if (!overlayDef) continue;

      current[overlayId] = 'pending';
      resolveProvider(overlayDef.createProvider())
        .then((provider) => {
          // Skip if destroyed or toggled off while loading
          if (viewer.isDestroyed() || current[overlayId] !== 'pending') return;
          const newLayer = layers.addImageryProvider(provider);
          newLayer.alpha = overlayOpacityRef.current[overlayId] ?? 1.0;
          layers.raiseToTop(newLayer);
          current[overlayId] = newLayer;
          viewer.scene.requestRender();
        })
        .catch((err) => {
          console.warn(`Overlay "${overlayId}" failed:`, err);
          delete current[overlayId];
        });
    }
  }, [activeOverlays]);

  // ── Overlay Opacity ────────────────────────────────────
  useEffect(() => {
    overlayOpacityRef.current = overlayOpacity;
    for (const [overlayId, cesiumLayer] of Object.entries(overlayLayersRef.current)) {
      if (cesiumLayer !== 'pending') cesiumLayer.alpha = overlayOpacity[overlayId] ?? 1.0;
    }
    viewerRef.current?.scene.requestRender();
  }, [overlayOpacity]);

  // ── Switch Terrain ─────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const terrainDef = TERRAIN_OPTIONS.find((t) => t.id === activeTerrainId);
    if (!terrainDef) return;

    resolveProvider(terrainDef.createProvider({ bareEarth }))
      .then((provider) => {
        if (viewer.isDestroyed()) return;
        viewer.terrainProvider = provider;
        viewer.scene.requestRender();
      })
      .catch((err) => console.warn(`Terrain "${terrainDef.id}" failed:`, err));
  }, [activeTerrainId, bareEarth]);

  // ── Terrain Exaggeration ───────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.scene.verticalExaggeration = terrainExaggeration;
    viewer.scene.requestRender();
  }, [terrainExaggeration]);

  // ── Performance Mode ───────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    applyPerfMode(viewer, perfMode);
  }, [perfMode]);

  return (
    <div
      ref={containerRef}
      id="cesium-container"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
      }}
    />
  );
}
