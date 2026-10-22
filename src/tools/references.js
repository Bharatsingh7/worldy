/**
 * Familiar areas and lengths for "how big is this?" comparisons.
 * Areas in km² (official land/admin areas, rounded), lengths in km.
 */

export const AREAS = [
  { name: 'a football pitch', km2: 0.00714 },
  { name: 'Vatican City', km2: 0.49 },
  { name: 'Central Park (NYC)', km2: 3.41 },
  { name: 'Manhattan', km2: 59.1 },
  { name: 'Paris (city)', km2: 105.4 },
  { name: 'Mumbai (city)', km2: 603 },
  { name: 'Singapore', km2: 735 },
  { name: 'Delhi (NCT)', km2: 1484 },
  { name: 'Greater London', km2: 1572 },
  { name: 'Goa', km2: 3702 },
  { name: 'Kerala', km2: 38863 },
  { name: 'Sri Lanka', km2: 65610 },
  { name: 'the United Kingdom', km2: 242495 },
  { name: 'Texas', km2: 695662 },
  { name: 'India', km2: 3287263 },
  { name: 'the USA', km2: 9833520 },
];

export const LENGTHS = [
  { name: 'the Burj Khalifa (height)', km: 0.828 },
  { name: 'the Golden Gate Bridge', km: 2.737 },
  { name: 'Mount Everest (height)', km: 8.849 },
  { name: 'a marathon', km: 42.195 },
  { name: 'the English Channel (Dover–Calais)', km: 33.3 },
  { name: 'Delhi → Mumbai (straight line)', km: 1150 },
  { name: 'the length of India (N–S)', km: 3214 },
  { name: "the Earth's circumference", km: 40075 },
];

const fmt = (x) => (x >= 10 ? Math.round(x).toLocaleString() : x >= 1 ? x.toFixed(1) : x.toFixed(2));

/** Two friendly comparisons: "≈ 3.2 × Manhattan" and "≈ 41% of Delhi (NCT)". */
export function compare(value, table, key) {
  const bigger = table.find((r) => r[key] >= value);
  const smaller = [...table].reverse().find((r) => r[key] < value);
  const out = [];
  if (smaller) out.push(`≈ ${fmt(value / smaller[key])} × ${smaller.name}`);
  if (bigger) out.push(`≈ ${fmt((value / bigger[key]) * 100)}% of ${bigger.name}`);
  return out;
}
