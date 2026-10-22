/*
 * Shallow-flow block update.
 *
 * Fluxes: HLLC Riemann solver on hydrostatically reconstructed states (Audusse et al. 2004),
 * which keeps a lake at rest exactly at rest over any bed and keeps depths non-negative.
 * Buildings: integral porosity — cell storage φ and face conveyance ψ = min(φL, φR); the wall
 * reaction g/2·h²·(φ − ψ) is folded into each side's momentum flux, so a pool at rest stays at
 * rest across porosity jumps too.
 * Positivity under local time stepping: outgoing mass of every donor cell is limited to the
 * water it holds ("draining time step", Bollermann et al. 2011).
 * Each face carries a time cursor; a face is integrated from its cursor to the end of whichever
 * adjacent block advances, so every instant of every face is counted exactly once (mass is
 * conserved to round-off with mixed step sizes — the refluxing idea of Berger & Colella).
 */
#include "sim.h"

#define OMEGA_EARTH 7.2921159e-5
#define RHO_AIR 1.225
#define RHO_SEA 1025.0
#define STEFAN 5.670374e-8

static inline double vel(double q, double h) { return h > H_DRY ? q / h : 0.0; }

/* Cube root without a JS import: bit-level initial guess + 3 Newton steps (≈1e-15 relative). */
static inline double cbrt_fast(double x) {
  if (x <= 0) return 0;
  union { double d; unsigned long long u; } v = {x};
  v.u = v.u / 3 + 0x2A9F7893782DA1CEULL;
  double y = v.d;
  y = y - (y * y * y - x) / (3.0 * y * y);
  y = y - (y * y * y - x) / (3.0 * y * y);
  y = y - (y * y * y - x) / (3.0 * y * y);
  return y;
}

/* HLLC flux for the x-normal problem: F = [mass, normal momentum, tangential momentum]. */
static void hllc(double g, double hL, double uL, double vL, double hR, double uR, double vR, double *F) {
  if (hL <= H_DRY && hR <= H_DRY) { F[0] = F[1] = F[2] = 0; return; }
  double cL = w_sqrt(g * hL), cR = w_sqrt(g * hR);
  double SL, SR;
  if (hL <= H_DRY) {
    SL = uR - 2.0 * cR;
    SR = uR + cR;
  } else if (hR <= H_DRY) {
    SL = uL - cL;
    SR = uL + 2.0 * cL;
  } else {
    SL = w_min(uL - cL, uR - cR);
    SR = w_max(uL + cL, uR + cR);
  }
  double FL0 = hL * uL, FL1 = hL * uL * uL + 0.5 * g * hL * hL;
  double FR0 = hR * uR, FR1 = hR * uR * uR + 0.5 * g * hR * hR;
  if (SL >= 0) { F[0] = FL0; F[1] = FL1; F[2] = FL0 * vL; return; }
  if (SR <= 0) { F[0] = FR0; F[1] = FR1; F[2] = FR0 * vR; return; }
  double den = SR - SL;
  F[0] = (SR * FL0 - SL * FR0 + SL * SR * (hR - hL)) / den;
  F[1] = (SR * FL1 - SL * FR1 + SL * SR * (hR * uR - hL * uL)) / den;
  double dS = hR * (uR - SR) - hL * (uL - SL);
  double Sstar = w_fabs(dS) > 1e-12 ? (SL * hR * (uR - SR) - SR * hL * (uL - SL)) / dS : 0.5 * (SL + SR);
  F[2] = F[0] * (Sstar >= 0 ? vL : vR);
}

/* Depth in the ghost cell beyond a domain edge (side 0 N, 1 E, 2 S, 3 W). */
static double ghost_depth(Sim *s, int c, int side) {
  return s->bc[side] == BC_LEVEL ? w_max(0.0, s->bcLevel[side] - s->z[c]) : s->h[c];
}

