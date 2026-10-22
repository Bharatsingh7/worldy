/*
 * Tsunami what-if, in three simplified physical steps.
 *
 * 1. Source (tsu_source): earthquake magnitude → rupture size and slip.
 *    M0 = 10^(1.5·Mw + 9.1) N·m; rupture length/width from Strasser et al. (2010) for
 *    subduction-interface events; mean slip D = M0 / (μ·L·W), μ = 30 GPa;
 *    initial wave amplitude ≈ D/2 (rule of thumb for a shallow-dipping thrust).
 *
 * 2. Ocean propagation (tsu_travel): long-wave speed c = √(g·d) on a bathymetry grid;
 *    first-arrival times by Dijkstra over ocean cells. Amplitude falls with cylindrical
 *    spreading √(r0/r) and grows in shallow water by Green's law (d_src/d)^¼,
 *    capped by breaking at 0.39·d.
 *
 * 3. Land inundation (tsu_inundate): from the coast, water height H decays inland at
 *    H/X_max, with X_max = 0.06·H^(4/3)/n² (Hills & Mader 1997; n = Manning roughness).
 *    A land cell floods when the water surface there is above the ground and it is
 *    reachable through flooded cells.
 */
#include "worldy.h"

EXPORT(tsu_source) void tsu_source(double mw, double *out) {
  double m0 = js_pow(10.0, 1.5 * mw + 9.1);
  double lenKm = js_pow(10.0, -2.477 + 0.585 * mw);
  double widKm = js_pow(10.0, -0.882 + 0.351 * mw);
  double slip = m0 / (3.0e10 * lenKm * 1000.0 * widKm * 1000.0);
  out[0] = m0;
  out[1] = lenKm;
  out[2] = widKm;
  out[3] = slip;
  out[4] = 0.5 * slip;
}

static const int OX[8] = {-1, 0, 1, -1, 1, -1, 0, 1};
static const int OY[8] = {-1, -1, -1, 0, 0, 1, 1, 1};

/*
 * bathy: elevation grid (m, negative = ocean) over [west..east]×[south..north], row 0 = north.
 * out tmin: first arrival (s, NaN where unreached/land). out amp: amplitude (m).
 * stats: [source depth m, cells reached]. Returns 0 on success, -1 if the source is on land.
 */
