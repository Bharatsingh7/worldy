import { BaseLayer, PointSet } from './BaseLayer';

const feedUrl = (minMag, period) =>
  `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${minMag}_${period}.geojson`;

const depthColor = (km) => (km < 70 ? '#ff5c39' : km < 300 ? '#ffc94d' : '#5aa9ff');

/** Live earthquakes from the USGS feed (refreshed every 5 minutes). */
class QuakeLayer extends BaseLayer {
  constructor(viewer, ctx) {
    super(viewer, ctx, { period: 'day', minMag: '2.5' });
    this.points = new PointSet(viewer, 'quakes', { farScale: 0.8 });
    this.features = [];
    this.every(5 * 60e3, () => this.load());
  }

  async load() {
    const res = await fetch(feedUrl(this.options.minMag, this.options.period), { signal: this.abort.signal });
    if (!res.ok) throw new Error(`USGS ${res.status}`);
    this.features = (await res.json()).features;
    this.points.set(
      this.features.map((f) => {
        const [lon, lat, depth] = f.geometry.coordinates;
        return {
          key: f.id,
          lon,
          lat,
          color: depthColor(depth),
          size: Math.max(4, (f.properties.mag ?? 2) * 3),
          outline: 'rgba(0,0,0,0.7)',
        };
      })
    );
    this.count = this.features.length;
    this.setStatus('ok');
  }

  onOptions() {
    this.load().catch((err) => this.setStatus('error', err.message));
  }

  optionSchema() {
    return [
      { key: 'period', label: 'Period', choices: [{ value: 'day', label: '24 h' }, { value: 'week', label: '7 days' }] },
      { key: 'minMag', label: 'Magnitude', choices: [{ value: '2.5', label: '≥ 2.5' }, { value: '4.5', label: '≥ 4.5' }] },
    ];
  }

  describe(key) {
    const f = this.features.find((x) => x.id === key);
    if (!f) return null;
    const p = f.properties;
    const [lon, lat, depth] = f.geometry.coordinates;
    return {
      icon: '🌋',
      title: `M ${p.mag?.toFixed(1)} · ${p.place || 'Earthquake'}`,
      subtitle: new Date(p.time).toLocaleString(),
      badges: [
        { text: `${depth.toFixed(0)} km deep`, color: depthColor(depth) },
        ...(p.tsunami ? [{ text: 'Tsunami flag', color: '#5aa9ff' }] : []),
        ...(p.alert ? [{ text: `PAGER ${p.alert}`, color: p.alert }] : []),
      ],
      rows: [
        ['Felt reports', p.felt ?? '—'],
        ['Intensity (MMI)', p.mmi?.toFixed(1) ?? '—'],
        ['Position', `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`],
      ],
      links: [{ label: 'USGS event page', url: p.url }],
      lat,
      lon,
    };
  }

  dispose() {
    this.points.destroy();
  }
}

export default {
  id: 'quakes',
  name: 'Earthquakes',
  group: 'Hazards',
  icon: '🌋',
  note: 'USGS real-time feed. Colour = depth (red shallow, blue deep), size = magnitude.',
  create: (viewer, ctx) => new QuakeLayer(viewer, ctx),
};
