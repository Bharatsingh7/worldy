/*
 * HBG — Hierarchical Basin-Graph hydrodynamics.
 *
 * 1. Basins: every cell descends to its lowest neighbour (ties broken by index, so flats drain
 *    to one cell); the local minima are the pits, and each cell gets the label of the pit it
 *    drains to. Sea / edge cells drain to the "outside" (label 0).
 * 2. Sills: for every pair of touching basins, the lowest pass max(z_a, z_b) along their shared
 *    boundary and its width (how many boundary cells sit within 0.25 m of that pass).
 * 3. Depression hierarchy: sills sorted ascending and merged with union-find (Kruskal) — every
 *    merge is a tree node that becomes one lake when the water reaches its sill.
 * 4. Exact hypsometry: each basin keeps its cells' elevations sorted with prefix sums, so the
 *    stored volume below level η, V(η) = Σ_{z<η} φ·A·(η − z), and its inverse are exact.
 *
 * Instant mode (hbg_fsm): rain is routed through the hierarchy — basins fill to their sill,
 * overflow pours into the neighbour across the sill, full siblings merge into one lake, and
 * what reaches the outside leaves (the Fill–Spill–Merge idea of Barnes et al. 2021).
 *
 * Dynamic mode (hbg_dyn_step): the basins are nodes of a weir network. Flow over every sill is
 * a broad-crested weir with Villemonte submergence,
 *     Q = C·w·H_u^{3/2}·(1 − (H_d/H_u)^{3/2})^{0.385},
 * rain reaches each pond through a linear reservoir (lag ≈ travel time across the basin), and
 * the volumes are integrated implicitly (backward Euler, nonlinear Gauss–Seidel with a
 * per-node Newton solve), so steps of a minute are stable for a whole city.
 */
#include "sim.h"

typedef struct {
  int nx, ny, n;
  double dx, dy, area;
  const double *z;
  int *label;           /* cell → basin (0 = outside) */
  int nb;               /* basins incl. 0 */
  /* hypsometry per basin: cells sorted by z, prefix sums */
  int *start, *count;   /* into sorted arrays */
  double *sz, *pa, *pz; /* sorted z, prefix φA, prefix φA·z */
  double *pitZ;         /* lowest cell per basin */
  /* sill edges */
  int ne;
  int *ea, *eb;
  double *es, *ew;      /* sill elevation, width (m) */
  int *adjStart, *adj;  /* CSR: edges touching each basin */
  /* hierarchy (Kruskal): nodes 0..nb-1 are basins, then merges */
  int nn;
  int *parent, *ch0, *ch1, *leafLo, *leafHi, *leafOrder;
  double *mergeZ;       /* elevation where this node's children joined */
  u8 *ocean;            /* component touches the outside */
  /* instant mode state */
  double *water, *level, *eff;
  u8 *merged;
  double lost;
  double *excess;
  int *stk;
  /* dynamic mode state */
  double *dW, *dS, *dEta, *dLag;
} Hbg;

static double *dalloc(int n) { return (double *)walloc((u32)n * 8u); }
static int *ialloc(int n) { return (int *)walloc((u32)n * 4u); }

/* heapsort of idx[] by key[idx] ascending */
static void sort_by(int *idx, const double *key, int n) {
  for (int i = n / 2 - 1; i >= 0; i--) {
    int r = i;
    for (;;) {
      int c = 2 * r + 1;
      if (c >= n) break;
      if (c + 1 < n && key[idx[c + 1]] > key[idx[c]]) c++;
      if (key[idx[r]] >= key[idx[c]]) break;
      int t = idx[r]; idx[r] = idx[c]; idx[c] = t;
      r = c;
    }
  }
  for (int end = n - 1; end > 0; end--) {
    int t = idx[0]; idx[0] = idx[end]; idx[end] = t;
    int r = 0;
    for (;;) {
      int c = 2 * r + 1;
      if (c >= end) break;
      if (c + 1 < end && key[idx[c + 1]] > key[idx[c]]) c++;
      if (key[idx[r]] >= key[idx[c]]) break;
      int t2 = idx[r]; idx[r] = idx[c]; idx[c] = t2;
      r = c;
    }
  }
}

