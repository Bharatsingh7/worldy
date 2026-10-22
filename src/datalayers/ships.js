import { Math as CesiumMath } from 'cesium';
import { BaseLayer, PointSet } from './BaseLayer';

const DIGITRAFFIC = 'https://meri.digitraffic.fi/api/ais/v1';
const HEADERS = { 'Digitraffic-User': 'Worldy/1.1' };
const NA_SOG = 102.3;

/** AIS ship type code → category. */
export function shipCategory(type) {
  if (type === 35) return 'military';
  if (type === 55) return 'law';
  if (type >= 60 && type <= 69) return 'passenger';
  if (type >= 70 && type <= 79) return 'cargo';
  if (type >= 80 && type <= 89) return 'tanker';
  if (type === 30) return 'fishing';
  if (type === 36 || type === 37) return 'leisure';
  if ((type >= 50 && type <= 54) || type === 31 || type === 32) return 'service';
  return 'other';
}

const CATS = {
  military: { label: 'Military', color: '#ff4d4d' },
  law: { label: 'Law enforcement', color: '#ff9f43' },
  cargo: { label: 'Cargo', color: '#3ad1c6' },
  tanker: { label: 'Tanker', color: '#b07cff' },
  passenger: { label: 'Passenger', color: '#6cb4ff' },
  fishing: { label: 'Fishing', color: '#9be564' },
  service: { label: 'Tug / pilot / SAR', color: '#ffd84d' },
  leisure: { label: 'Sailing / pleasure', color: '#f0f0f0' },
  other: { label: 'Other', color: '#8892a8' },
};

const FILTERS = {
  all: () => true,
  military: (c) => c === 'military' || c === 'law',
  commercial: (c) => c === 'cargo' || c === 'tanker',
  passenger: (c) => c === 'passenger',
};

const NAV_STATUS = [
  'Under way (engine)', 'At anchor', 'Not under command', 'Restricted manoeuvrability', 'Constrained by draught',
  'Moored', 'Aground', 'Fishing', 'Under way (sailing)',
];

/**
 * Ships from AIS. Baltic Sea keyless (Finnish Transport Infrastructure Agency, Digitraffic);
 * worldwide through the local aisstream.io relay when AISSTREAM_KEY is set in .env.
 */
class ShipsLayer extends BaseLayer {
  constructor(viewer, ctx) {
    super(viewer, ctx, { show: 'all' });
    this.points = new PointSet(viewer, 'ships', { near: 5e4, far: 1e7, farScale: 0.5 });
    this.ships = new Map(); // mmsi -> ship
    this.meta = new Map(); // mmsi -> static data
    this.relay = 'unknown'; // 'on' | 'nokey' | 'error'
    this.every(10 * 60e3, () => this.loadBalticMeta());
    this.every(60e3, () => this.loadBaltic());
    this.every(30e3, () => this.loadRelay());
  }

  async loadBalticMeta() {
    const res = await fetch(`${DIGITRAFFIC}/vessels`, { headers: HEADERS, signal: this.abort.signal });
    if (!res.ok) return;
    for (const v of await res.json()) this.meta.set(v.mmsi, v);
    this.draw();
  }

  async loadBaltic() {
    const res = await fetch(`${DIGITRAFFIC}/locations`, { headers: HEADERS, signal: this.abort.signal });
    if (!res.ok) throw new Error(`Digitraffic ${res.status}`);
    for (const f of (await res.json()).features) {
      const p = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      this.ships.set(p.mmsi, {
        mmsi: p.mmsi,
        lat,
        lon,
        sog: p.sog >= NA_SOG ? null : p.sog,
        cog: p.cog >= 360 ? null : p.cog,
        heading: p.heading === 511 ? null : p.heading,
        navStat: p.navStat,
        ts: p.timestampExternal,
        source: 'Digitraffic (Baltic)',
      });
    }
    this.draw();
  }

