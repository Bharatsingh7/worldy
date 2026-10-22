import React from 'react';

const fmtT = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);

/** Live water-depth hydrograph at one probe cell. */
export default function GaugeChart({ gauge, index, onRemove }) {
  const pts = gauge.series;
  const W = 280;
  const H = 70;
  const tMax = Math.max(60, pts.length ? pts[pts.length - 1].t : 60);
  const dMax = Math.max(0.1, ...pts.map((p) => p.depth));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${((p.t / tMax) * W).toFixed(1)},${(H - 4 - (p.depth / dMax) * (H - 10)).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <div className="gauge">
      <div className="gauge-head">
        <span>
          Gauge {index} · {gauge.lat.toFixed(4)}, {gauge.lon.toFixed(4)} · ground {gauge.ground.toFixed(1)} m
        </span>
        <button className="panel-toggle-btn" onClick={onRemove} title="Remove">
          ×
        </button>
      </div>
      <svg className="profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Water depth over time">
        {pts.length > 1 && <path d={`${d} L${((last.t / tMax) * W).toFixed(1)},${H} L0,${H} Z`} className="profile-fill" />}
        {pts.length > 1 && <path d={d} className="profile-line" />}
        <text x="4" y="11">{dMax.toFixed(2)} m</text>
        <text x={W - 4} y={H - 4} textAnchor="end">{fmtT(tMax)}</text>
      </svg>
      {last && (
        <div className="gauge-now">
          now {last.depth.toFixed(2)} m deep · {last.speed.toFixed(2)} m/s
        </div>
      )}
    </div>
  );
}