static int *uf;
static int find(int a) {
  while (uf[a] != a) { uf[a] = uf[uf[a]]; a = uf[a]; }
  return a;
}

/* strict total order on cells: lower z, then lower index */
static inline int lower(const double *z, int a, int b) { return z[a] < z[b] || (z[a] == z[b] && a < b); }

EXPORT(hbg_build) Hbg *hbg_build(const double *z, const double *phi, int nx, int ny, double dx, double dy, double seaLevel,
                                 int edgesOutlet) {
  Hbg *g = (Hbg *)walloc(sizeof(Hbg));
  int n = nx * ny;
  g->nx = nx; g->ny = ny; g->n = n; g->dx = dx; g->dy = dy; g->area = dx * dy; g->z = z;
  int *down = ialloc(n);
  g->label = ialloc(n);

  /* 1. steepest-descent receivers; outlets drain to the outside */
  for (int c = 0; c < n; c++) {
    int x = c % nx, y = c / nx;
    int isOut = z[c] <= seaLevel || (edgesOutlet && (x == 0 || y == 0 || x == nx - 1 || y == ny - 1));
    if (isOut) { down[c] = -2; continue; }
    int best = c;
    for (int a = -1; a <= 1; a++)
      for (int b = -1; b <= 1; b++) {
        if (!a && !b) continue;
        int xx = x + b, yy = y + a;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        int o = yy * nx + xx;
        if (lower(z, o, best)) best = o;
      }
    down[c] = best == c ? -1 : best; /* -1 = pit */
  }
  /* 2. labels via path following with memo */
  for (int c = 0; c < n; c++) g->label[c] = -1;
  int nb = 1;
  int *stack = ialloc(n);
  for (int c = 0; c < n; c++) {
    if (g->label[c] >= 0) continue;
    int sp = 0, k = c;
    while (g->label[k] < 0 && down[k] >= 0) { stack[sp++] = k; k = down[k]; }
    int lab;
    if (g->label[k] >= 0) lab = g->label[k];
    else if (down[k] == -2) lab = 0;
    else lab = nb++;
    g->label[k] = lab;
    while (sp) g->label[stack[--sp]] = lab;
  }
  g->nb = nb;

  /* 3. hypsometry: cells grouped by basin, sorted by z */
  g->count = ialloc(nb);
  g->start = ialloc(nb + 1);
  for (int b = 0; b < nb; b++) g->count[b] = 0;
  for (int c = 0; c < n; c++) g->count[g->label[c]]++;
  g->start[0] = 0;
  for (int b = 0; b < nb; b++) g->start[b + 1] = g->start[b] + g->count[b];
  int *fill = ialloc(nb), *order = ialloc(n);
  for (int b = 0; b < nb; b++) fill[b] = g->start[b];
  for (int c = 0; c < n; c++) order[fill[g->label[c]]++] = c;
  g->sz = dalloc(n); g->pa = dalloc(n + nb); g->pz = dalloc(n + nb); g->pitZ = dalloc(nb);
  for (int b = 0; b < nb; b++) {
    int s0 = g->start[b], m = g->count[b];
    sort_by(order + s0, z, m);
    /* prefix arrays have m+1 entries per basin, offset by b */
    double accA = 0, accZ = 0;
    g->pa[s0 + b] = 0;
    g->pz[s0 + b] = 0;
    for (int k = 0; k < m; k++) {
      int c = order[s0 + k];
      double a = g->area * (phi ? w_max(phi[c], 0.02) : 1.0);
      g->sz[s0 + k] = z[c];
      accA += a;
      accZ += a * z[c];
      g->pa[s0 + b + k + 1] = accA;
      g->pz[s0 + b + k + 1] = accZ;
    }
    g->pitZ[b] = m ? g->sz[s0] : 0;
  }

  /* 4. sills between touching basins (open-addressing hash on the pair) */
  int cap = 1;
  while (cap < 4 * nb + 64) cap <<= 1;
  int *hk0 = ialloc(cap), *hk1 = ialloc(cap);
  double *hs = dalloc(cap), *hw = dalloc(cap);
  for (int i = 0; i < cap; i++) hk0[i] = -1;
  for (int c = 0; c < n; c++) {
    int x = c % nx, y = c / nx;
    int nbrs[2] = {x < nx - 1 ? c + 1 : -1, y < ny - 1 ? c + nx : -1};
    for (int k = 0; k < 2; k++) {
      int o = nbrs[k];
      if (o < 0) continue;
      int a = g->label[c], b = g->label[o];
      if (a == b) continue;
      if (a > b) { int t = a; a = b; b = t; }
      double s = w_max(z[c], z[o]);
      u32 hsh = ((u32)a * 2654435761u ^ (u32)b * 40503u) & (u32)(cap - 1);
      while (hk0[hsh] >= 0 && !(hk0[hsh] == a && hk1[hsh] == b)) hsh = (hsh + 1) & (u32)(cap - 1);
      double len = k == 0 ? dy : dx;
      if (hk0[hsh] < 0) { hk0[hsh] = a; hk1[hsh] = b; hs[hsh] = s; hw[hsh] = len; }
      else if (s < hs[hsh] - 0.25) { hs[hsh] = s; hw[hsh] = len; }
      else if (s <= hs[hsh] + 0.25) { if (s < hs[hsh]) hs[hsh] = s; hw[hsh] += len; }
    }
  }
  g->ne = 0;
  for (int i = 0; i < cap; i++) if (hk0[i] >= 0) g->ne++;
  g->ea = ialloc(g->ne); g->eb = ialloc(g->ne); g->es = dalloc(g->ne); g->ew = dalloc(g->ne);
  for (int i = 0, e = 0; i < cap; i++)
    if (hk0[i] >= 0) { g->ea[e] = hk0[i]; g->eb[e] = hk1[i]; g->es[e] = hs[i]; g->ew[e] = hw[i]; e++; }

  g->adjStart = ialloc(nb + 1);
  g->adj = ialloc(2 * g->ne + 1);
  for (int b = 0; b <= nb; b++) g->adjStart[b] = 0;
  for (int e = 0; e < g->ne; e++) { g->adjStart[g->ea[e] + 1]++; g->adjStart[g->eb[e] + 1]++; }
  for (int b = 0; b < nb; b++) g->adjStart[b + 1] += g->adjStart[b];
  for (int b = 0; b < nb; b++) fill[b] = g->adjStart[b];
  for (int e = 0; e < g->ne; e++) { g->adj[fill[g->ea[e]]++] = e; g->adj[fill[g->eb[e]]++] = e; }

  /* 5. depression hierarchy by Kruskal on sill height */
  int maxNodes = 2 * nb;
  g->parent = ialloc(maxNodes); g->ch0 = ialloc(maxNodes); g->ch1 = ialloc(maxNodes);
  g->mergeZ = dalloc(maxNodes); g->ocean = (u8 *)walloc((u32)maxNodes);
  uf = ialloc(maxNodes);
  int *comp = ialloc(maxNodes); /* union-find root → tree node */
  for (int i = 0; i < maxNodes; i++) { g->parent[i] = -1; g->ch0[i] = g->ch1[i] = -1; g->mergeZ[i] = -1e300; g->ocean[i] = 0; uf[i] = i; comp[i] = i; }
  g->ocean[0] = 1;
  int *eorder = ialloc(g->ne);
  for (int e = 0; e < g->ne; e++) eorder[e] = e;
  sort_by(eorder, g->es, g->ne);
  int nn = nb;
  for (int k = 0; k < g->ne; k++) {
    int e = eorder[k];
    int ra = find(g->ea[e]), rb = find(g->eb[e]);
    if (ra == rb) continue;
    int na = comp[ra], nbn = comp[rb];
    int p = nn++;
    g->ch0[p] = na; g->ch1[p] = nbn; g->mergeZ[p] = g->es[e];
    g->parent[na] = p; g->parent[nbn] = p;
    g->ocean[p] = g->ocean[na] | g->ocean[nbn];
    uf[ra] = rb;
    comp[rb] = p;
  }
  g->nn = nn;
  /* leaves in DFS order so every subtree is a contiguous range */
  g->leafOrder = ialloc(nb); g->leafLo = ialloc(nn); g->leafHi = ialloc(nn);
  int pos = 0, sp = 0;
  for (int r = 0; r < nn; r++) {
    if (g->parent[r] >= 0) continue;
    stack[sp++] = r;
    while (sp) {
      int v = stack[--sp];
      if (v >= 0) {
        if (v < nb) { g->leafLo[v] = pos; g->leafOrder[pos++] = v; g->leafHi[v] = pos; continue; }
        stack[sp++] = ~v; /* post-visit marker */
        stack[sp++] = g->ch1[v];
        stack[sp++] = g->ch0[v];
      } else {
        v = ~v;
        g->leafLo[v] = g->leafLo[g->ch0[v]];
        g->leafHi[v] = g->leafHi[g->ch1[v]];
      }
    }
  }
  g->water = dalloc(nn); g->level = dalloc(nn); g->eff = dalloc(nb); g->merged = (u8 *)walloc((u32)nn);
  g->excess = dalloc(nn);
  g->stk = ialloc(nn + 2);
  g->dW = dalloc(nb); g->dS = dalloc(nb); g->dEta = dalloc(nb); g->dLag = dalloc(nb);
  for (int b = 0; b < nb; b++) {
    g->dW[b] = g->dS[b] = 0;
    g->dEta[b] = g->pitZ[b];
    double L = w_sqrt(g->count[b] * g->area);
    g->dLag[b] = w_max(60.0, L / 0.3); /* travel time at ~0.3 m/s sheet flow */
  }
  return g;
}

