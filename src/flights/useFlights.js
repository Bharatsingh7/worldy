import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Cartesian2, Cartesian3, Math as CesiumMath } from 'cesium';

import FlightLayer from './FlightLayer';
import { fetchGlobal, fetchNearby, fetchMilitary, fetchRoute, fetchAircraft, fetchTrack, RateLimitError } from './api';

// Above this camera height we use the global feed; below it, the denser regional feed.
const GLOBAL_VIEW_HEIGHT = 1_500_000;
const REGIONAL_VIEW_HEIGHT = 3_000_000;
const GLOBAL_INTERVAL = 90_000;
const REGIONAL_INTERVAL = 8_000;
const MILITARY_INTERVAL = 15_000;
/** Drop aircraft we haven't heard from in this long. */
const STALE_AFTER = 5 * 60_000;
const TRAIL_POINTS = 120;
const FT = 0.3048;

export const MAX_ALT_FT = 50_000;

/**
 * Live flight tracking: polls the feeds, merges them by ICAO hex, drives the
 * FlightLayer, and exposes filter / selection / forecast state to the UI.
 */
export default function useFlights(viewer) {
  const [enabled, setEnabled] = useState(true);
  const [filter, setFilter] = useState({ mode: 'all', minAltFt: 0, maxAltFt: MAX_ALT_FT });
  const [forecastMin, setForecastMin] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [details, setDetails] = useState(null);
  const [follow, setFollow] = useState(false);
  const [stats, setStats] = useState({ total: 0, military: 0, shown: 0 });
  const [feeds, setFeeds] = useState({ global: 'idle', regional: 'idle', military: 'idle', credits: null, updatedAt: null });

  const flightsRef = useRef(new Map());
  const routesRef = useRef(new Map());
  const layerRef = useRef(null);

  const filterFn = useMemo(() => {
    const { mode, minAltFt, maxAltFt } = filter;
    return (f) => {
      if (mode === 'military' && !f.military) return false;
      if (mode === 'airborne' && f.onGround) return false;
      const altFt = f.altM / FT;
      if (altFt < minAltFt) return false;
      if (maxAltFt < MAX_ALT_FT && altFt > maxAltFt) return false;
      return true;
    };
  }, [filter]);
  const filterRef = useRef(filterFn);

  const updateStats = useCallback(() => {
    let military = 0;
    let shown = 0;
    for (const f of flightsRef.current.values()) {
      if (f.military) military++;
      if (filterRef.current(f)) shown++;
    }
    setStats({ total: flightsRef.current.size, military, shown });
  }, []);

  /** Merge a batch from any feed; the freshest report per aircraft wins. */
  const merge = useCallback((batch) => {
    const map = flightsRef.current;
    const now = Date.now();
    for (const f of batch) {
      const prev = map.get(f.id);
      if (prev && prev.ts > f.ts) {
        prev.military ||= f.military;
        prev.type ||= f.type;
        prev.reg ||= f.reg;
        continue;
      }
      if (prev) {
        f.military ||= prev.military;
        f.type ||= prev.type;
        f.reg ||= prev.reg;
        f.country ||= prev.country;
        f.callsign ||= prev.callsign;
        f.trail = prev.trail;
        const last = f.trail[f.trail.length - 1];
        if (!last || Math.abs(last.lat - prev.lat) + Math.abs(last.lon - prev.lon) > 0.005) {
          f.trail.push({ lat: prev.lat, lon: prev.lon, altM: prev.altM });
          if (f.trail.length > TRAIL_POINTS) f.trail.shift();
        }
      } else {
        f.trail = [];
      }
      f.lastSeen = now;
      map.set(f.id, f);
    }
    for (const [id, f] of map) if (now - f.lastSeen > STALE_AFTER) map.delete(id);

    layerRef.current?.setFlights(map);
    updateStats();
  }, [updateStats]);

  // ── Layer lifecycle ───────────────────────────────────
  useEffect(() => {
    if (!viewer || !enabled) return;
    const layer = new FlightLayer(viewer, { onPick: setSelectedId });
    layer.setFilter(filterRef.current);
    layer.setRoutes(routesRef.current);
    layer.setFlights(flightsRef.current);
    layerRef.current = layer;
    return () => {
      layer.destroy();
      layerRef.current = null;
    };
  }, [viewer, enabled]);

  // ── Polling ───────────────────────────────────────────
  useEffect(() => {
    if (!viewer || !enabled) return;
    const ctrl = new AbortController();
    const timers = [];
    let lastGlobal = 0;

    const cameraHeight = () => viewer.camera.positionCartographic.height;
    const cameraCenter = () => {
      const canvas = viewer.scene.canvas;
      const hit = viewer.camera.pickEllipsoid(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
      const carto = hit ? viewer.scene.globe.ellipsoid.cartesianToCartographic(hit) : viewer.camera.positionCartographic;
      return { lat: CesiumMath.toDegrees(carto.latitude), lon: CesiumMath.toDegrees(carto.longitude) };
    };
    const setFeed = (name, state, extra = {}) =>
      setFeeds((s) => ({ ...s, [name]: state, updatedAt: state === 'ok' ? Date.now() : s.updatedAt, ...extra }));

    // Each loop returns the delay until its next run
    const loop = (fn) => {
      const run = async () => {
        let next;
        if (document.hidden) next = 2_000;
        else {
          try {
            next = await fn();
          } catch (err) {
            if (ctrl.signal.aborted) return;
            next = err.next ?? 30_000;
          }
        }
        if (!ctrl.signal.aborted) timers.push(setTimeout(run, next));
      };
      run();
    };

    loop(async () => {
      if (lastGlobal && cameraHeight() < GLOBAL_VIEW_HEIGHT) return 10_000;
      setFeed('global', 'loading');
      try {
        const { flights, credits } = await fetchGlobal(ctrl.signal);
        lastGlobal = Date.now();
        merge(flights);
        setFeed('global', 'ok', { credits });
        return GLOBAL_INTERVAL;
      } catch (err) {
        if (err instanceof RateLimitError) {
          lastGlobal = Date.now();
          setFeed('global', 'limited', { credits: 0 });
          return Math.min(err.retryAfterSec * 1000, 3_600_000);
        }
        if (!ctrl.signal.aborted) setFeed('global', 'error');
        throw err;
      }
    });

    loop(async () => {
      const height = cameraHeight();
      if (height > REGIONAL_VIEW_HEIGHT) return 5_000;
      const { lat, lon } = cameraCenter();
      const radiusNm = Math.max(40, Math.min(250, height / 1852));
      try {
        merge(await fetchNearby(lat, lon, radiusNm, ctrl.signal));
        setFeed('regional', 'ok');
        return REGIONAL_INTERVAL;
      } catch (err) {
        if (!ctrl.signal.aborted) setFeed('regional', 'error');
        throw err;
      }
    });

    loop(async () => {
      try {
        merge(await fetchMilitary(ctrl.signal));
        setFeed('military', 'ok');
        return MILITARY_INTERVAL;
      } catch (err) {
        if (!ctrl.signal.aborted) setFeed('military', 'error');
        throw err;
      }
    });

    return () => {
      ctrl.abort();
      timers.forEach(clearTimeout);
    };
  }, [viewer, enabled, merge]);

  // ── Push UI state into the layer ──────────────────────
  useEffect(() => {
    filterRef.current = filterFn;
    layerRef.current?.setFilter(filterFn);
    updateStats();
  }, [filterFn, updateStats]);

  useEffect(() => layerRef.current?.setForecast(forecastMin), [forecastMin, enabled]);
  useEffect(() => layerRef.current?.setFollow(follow), [follow, enabled]);

  // ── Selection: load route, aircraft and past track ────
  useEffect(() => {
    setDetails(null);
    setFollow(false);
    if (!selectedId) {
      layerRef.current?.setSelected(null);
      setSelectedFlight(null);
      return;
    }
    const flight = flightsRef.current.get(selectedId);
    const ctrl = new AbortController();
    layerRef.current?.setSelected({ id: selectedId, route: null, track: null });
    setDetails({ loading: true });

    const callsign = flight?.callsign;
    const cachedRoute = routesRef.current.get(callsign);
    Promise.all([
      cachedRoute !== undefined ? cachedRoute : fetchRoute(callsign, ctrl.signal).catch(() => null),
      fetchAircraft(selectedId, ctrl.signal).catch(() => null),
      fetchTrack(selectedId, ctrl.signal).catch(() => []),
    ]).then(([route, aircraft, track]) => {
      if (ctrl.signal.aborted) return;
      if (callsign) routesRef.current.set(callsign, route);
      setDetails({ loading: false, route, aircraft, track });
      layerRef.current?.setSelected({ id: selectedId, route, track });
    });

    return () => ctrl.abort();
  }, [selectedId]);

  // Refresh the selected flight's live numbers once a second
  useEffect(() => {
    if (!selectedId) return;
    const tick = () => {
      const f = flightsRef.current.get(selectedId);
      if (!f) return setSelectedFlight((prev) => (prev ? { ...prev, lost: true } : null));
      setSelectedFlight({ ...f, pos: layerRef.current?.locate(selectedId) ?? f, lost: false });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [selectedId]);

  // ── Actions ───────────────────────────────────────────
  const flyTo = useCallback((id) => {
    const p = layerRef.current?.locate(id);
    if (!viewer || !p) return;
    setFollow(false);
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(p.lon, p.lat, Math.max(p.altM + 60_000, 120_000)),
      duration: 1.5,
    });
  }, [viewer]);

  /** Find by callsign, registration or ICAO hex; selects and flies to it. */
  const findFlight = useCallback((query) => {
    const q = query.trim().toUpperCase();
    if (!q) return false;
    const all = [...flightsRef.current.values()];
    const match =
      all.find((f) => f.callsign === q || f.reg.toUpperCase() === q || f.id.toUpperCase() === q) ||
      all.find((f) => f.callsign.startsWith(q) || f.reg.toUpperCase().startsWith(q));
    if (!match) return false;
    setSelectedId(match.id);
    flyTo(match.id);
    return true;
  }, [flyTo]);

  const setEnabledAndReset = useCallback((on) => {
    setEnabled(on);
    if (!on) {
      setSelectedId(null);
      setForecastMin(0);
    }
  }, []);

  return {
    enabled,
    setEnabled: setEnabledAndReset,
    filter,
    setFilter,
    forecastMin,
    setForecastMin,
    selectedId,
    select: setSelectedId,
    selectedFlight,
    details,
    follow,
    setFollow,
    stats,
    feeds,
    flyTo,
    findFlight,
  };
}