typedef struct {
  int L, R;          /* cell indices (−1 = ghost) */
  int dir;           /* 0 x-face, 1 y-face */
  double dur, len, inv;
  double F[3];       /* ψ·HLLC flux, in face-normal frame */
  double PL, PR;     /* pressure corrections per side (already × ψ / porosity reaction) */
  double TL, TR;     /* upwind temperature for heat transport */
  double *cursor;
} Face;

#define MAX_FACES (2 * (BS + 1) * BS)
static Face faces[MAX_FACES];
static double outflow[(BS + 2) * (BS + 2)];

static void build_face(Sim *s, Face *f, int L, int R, int dir, int sideL, int sideR) {
  double g = s->g;
  double hL, uL, vL, zL, phiL, hR, uR, vR, zR, phiR;
  /* States in the face frame: u = normal velocity, v = tangential. */
  if (L >= 0) {
    hL = s->h[L]; zL = s->z[L]; phiL = s->phi[L];
    uL = dir ? vel(s->qy[L], hL) : vel(s->qx[L], hL);
    vL = dir ? vel(s->qx[L], hL) : vel(s->qy[L], hL);
  }
  if (R >= 0) {
    hR = s->h[R]; zR = s->z[R]; phiR = s->phi[R];
    uR = dir ? vel(s->qy[R], hR) : vel(s->qx[R], hR);
    vR = dir ? vel(s->qx[R], hR) : vel(s->qy[R], hR);
  }
  /* Ghost cells: same bed; walls reflect the normal velocity, open/level edges copy it. */
  if (L < 0) {
    hL = ghost_depth(s, R, sideL); zL = zR; phiL = phiR; vL = vR;
    uL = s->bc[sideL] == BC_WALL ? -uR : uR;
  }
  if (R < 0) {
    hR = ghost_depth(s, L, sideR); zR = zL; phiR = phiL; vR = vL;
    uR = s->bc[sideR] == BC_WALL ? -uL : uL;
  }
  double psi = w_min(phiL, phiR);
  if (psi < 0.05) psi = 0; /* solid wall (fully built-up cell) */

  double zf = w_max(zL, zR);
  double hLs = w_max(0.0, hL + zL - zf), hRs = w_max(0.0, hR + zR - zf);
  double F[3];
  hllc(g, hLs, uL, vL, hRs, uR, vR, F);
  f->F[0] = psi * F[0];
  f->F[1] = psi * F[1];
  f->F[2] = psi * F[2];
  /*
   * Side momentum fluxes = ψF + hydrostatic-reconstruction correction + porosity wall reaction,
   * minus the cell's own hydrostatic pressure g/2·h²·φ. Subtracting a per-cell constant leaves
   * the cell's net update unchanged (it appears on both of its faces), but makes every face
   * contribute exactly zero at rest — so a block applying a shared face never leaves its
   * neighbour with half of a balanced pressure pair (essential with local time stepping).
   */
  f->PL = psi * 0.5 * g * (hL * hL - hLs * hLs) + 0.5 * g * hL * hL * (phiL - psi) - 0.5 * g * hL * hL * phiL;
  f->PR = psi * 0.5 * g * (hR * hR - hRs * hRs) + 0.5 * g * hR * hR * (phiR - psi) - 0.5 * g * hR * hR * phiR;
  if (s->temp) {
    f->TL = L >= 0 ? s->temp[L] : (R >= 0 ? s->temp[R] : 0);
    f->TR = R >= 0 ? s->temp[R] : f->TL;
  }
}

static inline void add_cell(Sim *s, int c, double sign, double scale, Face *f) {
  double phi = w_max(s->phi[c], 0.02);
  double k = sign * f->dur * f->inv / phi;
  double P = sign < 0 ? f->PL : f->PR;  /* left cell loses (sign −1) */
  double dm = k * scale * f->F[0];
  double dn = k * (scale * f->F[1] + P);
  double dt_ = k * scale * f->F[2];
  if (s->temp && dm > 0) {
    /* incoming lava mixes its temperature in (mass-weighted) */
    double Tin = f->F[0] >= 0 ? f->TL : f->TR;
    double hn = s->h[c] + dm;
    if (hn > H_DRY) s->temp[c] = (s->temp[c] * s->h[c] + Tin * dm) / hn;
  }
  s->h[c] += dm;
  if (s->h[c] < 0) s->h[c] = 0; /* round-off only; draining keeps it ≥ 0 */
  if (f->dir) {
    s->qy[c] += dn;
    s->qx[c] += dt_;
  } else {
    s->qx[c] += dn;
    s->qy[c] += dt_;
  }
}

