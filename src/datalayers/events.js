import { BaseLayer, PointSet } from './BaseLayer';

const URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30';

const CATEGORY = {
  wildfires: { color: '#ff7a1a', icon: '🔥' },
  severeStorms: { color: '#b07cff', icon: '🌀' },
  volcanoes: { color: '#ff3b3b', icon: '🌋' },
  seaLakeIce: { color: '#bfe9ff', icon: '🧊' },
  floods: { color: '#3aa0ff', icon: '🌊' },
  earthquakes: { color: '#ffc94d', icon: '〰️' },
  landslides: { color: '#a0522d', icon: '⛰️' },
  dustHaze: { color: '#d2b48c', icon: '🌫️' },
  drought: { color: '#c8a165', icon: '☀️' },
  snow: { color: '#ffffff', icon: '❄️' },
};

/** Latest point of an EONET geometry (points, or the first vertex of a polygon). */
function lastPoint(event) {
  const g = event.geometry[event.geometry.length - 1];
  if (!g) return null;
  if (g.type === 'Point') return { lon: g.coordinates[0], lat: g.coordinates[1], date: g.date };
  const ring = g.coordinates?.[0];
  return ring?.length ? { lon: ring[0][0], lat: ring[0][1], date: g.date } : null;
}

/** NASA EONET open natural events: wildfires, storms, volcanoes, ice… */
class EventsLayer extends BaseLayer {
  constructor(viewer, ctx) {
    super(viewer, ctx);
    this.points = new PointSet(viewer, 'events', { farScale: 0.8 });
    this.events = [];
    this.every(30 * 60e3, () => this.load());
  }

  async load() {
    const res = await fetch(URL, { signal: this.abort.signal });
    if (!res.ok) throw new Error(`EONET ${res.status}`);
    this.events = (await res.json()).events
      .map((e) => ({ ...e, at: lastPoint(e), cat: e.categories?.[0]?.id }))
      .filter((e) => e.at);
    this.points.set(
      this.events.map((e) => ({
        key: e.id,
        lon: e.at.lon,
        lat: e.at.lat,
        color: CATEGORY[e.cat]?.color || '#ddd',
        size: 8,
        outline: '#111',
      }))
    );
    this.count = this.events.length;
    this.setStatus('ok');
  }

  describe(key) {
    const e = this.events.find((x) => x.id === key);
    if (!e) return null;
    const cat = CATEGORY[e.cat];
    return {
      icon: cat?.icon || '⚠️',
      title: e.title,
      subtitle: e.categories.map((c) => c.title).join(', '),
      badges: [{ text: `updated ${new Date(e.at.date).toLocaleDateString()}`, color: cat?.color }],
      rows: [
        ['Track points', e.geometry.length],
        ['Position', `${e.at.lat.toFixed(3)}°, ${e.at.lon.toFixed(3)}°`],
      ],
      links: e.sources.map((s) => ({ label: s.id, url: s.url })),
      lat: e.at.lat,
      lon: e.at.lon,
    };
  }

  dispose() {
    this.points.destroy();
  }
}

export default {
  id: 'events',
  name: 'Natural events',
  group: 'Hazards',
  icon: '🔥',
  note: 'NASA EONET open events (last 30 days): wildfires, storms, volcanoes, ice.',
  create: (viewer, ctx) => new EventsLayer(viewer, ctx),
};
