import { Cartesian3, Cartographic, Color, Ellipsoid, Material, PolylineCollection, Math as CesiumMath } from 'cesium';
import { BaseLayer, PointSet } from './BaseLayer';
import { cached } from './cache';
import { parseTLE, unixToJd, jdToUnix } from './tle';
import { compute } from '../compute/client';
import { onTick } from '../ticker';
import { destinationPoint } from '../flights/predict';
import { viewCenter } from '../camera';

const GROUPS = {
  stations: { label: 'Space stations', color: '#ffffff', celestrak: ['stations'] },
  military: { label: 'Military', color: '#ff4d4d', celestrak: ['military'] },
  resource: { label: 'Earth imaging', color: '#7CFC8A', celestrak: ['resource'] },
  gnss: { label: 'Navigation (GNSS)', color: '#ffc94d', celestrak: ['gps-ops', 'glo-ops', 'galileo', 'beidou'] },
  weather: { label: 'Weather', color: '#6cb4ff', celestrak: ['weather'] },
  geo: { label: 'Geostationary', color: '#b07cff', celestrak: ['geo'] },
  starlink: { label: 'Starlink', color: '#8892a8', celestrak: ['starlink'] },
};

const MU = 398600.4418; // km³/s²
const RE = 6371.0088;

const tleUrl = (g) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`;

/**
 * Satellites from CelesTrak (cached 2 h — CelesTrak allows one download per group per update).
 * Orbits are propagated by the C SGP4 core in the compute worker, twice a second.
 */
class SatelliteLayer extends BaseLayer {
  constructor(viewer, ctx) {
    super(viewer, ctx, { groups: ['stations', 'military', 'resource'] });
    this.points = new PointSet(viewer, 'satellites', { near: 1e6, far: 4e7, farScale: 0.6, surface: false });
    this.paths = viewer.scene.primitives.add(new PolylineCollection());
    this.sats = [];
    this.byNorad = new Map();
    this.positions = null;
    this.busy = false;
    this.selected = null;
    this.scratch = new Cartesian3();
    this.load();
    this.stopTicker = onTick(() => this.tick(), 500);
  }

  async load() {
    this.setStatus('loading', 'Fetching orbital elements…');
    const seen = new Set();
    const sats = [];
    let stale = false;
    for (const gid of this.options.groups) {
      for (const g of GROUPS[gid].celestrak) {
        try {
          const res = await cached(`tle:${g}`, 2 * 3600e3, async () => {
            const r = await fetch(tleUrl(g), { signal: this.abort.signal });
            const text = await r.text();
            if (!r.ok || !text.includes('\n1 ')) throw new Error(`CelesTrak ${r.status}`);
            return text;
          });
          stale ||= res.stale;
          for (const s of parseTLE(res.value)) {
            if (seen.has(s.norad)) continue;
            seen.add(s.norad);
            sats.push({ ...s, group: gid });
          }
        } catch (err) {
          if (this.abort.signal.aborted) return;
          this.message = `${g}: ${err.message}`;
        }
      }
    }
    if (this.abort.signal.aborted) return;
    this.sats = sats;
    this.byNorad = new Map(sats.map((s, i) => [s.norad, i]));
    const elements = new Float64Array(sats.length * 8);
    sats.forEach((s, i) => elements.set(s.elements, i * 8));
    const { deep } = await compute('sat:init', { elements });
    sats.forEach((s, i) => (s.deep = !!deep[i]));
    this.points.set(
      sats.map((s) => ({ key: s.norad, lon: 0, lat: 0, alt: 0, color: GROUPS[s.group].color, size: s.group === 'stations' ? 7 : 4 }))
    );
    this.count = sats.length;
    this.setStatus('ok', stale ? 'Using cached elements (CelesTrak limit)' : '');
    this.tick();
  }

  async tick() {
    if (this.busy || !this.sats.length) return;
    this.busy = true;
    try {
      const pos = await compute('sat:propagate', { jd: unixToJd(Date.now()) });
      if (this.abort.signal.aborted) return;
      this.positions = pos;
      for (let i = 0; i < this.sats.length; i++) {
        this.points.setPositionECEF(i, pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], this.scratch);
      }
      this.drawFootprint();
      this.render();
    } finally {
      this.busy = false;
    }
  }

  onOptions() {
    this.selected = null;
    this.paths.removeAll();
    this.load();
  }

  optionSchema() {
    return [
      {
        key: 'groups',
        label: 'Groups',
        multi: true,
        choices: Object.entries(GROUPS).map(([value, g]) => ({ value, label: g.label, color: g.color })),
      },
    ];
  }

  /** Sub-satellite point + altitude for index i. */
  subPoint(i) {
    if (!this.positions) return null;
    const c = new Cartesian3(this.positions[3 * i], this.positions[3 * i + 1], this.positions[3 * i + 2]);
    if (Number.isNaN(c.x)) return null;
    const carto = Cartographic.fromCartesian(c);
    return { lat: CesiumMath.toDegrees(carto.latitude), lon: CesiumMath.toDegrees(carto.longitude), altKm: carto.height / 1000, ecef: c };
  }

  async setSelected(norad) {
    this.selected = norad == null ? null : { norad, over: null, passes: null };
    this.paths.removeAll();
    this.render();
    if (norad == null) return;
    const i = this.byNorad.get(norad);
    // Ground track ±45 minutes
    const track = await compute('sat:track', { index: i, jd0: unixToJd(Date.now() - 45 * 60e3), stepSec: 30, count: 181 });
    if (this.selected?.norad !== norad) return;
    const pts = [];
    for (let k = 0; k < track.length; k += 3) pts.push(Cartesian3.fromDegrees(track[k + 1], track[k], track[k + 2]));
    this.trackLine = this.paths.add({
      positions: pts,
      width: 1.5,
      material: Material.fromType('Color', { color: Color.fromCssColorString(GROUPS[this.sats[i].group].color).withAlpha(0.8) }),
    });
    this.drawFootprint();
    this.reverseGeocode();
  }

  /** Line-of-sight coverage circle (satellite above the horizon) + nadir line. */
  drawFootprint() {
    if (!this.selected) return;
    const i = this.byNorad.get(this.selected.norad);
    const sp = this.subPoint(i);
    if (!sp) return;
    if (this.footprint) this.paths.remove(this.footprint);
    if (this.nadir) this.paths.remove(this.nadir);
    const lambda = Math.acos(RE / (RE + sp.altKm)); // earth central angle to the horizon
    this.selected.footprintKm = lambda * RE;
    const ring = [];
    for (let b = 0; b <= 360; b += 4) {
      const p = destinationPoint(sp.lat, sp.lon, b, lambda * RE * 1000);
      ring.push(Cartesian3.fromDegrees(p.lon, p.lat, 0));
    }
    const col = Color.fromCssColorString(GROUPS[this.sats[i].group].color);
    this.footprint = this.paths.add({ positions: ring, width: 2, material: Material.fromType('Color', { color: col.withAlpha(0.6) }) });
    this.nadir = this.paths.add({
      positions: [sp.ecef, Cartesian3.fromDegrees(sp.lon, sp.lat, 0)],
      width: 1,
      material: Material.fromType('PolylineDash', { color: col, dashLength: 8 }),
    });
    this.selected.sub = sp;
    if (Date.now() - (this.selected.geocodedAt || 0) > 15000) this.reverseGeocode();
  }

  async reverseGeocode() {
    const sel = this.selected;
    if (!sel?.sub) return;
    sel.geocodedAt = Date.now();
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&zoom=5&accept-language=en&lat=${sel.sub.lat.toFixed(3)}&lon=${sel.sub.lon.toFixed(3)}`
      );
      const d = await r.json();
      sel.over = d.error ? 'Open ocean' : [d.address?.state, d.address?.country].filter(Boolean).join(', ') || d.display_name;
    } catch {
      sel.over = null;
    }
    this.ctx.changed();
  }

  /** Visible passes over a point in the next 24 h (computed in C). */
  async passesOver(lat, lon) {
    const sel = this.selected;
    if (!sel) return;
    sel.passes = 'loading';
    this.ctx.changed();
    const out = await compute('sat:passes', {
      index: this.byNorad.get(sel.norad),
      jd0: unixToJd(Date.now()),
      hours: 24,
      lat,
      lon,
      alt: 0,
      minEl: 10,
      max: 8,
    });
    const passes = [];
    for (let k = 0; k < out.length; k += 4) passes.push({ rise: jdToUnix(out[k]), maxEl: out[k + 2], set: jdToUnix(out[k + 3]) });
    sel.passes = { lat, lon, list: passes };
    this.ctx.changed();
  }

  /** Satellites currently above `minEl` degrees as seen from a ground point, highest first. */
  visibleFrom(lat, lon, minEl = 10) {
    if (!this.positions) return [];
    const obs = Cartesian3.fromDegrees(lon, lat, 0);
    const up = Ellipsoid.WGS84.geodeticSurfaceNormal(obs, new Cartesian3());
    const d = new Cartesian3();
    const out = [];
    for (let i = 0; i < this.sats.length; i++) {
      d.x = this.positions[3 * i] - obs.x;
      d.y = this.positions[3 * i + 1] - obs.y;
      d.z = this.positions[3 * i + 2] - obs.z;
      if (Number.isNaN(d.x)) continue;
      const el = Math.asin(Cartesian3.dot(d, up) / Cartesian3.magnitude(d)) * (180 / Math.PI);
      if (el >= minEl) {
        const s = this.sats[i];
        out.push({ norad: s.norad, name: s.name, group: GROUPS[s.group].label, color: GROUPS[s.group].color, el, rangeKm: Cartesian3.magnitude(d) / 1000 });
      }
    }
    return out.sort((a, b) => b.el - a.el).slice(0, 30);
  }

  runAction(id) {
    if (id === 'passes') {
      const c = viewCenter(this.viewer);
      this.passesOver(c.lat, c.lon);
    }
  }

  describe(norad) {
    const i = this.byNorad.get(norad);
    if (i == null) return null;
    const s = this.sats[i];
    const sp = this.subPoint(i);
    const sel = this.selected?.norad === norad ? this.selected : null;
    const revPerDay = (s.elements[1] * 1440) / (2 * Math.PI);
    const a = Math.cbrt(MU / (revPerDay * 2 * Math.PI / 86400) ** 2);
    const speed = sp ? Math.sqrt(MU * (2 / (RE + sp.altKm) - 1 / a)) : null;
    const rows = [
      ['NORAD / COSPAR', `${s.norad} · ${s.intlDes}`],
      ['Altitude', sp ? `${Math.round(sp.altKm).toLocaleString()} km` : '—'],
      ['Speed', speed ? `${speed.toFixed(2)} km/s` : '—'],
      ['Inclination', `${(s.elements[3] * 180 / Math.PI).toFixed(1)}°`],
      ['Period', `${(1440 / revPerDay).toFixed(1)} min`],
      ['Now over', sel?.over ?? (sp ? `${sp.lat.toFixed(2)}°, ${sp.lon.toFixed(2)}°` : '—')],
      ['Line-of-sight radius', sel?.footprintKm ? `${Math.round(sel.footprintKm).toLocaleString()} km` : '—'],
    ];
    if (sel?.passes === 'loading') rows.push(['Passes', 'computing…']);
    else if (sel?.passes) {
      rows.push([`Passes ≥10° over ${sel.passes.lat.toFixed(2)}, ${sel.passes.lon.toFixed(2)}`, sel.passes.list.length ? '' : 'none in 24 h']);
      for (const p of sel.passes.list) {
        rows.push([
          new Date(p.rise).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
          `max ${p.maxEl.toFixed(0)}° · ${Math.round((p.set - p.rise) / 60000)} min`,
        ]);
      }
    }
    return {
      icon: '🛰️',
      title: s.name,
      subtitle: GROUPS[s.group].label,
      badges: [
        { text: GROUPS[s.group].label, color: GROUPS[s.group].color },
        ...(s.deep ? [{ text: 'deep-space · approx.', color: '#8892a8' }] : []),
      ],
      rows,
      actions: [{ id: 'passes', label: 'Passes over map centre' }],
      note:
        'Circle = area that can see the satellite above the horizon; imaging sensors cover a much narrower strip under the track. Classified satellites are not in public catalogues.',
      lat: sp?.lat,
      lon: sp?.lon,
      altM: sp ? sp.altKm * 1000 : 0,
    };
  }

  dispose() {
    this.stopTicker();
    this.points.destroy();
    this.viewer.scene.primitives.remove(this.paths);
  }
}

export default {
  id: 'satellites',
  name: 'Satellites',
  group: 'Space',
  icon: '🛰️',
  note: 'CelesTrak catalogue, orbits computed in C (SGP4). Click one for its track, coverage and passes.',
  create: (viewer, ctx) => new SatelliteLayer(viewer, ctx),
};
