/*
 * Okada (1985) surface deformation of an elastic half-space by a finite rectangular fault —
 * the standard initial condition for earthquake tsunamis (seafloor uplift ≈ initial sea surface).
 *
 * okada_uz_raw: Okada's own frame — x along strike, y perpendicular, d = depth of the fault's
 *   lower edge reference, dip δ, length L, width W; U1 strike-slip, U2 dip-slip, U3 tensile.
 * okada_grid: a fault given by its centroid (lat, lon, depth), strike, dip, rake, slip, L, W
 *   is evaluated on a lon/lat grid (local tangent-plane metres).
 */
#include "sim.h"

#define NU 0.25 /* Poisson's ratio */

static double I4(double db, double eta, double q, double sd, double cd, double R) {
  if (w_fabs(cd) > 1e-6) return (1.0 - 2.0 * NU) / cd * (js_log(R + db) - sd * js_log(R + eta));
  return -(1.0 - 2.0 * NU) * q / (R + db);
}

static double I5(double xi, double eta, double q, double sd, double cd, double R, double db) {
  double X = w_sqrt(xi * xi + q * q);
  if (w_fabs(xi) < 1e-12) return 0;
  if (w_fabs(cd) > 1e-6)
    return (1.0 - 2.0 * NU) * 2.0 / cd * js_atan((eta * (X + q * cd) + X * (R + X) * sd) / (xi * (R + X) * cd));
  return -(1.0 - 2.0 * NU) * xi * sd / (R + db);
}

static double atn(double xi, double eta, double q, double R) {
  if (w_fabs(q) < 1e-12) return 0;
  return js_atan(xi * eta / (q * R));
}

static double uz_ss(double xi, double eta, double q, double sd, double cd) {
  double R = w_sqrt(xi * xi + eta * eta + q * q);
  double db = eta * sd - q * cd;
  return db * q / (R * (R + eta)) + q * sd / (R + eta) + I4(db, eta, q, sd, cd, R) * sd;
}

static double uz_ds(double xi, double eta, double q, double sd, double cd) {
  double R = w_sqrt(xi * xi + eta * eta + q * q);
  double db = eta * sd - q * cd;
  return db * q / (R * (R + xi)) + sd * atn(xi, eta, q, R) - I5(xi, eta, q, sd, cd, R, db) * sd * cd;
}

static double uz_tf(double xi, double eta, double q, double sd, double cd) {
  double R = w_sqrt(xi * xi + eta * eta + q * q);
  double db = eta * sd - q * cd;
  double yb = eta * cd + q * sd;
  return yb * q / (R * (R + xi)) + cd * (xi * q / (R * (R + eta)) - atn(xi, eta, q, R)) - I5(xi, eta, q, sd, cd, R, db) * sd * sd;
}

typedef double (*Kernel)(double, double, double, double, double);

/* Chinnery's notation: f(x,p) − f(x,p−W) − f(x−L,p) + f(x−L,p−W) */
static double chinnery(Kernel f, double x, double p, double L, double W, double q, double sd, double cd) {
  return f(x, p, q, sd, cd) - f(x, p - W, q, sd, cd) - f(x - L, p, q, sd, cd) + f(x - L, p - W, q, sd, cd);
}

EXPORT(okada_uz_raw) double okada_uz_raw(double x, double y, double d, double dipDeg, double L, double W, double U1, double U2, double U3) {
  double dip = dipDeg * DEG, sd = js_sin(dip), cd = js_cos(dip);
  double p = y * cd + d * sd;
  double q = y * sd - d * cd;
  return -U1 / TWO_PI * chinnery(uz_ss, x, p, L, W, q, sd, cd) - U2 / TWO_PI * chinnery(uz_ds, x, p, L, W, q, sd, cd) +
         U3 / TWO_PI * chinnery(uz_tf, x, p, L, W, q, sd, cd);
}

/*
 * Vertical seafloor displacement (m) on a w×h grid over [west..east]×[south..north] (row 0 north).
 * Fault: centroid lat/lon, centroid depth (m), strike/dip/rake (deg), slip (m), length/width (m).
 * Returns the maximum uplift.
 */
EXPORT(okada_grid) double okada_grid(double lat0, double lon0, double depth, double strikeDeg, double dipDeg, double rakeDeg,
                                      double slip, double L, double W, double west, double south, double east, double north,
                                      int w, int h, float *out) {
  double st = strikeDeg * DEG, dip = dipDeg * DEG, rake = rakeDeg * DEG;
  double U1 = js_cos(rake) * slip, U2 = js_sin(rake) * slip;
  /* Okada's reference point: lower-left corner along strike; d = depth of the lower edge */
  double d = depth + js_sin(dip) * W / 2.0;
  double maxUp = -1e9;
  for (int r = 0; r < h; r++) {
    double lat = north - (r + 0.5) * (north - south) / h;
    double N = (lat - lat0) * DEG * EARTH_R;
    for (int c = 0; c < w; c++) {
      double lon = west + (c + 0.5) * (east - west) / w;
      double E = (lon - lon0) * DEG * EARTH_R * js_cos(lat0 * DEG);
      double x = js_cos(st) * N + js_sin(st) * E + L / 2.0;
      double y = js_sin(st) * N - js_cos(st) * E + js_cos(dip) * W / 2.0;
      double uz = okada_uz_raw(x, y, d, dipDeg, L, W, U1, U2, 0);
      out[r * w + c] = (float)uz;
      if (uz > maxUp) maxUp = uz;
    }
  }
  return maxUp;
}