/* Stored volume of basin b below level η (exact, binary search on sorted elevations). */
static double vol_basin(Hbg *g, int b, double eta) {
  int s0 = g->start[b], m = g->count[b];
  int lo = 0, hi = m;
  while (lo < hi) {
    int mid = (lo + hi) >> 1;
    if (g->sz[s0 + mid] < eta) lo = mid + 1; else hi = mid;
  }
  return eta * g->pa[s0 + b + lo] - g->pz[s0 + b + lo];
}

static double vol_node(Hbg *g, int v, double eta) {
  double s = 0;
  for (int k = g->leafLo[v]; k < g->leafHi[v]; k++) s += vol_basin(g, g->leafOrder[k], eta);
  return s;
}

/* Exact level holding volume W in a single basin: V is piecewise linear between sorted cell heights. */
static double level_basin(Hbg *g, int b, double W) {
  int s0 = g->start[b], m = g->count[b];
  if (m == 0) return 0;
  if (W <= 0) return g->sz[s0];
  int lo = 1, hi = m; /* find largest k with V(z_{k-1}) <= W, using V(z_k) = z_k·PA_k − PZ_k */
  while (lo < hi) {
    int mid = (lo + hi + 1) >> 1;
    double v = g->sz[s0 + mid - 1] * g->pa[s0 + b + mid - 1] - g->pz[s0 + b + mid - 1];
    if (v <= W) lo = mid; else hi = mid - 1;
  }
  return (W + g->pz[s0 + b + lo]) / g->pa[s0 + b + lo];
}

