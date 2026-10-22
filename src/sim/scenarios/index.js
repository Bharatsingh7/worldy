/**
 * Scenario catalogue: what each disaster needs, its parameters, and how it configures the engine.
 * configure(grid, params, ctx) returns the worker config (see simWorker.js init).
 *   ctx: { shape, point, mask (cells inside the drawn area), seaSides }
 */

const H = 3600;
const mmh = (mm, hours) => mm / hours;

/** Green–Ampt soil presets (Rawls et al. 1983): Ks (mm/h), suction × moisture deficit (m). */
const SOILS = {
  urban: { label: 'City (mostly sealed)', ks: 0.5, psid: 0.02, manning: 0.015 },
  suburban: { label: 'Suburb / loam', ks: 3.4, psid: 0.027, manning: 0.03 },
  rural: { label: 'Fields / sandy loam', ks: 10.9, psid: 0.044, manning: 0.04 },
  saturated: { label: 'Already saturated', ks: 0, psid: 0, manning: 0.035 },
};

function soilFields(grid, soilId, phi) {
  const soil = SOILS[soilId];
  const n = grid.nx * grid.ny;
  const ks = new Float64Array(n);
  const psid = new Float64Array(n).fill(soil.psid);
  const manning = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const built = phi && phi[i] < 0.6;
    ks[i] = built ? 0 : soil.ks / 1000 / H;
    manning[i] = built ? 0.015 : soil.manning;
  }
  return { ks, psid, manning };
}

/** Hyetograph [[t s, mm/h], …]: uniform, or a peaked storm with the burst at 35% of its duration. */
function hyetograph(totalMm, hours, profile) {
  const T = hours * H;
  if (profile === 'peaked') {
    const peak = (2 * totalMm) / hours;
    return [[0, 0], [0.35 * T, peak], [T, 0], [T + 1, 0]];
  }
  const r = mmh(totalMm, hours);
  return [[0, r], [T, r], [T + 1, 0]];
}

/** Sides of the grid that face the sea (≥ 30% of edge cells at or below 0.5 m). */
export function seaSides(grid) {
  const { nx, ny, z } = grid;
  const frac = (cells) => cells.filter((c) => z[c] <= 0.5).length / cells.length;
  const sides = [
    Array.from({ length: nx }, (_, x) => x),
    Array.from({ length: ny }, (_, y) => y * nx + nx - 1),
    Array.from({ length: nx }, (_, x) => (ny - 1) * nx + x),
    Array.from({ length: ny }, (_, y) => y * nx),
  ];
  return sides.map((cells) => frac(cells) >= 0.3);
}

