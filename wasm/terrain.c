/*
 * Elevation-grid analysis and raster colouring.
 *
 * Grids are row-major float32, row 0 = north, w columns west→east,
 * cell size dx (east-west) × dy (north-south) in metres.
 */
#include "worldy.h"

/* Statistics over masked cells → out [min, max, mean, std]. Returns cell count. */
EXPORT(ter_stats) int ter_stats(const float *h, const u8 *mask, int n, double *out) {
  double mn = INF_D, mx = -INF_D, sum = 0, sq = 0;
  int c = 0;
  for (int i = 0; i < n; i++) {
    if (mask && !mask[i]) continue;
    double v = h[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
    sq += v * v;
    c++;
  }
  double mean = c ? sum / c : 0;
  out[0] = c ? mn : 0;
  out[1] = c ? mx : 0;
  out[2] = mean;
  out[3] = c ? w_sqrt(w_max(0.0, sq / c - mean * mean)) : 0;
  return c;
}

static inline float at(const float *h, int w, int hgt, int x, int y) {
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x >= w) x = w - 1;
  if (y >= hgt) y = hgt - 1;
  return h[y * w + x];
}

/* Horn's method: slope (rad) and aspect (rad, clockwise from north) at a cell. */
static void slope_aspect(const float *h, int w, int hgt, int x, int y, double dx, double dy, double *slope, double *aspect) {
  double a = at(h, w, hgt, x - 1, y - 1), b = at(h, w, hgt, x, y - 1), c = at(h, w, hgt, x + 1, y - 1);
  double d = at(h, w, hgt, x - 1, y), f = at(h, w, hgt, x + 1, y);
  double g = at(h, w, hgt, x - 1, y + 1), i = at(h, w, hgt, x, y + 1), j = at(h, w, hgt, x + 1, y + 1);
  double dzdx = ((c + 2 * f + j) - (a + 2 * d + g)) / (8 * dx);
  double dzdy = ((g + 2 * i + j) - (a + 2 * b + c)) / (8 * dy); /* +y = south */
  *slope = js_atan(w_sqrt(dzdx * dzdx + dzdy * dzdy));
  *aspect = js_atan2(dzdx, dzdy); /* downslope direction */
}

/* Slope in degrees for every cell. */
EXPORT(ter_slope) void ter_slope(const float *h, int w, int hgt, double dx, double dy, float *out) {
  double s, a;
  for (int y = 0; y < hgt; y++)
    for (int x = 0; x < w; x++) {
      slope_aspect(h, w, hgt, x, y, dx, dy, &s, &a);
      out[y * w + x] = (float)(s / DEG);
    }
}

/* ── Colour ramps ─────────────────────────────────────── */

typedef struct { double t; u8 r, g, b; } Stop;

static const Stop ELEV[] = {
  {0.00, 26, 152, 80}, {0.20, 145, 207, 96}, {0.40, 217, 239, 139}, {0.55, 254, 224, 139},
  {0.70, 216, 179, 101}, {0.85, 140, 109, 49}, {1.00, 255, 255, 255},
};
static const Stop HEAT[] = { {0.0, 255, 237, 160}, {0.4, 254, 178, 76}, {0.7, 240, 59, 32}, {1.0, 128, 0, 38} };
static const Stop WATER[] = { {0.0, 198, 219, 239}, {0.4, 107, 174, 214}, {0.7, 33, 113, 181}, {1.0, 8, 48, 107} };
static const Stop TIME[] = { {0.0, 253, 231, 37}, {0.33, 53, 183, 121}, {0.66, 49, 104, 142}, {1.0, 68, 1, 84} };

static void ramp(const Stop *s, int n, double t, u8 *rgb) {
  t = w_clamp(t, 0, 1);
  int k = 0;
  while (k < n - 2 && t > s[k + 1].t) k++;
  double f = (t - s[k].t) / (s[k + 1].t - s[k].t);
  f = w_clamp(f, 0, 1);
  rgb[0] = (u8)(s[k].r + f * (s[k + 1].r - s[k].r));
  rgb[1] = (u8)(s[k].g + f * (s[k + 1].g - s[k].g));
  rgb[2] = (u8)(s[k].b + f * (s[k + 1].b - s[k].b));
}

