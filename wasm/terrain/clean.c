/*
 * GRSR — terrain tile reconstruction for Esri World Elevation tiles.
 *
 *  1. Invalid cells (LERC mask = 0, NaN, or impossible heights) are marked.
 *  2. Spikes: Hampel test against the 3×3 neighbourhood — a cell is an outlier when
 *     |h − median| > max(k·1.4826·MAD, floor), floor = max(5 m, one cell of 45° slope),
 *     so real summits and cliffs (whose neighbours also vary) survive.
 *  3. Bare earth (fine tiles only): the source is partly a surface model (trees, roofs).
 *     Multi-scale grey-scale openings give the residual r_s = h − open_s(h). Unlike the
 *     constant-slope SMRF/PMF filters, the threshold adapts to terrain:
 *         t_s = t0 + κ · s · Δ · tanθ_local,
 *     where tanθ_local is the robust slope of the *opened* surface (objects removed), so
 *     hillsides tolerate larger residuals than plains, and slopes above 10° are left
 *     untouched (ridges and summits look like objects at 30 m). Candidate regions are kept as
 *     "objects" only if their boundary is steep (mean edge step > tan 25°) — buildings and
 *     tree edges are abrupt, natural mounds are not — or if they are tiny.
 *  4. Every removed or invalid cell is rebuilt as a membrane (Laplace equation) anchored on
 *     the trusted cells: BFS seeding then successive over-relaxation. Bare earth never
 *     raises the ground.
 *  5. Geoid: N(lat, lon) is added so heights become ellipsoidal (Cesium's frame).
 *
 * Tiles are Web Mercator: rows are evenly spaced in Mercator y, not latitude.
 * flags: 1 despike/fill, 2 bare earth, 4 geoid. stats out: [invalid, spikes, bare cells, mean N].
 */
#include "../worldy.h"

double geoid_n(double latDeg, double lonDeg);

#define F_DESPIKE 1
#define F_BARE 2
#define F_GEOID 4

static void sort9(double *v, int n) {
  for (int i = 1; i < n; i++) {
    double x = v[i];
    int j = i - 1;
    while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j--; }
    v[j + 1] = x;
  }
}

/* Separable square min (erode=1) or max filter of radius r, using tmp. */
static void minmax(const float *src, float *dst, float *tmp, int w, int h, int r, int erode) {
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) {
      float m = src[y * w + x];
      for (int k = -r; k <= r; k++) {
        int xx = x + k;
        if (xx < 0 || xx >= w) continue;
        float v = src[y * w + xx];
        if (erode ? v < m : v > m) m = v;
      }
      tmp[y * w + x] = m;
    }
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) {
      float m = tmp[y * w + x];
      for (int k = -r; k <= r; k++) {
        int yy = y + k;
        if (yy < 0 || yy >= h) continue;
        float v = tmp[yy * w + x];
        if (erode ? v < m : v > m) m = v;
      }
      dst[y * w + x] = m;
    }
}

/* Laplace (membrane) fill of cells with fix[i]==0 from cells with fix[i]==1. */
static void membrane(float *h, u8 *fix, int w, int hgt) {
  int n = w * hgt;
  int *queue = (int *)walloc((u32)n * 4u);
  u8 *known = (u8 *)walloc((u32)n);
  int qh = 0, qt = 0, unknown = 0;
  for (int i = 0; i < n; i++) {
    known[i] = fix[i];
    if (!fix[i]) unknown++;
  }
  if (!unknown) return;
  if (unknown == n) {
    for (int i = 0; i < n; i++) h[i] = 0;
    return;
  }
  /* BFS seeding: each unknown cell starts at the mean of its already-known neighbours. */
  for (int i = 0; i < n; i++)
    if (known[i]) {
      int x = i % w, y = i / w;
      if ((x > 0 && !known[i - 1]) || (x < w - 1 && !known[i + 1]) || (y > 0 && !known[i - w]) || (y < hgt - 1 && !known[i + w]))
        queue[qt++] = i;
    }
  while (qh < qt) {
    int i = queue[qh++];
    int x = i % w, y = i / w;
    int nb[4] = {x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < hgt - 1 ? i + w : -1};
    for (int k = 0; k < 4; k++) {
      int j = nb[k];
      if (j < 0 || known[j]) continue;
      int jx = j % w, jy = j / w;
      double s = 0;
      int c = 0;
      int nn[4] = {jx > 0 ? j - 1 : -1, jx < w - 1 ? j + 1 : -1, jy > 0 ? j - w : -1, jy < hgt - 1 ? j + w : -1};
      for (int m = 0; m < 4; m++)
        if (nn[m] >= 0 && known[nn[m]]) { s += h[nn[m]]; c++; }
      h[j] = (float)(s / c);
      known[j] = 1;
      queue[qt++] = j;
    }
  }
  /* SOR iterations on the unknown cells only. */
  const double omega = 1.85;
  for (int it = 0; it < 120; it++) {
    double change = 0;
    for (int i = 0; i < n; i++) {
      if (fix[i]) continue;
      int x = i % w, y = i / w;
      double s = 0;
      int c = 0;
      if (x > 0) { s += h[i - 1]; c++; }
      if (x < w - 1) { s += h[i + 1]; c++; }
      if (y > 0) { s += h[i - w]; c++; }
      if (y < hgt - 1) { s += h[i + w]; c++; }
      double nv = h[i] + omega * (s / c - h[i]);
      change = w_max(change, w_fabs(nv - h[i]));
      h[i] = (float)nv;
    }
    if (change < 0.01) break;
  }
}