export const SCENARIOS = [
  {
    id: 'rainfall',
    name: 'Heavy rainfall / cloudburst',
    icon: '🌧️',
    blurb: 'Rain falls on the whole area, soaks in, runs off and collects in low ground and streets.',
    needs: [],
    modes: ['swe', 'hbg'],
    params: [
      { key: 'total', label: 'Rain', min: 10, max: 600, step: 10, default: 150, unit: 'mm' },
      { key: 'hours', label: 'Over', min: 0.5, max: 24, step: 0.5, default: 3, unit: 'h' },
      { key: 'profile', label: 'Storm shape', choices: [{ value: 'peaked', label: 'Burst' }, { value: 'uniform', label: 'Steady' }], default: 'peaked' },
      { key: 'soil', label: 'Ground', choices: Object.entries(SOILS).map(([value, s]) => ({ value, label: s.label })), default: 'urban' },
    ],
    speed: 120,
    configure(grid, p) {
      const runoff = p.soil === 'urban' ? 0.9 : p.soil === 'suburban' ? 0.6 : p.soil === 'rural' ? 0.4 : 1;
      return {
        params: { 12: 10 },
        bc: [1, 1, 1, 1],
        forcing: { rain: hyetograph(p.total, p.hours, p.profile) },
        duration: p.hours * H * 1.6,
        runoff,
        grid: soilFields(grid, p.soil, grid.phi),
        summary: { rainMm: p.total },
      };
    },
    assumptions:
      'Rain is spread evenly over the area; Green–Ampt infiltration by soil class; buildings as porosity; edges let water out freely; drains and sewers are not modelled (a worst case for cities).',
  },
  {
    id: 'river',
    name: 'River flood / dam break',
    icon: '🌊',
    blurb: 'Water pours in at a point you choose (a river breaching its bank, a failed dam or embankment).',
    needs: ['point'],
    pointLabel: 'Breach / inflow point',
    modes: ['swe'],
    params: [
      { key: 'peak', label: 'Peak flow', min: 10, max: 20000, step: 10, default: 800, unit: 'm³/s' },
      { key: 'hours', label: 'Lasting', min: 0.5, max: 48, step: 0.5, default: 6, unit: 'h' },
    ],
    speed: 120,
    configure(grid, p, ctx) {
      const T = p.hours * H;
      return {
        params: { 12: 10 },
        bc: [1, 1, 1, 1],
        inflows: [{ cell: ctx.pointCell, q: [[0, 0], [0.15 * T, p.peak], [0.6 * T, p.peak * 0.7], [T, 0], [T + 1, 0]] }],
        duration: T * 1.5,
        grid: soilFields(grid, 'suburban', grid.phi),
      };
    },
    assumptions: 'Triangular-ish flood hydrograph injected at one cell; no river channel geometry beyond what the terrain model resolves.',
  },
  {
    id: 'surge',
    name: 'Storm tide / sea surge',
    icon: '🌀',
    blurb: 'The sea rises along the coastal edges of the area (storm surge + tide) and floods inland.',
    needs: [],
    modes: ['swe'],
    params: [
      { key: 'peak', label: 'Peak sea level', min: 0.5, max: 10, step: 0.25, default: 3, unit: 'm' },
      { key: 'hours', label: 'Surge lasts', min: 1, max: 24, step: 1, default: 6, unit: 'h' },
    ],
    speed: 180,
    configure(grid, p) {
      const sides = seaSides(grid);
      if (!sides.some(Boolean)) throw new Error('No sea along the edges of this area — include some coastline.');
      const T = p.hours * H;
      const tide = [[0, 0], [T / 2, p.peak], [T, 0]];
      return {
        params: { 12: 10 },
        bc: sides.map((sea) => (sea ? 2 : 1)),
        bcLevel: [0, 0, 0, 0],
        forcing: { level: sides.map((sea) => (sea ? tide : null)) },
        duration: T * 1.2,
        grid: soilFields(grid, 'saturated', grid.phi),
      };
    },
    assumptions: 'Sea level imposed on coastal edges (no waves); inland flow by full shallow-water physics; no sea walls unless they are in the terrain data.',
  },
  {
    id: 'debris',
    name: 'Landslide / debris flow',
    icon: '⛰️',
    blurb: 'The drawn area collapses and flows downhill as a debris flow (Voellmy friction).',
    needs: ['releaseArea'],
    modes: ['swe'],
    domainPad: 2.5,
    params: [
      { key: 'depth', label: 'Release depth', min: 1, max: 40, step: 1, default: 8, unit: 'm' },
      { key: 'material', label: 'Material', choices: [{ value: 'debris', label: 'Wet debris' }, { value: 'rock', label: 'Dry rock / soil' }], default: 'debris' },
    ],
    speed: 15,
    configure(grid, p, ctx) {
      const h0 = new Float64Array(grid.nx * grid.ny);
      ctx.mask.forEach((m, i) => (h0[i] = m ? p.depth : 0));
      const mu = p.material === 'rock' ? 0.3 : 0.12;
      const xi = p.material === 'rock' ? 200 : 500;
      return { params: { 0: 1, 4: mu, 5: xi, 9: 2000, 12: 2 }, bc: [1, 1, 1, 1], duration: 900, grid: { h0 } };
    },
    assumptions: 'Depth-averaged Voellmy rheology (Coulomb friction μ + turbulent friction ξ), as used in RAMMS-type models; no entrainment of extra material.',
  },
  {
    id: 'avalanche',
    name: 'Snow avalanche',
    icon: '🏔️',
    blurb: 'A snow slab released over the drawn area runs down the slope.',
    needs: ['releaseArea'],
    modes: ['swe'],
    domainPad: 3,
    params: [{ key: 'depth', label: 'Slab depth', min: 0.3, max: 5, step: 0.1, default: 1.5, unit: 'm' }],
    speed: 10,
    configure(grid, p, ctx) {
      const h0 = new Float64Array(grid.nx * grid.ny);
      ctx.mask.forEach((m, i) => (h0[i] = m ? p.depth : 0));
      return { params: { 0: 1, 4: 0.155, 5: 1500, 9: 300, 12: 2 }, bc: [1, 1, 1, 1], duration: 600, grid: { h0 } };
    },
    assumptions: 'Voellmy rheology with typical large-avalanche values (μ = 0.155, ξ = 1500 m/s²); flowing dense snow only (no powder cloud).',
  },
  {
    id: 'lava',
    name: 'Lava flow',
    icon: '🌋',
    blurb: 'Lava erupts from a vent, spreads downhill, cools and stiffens until it stops.',
    needs: ['point'],
    pointLabel: 'Vent',
    modes: ['swe'],
    domainPad: 2,
    params: [
      { key: 'rate', label: 'Effusion rate', min: 1, max: 500, step: 1, default: 40, unit: 'm³/s' },
      { key: 'hours', label: 'Eruption lasts', min: 1, max: 72, step: 1, default: 12, unit: 'h' },
    ],
    speed: 600,
    configure(grid, p, ctx) {
      const T = p.hours * H;
      return {
        lava: true,
        params: { 0: 2, 6: 0.4, 7: 2.0, 9: 2600, 10: 1150, 11: 800, 12: 20 },
        bc: [1, 1, 1, 1],
        inflows: [{ cell: ctx.pointCell, q: [[0, p.rate], [T, p.rate], [T + 1, 0]] }],
        duration: T * 1.5,
      };
    },
    assumptions: 'Bingham lava (yield strength and viscosity rising exponentially as it cools from 1150 °C towards the 800 °C solidus; radiative + ground-conduction cooling).',
  },
];

export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id);
