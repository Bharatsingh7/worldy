/*
 * Wildfire spread: Rothermel (1972) rate of spread with wind and slope, elliptical fire shape
 * (Anderson 1983 length-to-breadth ratio), and fire arrival times from a minimum-travel-time
 * sweep (Dijkstra on a 16-direction stencil, as in FlamMap's MTT method) — the front is a
 * true anisotropic eikonal solution, not a cellular automaton's diamond or square.
 *
 * Fuels (Anderson's 13 NFFL models, 1-h dead fuel only, SI units):
 *   0 short grass (FM1), 1 tall grass (FM3), 2 chaparral (FM4), 3 brush (FM5),
 *   4 timber litter (FM8), 5 timber + understory (FM10)
 */
#include "sim.h"

typedef struct { double w0, sigma, depth, mx; } Fuel; /* load kg/m², SAV 1/m, depth m, extinction moisture */

static const Fuel FUELS[6] = {
  {0.166, 11483, 0.305, 0.12}, {0.675, 4921, 0.762, 0.25}, {1.123, 6562, 1.829, 0.20},
  {0.225, 6562, 0.610, 0.20},  {0.337, 6562, 0.061, 0.30}, {0.675, 6562, 0.305, 0.25},
};

/*
 * Rothermel rate of spread (m/min) for no wind/slope, plus the wind and slope factor coefficients.
 * out: [R0 m/s, C, B, E, beta/betaOp, packingTanCoef]
 */
static void rothermel(const Fuel *fu, double moisture, double *out) {
  const double h = 18608.0, rhoP = 512.0, St = 0.0555, Se = 0.010;
  double sigma = fu->sigma * 0.3048;            /* 1/m → 1/ft for the empirical fits */
  double w0 = fu->w0 * 0.2048;                  /* kg/m² → lb/ft² */
  double depth = fu->depth / 0.3048;            /* m → ft */
  double rhoPft = rhoP * 0.06243;               /* kg/m³ → lb/ft³ */
  double hft = h * 0.000430;                    /* kJ/kg → BTU/lb */
  double rhoB = w0 / depth;
  double beta = rhoB / rhoPft;
  double betaOp = 3.348 * js_pow(sigma, -0.8189);
  double A = 133.0 * js_pow(sigma, -0.7913);
  double gmax = js_pow(sigma, 1.5) / (495.0 + 0.0594 * js_pow(sigma, 1.5));
  double g = gmax * js_pow(beta / betaOp, A) * js_exp(A * (1.0 - beta / betaOp));
  double wn = w0 * (1.0 - St);
  double rm = w_min(1.0, moisture / fu->mx);
  double etaM = 1.0 - 2.59 * rm + 5.11 * rm * rm - 3.52 * rm * rm * rm;
  double etaS = w_min(1.0, 0.174 * js_pow(Se, -0.19));
  double IR = g * wn * hft * etaM * etaS;
  double xi = js_exp((0.792 + 0.681 * w_sqrt(sigma)) * (beta + 0.1)) / (192.0 + 0.2595 * sigma);
  double eps = js_exp(-138.0 / sigma);
  double Qig = 250.0 + 1116.0 * moisture;
  double R0 = IR * xi / (rhoB * eps * Qig); /* ft/min */
  out[0] = w_max(0.0, R0) * 0.3048 / 60.0;    /* m/s */
  out[1] = 7.47 * js_exp(-0.133 * js_pow(sigma, 0.55));
  out[2] = 0.02526 * js_pow(sigma, 0.54);
  out[3] = 0.715 * js_exp(-3.59e-4 * sigma);
  out[4] = beta / betaOp;
  out[5] = 5.275 * js_pow(beta, -0.3);
}

static const int OX[16] = {1, 1, 0, -1, -1, -1, 0, 1, 2, 1, -1, -2, -2, -1, 1, 2};
static const int OY[16] = {0, 1, 1, 1, 0, -1, -1, -1, 1, 2, 2, 1, -1, -2, -2, -1};

/*
 * Arrival time (s) of a fire lit at the ignition cells (ign[i] = 1) — NaN where it never arrives.
 * z: terrain (m), burnable[i] = 0 for water/roads/buildings, wind (m/s, 6 m) blowing towards
 * windToDeg (0 = north, 90 = east), fuel model, dead fuel moisture (fraction).
 * stats: [burned m², head ROS m/min, LB ratio, max arrival s]
 */
