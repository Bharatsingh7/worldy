/**
 * Vite dev/preview middleware: worldwide ships from aisstream.io.
 *
 * aisstream only allows server-side connections, so this keeps one upstream
 * WebSocket (opened on first request, closed after 10 idle minutes), stores the
 * latest report per ship, and serves GET /api/ships?bbox=west,south,east,north.
 * Without AISSTREAM_KEY it answers 204 and the app falls back to Baltic-only data.
 */

const UPSTREAM = 'wss://stream.aisstream.io/v0/stream';
const IDLE_MS = 10 * 60e3;
const MAX_AGE_MS = 60 * 60e3;
const MAX_RESULTS = 8000;

export default function aisRelay(apiKey) {
  const ships = new Map();
  let ws = null;
  let lastRequest = 0;
  let idleTimer = null;

  function connect() {
    ws = new WebSocket(UPSTREAM);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ShipStaticData'],
        })
      );
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString());
      } catch {
        return;
      }
      const meta = msg.MetaData;
      if (!meta?.MMSI) return;
      const s = ships.get(meta.MMSI) || { mmsi: meta.MMSI };
      if (msg.MessageType === 'ShipStaticData') {
        const d = msg.Message.ShipStaticData;
        s.type = d.Type;
        s.dest = d.Destination?.trim();
        s.name = d.Name?.trim() || s.name;
      } else {
        const p = msg.Message[msg.MessageType];
        s.lat = meta.latitude;
        s.lon = meta.longitude;
        s.sog = p.Sog;
        s.cog = p.Cog;
        s.heading = p.TrueHeading === 511 ? null : p.TrueHeading;
        s.navStat = p.NavigationalStatus;
        s.ts = Date.now();
        s.name ||= meta.ShipName?.trim();
      }
      ships.set(meta.MMSI, s);
    };
    ws.onclose = () => {
      ws = null;
    };
    ws.onerror = () => ws?.close();
  }

  function scheduleIdleCheck() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (Date.now() - lastRequest >= IDLE_MS) ws?.close();
      else scheduleIdleCheck();
    }, IDLE_MS);
  }

  function middleware(req, res, next) {
    if (!req.url.startsWith('/api/ships')) return next();
    if (!apiKey) {
      res.statusCode = 204;
      return res.end();
    }
    lastRequest = Date.now();
    if (!ws) connect();
    scheduleIdleCheck();

    const bbox = new URL(req.url, 'http://x').searchParams.get('bbox')?.split(',').map(Number);
    const [w, s, e, n] = bbox?.length === 4 ? bbox : [-180, -90, 180, 90];
    const now = Date.now();
    const out = [];
    for (const [k, v] of ships) {
      if (v.ts == null || v.lat == null) continue;
      if (now - v.ts > MAX_AGE_MS) {
        ships.delete(k);
        continue;
      }
      const inLon = w <= e ? v.lon >= w && v.lon <= e : v.lon >= w || v.lon <= e;
      if (inLon && v.lat >= s && v.lat <= n) out.push(v);
      if (out.length >= MAX_RESULTS) break;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ connected: ws?.readyState === 1, total: ships.size, ships: out }));
  }

  return {
    name: 'worldy-ais-relay',
    configureServer: (server) => server.middlewares.use(middleware),
    configurePreviewServer: (server) => server.middlewares.use(middleware),
  };
}
