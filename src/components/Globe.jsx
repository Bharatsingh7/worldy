import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Viewer,
  SceneMode,
  SkyBox,
  SkyAtmosphere,
  Globe as CesiumGlobe,
  Color,
  Cartesian3,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  ImageryLayer,
  Math as CesiumMath,
  EllipsoidTerrainProvider,
  Ion,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

import { IMAGERY_LAYERS, OVERLAY_LAYERS, TERRAIN_OPTIONS } from '../layers';

/**
 * Core Globe component — creates and manages the CesiumJS Viewer.
 * Handles imagery switching, overlays, terrain, and performance tuning.
 */
export default function Globe({
  activeImageryId,
  activeOverlays,
  activeTerrainId,
  terrainExaggeration,
  onViewerReady,
  onLoaded,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const overlayLayersRef = useRef({});

  // ── Initialize Viewer ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    // Suppress default Ion token warning — we use free sources
    Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTQ0OS1kMWFjYmFkNjc5YzciLCJpZCI6NTc3MzMsImlhdCI6MTYyNzg0NTE4Mn0.XcKpgANiY19MC4bdFUXMVEBToBmqS8kuYpUlxJHYZxk';

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
      creditContainer: document.createElement('div'), // hide credits container

      // Scene settings
      sceneMode: SceneMode.SCENE3D,
      scene3DOnly: true,

      // Performance
      requestRenderMode: false,
      maximumRenderTimeChange: Infinity,
      targetFrameRate: 60,
      msaaSamples: 4,

      // Don't add default imagery — we'll add our own
      baseLayer: false,
    });

    // ── Performance Tuning ──────────────────────────────
    const scene = viewer.scene;
    const globe = scene.globe;

    // Enable lighting for realistic sun illumination
    globe.enableLighting = true;

    // Depth testing against terrain
    globe.depthTestAgainstTerrain = true;

    // Tile caching
    globe.tileCacheSize = 1000;

    // Smooth tile loading
    globe.preloadSiblings = true;
    globe.preloadAncestors = true;

    // Level of detail
    globe.maximumScreenSpaceError = 1.5; // Lower = sharper, higher = faster

    // Atmosphere
    scene.skyAtmosphere.brightnessShift = 0.0;
    scene.skyAtmosphere.hueShift = 0.0;
    scene.skyAtmosphere.saturationShift = 0.0;

    // Globe base color (oceans when no tiles loaded)
    globe.baseColor = Color.fromCssColorString('#0a1628');

    // Show atmosphere ring
    globe.showGroundAtmosphere = true;

    // Fog for distance
    scene.fog.enabled = true;
    scene.fog.density = 2.0e-4;
    scene.fog.minimumBrightness = 0.03;

    // Background — deep space
    scene.backgroundColor = Color.fromCssColorString('#000000');

    // High DPI
    viewer.resolutionScale = window.devicePixelRatio || 1.0;

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
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(30, 20, 20000000),
      duration: 0,
    });

    viewerRef.current = viewer;
    onViewerReady(viewer);

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

    const layers = viewer.imageryLayers;

    // Remove existing base layer (index 0)
    if (layers.length > 0) {
      // Find and remove the base layer (lowest layer that isn't an overlay)
      const overlayIds = new Set(Object.keys(overlayLayersRef.current));
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers.get(i);
        if (!layer._worldyOverlayId) {
          layers.remove(layer);
          break;
        }
      }
    }

    // Add new base layer
    const providerResult = layerDef.createProvider();

    if (providerResult instanceof Promise || (providerResult && typeof providerResult.then === 'function')) {
      providerResult.then((provider) => {
        if (viewer.isDestroyed()) return;
        const newLayer = layers.addImageryProvider(provider, 0);
        newLayer._worldyBaseLayer = true;
      });
    } else {
      const newLayer = layers.addImageryProvider(providerResult, 0);
      newLayer._worldyBaseLayer = true;
    }
  }, [activeImageryId]);

  // ── Manage Overlays ────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const layers = viewer.imageryLayers;

    // Remove overlays that are no longer active
    for (const [overlayId, cesiumLayer] of Object.entries(overlayLayersRef.current)) {
      if (!activeOverlays.includes(overlayId)) {
        layers.remove(cesiumLayer);
        delete overlayLayersRef.current[overlayId];
      }
    }

    // Add new overlays
    for (const overlayId of activeOverlays) {
      if (overlayLayersRef.current[overlayId]) continue; // already added

      const overlayDef = OVERLAY_LAYERS.find((o) => o.id === overlayId);
      if (!overlayDef) continue;

      const addOverlayLayer = (provider) => {
        if (viewer.isDestroyed()) return;
        const newLayer = layers.addImageryProvider(provider);
        newLayer._worldyOverlayId = overlayId;
        // Transparent tile overlays (hasAlphaChannel) should be fully opaque —
        // their transparency comes from the PNG alpha channel itself.
        // Non-transparent overlays get reduced alpha for blending.
        newLayer.alpha = 1.0;
        // Ensure overlay is always on top of the stack
        layers.raiseToTop(newLayer);
        overlayLayersRef.current[overlayId] = newLayer;
      };

      const providerResult = overlayDef.createProvider();
      if (providerResult instanceof Promise || (providerResult && typeof providerResult.then === 'function')) {
        providerResult.then(addOverlayLayer);
      } else {
        addOverlayLayer(providerResult);
      }
    }
  }, [activeOverlays]);

  // ── Switch Terrain ─────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const terrainDef = TERRAIN_OPTIONS.find((t) => t.id === activeTerrainId);
    if (!terrainDef) return;

    const providerResult = terrainDef.createProvider();

    if (providerResult instanceof Promise || (providerResult && typeof providerResult.then === 'function')) {
      providerResult.then((provider) => {
        if (viewer.isDestroyed()) return;
        viewer.terrainProvider = provider;
      });
    } else {
      viewer.terrainProvider = providerResult;
    }
  }, [activeTerrainId]);

  // ── Terrain Exaggeration ───────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.scene.verticalExaggeration = terrainExaggeration;
  }, [terrainExaggeration]);

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
