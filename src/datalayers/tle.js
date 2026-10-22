/**
 * Two-line element parsing → the flat element records the C SGP4 core expects:
 * [epochJD, meanMotion (rad/min), ecc, incl, raan, argp, meanAnomaly, bstar] (radians).
 */

const DEG = Math.PI / 180;

/** Julian date at 0h UT on 1 January of `year`. */
const jdJan1 = (year) =>
  367 * year - Math.floor((7 * (year + Math.floor(10 / 12))) / 4) + Math.floor(275 / 9) + 1 + 1721013.5;

/** "12345-3" style implied-decimal exponent field. */
const expField = (s) => {
  const t = s.trim();
  if (!t) return 0;
  const m = t.match(/^([+-]?)(\d+)([+-]\d)$/);
  if (!m) return 0;
  return Number(`${m[1]}0.${m[2]}e${m[3]}`);
};

export const unixToJd = (ms) => ms / 86400000 + 2440587.5;
export const jdToUnix = (jd) => (jd - 2440587.5) * 86400000;

/** Parse 3-line (name + 2 lines) TLE text. */
export function parseTLE(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length + 0; i++) {
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (!l1?.startsWith('1 ') || !l2?.startsWith('2 ')) continue;
    const name = lines[i].replace(/^0 /, '').trim();
    const yy = Number(l1.slice(18, 20));
    const day = Number(l1.slice(20, 32));
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    out.push({
      name,
      norad: Number(l1.slice(2, 7)),
      intlDes: l1.slice(9, 17).trim(),
      elements: [
        jdJan1(year) + day - 1,
        (Number(l2.slice(52, 63)) * 2 * Math.PI) / 1440,
        Number(`0.${l2.slice(26, 33).trim()}`),
        Number(l2.slice(8, 16)) * DEG,
        Number(l2.slice(17, 25)) * DEG,
        Number(l2.slice(34, 42)) * DEG,
        Number(l2.slice(43, 51)) * DEG,
        expField(l1.slice(53, 61)),
      ],
    });
    i += 2;
  }
  return out;
}
