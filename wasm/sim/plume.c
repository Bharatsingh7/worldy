/*
 * Plumes and tracers.
 *
 * plume_step: a passive pollutant / smoke / ash concentration c (per m² column) carried by a
 *   uniform wind, spread by turbulent diffusion K and removed at rate λ (deposition / decay):
 *       ∂c/∂t + u·∇c = K∇²c − λc + S·δ(source)
 *   Advection is semi-Lagrangian (trace each cell back along the wind, bilinear sample — stable
 *   for any step), diffusion is explicit with automatic sub-steps (K·dt/Δ² ≤ 0.2).
 *
 * tracers_step: particles advected by a cell velocity field with midpoint (RK2) integration,
 *   respawned at random wet cells when they leave the grid or reach dry ground — used to animate
 *   flood currents and cyclone winds.
 */
#include "sim.h"

static inline double sample(const double *f, int w, int h, double fx, double fy) {
  if (fx < 0) fx = 0;
  if (fy < 0) fy = 0;
  if (fx > w - 1) fx = w - 1;
  if (fy > h - 1) fy = h - 1;
  int x0 = (int)fx, y0 = (int)fy;
  int x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  double tx = fx - x0, ty = fy - y0;
  return (1 - ty) * ((1 - tx) * f[y0 * w + x0] + tx * f[y0 * w + x1]) + ty * ((1 - tx) * f[y1 * w + x0] + tx * f[y1 * w + x1]);
}

/* One plume step. c and tmp are w×h; wind (ue east, vn north) m/s. Returns total mass. */
EXPORT(plume_step) double plume_step(double *c, double *tmp, int w, int h, double dx, double dy, double ue, double vn, double K,
                                     double lambda, int srcCell, double srcRate, double dt) {
  int n = w * h;
  /* advection: back-trace (grid y points south, so northward wind moves to smaller y) */
  double sx = ue * dt / dx, sy = -vn * dt / dy;
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) {
      double fx = x - sx, fy = y - sy;
      tmp[y * w + x] = (fx < -0.5 || fy < -0.5 || fx > w - 0.5 || fy > h - 0.5) ? 0.0 : sample(c, w, h, fx, fy);
    }
  /* diffusion with sub-steps */
  double lim = 0.2 * w_min(dx * dx, dy * dy) / w_max(K, 1e-9);
  int sub = (int)(dt / lim) + 1;
  double ds = dt / sub;
  for (int k = 0; k < sub; k++) {
    for (int y = 0; y < h; y++)
      for (int x = 0; x < w; x++) {
        int i = y * w + x;
        double cx = (x > 0 ? tmp[i - 1] : 0) + (x < w - 1 ? tmp[i + 1] : 0) - 2 * tmp[i];
        double cy = (y > 0 ? tmp[i - w] : 0) + (y < h - 1 ? tmp[i + w] : 0) - 2 * tmp[i];
        c[i] = tmp[i] + ds * K * (cx / (dx * dx) + cy / (dy * dy));
      }
    for (int i = 0; i < n; i++) tmp[i] = c[i];
  }
  double decay = js_exp(-lambda * dt), mass = 0;
  for (int i = 0; i < n; i++) {
    c[i] = tmp[i] * decay;
    if (c[i] < 0) c[i] = 0;
    mass += c[i] * dx * dy;
  }
  if (srcCell >= 0 && srcCell < n) {
    c[srcCell] += srcRate * dt / (dx * dy);
    mass += srcRate * dt;
  }
  return mass;
}

static u32 rng = 2463534242u;
static inline double rnd(void) {
  rng ^= rng << 13;
  rng ^= rng >> 17;
  rng ^= rng << 5;
  return (rng & 0xFFFFFF) / 16777216.0;
}

/*
 * Advance n tracers (grid coordinates px, py; age) through velocity u (east), v (south, grid
 * convention) in m/s; respawn where mask allows (mask[i] = 1 → may spawn/live there).
 */
EXPORT(tracers_step) void tracers_step(float *px, float *py, float *age, int n, const double *u, const double *v,
                                       const u8 *mask, int w, int h, double dx, double dy, double dt, double maxAge) {
  for (int k = 0; k < n; k++) {
    double x = px[k], y = py[k];
    int cell = (int)y * w + (int)x;
    int dead = age[k] > maxAge || x < 0 || y < 0 || x >= w - 1 || y >= h - 1 || !mask[cell];
    if (dead) {
      for (int tries = 0; tries < 20; tries++) {
        int c = (int)(rnd() * (w * h));
        if (mask[c]) {
          px[k] = (float)(c % w + rnd());
          py[k] = (float)(c / w + rnd());
          break;
        }
      }
      age[k] = (float)(rnd() * maxAge * 0.5);
      continue;
    }
    double u1 = sample(u, w, h, x - 0.5, y - 0.5), v1 = sample(v, w, h, x - 0.5, y - 0.5);
    double xm = x + 0.5 * dt * u1 / dx, ym = y + 0.5 * dt * v1 / dy;
    double u2 = sample(u, w, h, xm - 0.5, ym - 0.5), v2 = sample(v, w, h, xm - 0.5, ym - 0.5);
    px[k] = (float)(x + dt * u2 / dx);
    py[k] = (float)(y + dt * v2 / dy);
    age[k] += (float)dt;
  }
}
