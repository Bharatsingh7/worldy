import { Math as CesiumMath } from 'cesium';
import { BaseLayer, PointSet } from './BaseLayer';
import { overpass, elementLatLon } from './overpass';
import { cached } from './cache';

/** Only load when zoomed in below this camera height. */
const MAX_HEIGHT = 800_000;
const MAX_TILES = 16;

/**
 * OpenStreetMap features loaded by 1°×1° tiles for the current view
 * (cached for a week), e.g. military bases or bunkers.
 */
class OsmSitesLayer extends BaseLayer {
  constructor(viewer, ctx, def) {
    super(viewer, ctx);
    this.def = def;
    this.points = new PointSet(viewer, def.id, { near: 5e4, far: 2e6, farScale: 0.6 });
    this.items = new Map(); // osm id -> element
    this.tiles = new Set();
    this.queue = Promise.resolve();
    this.onMove = () => this.loadView();
    viewer.camera.moveEnd.addEventListener(this.onMove);
    this.loadView();
  }

  viewTiles() {
    const camera = this.viewer.camera;
    if (camera.positionCartographic.height > MAX_HEIGHT) return null;
    const r = camera.computeViewRectangle();
    if (!r) return null;
    const toDeg = CesiumMath.toDegrees;
    const tiles = [];
    for (let y = Math.floor(toDeg(r.south)); y <= Math.floor(toDeg(r.north)); y++)
      for (let x = Math.floor(toDeg(r.west)); x <= Math.floor(toDeg(r.east)); x++) tiles.push(`${x},${y}`);
    return tiles;
  }

  loadView() {
    const tiles = this.viewTiles();
    if (!tiles) {
      this.setStatus('idle', 'Zoom in (below ~800 km) to load');
      return;
    }
    const missing = tiles.filter((t) => !this.tiles.has(t)).slice(0, MAX_TILES);
    if (!missing.length) return;
    this.setStatus('loading', `Loading ${missing.length} area(s) from OpenStreetMap…`);
    for (const t of missing) {
      this.tiles.add(t);
      this.queue = this.queue.then(() => this.loadTile(t)).catch((err) => {
        this.tiles.delete(t);
        if (!this.abort.signal.aborted) this.setStatus('error', `${err.message} — OSM servers busy, try again shortly`);
      });
    }
    this.queue.then(() => !this.abort.signal.aborted && this.status === 'loading' && this.setStatus('ok'));
  }

  async loadTile(tile) {
    const [x, y] = tile.split(',').map(Number);
    const bbox = `${y},${x},${y + 1},${x + 1}`;
    const { value } = await cached(`osm:${this.def.id}:${tile}`, 7 * 86400e3, () =>
      overpass(`[out:json][timeout:25];(${this.def.query(bbox)});out center tags 3000;`, { signal: this.abort.signal })
    );
    for (const el of value) {
      const pos = elementLatLon(el);
      if (pos) this.items.set(`${el.type}/${el.id}`, { ...el, ...pos });
    }
    this.draw();
  }

  draw() {
    const items = [...this.items.entries()].map(([key, el]) => ({
      key,
      lon: el.lon,
      lat: el.lat,
      color: this.def.color(el.tags || {}),
      size: 7,
      outline: '#111',
    }));
    this.points.set(items);
    this.count = items.length;
    this.ctx.changed();
  }

  describe(key) {
    const el = this.items.get(key);
    if (!el) return null;
    const t = el.tags || {};
    return {
      icon: this.def.icon,
      title: t.name || t['name:en'] || this.def.unnamed(t),
      subtitle: this.def.kind(t),
      rows: [
        ...(t.operator ? [['Operator', t.operator]] : []),
        ...(t.military ? [['military=', t.military]] : []),
        ...(t.landuse ? [['landuse=', t.landuse]] : []),
        ...(t.bunker_type ? [['bunker_type=', t.bunker_type]] : []),
        ...(t.historic ? [['historic=', t.historic]] : []),
        ['Position', `${el.lat.toFixed(4)}°, ${el.lon.toFixed(4)}°`],
      ],
      links: [{ label: 'View on OpenStreetMap', url: `https://www.openstreetmap.org/${key}` }],
      note: this.def.disclaimer,
      lat: el.lat,
      lon: el.lon,
    };
  }

  dispose() {
    this.viewer.camera.moveEnd.removeEventListener(this.onMove);
    this.points.destroy();
  }
}

export const militaryBases = {
  id: 'military',
  name: 'Military bases & airfields',
  group: 'Sites',
  icon: '🎖️',
  note: 'OpenStreetMap military land and installations. Loads when zoomed in.',
  query: (b) =>
    `nwr["landuse"="military"](${b});nwr["military"~"^(base|airfield|naval_base|barracks|training_area|range)$"](${b});`,
  color: (t) => (t.military === 'airfield' ? '#6cb4ff' : t.military === 'naval_base' ? '#3ad1c6' : '#ff6b6b'),
  kind: (t) => (t.military ? `Military ${t.military.replace('_', ' ')}` : 'Military land'),
  unnamed: () => 'Unnamed military area',
  disclaimer: 'Publicly mapped on OpenStreetMap; coverage varies by country.',
  create: (viewer, ctx) => new OsmSitesLayer(viewer, ctx, militaryBases),
};

export const bunkers = {
  id: 'bunkers',
  name: 'Mapped bunkers',
  group: 'Sites',
  icon: '🛖',
  note: 'Bunkers publicly mapped on OpenStreetMap (mostly historic). Classified sites are not in any public data.',
  query: (b) => `nwr["military"="bunker"](${b});`,
  color: (t) => (t.historic ? '#c8a165' : '#e0e0e0'),
  kind: (t) => `Bunker${t.bunker_type ? ` (${t.bunker_type})` : ''}${t.historic ? ' · historic' : ''}`,
  unnamed: () => 'Unnamed bunker',
  disclaimer: 'Only publicly mapped bunkers. Hidden or classified facilities are not in any public dataset.',
  create: (viewer, ctx) => new OsmSitesLayer(viewer, ctx, bunkers),
};