EXPORT(tsu_travel) int tsu_travel(const float *bathy, int w, int hgt, double west, double south, double east,
                                  double north, double srcLat, double srcLon, double a0, double srcRadiusM,
                                  float *tmin, float *amp, double *stats) {
  int n = w * hgt;
  double cellLat = (north - south) / hgt, cellLon = (east - west) / w;
  double dy = cellLat * DEG * EARTH_R;
  int sx = (int)((srcLon - west) / cellLon), sy = (int)((north - srcLat) / cellLat);
  if (sx < 0 || sy < 0 || sx >= w || sy >= hgt) return -1;

  /* Move the source to the deepest ocean cell nearby if it sits on land. */
  int src = sy * w + sx;
  if (bathy[src] >= 0) {
    double best = 0;
    for (int yy = sy - 3; yy <= sy + 3; yy++)
      for (int xx = sx - 3; xx <= sx + 3; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= hgt) continue;
        if (bathy[yy * w + xx] < best) { best = bathy[yy * w + xx]; src = yy * w + xx; }
      }
    if (bathy[src] >= 0) return -1;
  }
  double dSrc = -bathy[src];

  for (int i = 0; i < n; i++) { tmin[i] = __builtin_nanf(""); amp[i] = 0; }
  double *t = (double *)walloc((u32)n * 8u);
  for (int i = 0; i < n; i++) t[i] = INF_D;

  Heap q;
  heap_init(&q, n * 8);
  t[src] = 0;
  heap_push(&q, src, 0);
  int reached = 0;
  while (q.size) {
    double ti;
    int i = heap_pop(&q, &ti);
    if (ti > t[i]) continue;
    reached++;
    int x = i % w, y = i / w;
    double lat = north - (y + 0.5) * cellLat;
    double dx = cellLon * DEG * EARTH_R * js_cos(lat * DEG);
    double ci = w_sqrt(GRAVITY * w_max(1.0, -bathy[i]));
    for (int k = 0; k < 8; k++) {
      int nx = x + OX[k], ny = y + OY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= hgt) continue;
      int j = ny * w + nx;
      if (bathy[j] >= 0) continue;
      double cj = w_sqrt(GRAVITY * w_max(1.0, -bathy[j]));
      double d = w_sqrt((OX[k] * dx) * (OX[k] * dx) + (OY[k] * dy) * (OY[k] * dy));
      double tj = ti + d / (0.5 * (ci + cj));
      if (tj < t[j]) {
        t[j] = tj;
        heap_push(&q, j, tj);
      }
    }
  }

  double sLat = north - (src / w + 0.5) * cellLat, sLon = west + (src % w + 0.5) * cellLon;
  for (int i = 0; i < n; i++) {
    if (t[i] >= INF_D) continue;
    tmin[i] = (float)t[i];
    int x = i % w, y = i / w;
    double lat = north - (y + 0.5) * cellLat, lon = west + (x + 0.5) * cellLon;
    double r = geo_distance(sLat, sLon, lat, lon);
    double d = w_max(1.0, -bathy[i]);
    double a = a0 * w_sqrt(srcRadiusM / w_max(r, srcRadiusM)) * js_pow(dSrc / d, 0.25);
    amp[i] = (float)w_min(a, 0.39 * d);
  }
  stats[0] = dSrc;
  stats[1] = reached;
  return 0;
}

/*
 * h: land elevation grid (m) for the coastal analysis area; cells ≤ 0.5 m are sea.
 * runup: water height at the shoreline (m). n: Manning roughness.
 * out depth: flood depth (m). stats: [flooded area m², max inland distance m, max depth m, X_max m].
 */
EXPORT(tsu_inundate) int tsu_inundate(const float *h, int w, int hgt, double dx, double dy, double runup,
                                      double manning, float *depth, double *stats) {
  int n = w * hgt;
  double xmax = 0.06 * js_pow(runup, 4.0 / 3.0) / (manning * manning);
  double decay = runup / xmax;
  double *dist = (double *)walloc((u32)n * 8u);
  Heap q;
  heap_init(&q, n * 8);
  int seas = 0;
  for (int i = 0; i < n; i++) {
    depth[i] = 0;
    dist[i] = INF_D;
    if (h[i] <= 0.5f) {
      dist[i] = 0;
      heap_push(&q, i, 0);
      seas++;
    }
  }
  double flooded = 0, inland = 0, maxDepth = 0;
  while (q.size) {
    double di;
    int i = heap_pop(&q, &di);
    if (di > dist[i]) continue;
    int x = i % w, y = i / w;
    for (int k = 0; k < 8; k++) {
      int nx = x + OX[k], ny = y + OY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= hgt) continue;
      int j = ny * w + nx;
      if (h[j] <= 0.5f) continue;
      double d = di + w_sqrt((OX[k] * dx) * (OX[k] * dx) + (OY[k] * dy) * (OY[k] * dy));
      double level = runup - d * decay;
      if (level <= h[j] || d >= dist[j]) continue;
      dist[j] = d;
      heap_push(&q, j, d);
    }
  }
  for (int i = 0; i < n; i++) {
    if (h[i] <= 0.5f || dist[i] >= INF_D) continue;
    double dep = runup - dist[i] * decay - h[i];
    if (dep <= 0) continue;
    depth[i] = (float)dep;
    flooded += dx * dy;
    if (dist[i] > inland) inland = dist[i];
    if (dep > maxDepth) maxDepth = dep;
  }
  stats[0] = flooded;
  stats[1] = inland;
  stats[2] = maxDepth;
  stats[3] = xmax;
  return seas;
}
