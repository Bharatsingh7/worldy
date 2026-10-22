/*
 * Worldy compute core — shared definitions.
 *
 * Freestanding C compiled straight to WebAssembly with clang (no libc, no Emscripten).
 * Transcendental maths comes from the host's JS Math; sqrt/floor/fabs are native wasm ops.
 * Memory: one bump allocator with mark/release so callers can free scratch space.
 */
#ifndef WORLDY_H
#define WORLDY_H

#define EXPORT(name) __attribute__((export_name(#name)))
#define IMPORT(name) __attribute__((import_module("env"), import_name(#name)))

typedef unsigned char u8;
typedef unsigned int u32;

IMPORT(sin) double js_sin(double);
IMPORT(cos) double js_cos(double);
IMPORT(tan) double js_tan(double);
IMPORT(asin) double js_asin(double);
IMPORT(acos) double js_acos(double);
IMPORT(atan) double js_atan(double);
IMPORT(atan2) double js_atan2(double, double);
IMPORT(exp) double js_exp(double);
IMPORT(log) double js_log(double);
IMPORT(pow) double js_pow(double, double);

static inline double w_sqrt(double x) { return __builtin_sqrt(x); }
static inline double w_fabs(double x) { return __builtin_fabs(x); }
static inline double w_floor(double x) { return __builtin_floor(x); }
static inline double w_fmod(double x, double y) { return x - __builtin_trunc(x / y) * y; }
static inline double w_min(double a, double b) { return a < b ? a : b; }
static inline double w_max(double a, double b) { return a > b ? a : b; }
static inline double w_clamp(double x, double lo, double hi) { return x < lo ? lo : (x > hi ? hi : x); }
static inline double w_log10(double x) { return js_log(x) * 0.43429448190325176; }

#define PI 3.14159265358979323846
#define TWO_PI (2.0 * PI)
#define DEG (PI / 180.0)
#define EARTH_R 6371008.8      /* mean radius, m */
#define WGS84_A 6378137.0
#define WGS84_E2 6.69437999014e-3
#define GRAVITY 9.80665
#define INF_D 1e300

/* memory.c */
void *walloc(u32 bytes);

/* geo.c — shared helpers */
double geo_distance(double lat1, double lon1, double lat2, double lon2);
void geodetic_to_ecef(double latDeg, double lonDeg, double h, double *out);

/* Tiny binary min-heap keyed by double, used by Dijkstra-style sweeps. */
typedef struct {
  int *idx;
  double *key;
  int size;
} Heap;

void heap_init(Heap *h, int capacity);
void heap_push(Heap *h, int i, double k);
int heap_pop(Heap *h, double *k);

#endif