  async loadRelay() {
    if (this.relay === 'nokey' && Date.now() - this.relayChecked < 5 * 60e3) return;
    this.relayChecked = Date.now();
    const r = this.viewer.camera.computeViewRectangle();
    const bbox = r
      ? [r.west, r.south, r.east, r.north].map((v) => CesiumMath.toDegrees(v).toFixed(3)).join(',')
      : '-180,-90,180,90';
    let res;
    try {
      res = await fetch(`/api/ships?bbox=${bbox}`, { signal: this.abort.signal });
    } catch {
      this.relay = 'error';
      return;
    }
    const isJson = res.headers.get('content-type')?.includes('application/json');
    if (res.status === 204 || res.status === 404 || (res.ok && !isJson)) {
      this.relay = 'nokey';
      this.ctx.changed();
      return;
    }
    if (!res.ok) {
      this.relay = 'error';
      return;
    }
    const data = await res.json();
    this.relay = 'on';
    for (const s of data.ships) {
      const prev = this.ships.get(s.mmsi);
      if (prev && prev.ts > s.ts) continue;
      this.ships.set(s.mmsi, { ...s, source: 'aisstream.io' });
      if (s.name || s.type) this.meta.set(s.mmsi, { ...this.meta.get(s.mmsi), name: s.name, shipType: s.type, destination: s.dest });
    }
    this.draw();
  }

  draw() {
    const now = Date.now();
    for (const [k, s] of this.ships) if (now - s.ts > 3 * 3600e3) this.ships.delete(k);
    const keep = FILTERS[this.options.show];
    const items = [];
    for (const s of this.ships.values()) {
      const cat = shipCategory(this.meta.get(s.mmsi)?.shipType);
      if (!keep(cat)) continue;
      items.push({ key: s.mmsi, lon: s.lon, lat: s.lat, color: CATS[cat].color, size: cat === 'military' ? 8 : 5 });
    }
    this.points.set(items);
    this.count = items.length;
    const relayNote =
      this.relay === 'on' ? 'worldwide via aisstream.io' : 'Baltic only — add a free AISSTREAM_KEY to .env for worldwide';
    this.setStatus('ok', relayNote);
  }

  onOptions() {
    this.draw();
  }

  optionSchema() {
    return [
      {
        key: 'show',
        label: 'Show',
        choices: [
          { value: 'all', label: 'All' },
          { value: 'military', label: 'Military & law enf.' },
          { value: 'commercial', label: 'Cargo & tankers' },
          { value: 'passenger', label: 'Passenger' },
        ],
      },
    ];
  }

  describe(key) {
    const s = this.ships.get(key);
    if (!s) return null;
    const m = this.meta.get(key) || {};
    const cat = shipCategory(m.shipType);
    return {
      icon: cat === 'military' ? '⚓' : '🚢',
      title: m.name || `MMSI ${key}`,
      subtitle: `${CATS[cat].label}${m.shipType ? ` (AIS type ${m.shipType})` : ''}`,
      badges: [{ text: CATS[cat].label, color: CATS[cat].color }],
      rows: [
        ['Speed', s.sog != null ? `${s.sog.toFixed(1)} kn` : '—'],
        ['Course', s.cog != null ? `${Math.round(s.cog)}°` : '—'],
        ['Status', NAV_STATUS[s.navStat] || '—'],
        ['Destination', m.destination || '—'],
        ['Call sign / IMO', [m.callSign, m.imo].filter(Boolean).join(' · ') || '—'],
        ['Last report', new Date(s.ts).toLocaleTimeString()],
        ['Source', s.source],
      ],
      links: [{ label: 'MarineTraffic', url: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${key}` }],
      note: 'Only ships transmitting AIS appear; warships often switch it off.',
      lat: s.lat,
      lon: s.lon,
    };
  }

  dispose() {
    this.points.destroy();
  }
}

export default {
  id: 'ships',
  name: 'Ships (AIS)',
  group: 'Sea',
  icon: '🚢',
  note: 'Baltic keyless; worldwide with a free aisstream.io key in .env. Red = military.',
  create: (viewer, ctx) => new ShipsLayer(viewer, ctx),
};
