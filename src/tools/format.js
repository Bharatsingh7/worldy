/** Human-friendly area / length formatting. */
export const fmtArea = (m2) =>
  m2 >= 1e6 ? `${(m2 / 1e6).toLocaleString(undefined, { maximumFractionDigits: m2 >= 1e8 ? 0 : 2 })} km²` : m2 >= 1e4 ? `${(m2 / 1e4).toFixed(1)} ha` : `${Math.round(m2)} m²`;
export const fmtLen = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} km` : `${Math.round(m)} m`);