EXPORT(fire_spread) int fire_spread(const double *z, const u8 *burnable, const u8 *ign, int w, int hgt, double dx, double dy,
                                    double windSpeed, double windToDeg, int fuelModel, double moisture, double tMax, float *tArr,
                                    double *stats) {
  int n = w * hgt;
  double ros[6];
  rothermel(&FUELS[fuelModel < 0 || fuelModel > 5 ? 0 : fuelModel], moisture, ros);
  double R0 = ros[0], C = ros[1], B = ros[2], E = ros[3], ratio = ros[4];
  /* midflame wind ≈ 0.4 × 6 m wind; Rothermel's φw uses ft/min */
  double Umid = 0.4 * windSpeed * 196.85;
  double phiW = C * js_pow(w_max(Umid, 1e-6), B) * js_pow(ratio, -E);
  double Ump = 0.4 * windSpeed * 2.237; /* mph for Anderson's LB */
  double LB = w_min(8.0, 0.936 * js_exp(0.2566 * Ump) + 0.461 * js_exp(-0.1548 * Ump) - 0.397);
  if (LB < 1.0) LB = 1.0;
  double ecc = w_sqrt(1.0 - 1.0 / (LB * LB));
  double wdx = js_sin(windToDeg * DEG), wdy = -js_cos(windToDeg * DEG); /* grid y points south */

  double *t = (double *)walloc((u32)n * 8u);
  for (int i = 0; i < n; i++) t[i] = INF_D;
  Heap q;
  heap_init(&q, n * 16 + 16);
  for (int i = 0; i < n; i++)
    if (ign[i] && burnable[i]) { t[i] = 0; heap_push(&q, i, 0); }

  double headMax = 0;
  while (q.size) {
    double ti;
    int i = heap_pop(&q, &ti);
    if (ti > t[i] || ti > tMax) continue;
    int x = i % w, y = i / w;
    /* local slope (upslope direction) for φs */
    int xl = x > 0 ? i - 1 : i, xr = x < w - 1 ? i + 1 : i, yu = y > 0 ? i - w : i, yd = y < hgt - 1 ? i + w : i;
    double gx = (z[xr] - z[xl]) / ((xr - xl) * dx + 1e-9), gy = (z[yd] - z[yu]) / (((yd - yu) / w) * dy + 1e-9);
    double tanS = w_sqrt(gx * gx + gy * gy);
    double phiS = ros[5] * tanS * tanS;
    /* combine wind and slope as vectors (upslope = +gradient) */
    double vx = phiW * wdx + (tanS > 1e-9 ? phiS * gx / tanS : 0);
    double vy = phiW * wdy + (tanS > 1e-9 ? phiS * gy / tanS : 0);
    double phi = w_sqrt(vx * vx + vy * vy);
    double head = R0 * (1.0 + phi);
    if (head > headMax) headMax = head;
    double hx = phi > 1e-9 ? vx / phi : 1, hy = phi > 1e-9 ? vy / phi : 0;
    for (int k = 0; k < 16; k++) {
      int nx_ = x + OX[k], ny_ = y + OY[k];
      if (nx_ < 0 || ny_ < 0 || nx_ >= w || ny_ >= hgt) continue;
      int j = ny_ * w + nx_;
      if (!burnable[j]) continue;
      double ex = OX[k] * dx, ey = OY[k] * dy;
      double d = w_sqrt(ex * ex + ey * ey);
      double cosT = (ex * hx + ey * hy) / d;
      /* ellipse with the ignition at its rear focus: R(θ) = head·(1−e)/(1−e·cosθ) */
      double rate = head * (1.0 - ecc) / (1.0 - ecc * cosT);
      if (rate <= 1e-9) continue;
      double tj = ti + d / rate;
      if (tj < t[j]) { t[j] = tj; heap_push(&q, j, tj); }
    }
  }
  double burned = 0, tm = 0;
  for (int i = 0; i < n; i++) {
    if (t[i] <= tMax) {
      tArr[i] = (float)t[i];
      burned += dx * dy;
      if (t[i] > tm) tm = t[i];
    } else tArr[i] = __builtin_nanf("");
  }
  stats[0] = burned;
  stats[1] = headMax * 60.0;
  stats[2] = LB;
  stats[3] = tm;
  return 1;
}
