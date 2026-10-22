/*
 * SGP4 satellite propagation (near-Earth model, WGS-72 constants),
 * following Vallado et al. "Revisiting Spacetrack Report #3" (public domain reference).
 *
 * Deep-space objects (period ≥ 225 min: GPS, GEO, Molniya) are propagated with the
 * same secular/drag model but without lunar-solar and resonance terms — accurate to
 * tens of km near the TLE epoch, which is fine for display; flagged as approximate.
 *
 * Elements in: n × 8 doubles [epochJD, meanMotion(rad/min), ecc, incl, raan, argp, meanAnomaly, bstar] (radians)
 * Positions out: ECEF metres (TEME rotated by GMST; polar motion ignored).
 */
#include "worldy.h"

#define XKE 0.0743669161331734
#define RE_KM 6378.135
#define J2 0.001082616
#define J3 -0.00000253881
#define J4 -0.00000165597
#define J3OJ2 (J3 / J2)
#define X2O3 (2.0 / 3.0)

typedef struct {
  double epoch, no, ecco, inclo, nodeo, argpo, mo, bstar;
  double ao, con41, x1mth2, x7thm1, cosio, sinio, eta, cc1, cc4, cc5, d2, d3, d4, delmo, sinmao;
  double mdot, argpdot, nodedot, nodecf, omgcof, xmcof, xlcof, aycof, t2cof, t3cof, t4cof, t5cof;
  int isimp, deep, error;
} Sat;

static void sat_setup(Sat *s) {
  double ecco = s->ecco, inclo = s->inclo, no = s->no;

  /* initl: recover original mean motion and semi-major axis */
  double eccsq = ecco * ecco, omeosq = 1.0 - eccsq, rteosq = w_sqrt(omeosq);
  double cosio = js_cos(inclo), cosio2 = cosio * cosio;
  double ak = js_pow(XKE / no, X2O3);
  double d1 = 0.75 * J2 * (3.0 * cosio2 - 1.0) / (rteosq * omeosq);
  double del = d1 / (ak * ak);
  double adel = ak * (1.0 - del * del - del * (1.0 / 3.0 + 134.0 * del * del / 81.0));
  del = d1 / (adel * adel);
  no = no / (1.0 + del);
  s->no = no;
  double ao = js_pow(XKE / no, X2O3);
  double sinio = js_sin(inclo);
  double po = ao * omeosq;
  double con42 = 1.0 - 5.0 * cosio2;
  s->con41 = -con42 - cosio2 - cosio2;
  double posq = po * po, rp = ao * (1.0 - ecco);
  s->ao = ao;
  s->cosio = cosio;
  s->sinio = sinio;
  s->error = 0;
  s->deep = (TWO_PI / no) >= 225.0;

  /* sgp4init */
  s->isimp = rp < (220.0 / RE_KM + 1.0);
  double ss = 78.0 / RE_KM + 1.0;
  double qzms2t = js_pow((120.0 - 78.0) / RE_KM, 4.0);
  double sfour = ss, qzms24 = qzms2t;
  double perige = (rp - 1.0) * RE_KM;
  if (perige < 156.0) {
    sfour = perige < 98.0 ? 20.0 : perige - 78.0;
    qzms24 = js_pow((120.0 - sfour) / RE_KM, 4.0);
    sfour = sfour / RE_KM + 1.0;
  }
  double pinvsq = 1.0 / posq;
  double tsi = 1.0 / (ao - sfour);
  double eta = ao * ecco * tsi, etasq = eta * eta, eeta = ecco * eta;
  double psisq = w_fabs(1.0 - etasq);
  double coef = qzms24 * js_pow(tsi, 4.0);
  double coef1 = coef / js_pow(psisq, 3.5);
  double cc2 = coef1 * no *
               (ao * (1.0 + 1.5 * etasq + eeta * (4.0 + etasq)) +
                0.375 * J2 * tsi / psisq * s->con41 * (8.0 + 3.0 * etasq * (8.0 + etasq)));
  s->eta = eta;
  s->cc1 = s->bstar * cc2;
  double cc3 = ecco > 1.0e-4 ? -2.0 * coef * tsi * J3OJ2 * no * sinio / ecco : 0.0;
  s->x1mth2 = 1.0 - cosio2;
  s->cc4 = 2.0 * no * coef1 * ao * omeosq *
           (eta * (2.0 + 0.5 * etasq) + ecco * (0.5 + 2.0 * etasq) -
            J2 * tsi / (ao * psisq) *
                (-3.0 * s->con41 * (1.0 - 2.0 * eeta + etasq * (1.5 - 0.5 * eeta)) +
                 0.75 * s->x1mth2 * (2.0 * etasq - eeta * (1.0 + etasq)) * js_cos(2.0 * s->argpo)));
  s->cc5 = 2.0 * coef1 * ao * omeosq * (1.0 + 2.75 * (etasq + eeta) + eeta * etasq);
  double cosio4 = cosio2 * cosio2;
  double temp1 = 1.5 * J2 * pinvsq * no;
  double temp2 = 0.5 * temp1 * J2 * pinvsq;
  double temp3 = -0.46875 * J4 * pinvsq * pinvsq * no;
  s->mdot = no + 0.5 * temp1 * rteosq * s->con41 + 0.0625 * temp2 * rteosq * (13.0 - 78.0 * cosio2 + 137.0 * cosio4);
  s->argpdot = -0.5 * temp1 * con42 + 0.0625 * temp2 * (7.0 - 114.0 * cosio2 + 395.0 * cosio4) +
               temp3 * (3.0 - 36.0 * cosio2 + 49.0 * cosio4);
  double xhdot1 = -temp1 * cosio;
  s->nodedot = xhdot1 + (0.5 * temp2 * (4.0 - 19.0 * cosio2) + 2.0 * temp3 * (3.0 - 7.0 * cosio2)) * cosio;
  s->omgcof = s->bstar * cc3 * js_cos(s->argpo);
  s->xmcof = ecco > 1.0e-4 ? -X2O3 * coef * s->bstar / eeta : 0.0;
  s->nodecf = 3.5 * omeosq * xhdot1 * s->cc1;
  s->t2cof = 1.5 * s->cc1;
  double den = w_fabs(cosio + 1.0) > 1.5e-12 ? 1.0 + cosio : 1.5e-12;
  s->xlcof = -0.25 * J3OJ2 * sinio * (3.0 + 5.0 * cosio) / den;
  s->aycof = -0.5 * J3OJ2 * sinio;
  double dm = 1.0 + eta * js_cos(s->mo);
  s->delmo = dm * dm * dm;
  s->sinmao = js_sin(s->mo);
  s->x7thm1 = 7.0 * cosio2 - 1.0;

  if (!s->isimp) {
    double cc1sq = s->cc1 * s->cc1;
    s->d2 = 4.0 * ao * tsi * cc1sq;
    double temp = s->d2 * tsi * s->cc1 / 3.0;
    s->d3 = (17.0 * ao + sfour) * temp;
    s->d4 = 0.5 * temp * ao * tsi * (221.0 * ao + 31.0 * sfour) * s->cc1;
    s->t3cof = s->d2 + 2.0 * cc1sq;
    s->t4cof = 0.25 * (3.0 * s->d3 + s->cc1 * (12.0 * s->d2 + 10.0 * cc1sq));
    s->t5cof = 0.2 * (3.0 * s->d4 + 12.0 * s->cc1 * s->d3 + 6.0 * s->d2 * s->d2 + 15.0 * cc1sq * (2.0 * s->d2 + cc1sq));
  }
}