EXPORT(ter_clean) int ter_clean(float *h, const u8 *mask, int w, int hgt, double west, double south, double east,
                                double north, int flags, double *stats) {
  int n = w * hgt;
  u8 *fix = (u8 *)walloc((u32)n);
  int invalid = 0, spikes = 0, bare = 0;

  /* Cell size (m) at the tile centre; rows are Mercator-spaced. */
  double midLat = 0.5 * (north + south);
  double dx = (east - west) * DEG * EARTH_R * js_cos(midLat * DEG) / (w - 1);
  double dy = (north - south) * DEG * EARTH_R / (hgt - 1);
  double cell = 0.5 * (dx + dy);

  for (int i = 0; i < n; i++) {
    float v = h[i];
    int ok = (!mask || mask[i]) && v == v && v > -12000.0f && v < 9000.0f;
    fix[i] = (u8)ok;
    if (!ok) invalid++;
  }

  if (flags & F_DESPIKE) {
    double floorM = w_max(5.0, cell);
    double nb[8];
    for (int y = 0; y < hgt; y++)
      for (int x = 0; x < w; x++) {
        int i = y * w + x;
        if (!fix[i]) continue;
        int c = 0;
        for (int a = -1; a <= 1; a++)
          for (int b = -1; b <= 1; b++) {
            if (!a && !b) continue;
            int xx = x + b, yy = y + a;
            if (xx < 0 || yy < 0 || xx >= w || yy >= hgt) continue;
            int j = yy * w + xx;
            if (fix[j]) nb[c++] = h[j];
          }
        if (c < 5) continue;
        sort9(nb, c);
        double med = c & 1 ? nb[c / 2] : 0.5 * (nb[c / 2 - 1] + nb[c / 2]);
        double dev[8];
        for (int k = 0; k < c; k++) dev[k] = w_fabs(nb[k] - med);
        sort9(dev, c);
        double mad = c & 1 ? dev[c / 2] : 0.5 * (dev[c / 2 - 1] + dev[c / 2]);
        if (w_fabs(h[i] - med) > w_max(4.0 * 1.4826 * mad, floorM)) {
          fix[i] = 0;
          spikes++;
        }
      }
  }

  if (invalid || spikes) membrane(h, fix, w, hgt);
  for (int i = 0; i < n; i++) fix[i] = 1;

  /* Bare-earth estimate only where cells are fine enough to resolve buildings and trees. */
  if ((flags & F_BARE) && cell <= 60.0) {
    float *open = (float *)walloc((u32)n * 4u);
    float *tmp = (float *)walloc((u32)n * 4u);
    float *ero = (float *)walloc((u32)n * 4u);
    float *slope = (float *)walloc((u32)n * 4u);
    u8 *cand = (u8 *)walloc((u32)n);
    for (int i = 0; i < n; i++) cand[i] = 0;

    static const int scales[4] = {1, 2, 3, 5};
    const double t0 = 1.5, kappa = 1.2, cap = 60.0;
    const double gentle = js_tan(10.0 * DEG);
    for (int si = 0; si < 4; si++) {
      int r = scales[si];
      if (r * cell > 160.0) break;
      minmax(h, ero, tmp, w, hgt, r, 1);
      minmax(ero, open, tmp, w, hgt, r, 0);
      /* Robust local slope of the opened surface (central differences, 3×3 mean). */
      for (int y = 0; y < hgt; y++)
        for (int x = 0; x < w; x++) {
          int xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
          int yu = y > 0 ? y - 1 : y, yd = y < hgt - 1 ? y + 1 : y;
          double gx = (open[y * w + xr] - open[y * w + xl]) / ((xr - xl) * dx + 1e-9);
          double gy = (open[yd * w + x] - open[yu * w + x]) / ((yd - yu) * dy + 1e-9);
          slope[y * w + x] = (float)w_sqrt(gx * gx + gy * gy);
        }
      for (int i = 0; i < n; i++) {
        /* Only on gentle ground: at these resolutions steep ridges look like objects. */
        if (slope[i] > gentle) continue;
        double res = h[i] - open[i];
        double t = t0 + kappa * r * cell * slope[i];
        if (res > t && res < cap) cand[i] = 1;
      }
    }

    /* Keep only object-like regions: abrupt boundary or tiny. */
    int *stack = (int *)walloc((u32)n * 4u);
    int *members = (int *)walloc((u32)n * 4u);
    u8 *seen = (u8 *)walloc((u32)n);
    for (int i = 0; i < n; i++) seen[i] = 0;
    const double steep = js_tan(25.0 * DEG);
    for (int s = 0; s < n; s++) {
      if (!cand[s] || seen[s]) continue;
      int sp = 0, count = 0;
      double edgeSum = 0;
      int edges = 0;
      stack[sp++] = s;
      seen[s] = 1;
      while (sp) {
        int i = stack[--sp];
        members[count++] = i;
        int x = i % w, y = i / w;
        int nb4[4] = {x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < hgt - 1 ? i + w : -1};
        double d4[4] = {dx, dx, dy, dy};
        for (int k = 0; k < 4; k++) {
          int j = nb4[k];
          if (j < 0) continue;
          if (cand[j]) {
            if (!seen[j]) { seen[j] = 1; stack[sp++] = j; }
          } else {
            edgeSum += (h[i] - h[j]) / d4[k];
            edges++;
          }
        }
      }
      double edgeSlope = edges ? edgeSum / edges : 0;
      if (count <= 4 || edgeSlope > steep) {
        for (int k = 0; k < count; k++) fix[members[k]] = 0;
        bare += count;
      }
    }
    if (bare) {
      for (int i = 0; i < n; i++) tmp[i] = h[i];
      membrane(h, fix, w, hgt);
      for (int i = 0; i < n; i++)
        if (h[i] > tmp[i]) h[i] = tmp[i]; /* never raise the ground */
    }
  }

  double sumN = 0;
  if (flags & F_GEOID) {
    /* N varies over hundreds of km: evaluate on a coarse 9×9 lattice, interpolate bilinearly. */
    const int L = 9;
    double lat[9], lon[9], N[81];
    double ms = js_log(js_tan(PI / 4 + south * DEG / 2)), mn = js_log(js_tan(PI / 4 + north * DEG / 2));
    for (int k = 0; k < L; k++) {
      double f = (double)k / (L - 1);
      lon[k] = west + f * (east - west);
      double my = mn + f * (ms - mn); /* row 0 = north */
      lat[k] = (2.0 * js_atan(js_exp(my)) - PI / 2) / DEG;
    }
    for (int a = 0; a < L; a++)
      for (int b = 0; b < L; b++) N[a * L + b] = geoid_n(lat[a], lon[b]);
    for (int y = 0; y < hgt; y++) {
      double fy = (double)y / (hgt - 1) * (L - 1);
      int a = (int)fy;
      if (a > L - 2) a = L - 2;
      double ty = fy - a;
      for (int x = 0; x < w; x++) {
        double fx = (double)x / (w - 1) * (L - 1);
        int b = (int)fx;
        if (b > L - 2) b = L - 2;
        double tx = fx - b;
        double v = (1 - ty) * ((1 - tx) * N[a * L + b] + tx * N[a * L + b + 1]) +
                   ty * ((1 - tx) * N[(a + 1) * L + b] + tx * N[(a + 1) * L + b + 1]);
        h[y * w + x] += (float)v;
        sumN += v;
      }
    }
  }

  stats[0] = invalid;
  stats[1] = spikes;
  stats[2] = bare;
  stats[3] = (flags & F_GEOID) ? sumN / n : 0;
  return 1;
}
