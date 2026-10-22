/*
 * EDLTS — Event-Driven Local Time Stepping.
 *
 * The grid is cut into 16×16 blocks. Every block owns a step dtᵦ = dt_base·2^k (dyadic, so
 * block clocks line up) chosen from its own CFL limit and kept within a factor 2 of its awake
 * neighbours. Instead of cycling through levels synchronously (classic LTS), blocks are
 * processed as events in a priority queue ordered by their current time — always the block
 * that is furthest behind goes next, so no block ever runs ahead of an older neighbour's state.
 * Dry blocks without rain or inflow are removed from the queue entirely ("asleep") and are
 * woken when water crosses into them. Face time cursors (swe.c) make every face flux count
 * exactly once, so mass is conserved to round-off.
 *
 * lts = 0 runs the same code with one global step (reference mode for tests).
 */
#include "sim.h"

static double *zeros(int n, double v) {
  double *a = (double *)walloc((u32)n * 8u);
  for (int i = 0; i < n; i++) a[i] = v;
  return a;
}

EXPORT(sim_create) Sim *sim_create(int nx, int ny, double dx, double dy) {
  Sim *s = (Sim *)walloc(sizeof(Sim));
  u8 *raw = (u8 *)s;
  for (u32 i = 0; i < sizeof(Sim); i++) raw[i] = 0;
  s->nx = nx;
  s->ny = ny;
  s->n = nx * ny;
  s->dx = dx;
  s->dy = dy;
  int n = s->n;
  s->z = zeros(n, 0);
  s->h = zeros(n, 0);
  s->qx = zeros(n, 0);
  s->qy = zeros(n, 0);
  s->phi = zeros(n, 1);
  s->manning = zeros(n, 0.035);
  s->rainMul = zeros(n, 1);
  s->ks = zeros(n, 0);
  s->psid = zeros(n, 0.11);
  s->finf = zeros(n, 0);
  s->hmax = zeros(n, 0);
  s->tArrive = zeros(n, -1);
  s->cx = zeros((nx + 1) * ny, 0);
  s->cy = zeros(nx * (ny + 1), 0);
  s->bnx = (nx + BS - 1) / BS;
  s->bny = (ny + BS - 1) / BS;
  s->nb = s->bnx * s->bny;
  s->bt = zeros(s->nb, 0);
  s->bdt = zeros(s->nb, 0);
  s->awake = (u8 *)walloc((u32)s->nb);
  s->dirty = (u8 *)walloc((u32)s->nb);
  for (int b = 0; b < s->nb; b++) s->awake[b] = s->dirty[b] = 0;
  heap_init(&s->queue, s->nb * 8 + 64);
  s->g = 9.81;
  s->cfl = 0.45;
  s->dtMaxCap = 30.0;
  s->lts = 1;
  s->rho = 1000;
  s->mu = 0.15;
  s->xi = 500;
  s->tauY = 0.5;
  s->nu = 0.01;
  s->hbN = 0.5;
  s->lavaT0 = 1150;
  s->lavaTs = 800;
  for (int k = 0; k < 4; k++) s->bc[k] = BC_OPEN;
  return s;
}

/* Field pointers for JS views. */
EXPORT(sim_ptr) double *sim_ptr(Sim *s, int field) {
  switch (field) {
    case 0: return s->z;
    case 1: return s->h;
    case 2: return s->qx;
    case 3: return s->qy;
    case 4: return s->phi;
    case 5: return s->manning;
    case 6: return s->rainMul;
    case 7: return s->ks;
    case 8: return s->psid;
    case 9: return s->finf;
    case 10:
      if (!s->wx) { s->wx = zeros(s->n, 0); s->wy = zeros(s->n, 0); s->dp = zeros(s->n, 0); }
      return s->wx;
    case 11: sim_ptr(s, 10); return s->wy;
    case 12: sim_ptr(s, 10); return s->dp;
    case 13:
      if (!s->temp) s->temp = zeros(s->n, 25.0);
      return s->temp;
    case 14: return s->hmax;
    case 15: return s->tArrive;
  }
  return 0;
}

/* Scalar parameters. */
EXPORT(sim_set) void sim_set(Sim *s, int key, double v) {
  switch (key) {
    case 0: s->rheology = (int)v; break;
    case 1: s->lts = (int)v; break;
    case 2: s->cfl = v; break;
    case 3: s->rainRate = v; break;
    case 4: s->mu = v; break;
    case 5: s->xi = v; break;
    case 6: s->tauY = v; break;
    case 7: s->nu = v; break;
    case 8: s->hbN = v; break;
    case 9: s->rho = v; break;
    case 10: s->lavaT0 = v; break;
    case 11: s->lavaTs = v; break;
    case 12: s->dtMaxCap = v; break;
    case 13: s->coriolis = (int)v; break;
    case 14: s->lat0 = v; break;
    case 20: case 21: case 22: case 23: s->bc[key - 20] = (int)v; break;
    case 30: case 31: case 32: case 33: s->bcLevel[key - 30] = v; break;
  }
}

