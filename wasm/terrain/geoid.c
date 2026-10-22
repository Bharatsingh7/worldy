/*
 * EGM96 geoid undulation N(lat, lon): height of mean sea level above the WGS84 ellipsoid.
 *
 * Esri World Elevation heights are orthometric (above sea level); Cesium places everything
 * on the ellipsoid. Ellipsoidal height = orthometric height + N, with N between −107 m
 * (south of India) and +85 m (New Guinea), so ignoring it shifts terrain by tens of metres.
 *
 * Grid: 181 × 360 int16 centimetres, rows lat 90 → −90, columns lon −180 → 179
 * (downsampled from GeographicLib egm96-15). Interpolation: bicubic Catmull–Rom.
 */
#include "../worldy.h"

static const short *grid = 0;

EXPORT(geoid_set) void geoid_set(const short *g) { grid = g; }

static inline double node(int r, int c) {
  if (r < 0) r = 0;
  if (r > 180) r = 180;
  c = ((c % 360) + 360) % 360;
  return grid[r * 360 + c] * 0.01;
}

static inline double cubic(double p0, double p1, double p2, double p3, double t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/* Geoid undulation in metres (0 if the grid isn't loaded). */
EXPORT(geoid_n) double geoid_n(double latDeg, double lonDeg) {
  if (!grid) return 0;
  double fr = 90.0 - latDeg, fc = lonDeg + 180.0;
  int r = (int)w_floor(fr), c = (int)w_floor(fc);
  double tr = fr - r, tc = fc - c;
  double rows[4];
  for (int k = 0; k < 4; k++) {
    int rr = r - 1 + k;
    rows[k] = cubic(node(rr, c - 1), node(rr, c), node(rr, c + 1), node(rr, c + 2), tc);
  }
  return cubic(rows[0], rows[1], rows[2], rows[3], tr);
}
