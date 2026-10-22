/*
 * Tropical cyclone forcing: wind, pressure and rain fields for the shallow-water solver.
 *
 *  Pressure (Holland 1980):  p(r) = pc + Δp·exp(−(Rmax/r)^B)
 *  Gradient wind:            Vg = sqrt(B·Δp/ρa·(Rmax/r)^B·exp(−(Rmax/r)^B) + (rf/2)²) − rf/2
 *  Surface wind:             0.8·Vg, turned 20° inward (frictional inflow), plus half the
 *                            storm's forward motion (translation asymmetry, strongest on the right
 *                            of the track in the northern hemisphere).
 *  Rmax, B (Vickery & Wadhera 2008):  ln Rmax = 3.015 − 6.291e−5·Δp² + 0.0337·|lat|,
 *                                      B = 1.881 − 0.00557·Rmax − 0.01295·|lat|
 *  Rain (R-CLIPER, Tuleya et al. 2007): linear rise to Tm at rm, exponential decay beyond.
 */
#include "sim.h"

#define RHO_A 1.15
#define OMEGA 7.2921159e-5

/* Radius of maximum wind (km) and Holland B for a pressure deficit Δp (hPa) at latitude lat. */
EXPORT(cyc_params) void cyc_params(double dpHpa, double lat, double *out) {
  double rmax = js_exp(3.015 - 6.291e-5 * dpHpa * dpHpa + 0.0337 * w_fabs(lat));
  double B = w_clamp(1.881 - 0.00557 * rmax - 0.01295 * w_fabs(lat), 0.8, 2.5);
  out[0] = rmax;
  out[1] = B;
}

/*
 * Fields on a grid (row 0 north): wind east/north (m/s), pressure anomaly (Pa), rain (mm/h).
 * Storm centre (clat, clon), Δp (hPa), Rmax (km), B, forward motion (m/s east, north).
 * Returns the maximum surface wind (m/s).
 */
EXPORT(cyc_fields) double cyc_fields(double clat, double clon, double dpHpa, double rmaxKm, double B, double vtx, double vty,
                                     double west, double south, double east, double north, int w, int h, double *wx,
                                     double *wy, double *dp, double *rain) {
  double dP = dpHpa * 100.0, Rm = rmaxKm * 1000.0;
  double f = 2.0 * OMEGA * js_sin(w_fabs(clat) * DEG);
  double hemi = clat >= 0 ? 1.0 : -1.0;
  double inflow = 20.0 * DEG;
  double vmax = 0;
  /* R-CLIPER intensity scaling from the Holland maximum wind (in knots) */
  double vgMax = w_sqrt(B * dP / (RHO_A * 2.718281828));
  double U = 1.0 + (0.8 * vgMax * 1.944 - 35.0) / 33.0;
  double T0 = (-1.10 + 3.96 * U) * 25.4 / 24.0, Tm = (-1.60 + 4.80 * U) * 25.4 / 24.0;
  double rm = (64.5 - 13.0 * U) * 1000.0, re = (150.0 - 16.0 * U) * 1000.0;
  if (rm < 20000) rm = 20000;
  if (re < 60000) re = 60000;
  for (int r = 0; r < h; r++) {
    double lat = north - (r + 0.5) * (north - south) / h;
    double dy = (lat - clat) * DEG * EARTH_R;
    for (int c = 0; c < w; c++) {
      int i = r * w + c;
      double lon = west + (c + 0.5) * (east - west) / w;
      double dx = (lon - clon) * DEG * EARTH_R * js_cos(clat * DEG);
      double R = w_sqrt(dx * dx + dy * dy);
      if (R < 1000) R = 1000;
      double x = js_pow(Rm / R, B);
      double ex = js_exp(-x);
      dp[i] = -dP * (1.0 - ex); /* p − p_env = −Δp·(1 − e^{−x}) */
      double vg = w_sqrt(B * dP / RHO_A * x * ex + (R * f / 2) * (R * f / 2)) - R * f / 2;
      double vs = 0.8 * vg;
      /* cyclonic rotation: counter-clockwise in the north, turned inward by the inflow angle */
      double ux = -dy / R, uy = dx / R; /* unit tangential (CCW) */
      double ix = -dx / R, iy = -dy / R; /* unit inward */
      double tx = hemi * ux, ty = hemi * uy;
      double ex2 = js_cos(inflow) * tx + js_sin(inflow) * ix;
      double ey2 = js_cos(inflow) * ty + js_sin(inflow) * iy;
      double decay = js_exp(-R / (8.0 * Rm)); /* forward-motion boost fades away from the core */
      wx[i] = vs * ex2 + 0.5 * vtx * decay;
      wy[i] = vs * ey2 + 0.5 * vty * decay;
      double sp = w_sqrt(wx[i] * wx[i] + wy[i] * wy[i]);
      if (sp > vmax) vmax = sp;
      if (rain) rain[i] = R < rm ? T0 + (Tm - T0) * (R / rm) : Tm * js_exp(-(R - rm) / re);
    }
  }
  return vmax;
}
