/*
 * Worldy Physics Engine — shared state.
 *
 * A finite-volume shallow-flow solver on a uniform grid (row-major, row 0 = north,
 * x east, y south), advanced block by block by the event-driven local time stepping
 * scheduler (edlts.c). All quantities SI; state in double precision so mass is
 * conserved to round-off.
 */
#ifndef SIM_H
#define SIM_H
#include "../worldy.h"

#define BS 16              /* block size (cells) */
#define H_DRY 1e-4         /* below this depth a cell is dry (m) */
#define MAX_LEVEL 8        /* coarsest step = dt_base · 2^MAX_LEVEL */

enum Rheology { RHEO_WATER = 0, RHEO_VOELLMY = 1, RHEO_BINGHAM = 2, RHEO_HB = 3 };
enum Boundary { BC_WALL = 0, BC_OPEN = 1, BC_LEVEL = 2 };

typedef struct {
  int nx, ny, n;
  double dx, dy, lat0;          /* cell size (m), reference latitude for Coriolis */

  /* cell fields */
  double *z;                    /* bed elevation (m above sea level) */
  double *h, *qx, *qy;          /* depth and unit discharges */
  double *phi;                  /* storage porosity (1 open … 0 solid building) */
  double *manning;              /* Manning n (water) */
  double *rainMul;              /* spatial rain multiplier (0 = no rain here) */
  double *ks, *psid, *finf;     /* Green–Ampt: sat. conductivity (m/s), suction×Δθ (m), cumulative infiltration (m) */
  double *wx, *wy, *dp;         /* wind (m/s) at 10 m, pressure anomaly (Pa, negative in a cyclone) */
  double *temp;                 /* lava temperature (°C), optional */
  double *hmax, *tArrive;       /* diagnostics: peak depth, first wet time */

  /* face time cursors (EDLTS): x-faces (nx+1)·ny, y-faces nx·(ny+1) */
  double *cx, *cy;

  /* blocks */
  int bnx, bny, nb;
  double *bt, *bdt;             /* block time and current step */
  u8 *awake, *dirty;
  Heap queue;

  /* parameters */
  int rheology, lts, coriolis;
  double g, cfl, dtBase, dtMaxCap;
  double rainRate;              /* m/s, multiplied by rainMul */
  double mu, xi;                /* Voellmy */
  double tauY, nu, hbN;         /* Bingham / Herschel–Bulkley yield stress (Pa/ρ), viscosity (m²/s), HB exponent */
  double rho;                   /* flow density (kg/m³) */
  double lavaT0, lavaTs;        /* lava eruption and solidus temperature (°C) */
  int bc[4];                    /* N, E, S, W */
  double bcLevel[4];            /* water level for BC_LEVEL (m) */

  /* point inflows (rivers, dam breaks, vents) */
  int nIn;
  int inCell[16];
  double inQ[16];               /* m³/s */

  /* accounting */
  double rainIn, inflowIn, infiltrated, outflow, events, time;
} Sim;

/* swe.c */
void sim_block_advance(Sim *s, int b, double tEnd);
double sim_block_dt(Sim *s, int b);
int sim_block_is_dry(Sim *s, int b);
int sim_block_is_still(Sim *s, int b);

/* edlts.c */
void sim_wake(Sim *s, int b, double t);

#endif