/* Largest stable step for a block (CFL on the fastest wave). */
double sim_block_dt(Sim *s, int b) {
  int bx = b % s->bnx, by = b / s->bnx;
  int x0 = bx * BS, y0 = by * BS, x1 = w_min(x0 + BS, s->nx), y1 = w_min(y0 + BS, s->ny);
  double smax = 0;
  for (int y = y0; y < y1; y++)
    for (int x = x0; x < x1; x++) {
      int c = y * s->nx + x;
      double h = s->h[c];
      if (h <= H_DRY) continue;
      double c0 = w_sqrt(s->g * h);
      double su = w_fabs(s->qx[c] / h) + c0, sv = w_fabs(s->qy[c] / h) + c0;
      if (su / s->dx > smax) smax = su / s->dx;
      if (sv / s->dy > smax) smax = sv / s->dy;
    }
  if (smax <= 0) return s->dtMaxCap;
  return w_min(s->dtMaxCap, s->cfl / smax);
}

int sim_block_is_dry(Sim *s, int b) {
  int bx = b % s->bnx, by = b / s->bnx;
  int x0 = bx * BS, y0 = by * BS, x1 = w_min(x0 + BS, s->nx), y1 = w_min(y0 + BS, s->ny);
  for (int y = y0; y < y1; y++)
    for (int x = x0; x < x1; x++)
      if (s->h[y * s->nx + x] > H_DRY) return 0;
  return 1;
}