/* Hypsometric colours × hillshade (sun from NW, 45°), transparent outside the mask. */
EXPORT(ter_render) void ter_render(const float *h, const u8 *mask, int w, int hgt, double dx, double dy, double minH,
                                   double maxH, u8 *rgba) {
  const double zen = 45.0 * DEG, az = 315.0 * DEG;
  double range = maxH - minH > 1 ? maxH - minH : 1;
  for (int y = 0; y < hgt; y++)
    for (int x = 0; x < w; x++) {
      int i = y * w + x;
      u8 *o = rgba + 4 * i;
      if (mask && !mask[i]) { o[0] = o[1] = o[2] = o[3] = 0; continue; }
      double s, a;
      slope_aspect(h, w, hgt, x, y, dx, dy, &s, &a);
      double shade = js_cos(zen) * js_cos(s) + js_sin(zen) * js_sin(s) * js_cos(az - a);
      double k = 0.5 + 0.5 * w_clamp(shade, 0, 1);
      u8 rgb[3];
      if (h[i] <= 0) { rgb[0] = 44; rgb[1] = 127; rgb[2] = 184; }
      else ramp(ELEV, 7, (h[i] - minH) / range, rgb);
      o[0] = (u8)(rgb[0] * k);
      o[1] = (u8)(rgb[1] * k);
      o[2] = (u8)(rgb[2] * k);
      o[3] = 210;
    }
}

/* Colour a value grid (palette 1 heat, 2 water, 3 time). Values ≤ 0 or NaN are transparent. */
EXPORT(ras_colorize) void ras_colorize(const float *v, int n, double vmin, double vmax, int palette, u8 *rgba) {
  const Stop *p = palette == 2 ? WATER : palette == 3 ? TIME : HEAT;
  double range = vmax - vmin > 1e-9 ? vmax - vmin : 1;
  for (int i = 0; i < n; i++) {
    u8 *o = rgba + 4 * i;
    float x = v[i];
    if (!(x > 0)) { o[0] = o[1] = o[2] = o[3] = 0; continue; }
    ramp(p, 4, (x - vmin) / range, o);
    o[3] = 200;
  }
}

/*
 * Viewshed: which cells can be seen from (ox, oy) with the eye obsH metres above ground,
 * looking at targets targetH above ground. out[i] = 1 visible. Returns visible count.
 */
EXPORT(ter_viewshed) int ter_viewshed(const float *h, int w, int hgt, double dx, double dy, int ox, int oy, double obsH,
                                      double targetH, u8 *out) {
  double eye = h[oy * w + ox] + obsH;
  int count = 0;
  for (int y = 0; y < hgt; y++)
    for (int x = 0; x < w; x++) {
      int i = y * w + x;
      double ddx = (x - ox) * dx, ddy = (y - oy) * dy;
      double dist = w_sqrt(ddx * ddx + ddy * ddy);
      if (dist < 1e-6) { out[i] = 1; count++; continue; }
      double target = (h[i] + targetH - eye) / dist;
      int steps = (int)(w_max(w_fabs((double)(x - ox)), w_fabs((double)(y - oy))) * 2);
      u8 vis = 1;
      for (int k = 1; k < steps; k++) {
        double f = (double)k / steps;
        int sx = ox + (int)((x - ox) * f + 0.5), sy = oy + (int)((y - oy) * f + 0.5);
        double sd = dist * f;
        /* earth curvature drop over sd */
        double drop = sd * sd / (2 * EARTH_R);
        if ((h[sy * w + sx] - drop - eye) / sd > target) { vis = 0; break; }
      }
      out[i] = vis;
      count += vis;
    }
  return count;
}
