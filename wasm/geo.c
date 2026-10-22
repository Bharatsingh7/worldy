/*
 * Geodesy: distances, polygon area/perimeter, point-in-polygon, raster masks,
 * and batch dead-reckoning of moving objects straight to ECEF coordinates.
 *
 * Polygons are flat arrays [lon0, lat0, lon1, lat1, ...] in degrees.
 */
#include "worldy.h"

EXPORT(geo_distance) double geo_distance(double lat1, double lon1, double lat2, double lon2) {
  double p1 = lat1 * DEG, p2 = lat2 * DEG;
  double dp = (lat2 - lat1) * DEG, dl = (lon2 - lon1) * DEG;
  double s1 = js_sin(dp / 2), s2 = js_sin(dl / 2);
  double a = s1 * s1 + js_cos(p1) * js_cos(p2) * s2 * s2;
  return 2.0 * EARTH_R * js_asin(w_sqrt(w_min(1.0, a)));
}

EXPORT(geo_bearing) double geo_bearing(double lat1, double lon1, double lat2, double lon2) {
  double p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  double y = js_sin(dl) * js_cos(p2);
  double x = js_cos(p1) * js_sin(p2) - js_sin(p1) * js_cos(p2) * js_cos(dl);
  return w_fmod(js_atan2(y, x) / DEG + 360.0, 360.0);
}

/* Point reached from (lat, lon) after distM along bearing; writes out[0]=lat, out[1]=lon. */
static void destination(double lat, double lon, double bearingDeg, double distM, double *out) {
  double d = distM / EARTH_R, b = bearingDeg * DEG;
  double p1 = lat * DEG, l1 = lon * DEG;
  double sp1 = js_sin(p1), cp1 = js_cos(p1), sd = js_sin(d), cd = js_cos(d);
  double p2 = js_asin(sp1 * cd + cp1 * sd * js_cos(b));
  double l2 = l1 + js_atan2(js_sin(b) * sd * cp1, cd - sp1 * js_sin(p2));
  out[0] = p2 / DEG;
  out[1] = w_fmod(l2 / DEG + 540.0, 360.0) - 180.0;
}

void geodetic_to_ecef(double latDeg, double lonDeg, double h, double *out) {
  double p = latDeg * DEG, l = lonDeg * DEG;
  double sp = js_sin(p), cp = js_cos(p);
  double n = WGS84_A / w_sqrt(1.0 - WGS84_E2 * sp * sp);
  out[0] = (n + h) * cp * js_cos(l);
  out[1] = (n + h) * cp * js_sin(l);
  out[2] = (n * (1.0 - WGS84_E2) + h) * sp;
}

/* Geodesic polygon area (m²) on the authalic sphere — spherical excess, as used by most GIS tools. */
EXPORT(geo_poly_area) double geo_poly_area(const double *pts, int n) {
  const double R = 6371007.2;
  double sum = 0;
  for (int i = 0; i < n; i++) {
    int j = (i + 1) % n;
    double l1 = pts[2 * i] * DEG, p1 = pts[2 * i + 1] * DEG;
    double l2 = pts[2 * j] * DEG, p2 = pts[2 * j + 1] * DEG;
    double dl = l2 - l1;
    if (dl > PI) dl -= TWO_PI;
    if (dl < -PI) dl += TWO_PI;
    sum += dl * (2.0 + js_sin(p1) + js_sin(p2));
  }
  return w_fabs(sum * R * R / 2.0);
}

/* Length of a polyline (closed = 1 adds the closing edge), m. */
EXPORT(geo_path_length) double geo_path_length(const double *pts, int n, int closed) {
  double len = 0;
  int edges = closed ? n : n - 1;
  for (int i = 0; i < edges; i++) {
    int j = (i + 1) % n;
    len += geo_distance(pts[2 * i + 1], pts[2 * i], pts[2 * j + 1], pts[2 * j]);
  }
  return len;
}

EXPORT(geo_point_in_poly) int geo_point_in_poly(double lon, double lat, const double *pts, int n) {
  int inside = 0;
  for (int i = 0, j = n - 1; i < n; j = i++) {
    double xi = pts[2 * i], yi = pts[2 * i + 1], xj = pts[2 * j], yj = pts[2 * j + 1];
    if (((yi > lat) != (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/*
 * Rasterise a polygon onto a w×h grid covering [west..east]×[south..north]
 * (row 0 = north). out[i] = 1 inside, 0 outside. Returns the inside count.
 */
EXPORT(geo_poly_mask) int geo_poly_mask(const double *pts, int n, double west, double south, double east, double north,
                                         int w, int h, u8 *out) {
  int count = 0;
  for (int y = 0; y < h; y++) {
    double lat = north - (y + 0.5) * (north - south) / h;
    for (int x = 0; x < w; x++) {
      double lon = west + (x + 0.5) * (east - west) / w;
      u8 v = (u8)geo_point_in_poly(lon, lat, pts, n);
      out[y * w + x] = v;
      count += v;
    }
  }
  return count;
}

/*
 * Batch dead reckoning. in: n records of 7 doubles
 *   [lat, lon, altM, speedMs, headingDeg, vertRateMs, dtSec]
 * out: n × [x, y, z] ECEF metres. Vertical extrapolation is capped at 30 s.
 */
EXPORT(dr_batch) void dr_batch(const double *in, int n, double *out) {
  double p[2];
  for (int i = 0; i < n; i++) {
    const double *r = in + 7 * i;
    double lat = r[0], lon = r[1], alt = r[2];
    if (r[3] > 1.0 && r[6] > 0) {
      destination(lat, lon, r[4], r[3] * r[6], p);
      lat = p[0];
      lon = p[1];
      alt = w_max(0.0, alt + r[5] * w_min(r[6], 30.0));
    }
    geodetic_to_ecef(lat, lon, alt, out + 3 * i);
  }
}
