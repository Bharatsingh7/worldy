import { BaseLayer, PointSet } from './BaseLayer';
import { cached } from './cache';

const URL = 'https://cdn.jsdelivr.net/gh/cristianst85/GeoNuclearData@master/data/json/denormalized/nuclear_power_plants.json';

const STATUS_COLOR = {
  Operational: '#7CFC8A',
  'Under Construction': '#ffc94d',
  Planned: '#6cb4ff',
  'Suspended Operation': '#ff9f43',
  'Suspended Construction': '#ff9f43',
  Shutdown: '#8892a8',
  'Decommissioning Completed': '#5a6378',
};

const FILTERS = {
  operating: (s) => s === 'Operational',
  building: (s) => s === 'Under Construction' || s === 'Planned',
  shutdown: (s) => s === 'Shutdown' || s === 'Decommissioning Completed' || s.startsWith('Suspended'),
  all: () => true,
};

/** Nuclear power reactors worldwide (GeoNuclearData, compiled from WNA/IAEA). */
class NuclearLayer extends BaseLayer {
  constructor(viewer, ctx) {
    super(viewer, ctx, { status: 'operating' });
    this.points = new PointSet(viewer, 'nuclear', { farScale: 0.7 });
    this.reactors = [];
    cached('nuclear-plants', 7 * 86400e3, async () => (await fetch(URL, { signal: this.abort.signal })).json())
      .then(({ value }) => {
        this.reactors = value.filter((r) => r.Latitude != null);
        this.draw();
        this.setStatus('ok');
      })
      .catch((err) => this.setStatus('error', err.message));
  }

  draw() {
    const keep = FILTERS[this.options.status];
    const shown = this.reactors.filter((r) => keep(r.Status));
    this.points.set(
      shown.map((r) => ({
        key: r.Id,
        lon: r.Longitude,
        lat: r.Latitude,
        color: STATUS_COLOR[r.Status] || '#c0c6d4',
        size: r.Status === 'Operational' ? 8 : 6,
        outline: '#1b1b1b',
      }))
    );
    this.count = shown.length;
  }

  onOptions() {
    this.draw();
  }

  optionSchema() {
    return [
      {
        key: 'status',
        label: 'Status',
        choices: [
          { value: 'operating', label: 'Operating' },
          { value: 'building', label: 'Building / planned' },
          { value: 'shutdown', label: 'Shut down' },
          { value: 'all', label: 'All' },
        ],
      },
    ];
  }

  describe(key) {
    const r = this.reactors.find((x) => x.Id === key);
    if (!r) return null;
    return {
      icon: '☢️',
      title: r.Name,
      subtitle: `${r.Country} · nuclear power reactor`,
      badges: [{ text: r.Status, color: STATUS_COLOR[r.Status] }],
      rows: [
        ['Type', [r.ReactorType, r.ReactorModel].filter(Boolean).join(' · ') || '—'],
        ['Capacity', r.Capacity ? `${r.Capacity} MWe` : '—'],
        ['Construction', r.ConstructionStartAt?.slice(0, 4) || '—'],
        ['Operating', r.OperationalFrom ? `${r.OperationalFrom.slice(0, 4)}–${r.OperationalTo?.slice(0, 4) || 'now'}` : '—'],
        ['Position', `${r.Latitude.toFixed(3)}°, ${r.Longitude.toFixed(3)}°`],
      ],
      note: `Source: ${r.Source || 'WNA/IAEA'} via GeoNuclearData. Statuses may be a few years old.`,
      lat: r.Latitude,
      lon: r.Longitude,
    };
  }

  dispose() {
    this.points.destroy();
  }
}

export default {
  id: 'nuclear',
  name: 'Nuclear power plants',
  group: 'Sites',
  icon: '☢️',
  note: '804 reactors from WNA/IAEA (GeoNuclearData).',
  create: (viewer, ctx) => new NuclearLayer(viewer, ctx),
};
