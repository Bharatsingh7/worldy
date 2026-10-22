/*
 * Landslide runout on a DEM — an empirical-energy-line model.
 *
 * 1. Volume V = release area × depth.
 * 2. Reach angle α from Scheidegger (1973): log10(H/L) = -0.15666·log10(V) + 0.62419
 *    (H = fall height, L = travel distance; big slides travel relatively further).
 * 3. Mass is routed cell by cell from the highest point downwards using multiple-flow-direction
 *    weights (Holmgren 1994, exponent 4). Flow may continue to a neighbour only while the
 *    energy line, falling at tan α per metre travelled, stays above the ground.
 * 4. Mass deposits where flow can't continue, plus partially on gentle slopes (< 15°).
 * 5. Deposits steeper than the angle of repose slump sideways (sandpile relaxation).
 *
 * out deposit: thickness (m) per cell. stats:
 *   [volume m³, H/L, reach angle °, affected area m², runout beyond release m, max deposit m, mass leaving grid m³]
 */
#include "worldy.h"

EXPORT(ls_run) int ls_run(const float *h, int w, int hgt, double dx, double dy, const u8 *release, double depth,
                          float *deposit, double *stats) {
  int n = w * hgt;
  double area = dx * dy;
  double *mass = (double *)walloc((u32)n * 8u);
  double *energy = (double *)walloc((u32)n * 8u);
  u8 *touched = (u8 *)walloc((u32)n);
  double volume = 0;

  for (int i = 0; i < n; i++) {
    mass[i] = 0;
    energy[i] = -INF_D;
    touched[i] = 0;
    deposit[i] = 0;
    if (release[i]) {
      mass[i] = depth * area;
      energy[i] = h[i] + depth;
      touched[i] = 1;
      volume += depth * area;
    }
  }
  if (volume <= 0) return 0;

  double hl = js_pow(10.0, -0.15666 * w_log10(volume) + 0.62419);
  hl = w_clamp(hl, 0.05, 1.2);

  /* Visit cells from highest to lowest so every inflow is known before a cell routes onwards. */
  Heap order;
  heap_init(&order, n);
  for (int i = 0; i < n; i++) heap_push(&order, i, -(double)h[i]);

  static const int ox[8] = {-1, 0, 1, -1, 1, -1, 0, 1};
  static const int oy[8] = {-1, -1, -1, 0, 0, 1, 1, 1};
  double gentle = js_tan(15.0 * DEG);
  double lost = 0;

  while (order.size) {
    double key;
    int i = heap_pop(&order, &key);
    if (mass[i] <= 0) continue;
    int x = i % w, y = i / w;
    double wsum = 0, wts[8], steep = 0;
    int nb[8];
    for (int k = 0; k < 8; k++) {
      nb[k] = -1;
      wts[k] = 0;
      int nx = x + ox[k], ny = y + oy[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= hgt) {
        continue;
      }
      int j = ny * w + nx;
      double d = w_sqrt((ox[k] * dx) * (ox[k] * dx) + (oy[k] * dy) * (oy[k] * dy));
      double drop = h[i] - h[j];
      if (drop <= 0) continue;
      double e = energy[i] - d * hl;
      if (e <= h[j]) continue;
      double tb = drop / d;
      if (tb > steep) steep = tb;
      nb[k] = j;
      wts[k] = tb * tb * tb * tb;
      wsum += wts[k];
    }

    /* Edge cells on a downhill run lose their mass off-grid. */
    int edge = x == 0 || y == 0 || x == w - 1 || y == hgt - 1;
    if (wsum <= 0) {
      if (edge && energy[i] - h[i] > 0 && !release[i]) { lost += mass[i]; mass[i] = 0; continue; }
      deposit[i] += (float)(mass[i] / area);
      continue;
    }

    /* Gentle ground holds back part of the passing mass (spreads the deposit fan). */
    double keep = steep < gentle ? 0.2 * (1.0 - steep / gentle) : 0.0;
    deposit[i] += (float)(mass[i] * keep / area);
    double moving = mass[i] * (1.0 - keep);
    for (int k = 0; k < 8; k++) {
      int j = nb[k];
      if (j < 0) continue;
      double d = w_sqrt((ox[k] * dx) * (ox[k] * dx) + (oy[k] * dy) * (oy[k] * dy));
      mass[j] += moving * wts[k] / wsum;
      double e = energy[i] - d * hl;
      if (e > energy[j]) energy[j] = e;
      touched[j] = 1;
    }
  }

  /*
   * Deposit relaxation: debris piles steeper than its angle of repose (~12° for wet
   * debris fans) slump onto neighbours. A few sandpile passes spread the deposit
   * sideways the way real debris flows fan out.
   */
  double repose = js_tan(12.0 * DEG);
  for (int pass = 0; pass < 60; pass++) {
    int moved = 0;
    for (int i = 0; i < n; i++) {
      if (deposit[i] <= 0.01f) continue;
      int x = i % w, y = i / w;
      for (int k = 0; k < 8; k++) {
        int nx = x + ox[k], ny = y + oy[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= hgt) continue;
        int j = ny * w + nx;
        double d = w_sqrt((ox[k] * dx) * (ox[k] * dx) + (oy[k] * dy) * (oy[k] * dy));
        double excess = (h[i] + deposit[i]) - (h[j] + deposit[j]) - repose * d;
        if (excess <= 0.01) continue;
        double give = w_min(excess / 4.0, deposit[i]);
        deposit[i] -= (float)give;
        deposit[j] += (float)give;
        touched[j] = 1;
        moved = 1;
      }
    }
    if (!moved) break;
  }

  /*
   * Runout = straight-line reach beyond the release area: farthest affected cell from the
   * release centroid, minus the release area's equivalent radius.
   */
  double cx = 0, cy = 0, rc = 0;
  for (int i = 0; i < n; i++)
    if (release[i]) { cx += (i % w) * dx; cy += (i / w) * dy; rc++; }
  cx /= rc;
  cy /= rc;
  double releaseRadius = w_sqrt(rc * area / PI);
  double affected = 0, runout = 0, maxDep = 0;
  for (int i = 0; i < n; i++) {
    if (!touched[i] && deposit[i] <= 0) continue;
    affected += area;
    double ex = (i % w) * dx - cx, ey = (i / w) * dy - cy;
    double reach = w_sqrt(ex * ex + ey * ey) - releaseRadius;
    if (reach > runout) runout = reach;
    if (deposit[i] > maxDep) maxDep = deposit[i];
  }
  stats[0] = volume;
  stats[1] = hl;
  stats[2] = js_atan(hl) / DEG;
  stats[3] = affected;
  stats[4] = runout;
  stats[5] = maxDep;
  stats[6] = lost;
  return 1;
}
