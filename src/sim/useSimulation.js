import { useState, useRef, useCallback, useEffect } from 'react';
import { ScreenSpaceEventHandler, ScreenSpaceEventType, Cartographic, Math as CesiumMath } from 'cesium';

import PhysicsEngine from './engine';
import WaterSurfacePrimitive from './render/WaterSurfacePrimitive';
import TracerLayer from './render/TracerLayer';
import { prepareGrid, prepareOceanGrid, cellOf, cellLonLat } from './grid';
import { fetchBuildings, porosityFrom, buildingsPrimitive } from './buildings';
import { scenarioById } from './scenarios';
import { loadPerfMode } from '../perf';

const MAX_CELLS = { eco: 160, balanced: 224, quality: 300 };
const GAUGE_POINTS = 600;

function pointInPoly(lon, lat, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Live disaster simulation on the map: prepares the grid (corrected terrain + OSM buildings),
 * drives the physics worker, renders the water surface every frame, and keeps gauges.
 */
export default function useSimulation(viewer, { ensureTerrain }) {
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState(null);
  const [gridInfo, setGridInfo] = useState(null);
  const [gauges, setGauges] = useState([]);
  const [placingGauge, setPlacingGauge] = useState(false);
  const [speed, setSpeedState] = useState(120);
  const [instantStats, setInstantStats] = useState(null);
  const [active, setActive] = useState(null); // { scenario, params, mode }

  const engineRef = useRef(null);
  const waterRef = useRef(null);
  const buildingsRef = useRef(null);
  const tracersRef = useRef(null);
  const fixedScaleRef = useRef(false);
  const gridRef = useRef(null);
  const statsTick = useRef(0);
  const gaugesRef = useRef([]);
  useEffect(() => {
    gaugesRef.current = gauges;
  }, [gauges]);

  const clear = useCallback(() => {
    engineRef.current?.destroy();
    engineRef.current = null;
    if (viewer && !viewer.isDestroyed()) {
      if (waterRef.current) viewer.scene.primitives.remove(waterRef.current);
      if (buildingsRef.current) viewer.scene.primitives.remove(buildingsRef.current);
      tracersRef.current?.destroy();
      viewer.scene.requestRender();
    }
    tracersRef.current = null;
    waterRef.current = null;
    buildingsRef.current = null;
    gridRef.current = null;
    setStats(null);
    setInstantStats(null);
    setGauges([]);
    setGridInfo(null);
    setActive(null);
    setStatus('idle');
    setMessage('');
  }, [viewer]);

  useEffect(() => () => engineRef.current?.destroy(), []);

  const onFrame = useCallback(
    (data) => {
      const water = waterRef.current;
      if (!water) return;
      water.setFrame(data.depth, data.speed);
      if (data.tracers && tracersRef.current) tracersRef.current.update(data.tracers.x, data.tracers.y, data.depth);
      // colour scale follows the flood (95th percentile of wet depths, at least 0.5 m)
      if (!fixedScaleRef.current && statsTick.current % 15 === 0) {
        const wet = [];
        for (let i = 0; i < data.depth.length; i += 7) if (data.depth[i] > 0.05) wet.push(data.depth[i]);
        wet.sort((a, b) => a - b);
        water.maxDepth = Math.max(0.5, wet.length ? wet[Math.floor(wet.length * 0.95)] : 0.5);
      }
      viewer?.scene.requestRender();
      if (data.probes?.length) {
        setGauges((gs) =>
          gs.map((g) => {
            const p = data.probes.find((q) => q.cell === g.cell);
            if (!p) return g;
            const series = [...g.series, { t: data.stats.t, depth: p.depth, speed: p.speed }];
            return { ...g, series: series.length > GAUGE_POINTS ? series.filter((_, i) => i % 2 === 0) : series };
          })
        );
      }
      if (statsTick.current++ % 4 === 0) setStats(data.stats);
    },
    [viewer]
  );

  /** Prepare everything for a scenario and start it. */
  const start = useCallback(
    async ({ scenarioId, params, mode, area, point, line, buildings }) => {
      if (!viewer) return;
      clear();
      const scenario = scenarioById(scenarioId);
      try {
        setStatus('preparing');
        setMessage('Switching on corrected 3D terrain…');
        await ensureTerrain?.();
        const maxCells = MAX_CELLS[loadPerfMode()] || 224;
        if (scenario.needs.includes('line') && !line) throw new Error(`Draw a Line (Tools tab) for the ${scenario.lineLabel.toLowerCase()}.`);
        let grid;
        if (scenario.gridSource === 'etopo') {
          setMessage('Loading NOAA ETOPO bathymetry for the ocean domain…');
          const bounds = scenario.domain(area, point, line);
          if (bounds[2] - bounds[0] > 30 || bounds[3] - bounds[1] > 30) throw new Error('Domain too large (> 30°): keep the area, source and track closer together.');
          grid = await prepareOceanGrid(bounds, Math.min(maxCells, 256));
        } else {
          setMessage('Sampling terrain for the simulation grid…');
          grid = await prepareGrid(area, maxCells, { padFrac: scenario.domainPad ?? 0.05, minSpanM: scenario.domainPad ? 3000 : 800 });
        }
        gridRef.current = grid;
        const groundAt = (lon, lat) => {
          const c = cellOf(grid, lon, lat);
          return c >= 0 ? grid.ground[c] : grid.ground[0];
        };

        let builtCells = 0;
        let buildingCount = 0;
        if (buildings && !grid.ocean) {
          setMessage('Loading OpenStreetMap buildings…');
          try {
            const { list, skipped } = await fetchBuildings(grid.bounds);
            if (!skipped && list.length) {
              const por = porosityFrom(list, grid);
              grid.phi = por.phi;
              builtCells = por.builtCells;
              buildingCount = list.length;
              const prim = buildingsPrimitive(list, grid, groundAt);
              if (prim) buildingsRef.current = viewer.scene.primitives.add(prim);
            }
          } catch {
            setMessage('Buildings unavailable (OpenStreetMap busy) — continuing without them…');
          }
        }

        const mask = new Uint8Array(grid.nx * grid.ny);
        for (let c = 0; c < mask.length; c++) {
          const [lon, lat] = cellLonLat(grid, c);
          mask[c] = pointInPoly(lon, lat, area.points) ? 1 : 0;
        }
        const pointCell = point ? cellOf(grid, ...(point.center || point.points[0])) : -1;
        if (scenario.needs.includes('point') && pointCell < 0) throw new Error(`${scenario.pointLabel || 'The point'} must be inside the simulation area.`);

        const cfg = scenario.configure(grid, params, { area, point, line, pointCell, mask });
        const fullCfg = {
          mode,
          speed: scenario.speed,
          bounds: grid.bounds,
          ...cfg,
          grid: { nx: grid.nx, ny: grid.ny, dx: grid.dx, dy: grid.dy, z: grid.z, phi: grid.phi, ...cfg.grid },
          probes: gaugesRef.current.map((g) => g.cell),
        };

        const water = new WaterSurfacePrimitive({ nx: grid.nx, ny: grid.ny, bounds: grid.bounds, ground: grid.ground, bed: grid.bed || grid.z, cellSize: grid.cellSize });
        water.mode = scenario.render || 0;
        if (water.mode >= 2) {
          water.lift = 0;
          water.maxDepth = 1;
        }
        if (cfg.colorScale) water.maxDepth = cfg.colorScale;
        fixedScaleRef.current = water.mode !== 0;
        if (scenarioId === 'lava') water.colors = ['#ffcc33', '#b01800'];
        if (scenarioId === 'debris') water.colors = ['#b08b5a', '#4a3520'];
        if (scenarioId === 'avalanche') water.colors = ['#ffffff', '#b8c8de'];
        waterRef.current = viewer.scene.primitives.add(water);
        if (cfg.tracers) {
          tracersRef.current = new TracerLayer(viewer, grid, {
            count: cfg.tracers.count,
            height: cfg.tracers.source === 'wind' ? 1500 : 0,
            color: cfg.tracers.source === 'wind' ? '#e8f4ff' : '#ffffff',
          });
        }

        const engine = new PhysicsEngine({
          onFrame,
          onDone: () => setStatus('done'),
          onInstant: (d) => {
            waterRef.current?.setFrame(d.depth, null);
            viewer.scene.requestRender();
            setInstantStats(d.stats);
          },
          onError: (e) => {
            setStatus('error');
            setMessage(e.message);
          },
        });
        engineRef.current = engine;
        engine.init(fullCfg);
        setGridInfo({ nx: grid.nx, ny: grid.ny, cell: grid.cellSize, buildings: buildingCount, builtCells, km2: (grid.nx * grid.dx * grid.ny * grid.dy) / 1e6 });
        setActive({ scenario, params, mode });
        setSpeedState(scenario.speed);
        setMessage('');
        setStatus('running');
        engine.run(scenario.speed);
      } catch (err) {
        setStatus('error');
        setMessage(err.message || String(err));
      }
    },
    [viewer, clear, ensureTerrain, onFrame]
  );

  const pause = useCallback(() => {
    engineRef.current?.pause();
    setStatus('paused');
  }, []);

  const resume = useCallback(() => {
    engineRef.current?.run();
    setStatus('running');
  }, []);

  const setSpeed = useCallback((s) => {
    setSpeedState(s);
    engineRef.current?.setSpeed(s);
  }, []);

  /** Where would this much rain finally collect? (instant, basin hierarchy) */
  const instant = useCallback((rainMm, runoff) => {
    engineRef.current?.pause();
    setStatus('paused');
    engineRef.current?.instant(rainMm, runoff);
  }, []);

  // Gauge placement: next click on the globe drops a probe in the grid
  useEffect(() => {
    if (!viewer || !placingGauge) return;
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    viewer.container.dataset.drawing = '1';
    handler.setInputAction((e) => {
      const ray = viewer.camera.getPickRay(e.position);
      const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
      const grid = gridRef.current;
      if (hit && grid) {
        const k = Cartographic.fromCartesian(hit);
        const lon = CesiumMath.toDegrees(k.longitude);
        const lat = CesiumMath.toDegrees(k.latitude);
        const cell = cellOf(grid, lon, lat);
        if (cell >= 0) {
          const next = [...gaugesRef.current, { id: Date.now(), cell, lon, lat, ground: grid.z[cell], series: [] }];
          setGauges(next);
          engineRef.current?.setProbes(next.map((g) => g.cell));
        }
      }
      setPlacingGauge(false);
    }, ScreenSpaceEventType.LEFT_CLICK);
    return () => {
      handler.destroy();
      delete viewer.container.dataset.drawing;
    };
  }, [viewer, placingGauge]);

  const removeGauge = useCallback((id) => {
    const next = gaugesRef.current.filter((g) => g.id !== id);
    setGauges(next);
    engineRef.current?.setProbes(next.map((g) => g.cell));
  }, []);

  return {
    status,
    message,
    stats,
    gridInfo,
    gauges,
    placingGauge,
    setPlacingGauge,
    removeGauge,
    speed,
    setSpeed,
    instantStats,
    active,
    start,
    pause,
    resume,
    clear,
    instant,
  };
}