/* Position in TEME (km) at t minutes after epoch. Returns 0 on success. */
static int sat_teme(const Sat *s, double t, double *r) {
  double xmdf = s->mo + s->mdot * t;
  double argpdf = s->argpo + s->argpdot * t;
  double nodedf = s->nodeo + s->nodedot * t;
  double argpm = argpdf, mm = xmdf, t2 = t * t;
  double nodem = nodedf + s->nodecf * t2;
  double tempa = 1.0 - s->cc1 * t;
  double tempe = s->bstar * s->cc4 * t;
  double templ = s->t2cof * t2;

  if (!s->isimp) {
    double delomg = s->omgcof * t;
    double dmt = 1.0 + s->eta * js_cos(xmdf);
    double delm = s->xmcof * (dmt * dmt * dmt - s->delmo);
    double temp = delomg + delm;
    mm = xmdf + temp;
    argpm = argpdf - temp;
    double t3 = t2 * t, t4 = t3 * t;
    tempa = tempa - s->d2 * t2 - s->d3 * t3 - s->d4 * t4;
    tempe = tempe + s->bstar * s->cc5 * (js_sin(mm) - s->sinmao);
    templ = templ + s->t3cof * t3 + t4 * (s->t4cof + t * s->t5cof);
  }

  double nm = s->no, em = s->ecco, inclm = s->inclo;
  double am = js_pow(XKE / nm, X2O3) * tempa * tempa;
  nm = XKE / js_pow(am, 1.5);
  em = em - tempe;
  if (em >= 1.0 || em < -0.001) return 1;
  if (em < 1.0e-6) em = 1.0e-6;
  mm = mm + s->no * templ;
  double xlm = mm + argpm + nodem;
  nodem = w_fmod(nodem, TWO_PI);
  argpm = w_fmod(argpm, TWO_PI);
  xlm = w_fmod(xlm, TWO_PI);
  mm = w_fmod(xlm - argpm - nodem, TWO_PI);

  double sinim = js_sin(inclm), cosim = js_cos(inclm);

  /* long-period periodics */
  double axnl = em * js_cos(argpm);
  double temp = 1.0 / (am * (1.0 - em * em));
  double aynl = em * js_sin(argpm) + temp * s->aycof;
  double xl = mm + argpm + nodem + temp * s->xlcof * axnl;

  /* Kepler's equation */
  double u = w_fmod(xl - nodem, TWO_PI);
  double eo1 = u, tem5 = 9999.9, sineo1 = 0, coseo1 = 0;
  for (int k = 0; k < 10 && w_fabs(tem5) >= 1.0e-12; k++) {
    sineo1 = js_sin(eo1);
    coseo1 = js_cos(eo1);
    tem5 = 1.0 - coseo1 * axnl - sineo1 * aynl;
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
    if (w_fabs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
    eo1 += tem5;
  }

  /* short-period periodics */
  double ecose = axnl * coseo1 + aynl * sineo1;
  double esine = axnl * sineo1 - aynl * coseo1;
  double el2 = axnl * axnl + aynl * aynl;
  double pl = am * (1.0 - el2);
  if (pl < 0.0) return 2;
  double rl = am * (1.0 - ecose);
  double betal = w_sqrt(1.0 - el2);
  temp = esine / (1.0 + betal);
  double sinu = am / rl * (sineo1 - aynl - axnl * temp);
  double cosu = am / rl * (coseo1 - axnl + aynl * temp);
  double su = js_atan2(sinu, cosu);
  double sin2u = (cosu + cosu) * sinu;
  double cos2u = 1.0 - 2.0 * sinu * sinu;
  temp = 1.0 / pl;
  double temp1 = 0.5 * J2 * temp;
  double temp2 = temp1 * temp;

  double mrt = rl * (1.0 - 1.5 * temp2 * betal * s->con41) + 0.5 * temp1 * s->x1mth2 * cos2u;
  su = su - 0.25 * temp2 * s->x7thm1 * sin2u;
  double xnode = nodem + 1.5 * temp2 * cosim * sin2u;
  double xinc = inclm + 1.5 * temp2 * cosim * sinim * cos2u;
  if (mrt < 1.0) return 6; /* decayed */

  double sinsu = js_sin(su), cossu = js_cos(su);
  double snod = js_sin(xnode), cnod = js_cos(xnode);
  double sini = js_sin(xinc), cosi = js_cos(xinc);
  double xmx = -snod * cosi, xmy = cnod * cosi;
  double ux = xmx * sinsu + cnod * cossu;
  double uy = xmy * sinsu + snod * cossu;
  double uz = sini * sinsu;
  r[0] = mrt * ux * RE_KM;
  r[1] = mrt * uy * RE_KM;
  r[2] = mrt * uz * RE_KM;
  return 0;
}

/* Greenwich mean sidereal time (rad) for a UT1 Julian date. */
EXPORT(gmst) double gmst(double jd) {
  double tut1 = (jd - 2451545.0) / 36525.0;
  double temp = -6.2e-6 * tut1 * tut1 * tut1 + 0.093104 * tut1 * tut1 +
                (876600.0 * 3600.0 + 8640184.812866) * tut1 + 67310.54841;
  temp = w_fmod(temp * DEG / 240.0, TWO_PI);
  return temp < 0 ? temp + TWO_PI : temp;
}

/* ECEF metres at Julian date jd; returns nonzero on failure. */
static int sat_ecef(const Sat *s, double jd, double g, double *out) {
  double r[3];
  int err = sat_teme(s, (jd - s->epoch) * 1440.0, r);
  if (err) return err;
  double cg = js_cos(g), sg = js_sin(g);
  out[0] = (cg * r[0] + sg * r[1]) * 1000.0;
  out[1] = (-sg * r[0] + cg * r[1]) * 1000.0;
  out[2] = r[2] * 1000.0;
  return 0;
}

/* ECEF → geodetic (deg, deg, m), Bowring-style iteration. */
static void ecef_to_geodetic(const double *p, double *out) {
  double x = p[0], y = p[1], z = p[2];
  double lon = js_atan2(y, x);
  double rxy = w_sqrt(x * x + y * y);
  double lat = js_atan2(z, rxy * (1.0 - WGS84_E2));
  double h = 0;
  for (int i = 0; i < 5; i++) {
    double sl = js_sin(lat);
    double n = WGS84_A / w_sqrt(1.0 - WGS84_E2 * sl * sl);
    h = rxy / js_cos(lat) - n;
    lat = js_atan2(z, rxy * (1.0 - WGS84_E2 * n / (n + h)));
  }
  out[0] = lat / DEG;
  out[1] = lon / DEG;
  out[2] = h;
}

/* ── Exports ──────────────────────────────────────────── */

/* Build n satellite records from elements; returns pointer to the record array. */
EXPORT(sat_init) Sat *sat_init(const double *el, int n) {
  Sat *sats = (Sat *)walloc((u32)n * sizeof(Sat));
  for (int i = 0; i < n; i++) {
    const double *e = el + 8 * i;
    Sat *s = sats + i;
    s->epoch = e[0];
    s->no = e[1];
    s->ecco = e[2];
    s->inclo = e[3];
    s->nodeo = e[4];
    s->argpo = e[5];
    s->mo = e[6];
    s->bstar = e[7];
    sat_setup(s);
  }
  return sats;
}

EXPORT(sat_is_deep) int sat_is_deep(const Sat *sats, int i) { return sats[i].deep; }

/* All n satellites at jd → out n×3 ECEF metres (NaN for failed/decayed). Returns failure count. */
EXPORT(sat_propagate) int sat_propagate(const Sat *sats, int n, double jd, double *out) {
  double g = gmst(jd);
  int failed = 0;
  for (int i = 0; i < n; i++) {
    if (sat_ecef(sats + i, jd, g, out + 3 * i)) {
      out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = __builtin_nan("");
      failed++;
    }
  }
  return failed;
}

/* Ground track of one satellite: count points from jd0 every stepSec → out count×3 [lat, lon, altM]. */
EXPORT(sat_track) int sat_track(const Sat *sats, int i, double jd0, double stepSec, int count, double *out) {
  double p[3];
  int ok = 0;
  for (int k = 0; k < count; k++) {
    double jd = jd0 + k * stepSec / 86400.0;
    if (sat_ecef(sats + i, jd, gmst(jd), p)) break;
    ecef_to_geodetic(p, out + 3 * k);
    ok++;
  }
  return ok;
}

/* Elevation angle (deg) of an ECEF point seen from an observer. */
static double elevation(const double *sat, const double *obs, double latDeg, double lonDeg) {
  double dx = sat[0] - obs[0], dy = sat[1] - obs[1], dz = sat[2] - obs[2];
  double p = latDeg * DEG, l = lonDeg * DEG;
  double up = js_cos(p) * js_cos(l) * dx + js_cos(p) * js_sin(l) * dy + js_sin(p) * dz;
  double range = w_sqrt(dx * dx + dy * dy + dz * dz);
  return js_asin(up / range) / DEG;
}

/*
 * Passes of satellite i over an observer within `hours` from jd0 (30 s steps, refined to 1 s).
 * out: up to maxPasses × [riseJD, culminationJD, maxElevationDeg, setJD]. Returns pass count.
 */
EXPORT(sat_passes) int sat_passes(const Sat *sats, int i, double jd0, double hours, double obsLat, double obsLon,
                                  double obsAlt, double minEl, double *out, int maxPasses) {
  double obs[3], p[3];
  geodetic_to_ecef(obsLat, obsLon, obsAlt, obs);
  const double step = 30.0 / 86400.0;
  int steps = (int)(hours * 120.0);
  int found = 0, up = 0;
  double rise = 0, best = -90, bestJd = 0, prevJd = jd0;
  for (int k = 0; k <= steps && found < maxPasses; k++) {
    double jd = jd0 + k * step;
    if (sat_ecef(sats + i, jd, gmst(jd), p)) return found;
    double el = elevation(p, obs, obsLat, obsLon);
    if (el >= minEl && !up) {
      up = 1;
      rise = prevJd;
      for (double t = prevJd; t <= jd; t += 1.0 / 86400.0) {
        sat_ecef(sats + i, t, gmst(t), p);
        if (elevation(p, obs, obsLat, obsLon) >= minEl) { rise = t; break; }
      }
      best = el;
      bestJd = jd;
    } else if (up && el > best) {
      best = el;
      bestJd = jd;
    } else if (el < minEl && up) {
      up = 0;
      double set = jd;
      for (double t = prevJd; t <= jd; t += 1.0 / 86400.0) {
        sat_ecef(sats + i, t, gmst(t), p);
        if (elevation(p, obs, obsLat, obsLon) < minEl) { set = t; break; }
      }
      double *o = out + 4 * found++;
      o[0] = rise;
      o[1] = bestJd;
      o[2] = best;
      o[3] = set;
    }
    prevJd = jd;
  }
  return found;
}