/* Level holding volume W in node v (bisection; volume is convex and increasing in η). */
static double level_for(Hbg *g, int v, double W) {
  if (v < g->nb) return level_basin(g, v, W);
  double lo = 1e300, hi;
  for (int k = g->leafLo[v]; k < g->leafHi[v]; k++) {
    int b = g->leafOrder[k];
    if (g->count[b] && g->pitZ[b] < lo) lo = g->pitZ[b];
  }
  if (W <= 0) return lo;
  hi = lo + 1;
  while (vol_node(g, v, hi) < W) hi = lo + 2.0 * (hi - lo);
  for (int it = 0; it < 50; it++) {
    double mid = 0.5 * (lo + hi);
    if (vol_node(g, v, mid) < W) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

static double spill_of(Hbg *g, int v) { return g->parent[v] >= 0 ? g->mergeZ[g->parent[v]] : 1e300; }

/* Room left in v below its spill level (infinite for anything connected to the outside). */
static double room(Hbg *g, int v) {
  if (g->ocean[v]) return 1e300;
  double sp = spill_of(g, v);
  return sp > 1e299 ? 1e300 : vol_node(g, v, sp) - g->water[v];
}

/* Top-down: share a node's water among its children (lowest side first), then set levels. */
static void settle(Hbg *g, int v) {
  int *stack = g->stk, sp = 0;
  stack[sp++] = v;
  while (sp) {
    int u = stack[--sp];
    if (g->ocean[u] && u >= g->nb) {
      /* drained by the outside: its children keep what they hold below their sills */
      stack[sp++] = g->ch0[u]; stack[sp++] = g->ch1[u];
      continue;
    }
    if (u < g->nb || g->merged[u]) {
      double lvl = u == 0 ? -1e300 : level_for(g, u, g->water[u]);
      for (int k = g->leafLo[u]; k < g->leafHi[u]; k++) g->eff[g->leafOrder[k]] = lvl;
      continue;
    }
    int a = g->ch0[u], b = g->ch1[u];
    double extra = g->water[u] - g->water[a] - g->water[b];
    if (extra > 0) {
      int first = g->level[a] <= g->level[b] ? a : b, second = first == a ? b : a;
      double give = w_min(extra, room(g, first));
      g->water[first] += give;
      g->water[second] += extra - give;
    }
    stack[sp++] = a;
    stack[sp++] = b;
  }
}

/*
 * Instant mode: rain depth (m) × runoff coefficient lands on every basin and is routed through
 * the hierarchy. depthOut gets the final ponding depth per cell.
 * stats: [ponded m³, lost to the outside m³, lakes, deepest m].
 *
 * Bottom-up (children before parents): each node keeps what fits below the sill where it meets
 * its sibling; the overflow crosses that sill into the sibling; when both are full they become
 * one lake that can rise to the next sill up. Anything reaching the outside is lost. A top-down
 * pass then shares each subtree's water among its basins and sets every basin's water level.
 */
EXPORT(hbg_fsm) void hbg_fsm(Hbg *g, double rain, double runoff, float *depthOut, double *stats) {
  double *excess = g->excess;
  g->lost = 0;
  for (int v = 0; v < g->nn; v++) { g->water[v] = 0; g->merged[v] = 0; excess[v] = 0; g->level[v] = -1e300; }
  g->lost = rain * runoff * g->count[0] * g->area; /* rain on sea / edge cells */
  for (int v = 1; v < g->nn; v++) {
    if (v < g->nb) {
      double W = rain * runoff * g->count[v] * g->area;
      double keep = w_min(W, room(g, v));
      g->water[v] = keep;
      g->level[v] = level_basin(g, v, keep);
      excess[v] = W - keep;
      continue;
    }
    int a = g->ch0[v], b = g->ch1[v];
    double ea = excess[a], eb = excess[b];
    if (ea > 0) {
      double t = w_min(ea, room(g, b));
      if (g->ocean[b]) g->lost += t; else g->water[b] += t;
      ea -= t;
    }
    if (eb > 0) {
      double t = w_min(eb, room(g, a));
      if (g->ocean[a]) g->lost += t; else g->water[a] += t;
      eb -= t;
    }
    g->water[v] = (g->ocean[a] ? 0 : g->water[a]) + (g->ocean[b] ? 0 : g->water[b]);
    double rest = ea + eb;
    if (rest > 0 && !g->ocean[v]) {
      g->merged[v] = 1;
      double keep = w_min(rest, room(g, v));
      g->water[v] += keep;
      excess[v] = rest - keep;
    } else {
      g->lost += g->ocean[v] ? rest : 0;
      excess[v] = 0;
    }
    g->level[v] = g->merged[v] ? level_for(g, v, g->water[v]) : w_max(g->level[a], g->level[b]);
  }
  for (int b = 0; b < g->nb; b++) g->eff[b] = -1e300;
  for (int v = 0; v < g->nn; v++)
    if (g->parent[v] < 0) settle(g, v);
  double ponded = 0, deepest = 0;
  int lakes = 0;
  for (int c = 0; c < g->n; c++) {
    int b = g->label[c];
    double d = b == 0 ? 0 : g->eff[b] - g->z[c];
    if (d < 0) d = 0;
    depthOut[c] = (float)d;
    ponded += d * g->area;
    if (d > deepest) deepest = d;
  }
  for (int b = 1; b < g->nb; b++) if (g->eff[b] > g->pitZ[b] + 0.01) lakes++;
  stats[0] = ponded;
  stats[1] = g->lost;
  stats[2] = lakes;
  stats[3] = deepest;
}

/* ── Dynamic weir network ─────────────────────────────── */

/* Villemonte submergence factor (1 − r^{3/2})^{0.385}, tabulated once (no JS calls in the hot loop). */
#define SUB_N 1024
static double subLut[SUB_N + 1];
static int subReady = 0;
static void sub_init(void) {
  for (int i = 0; i <= SUB_N; i++) {
    double r = (double)i / SUB_N;
    double base = 1.0 - r * w_sqrt(r);
    subLut[i] = base > 0 ? js_pow(base, 0.385) : 0;
  }
  subReady = 1;
}

static inline double weir(double etaU, double etaD, double sill, double width) {
  double Hu = etaU - sill;
  if (Hu <= 0) return 0;
  double Hd = w_max(0.0, etaD - sill);
  double r = Hd / Hu;
  if (r >= 1) return 0;
  double f = r * SUB_N;
  int i = (int)f;
  double sub = subLut[i] + (f - i) * (subLut[i + 1] - subLut[i]);
  return 1.7 * width * Hu * w_sqrt(Hu) * sub;
}

EXPORT(hbg_dyn_reset) void hbg_dyn_reset(Hbg *g) {
  if (!subReady) sub_init();
  for (int b = 0; b < g->nb; b++) { g->dW[b] = g->dS[b] = 0; g->dEta[b] = g->pitZ[b]; }
}

/* Net inflow to basin i at level etaI (weirs over each of its sills; the outside never flows back). */
static double net_exchange(Hbg *g, int i, double etaI) {
  double q = 0;
  for (int k = g->adjStart[i]; k < g->adjStart[i + 1]; k++) {
    int e = g->adj[k];
    int o = g->ea[e] == i ? g->eb[e] : g->ea[e];
    double etaO = o == 0 ? -1e9 : g->dEta[o];
    if (etaI > etaO) q -= weir(etaI, etaO, g->es[e], g->ew[e]);
    else if (o != 0) q += weir(etaO, etaI, g->es[e], g->ew[e]);
  }
  return q;
}

/*
 * One implicit step of dt seconds with rain (m/s) and runoff coefficient. stats: [stored m³,
 * outflow m³ this step, max level rise, iterations].
 */
EXPORT(hbg_dyn_step) void hbg_dyn_step(Hbg *g, double dt, double rain, double runoff, double *stats) {
  double *W0 = g->water; /* reuse as scratch for the old volumes */
  for (int b = 1; b < g->nb; b++) {
    /* overland linear reservoir: storage S drains to the pond with lag k */
    double inRain = rain * runoff * g->count[b] * g->area;
    double k = g->dLag[b];
    double Snew = (g->dS[b] + dt * inRain) / (1.0 + dt / k);
    W0[b] = g->dW[b] + dt * Snew / k;
    g->dS[b] = Snew;
  }
  int it;
  double maxChange = 0;
  for (it = 0; it < 8; it++) {
    maxChange = 0;
    for (int b = 1; b < g->nb; b++) {
      if (!g->count[b]) continue;
      /* idle: empty, nothing arriving, and no neighbour above a shared sill */
      if (W0[b] <= 0 && g->dW[b] <= 0) {
        int active = 0;
        for (int k = g->adjStart[b]; k < g->adjStart[b + 1] && !active; k++) {
          int e = g->adj[k];
          int o = g->ea[e] == b ? g->eb[e] : g->ea[e];
          if (o != 0 && g->dEta[o] > g->es[e]) active = 1;
        }
        if (!active) continue;
      }
      /* solve W − W0 − dt·Qnet(η(W)) = 0 for this node with secant iterations */
      double W = g->dW[b];
      double f0 = W - W0[b] - dt * net_exchange(g, b, g->dEta[b]);
      double W1 = w_max(0.0, W - f0);
      for (int k = 0; k < 6 && w_fabs(W1 - W) > 1e-6 * (1.0 + W); k++) {
        double eta1 = level_basin(g, b, W1);
        double f1 = W1 - W0[b] - dt * net_exchange(g, b, eta1);
        double d = f1 - f0;
        double Wn = w_fabs(d) > 1e-12 ? W1 - f1 * (W1 - W) / d : W1;
        W = W1; f0 = f1;
        W1 = w_max(0.0, Wn);
      }
      double eta = level_basin(g, b, W1);
      maxChange = w_max(maxChange, w_fabs(eta - g->dEta[b]));
      g->dW[b] = W1;
      g->dEta[b] = eta;
    }
    if (maxChange < 1e-3) break;
  }
  /*
   * Corrector: the sweeps above predict implicit levels; now every sill's flow is evaluated
   * once from those levels and applied to both sides (exactly conservative), with each basin's
   * outflow limited to the water it actually has.
   */
  double *outQ = g->eff; /* scratch: total outflow per basin */
  for (int b = 0; b < g->nb; b++) outQ[b] = 0;
  for (int e = 0; e < g->ne; e++) {
    int a = g->ea[e], c = g->eb[e];
    double ea = a == 0 ? -1e9 : g->dEta[a], ec = c == 0 ? -1e9 : g->dEta[c];
    if (ea > ec) outQ[a] += weir(ea, ec, g->es[e], g->ew[e]);
    else if (ec > ea) outQ[c] += weir(ec, ea, g->es[e], g->ew[e]);
  }
  double out = rain * runoff * g->count[0] * g->area * dt; /* rain on sea / edge cells */
  for (int b = 1; b < g->nb; b++) g->dW[b] = W0[b];
  for (int e = 0; e < g->ne; e++) {
    int a = g->ea[e], c = g->eb[e];
    double ea = a == 0 ? -1e9 : g->dEta[a], ec = c == 0 ? -1e9 : g->dEta[c];
    int up = ea > ec ? a : c, dn = up == a ? c : a;
    if (ea == ec || up == 0) continue;
    double q = weir(ea > ec ? ea : ec, ea > ec ? ec : ea, g->es[e], g->ew[e]);
    double lim = outQ[up] * dt > W0[up] ? W0[up] / (outQ[up] * dt) : 1.0; /* draining limiter */
    double vol = q * dt * lim;
    g->dW[up] -= vol;
    if (dn == 0) out += vol; else g->dW[dn] += vol;
  }
  double stored = 0;
  for (int b = 1; b < g->nb; b++) {
    if (g->dW[b] < 0) g->dW[b] = 0; /* round-off */
    g->dEta[b] = level_basin(g, b, g->dW[b]);
    stored += g->dW[b] + g->dS[b];
  }
  stats[0] = stored; /* ponds + water still running off the slopes */
  stats[1] = out;
  stats[2] = maxChange;
  stats[3] = it + 1;
}

EXPORT(hbg_dyn_depth) void hbg_dyn_depth(Hbg *g, float *out) {
  for (int c = 0; c < g->n; c++) {
    int b = g->label[c];
    double d = b == 0 ? 0 : g->dEta[b] - g->z[c];
    out[c] = d > 0 ? (float)d : 0.0f;
  }
}

EXPORT(hbg_info) void hbg_info(Hbg *g, double *out) {
  out[0] = g->nb - 1;
  out[1] = g->ne;
  out[2] = g->nn;
}

EXPORT(hbg_labels) int *hbg_labels(Hbg *g) { return g->label; }
