/**
 * Flight data sources — all free and keyless.
 *
 *  - OpenSky Network  : global state vectors (anonymous: ~400 credits/day, /states/all costs 4)
 *  - adsb.lol         : regional + military-flagged aircraft (community ADS-B feeders)
 *  - adsbdb.com       : callsign → origin/destination route, hex → aircraft details
 *
 * OpenSky and adsb.lol don't send CORS headers, so they go through the
 * Vite dev/preview proxy (see vite.config.js). adsbdb allows CORS directly.
 *
 * Only aircraft that broadcast ADS-B / are multilaterated appear here. Aircraft
 * with transponders off (e.g. many military/stealth sorties) are not in any public feed.
 */

const OPENSKY = '/api/opensky';
const ADSB = '/api/adsb';
const ADSBDB = 'https://api.adsbdb.com/v0';

const FT = 0.3048;
const KT = 0.514444;

export class RateLimitError extends Error {
  constructor(retryAfterSec) {
    super('OpenSky rate limit reached');
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Normalised flight shape shared by every source.
 * @typedef {{
 *   id: string, callsign: string, lat: number, lon: number, altM: number,
 *   speedMs: number, headingDeg: number, vertRateMs: number, onGround: boolean,
 *   military: boolean, type: string, reg: string, country: string,
 *   squawk: string, source: string, ts: number
 * }} Flight
 */

// ── OpenSky ──────────────────────────────────────────────

function fromOpenSky(s) {
  // [icao24, callsign, origin_country, time_position, last_contact, lon, lat,
  //  baro_altitude, on_ground, velocity, true_track, vertical_rate, sensors,
  //  geo_altitude, squawk, spi, position_source]
  if (s[5] == null || s[6] == null) return null;
  return {
    id: s[0],
    callsign: (s[1] || '').trim(),
    lat: s[6],
    lon: s[5],
    altM: s[13] ?? s[7] ?? 0,
    speedMs: s[9] ?? 0,
    headingDeg: s[10] ?? 0,
    vertRateMs: s[11] ?? 0,
    onGround: !!s[8],
    military: false,
    type: '',
    reg: '',
    country: s[2] || '',
    squawk: s[14] || '',
    source: 'OpenSky',
    ts: (s[3] ?? s[4]) * 1000,
  };
}

export async function fetchGlobal(signal) {
  const res = await fetch(`${OPENSKY}/states/all`, { signal });
  if (res.status === 429) {
    throw new RateLimitError(Number(res.headers.get('x-rate-limit-retry-after-seconds')) || 3600);
  }
  if (!res.ok) throw new Error(`OpenSky ${res.status}`);
  const data = await res.json();
  const remaining = res.headers.get('x-rate-limit-remaining');
  return {
    flights: (data.states || []).map(fromOpenSky).filter(Boolean),
    credits: remaining != null ? Number(remaining) : null,
  };
}

export async function fetchTrack(icao24, signal) {
  const res = await fetch(`${OPENSKY}/tracks/all?icao24=${icao24}&time=0`, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  // path: [time, lat, lon, baro_altitude, true_track, on_ground]
  return (data.path || []).map(([, lat, lon, alt]) => ({ lat, lon, altM: alt ?? 0 }));
}

// ── adsb.lol ─────────────────────────────────────────────

function fromAdsb(ac, nowMs) {
  if (ac.lat == null || ac.lon == null) return null;
  const onGround = ac.alt_baro === 'ground';
  const altFt = onGround ? 0 : (ac.alt_geom ?? ac.alt_baro ?? 0);
  return {
    id: ac.hex.replace(/^~/, ''),
    callsign: (ac.flight || '').trim(),
    lat: ac.lat,
    lon: ac.lon,
    altM: altFt * FT,
    speedMs: (ac.gs ?? 0) * KT,
    headingDeg: ac.track ?? ac.true_heading ?? ac.mag_heading ?? 0,
    vertRateMs: ((ac.geom_rate ?? ac.baro_rate ?? 0) * FT) / 60,
    onGround,
    military: (ac.dbFlags & 1) === 1,
    type: ac.t || '',
    reg: ac.r || '',
    country: '',
    squawk: ac.squawk || '',
    source: 'adsb.lol',
    ts: nowMs - (ac.seen_pos ?? ac.seen ?? 0) * 1000,
  };
}

async function fetchAdsb(path, signal) {
  const res = await fetch(`${ADSB}${path}`, { signal });
  if (!res.ok) throw new Error(`adsb.lol ${res.status}`);
  const data = await res.json();
  const now = data.now ?? Date.now();
  return (data.ac || []).map((ac) => fromAdsb(ac, now)).filter(Boolean);
}

/** Aircraft within radiusNm (max 250) of a point. */
export const fetchNearby = (lat, lon, radiusNm, signal) =>
  fetchAdsb(`/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${Math.min(250, Math.round(radiusNm))}`, signal);

/** Every aircraft flagged military in the adsb.lol database that is currently broadcasting. */
export const fetchMilitary = (signal) => fetchAdsb('/v2/mil', signal);

// ── adsbdb ───────────────────────────────────────────────

function toAirport(a) {
  return {
    name: a.name,
    iata: a.iata_code,
    icao: a.icao_code,
    city: a.municipality,
    country: a.country_name,
    lat: a.latitude,
    lon: a.longitude,
  };
}

/** Scheduled route for a callsign, or null if unknown. */
export async function fetchRoute(callsign, signal) {
  if (!callsign) return null;
  const res = await fetch(`${ADSBDB}/callsign/${encodeURIComponent(callsign)}`, { signal });
  if (!res.ok) return null;
  const route = (await res.json())?.response?.flightroute;
  if (!route?.origin || !route?.destination) return null;
  return {
    airline: route.airline?.name || '',
    origin: toAirport(route.origin),
    destination: toAirport(route.destination),
  };
}

/** Aircraft registry details for an ICAO hex, or null. */
export async function fetchAircraft(icao24, signal) {
  const res = await fetch(`${ADSBDB}/aircraft/${icao24}`, { signal });
  if (!res.ok) return null;
  const a = (await res.json())?.response?.aircraft;
  if (!a) return null;
  return {
    model: [a.manufacturer, a.type].filter(Boolean).join(' '),
    owner: a.registered_owner || '',
    ownerCountry: a.registered_owner_country_name || '',
    reg: a.registration || '',
    photo: a.url_photo_thumbnail || null,
  };
}
