/*
 * Flood fill ("bathtub" model with connectivity).
 *
 * Sea-level rise: water starts from the sea (cells ≤ 0 m) and fills every connected cell
 * lower than the new sea level. Local flood: starts from a chosen cell instead, filling
 * connected ground below (that cell's height + rise). Water doesn't jump over ridges.
 *
 * out depth (m). stats: [flooded area m², max depth m, cells].
 */
#include "worldy.h"

EXPORT(fl_fill) int fl_fill(const float *h, int w, int hgt, double dx, double dy, double rise, int seedX, int seedY,
                            float *depth, double *stats) {
  int n = w * hgt;
  int *stack = (int *)walloc((u32)n * 4u);
  u8 *seen = (u8 *)walloc((u32)n);
  int sp = 0;
  double level = rise;
  for (int i = 0; i < n; i++) { depth[i] = 0; seen[i] = 0; }

  if (seedX >= 0 && seedY >= 0 && seedX < w && seedY < hgt) {
    int s = seedY * w + seedX;
    level = h[s] + rise;
    stack[sp++] = s;
    seen[s] = 1;
  } else {
    for (int i = 0; i < n; i++)
      if (h[i] <= 0) { stack[sp++] = i; seen[i] = 1; }
  }

  double area = 0, maxDepth = 0;
  int cells = 0;
  while (sp) {
    int i = stack[--sp];
    double dep = level - h[i];
    if (dep > 0 && (seedX >= 0 || h[i] > 0)) {
      depth[i] = (float)dep;
      area += dx * dy;
      if (dep > maxDepth) maxDepth = dep;
      cells++;
    }
    int x = i % w, y = i / w;
    int nbr[4] = {x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < hgt - 1 ? i + w : -1};
    for (int k = 0; k < 4; k++) {
      int j = nbr[k];
      if (j < 0 || seen[j] || h[j] >= level) continue;
      seen[j] = 1;
      stack[sp++] = j;
    }
  }
  stats[0] = area;
  stats[1] = maxDepth;
  stats[2] = cells;
  return cells;
}