static void sources(Sim *s, int c, double dt, double t0) {
  double phi = w_max(s->phi[c], 0.02);
  double area = s->dx * s->dy;

  /* Rain falls on the whole cell; roofs drain into the open fraction. */
  if (s->rainRate > 0 && s->rainMul[c] > 0) {
    double dh = s->rainRate * s->rainMul[c] * dt;
    s->h[c] += dh / phi;
    s->rainIn += dh * area;
  }

  /* Green–Ampt infiltration: f = Ks·(1 + ψΔθ / F). */
  if (s->ks[c] > 0 && s->h[c] > 0) {
    double F = w_max(s->finf[c], 1e-3);
    double rate = s->ks[c] * (1.0 + s->psid[c] / F);
    double inf = w_min(rate * dt, s->h[c]);
    s->h[c] -= inf;
    s->finf[c] += inf;
    s->infiltrated += inf * phi * area;
  }

  double h = s->h[c];
  if (h <= H_DRY) {
    s->qx[c] = s->qy[c] = 0;
    return;
  }

  /* Wind stress (Garratt drag) and pressure gradient (inverse barometer) for storm surge. */
  if (s->wx) {
    double W = w_sqrt(s->wx[c] * s->wx[c] + s->wy[c] * s->wy[c]);
    if (W > 0 && h > 0.05) {
      double cd = w_min(0.0035, (0.75 + 0.067 * W) * 1e-3);
      double k = RHO_AIR / RHO_SEA * cd * W * dt;
      s->qx[c] += k * s->wx[c];
      s->qy[c] -= k * s->wy[c]; /* wy is northward; grid y points south */
    }
    int x = c % s->nx, y = c / s->nx;
    int xl = x > 0 ? c - 1 : c, xr = x < s->nx - 1 ? c + 1 : c;
    int yu = y > 0 ? c - s->nx : c, yd = y < s->ny - 1 ? c + s->nx : c;
    double gx = (s->dp[xr] - s->dp[xl]) / ((xr - xl) * s->dx + 1e-9);
    double gy = (s->dp[yd] - s->dp[yu]) / (((yd - yu) / s->nx) * s->dy + 1e-9);
    s->qx[c] -= dt * h * gx / RHO_SEA;
    s->qy[c] -= dt * h * gy / RHO_SEA;
  }

  /* Coriolis: exact rotation of the discharge vector (y south ⇒ sign flip). */
  if (s->coriolis) {
    double f = 2.0 * OMEGA_EARTH * js_sin(s->lat0 * DEG);
    double a = f * dt, ca = js_cos(a), sa = js_sin(a);
    double qx = s->qx[c], qn = -s->qy[c];
    s->qx[c] = ca * qx + sa * qn;
    s->qy[c] = -(-sa * qx + ca * qn);
  }

  /* Bed friction / rheology (semi-implicit, cannot reverse the flow). */
  double qx = s->qx[c], qy = s->qy[c];
  double q = w_sqrt(qx * qx + qy * qy);
  if (q <= 0) return;
  double u = q / h, scale = 1.0;
  switch (s->rheology) {
    case RHEO_VOELLMY: {
      double qc = w_max(0.0, q - dt * s->mu * s->g * h);
      scale = (qc / q) / (1.0 + dt * s->g * u / (s->xi * h));
      break;
    }
    case RHEO_BINGHAM:
    case RHEO_HB: {
      double tau = s->tauY, nu = s->nu;
      if (s->temp) {
        /* lava: viscosity and yield strength rise steeply as it cools towards the solidus */
        double cool = w_clamp((s->lavaT0 - s->temp[c]) / (s->lavaT0 - s->lavaTs), 0, 1);
        nu *= js_exp(6.0 * cool);
        tau *= js_exp(5.0 * cool);
        if (s->temp[c] <= s->lavaTs) tau = 1e9; /* solid */
      }
      double qc = w_max(0.0, q - dt * tau);
      double visc = s->rheology == RHEO_HB ? 3.0 * nu * js_pow(u / h, s->hbN - 1.0) : 3.0 * nu;
      scale = (qc / q) / (1.0 + dt * visc / (h * h));
      break;
    }
    default: {
      double n = s->manning[c];
      scale = 1.0 / (1.0 + dt * s->g * n * n * u / (h * cbrt_fast(h))); /* h^(4/3) */
    }
  }
  s->qx[c] = qx * scale;
  s->qy[c] = qy * scale;

  /* Lava cooling: radiation from the surface + conduction into the ground. */
  if (s->temp) {
    double TK = s->temp[c] + 273.15;
    double loss = (0.95 * STEFAN * (TK * TK * TK * TK - 300.0 * 300.0 * 300.0 * 300.0) + 40.0 * (s->temp[c] - 25.0));
    s->temp[c] -= dt * loss / (2600.0 * 1150.0 * w_max(h, 0.05));
    if (s->temp[c] < 25.0) s->temp[c] = 25.0;
  }

  if (s->h[c] > s->hmax[c]) s->hmax[c] = s->h[c];
  if (s->tArrive[c] < 0 && s->h[c] > 0.05) s->tArrive[c] = t0 + dt;
}