/* Point inflow (river, breach, vent) in m³/s; returns its index. Calling again with the same cell updates Q. */
EXPORT(sim_inflow) int sim_inflow(Sim *s, int cell, double q) {
  for (int k = 0; k < s->nIn; k++)
    if (s->inCell[k] == cell) { s->inQ[k] = q; return k; }
  if (s->nIn >= 16) return -1;
  s->inCell[s->nIn] = cell;
  s->inQ[s->nIn] = q;
  int b = ((cell / s->nx) / BS) * s->bnx + (cell % s->nx) / BS;
  if (!s->awake[b] && s->dtBase > 0) sim_wake(s, b, s->time); /* already running */
  return s->nIn++;
}

static int block_has_forcing(Sim *s, int b) {
  int bx = b % s->bnx, by = b / s->bnx;
  int x0 = bx * BS, y0 = by * BS, x1 = w_min(x0 + BS, s->nx), y1 = w_min(y0 + BS, s->ny);
  for (int k = 0; k < s->nIn; k++) {
    int c = s->inCell[k], cx = c % s->nx, cy = c / s->nx;
    if (cx >= x0 && cx < x1 && cy >= y0 && cy < y1) return 1;
  }
  if (s->rainRate > 0) {
    for (int y = y0; y < y1; y++)
      for (int x = x0; x < x1; x++)
        if (s->rainMul[y * s->nx + x] > 0) return 1;
  }
  /* level boundaries keep edge blocks alive */
  if ((s->bc[0] == BC_LEVEL && by == 0) || (s->bc[2] == BC_LEVEL && by == s->bny - 1) ||
      (s->bc[3] == BC_LEVEL && bx == 0) || (s->bc[1] == BC_LEVEL && bx == s->bnx - 1))
    return 1;
  return 0;
}

/* Choose the block's next dyadic step: ≤ its CFL limit, ≤ 2× its neighbours', aligned to its clock. */
static double next_dt(Sim *s, int b) {
  double dt = sim_block_dt(s, b);
  if (dt < s->dtBase) {
    /* a faster wave appeared: refine the base (old clocks stay aligned, the base only halves) */
    while (s->dtBase > dt) s->dtBase *= 0.5;
  }
  if (!s->lts) return s->dtBase;
  int bx = b % s->bnx, by = b / s->bnx;
  static const int nbx[4] = {0, 1, 0, -1}, nby[4] = {-1, 0, 1, 0};
  for (int k = 0; k < 4; k++) {
    int ox = bx + nbx[k], oy = by + nby[k];
    if (ox < 0 || oy < 0 || ox >= s->bnx || oy >= s->bny) continue;
    int o = oy * s->bnx + ox;
    if (s->awake[o] && s->bdt[o] > 0) dt = w_min(dt, 2.0 * s->bdt[o]);
  }
  double step = s->dtBase;
  for (int k = 0; k < MAX_LEVEL && step * 2.0 <= dt; k++) step *= 2.0;
  /* stay on the dyadic lattice so clocks of neighbouring blocks meet */
  while (step > s->dtBase && w_fmod(s->bt[b], step) > 1e-9 * step) step *= 0.5;
  return step;
}

void sim_wake(Sim *s, int b, double t) {
  if (s->awake[b]) return;
  s->awake[b] = 1;
  if (t > s->bt[b]) s->bt[b] = t;
  /* faces with sleeping neighbours / the domain edge carried no flux while asleep */
  int bx = b % s->bnx, by = b / s->bnx, nx = s->nx;
  int x0 = bx * BS, y0 = by * BS, x1 = w_min(x0 + BS, nx), y1 = w_min(y0 + BS, s->ny);
  for (int y = y0; y < y1; y++)
    for (int x = x0; x <= x1; x++) {
      int ob = -1;
      if (x == x0 && x > 0) ob = by * s->bnx + (bx - 1);
      if (x == x1 && x < nx) ob = by * s->bnx + (bx + 1);
      double *c = &s->cx[y * (nx + 1) + x];
      if (ob < 0 || !s->awake[ob]) *c = w_max(*c, s->bt[b]);
    }
  for (int y = y0; y <= y1; y++)
    for (int x = x0; x < x1; x++) {
      int ob = -1;
      if (y == y0 && y > 0) ob = (by - 1) * s->bnx + bx;
      if (y == y1 && y < s->ny) ob = (by + 1) * s->bnx + bx;
      double *c = &s->cy[y * nx + x];
      if (ob < 0 || !s->awake[ob]) *c = w_max(*c, s->bt[b]);
    }
  s->bdt[b] = next_dt(s, b);
  heap_push(&s->queue, b, s->bt[b]);
}