/* Advance block b from its current time to tEnd. */
void sim_block_advance(Sim *s, int b, double tEnd) {
  int nx = s->nx, ny = s->ny;
  int bx = b % s->bnx, by = b / s->bnx;
  int x0 = bx * BS, y0 = by * BS, x1 = w_min(x0 + BS, nx), y1 = w_min(y0 + BS, ny);
  int lw = (x1 - x0) + 2;
  int nf = 0;

  /* 1. Fluxes on every face touching the block, from its cursor to tEnd (states at start). */
  for (int y = y0; y < y1; y++)
    for (int x = x0; x <= x1; x++) {
      double *cur = &s->cx[y * (nx + 1) + x];
      double dur = tEnd - *cur;
      if (dur <= 0) continue;
      Face *f = &faces[nf++];
      int L = x > 0 ? y * nx + x - 1 : -1, R = x < nx ? y * nx + x : -1;
      f->L = L; f->R = R; f->dir = 0; f->dur = dur; f->inv = 1.0 / s->dx; f->len = s->dy; f->cursor = cur;
      build_face(s, f, L, R, 0, 3, 1);
    }
  for (int y = y0; y <= y1; y++)
    for (int x = x0; x < x1; x++) {
      double *cur = &s->cy[y * nx + x];
      double dur = tEnd - *cur;
      if (dur <= 0) continue;
      Face *f = &faces[nf++];
      int L = y > 0 ? (y - 1) * nx + x : -1, R = y < ny ? y * nx + x : -1;
      f->L = L; f->R = R; f->dir = 1; f->dur = dur; f->inv = 1.0 / s->dy; f->len = s->dx; f->cursor = cur;
      build_face(s, f, L, R, 1, 0, 2);
    }

  /* 2. Draining limiter: no donor cell may give away more water than it holds. */
  for (int i = 0; i < lw * ((y1 - y0) + 2); i++) outflow[i] = 0;
#define LOCAL(c) ((((c) / nx) - y0 + 1) * lw + (((c) % nx) - x0 + 1))
  for (int k = 0; k < nf; k++) {
    Face *f = &faces[k];
    double m = f->F[0] * f->dur * f->inv;
    int donor = m > 0 ? f->L : f->R;
    if (donor >= 0 && m != 0) outflow[LOCAL(donor)] += w_fabs(m) / w_max(s->phi[donor], 0.02);
  }
  /* 3. Apply. */
  for (int k = 0; k < nf; k++) {
    Face *f = &faces[k];
    double m = f->F[0];
    int donor = m > 0 ? f->L : f->R;
    double scale = 1.0;
    if (donor >= 0 && m != 0) {
      double out = outflow[LOCAL(donor)];
      if (out > s->h[donor]) scale = s->h[donor] / out;
    }
    if (f->L >= 0) add_cell(s, f->L, -1.0, scale, f);
    if (f->R >= 0) add_cell(s, f->R, +1.0, scale, f);
    /* domain boundary accounting (volume leaving through open / level edges) */
    if (f->L < 0) s->outflow -= scale * m * f->dur * f->len;
    if (f->R < 0) s->outflow += scale * m * f->dur * f->len;
    *f->cursor = tEnd;
  }
#undef LOCAL

  /* 4. Point inflows inside the block. */
  double dt = tEnd - s->bt[b];
  for (int k = 0; k < s->nIn; k++) {
    int c = s->inCell[k];
    int cx = c % nx, cy = c / nx;
    if (cx < x0 || cx >= x1 || cy < y0 || cy >= y1) continue;
    s->h[c] += s->inQ[k] * dt / (s->dx * s->dy * w_max(s->phi[c], 0.02));
    s->inflowIn += s->inQ[k] * dt;
    if (s->temp) s->temp[c] = s->lavaT0;
  }

  /* 5. Sources, friction, diagnostics. */
  for (int y = y0; y < y1; y++)
    for (int x = x0; x < x1; x++) sources(s, y * nx + x, dt, s->bt[b]);

  /* 6. Neighbouring blocks that received water wake up. */
  for (int k = 0; k < nf; k++) {
    Face *f = &faces[k];
    int other = -1;
    if (f->L >= 0 && (f->L % nx < x0 || f->L % nx >= x1 || f->L / nx < y0 || f->L / nx >= y1)) other = f->L;
    if (f->R >= 0 && (f->R % nx < x0 || f->R % nx >= x1 || f->R / nx < y0 || f->R / nx >= y1)) other = f->R;
    if (other >= 0 && s->h[other] > H_DRY) {
      int ob = ((other / nx) / BS) * s->bnx + (other % nx) / BS;
      if (!s->awake[ob]) sim_wake(s, ob, tEnd);
    }
  }
  s->dirty[b] = 1;
}