/* Initialise clocks at t0 and wake every block that is wet or forced. */
EXPORT(sim_start) void sim_start(Sim *s, double t0) {
  s->time = t0;
  s->queue.size = 0;
  for (int i = 0; i < (s->nx + 1) * s->ny; i++) s->cx[i] = t0;
  for (int i = 0; i < s->nx * (s->ny + 1); i++) s->cy[i] = t0;
  /* global base step: smallest CFL step anywhere, rounded down to a power of two */
  double dmin = s->dtMaxCap;
  for (int b = 0; b < s->nb; b++) {
    s->bt[b] = t0;
    s->awake[b] = 0;
    s->bdt[b] = 0;
    double d = sim_block_dt(s, b);
    if (d < dmin) dmin = d;
  }
  double base = 1.0;
  while (base > dmin) base *= 0.5;
  while (base * 2.0 <= dmin) base *= 2.0;
  s->dtBase = base;
  for (int b = 0; b < s->nb; b++)
    if (!sim_block_is_dry(s, b) || block_has_forcing(s, b)) sim_wake(s, b, t0);
}

/* Reference mode: a conventional dense solver — every block, one global CFL step. */
static double advance_global(Sim *s, double tTarget, int maxEvents) {
  int events = 0;
  while (s->time < tTarget && events < maxEvents) {
    double dt = s->dtMaxCap;
    for (int b = 0; b < s->nb; b++) dt = w_min(dt, sim_block_dt(s, b));
    dt = w_min(dt, tTarget - s->time);
    double tEnd = s->time + dt;
    for (int b = 0; b < s->nb; b++) {
      sim_block_advance(s, b, tEnd);
      s->bt[b] = tEnd;
      events++;
    }
    s->time = tEnd;
  }
  s->events += events;
  return s->time;
}

/* Process events until every awake block has reached tTarget (or the event budget runs out). */
EXPORT(sim_advance) double sim_advance(Sim *s, double tTarget, int maxEvents) {
  if (!s->lts) return advance_global(s, tTarget, maxEvents);
  int events = 0;
  while (s->queue.size && events < maxEvents) {
    double t;
    int b = heap_pop(&s->queue, &t);
    if (!s->awake[b] || t != s->bt[b]) continue; /* stale entry */
    if (t >= tTarget) {
      heap_push(&s->queue, b, t);
      break;
    }
    double dt = next_dt(s, b);
    double tEnd = t + dt;
    sim_block_advance(s, b, tEnd);
    s->bt[b] = tEnd;
    s->bdt[b] = dt;
    events++;
    if (sim_block_is_dry(s, b) && !block_has_forcing(s, b)) {
      s->awake[b] = 0; /* falls asleep; neighbours wake it when water arrives */
      continue;
    }
    heap_push(&s->queue, b, tEnd);
  }
  s->events += events;
  /* the "now" of the simulation is the oldest awake clock (or the target if all are past it) */
  double tmin = tTarget;
  for (int b = 0; b < s->nb; b++)
    if (s->awake[b] && s->bt[b] < tmin) tmin = s->bt[b];
  s->time = tmin;
  return tmin;
}

/*
 * Output for rendering: depth and speed as float32, plus per-block dirty flags (cleared).
 * Returns the number of dirty blocks.
 */
EXPORT(sim_frame) int sim_frame(Sim *s, float *depth, float *speed, u8 *dirty) {
  int count = 0;
  for (int b = 0; b < s->nb; b++) {
    dirty[b] = s->dirty[b];
    count += s->dirty[b];
    s->dirty[b] = 0;
  }
  for (int i = 0; i < s->n; i++) {
    double h = s->h[i];
    depth[i] = (float)h;
    if (speed) speed[i] = h > H_DRY ? (float)(w_sqrt(s->qx[i] * s->qx[i] + s->qy[i] * s->qy[i]) / h) : 0.0f;
  }
  return count;
}

/*
 * Stats: [time, water volume, rain in, inflow in, infiltrated, outflow, events, awake blocks,
 *         max depth, wet area m², dt_base, mass error]
 */
EXPORT(sim_stats) void sim_stats(Sim *s, double *out) {
  double vol = 0, hmax = 0, wet = 0, area = s->dx * s->dy;
  for (int i = 0; i < s->n; i++) {
    vol += s->h[i] * s->phi[i] * area;
    if (s->h[i] > hmax) hmax = s->h[i];
    if (s->h[i] > 0.01) wet += area;
  }
  int awake = 0;
  for (int b = 0; b < s->nb; b++) awake += s->awake[b];
  out[0] = s->time;
  out[1] = vol;
  out[2] = s->rainIn;
  out[3] = s->inflowIn;
  out[4] = s->infiltrated;
  out[5] = s->outflow;
  out[6] = s->events;
  out[7] = awake;
  out[8] = hmax;
  out[9] = wet;
  out[10] = s->dtBase;
  out[11] = 0;
}

/* Initial-volume bookkeeping helper for mass checks: Σ h·φ·area right now. */
EXPORT(sim_volume) double sim_volume(Sim *s) {
  double v = 0;
  for (int i = 0; i < s->n; i++) v += s->h[i] * s->phi[i] * s->dx * s->dy;
  return v;
}
