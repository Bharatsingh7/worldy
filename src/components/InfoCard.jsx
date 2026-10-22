import React, { useEffect, useState } from 'react';

/**
 * Details card for a picked item from any data layer (ship, satellite, site, quake…).
 * Content comes from the layer's describe(key); refreshed every second for moving things.
 */
export default function InfoCard({ layer, itemKey, onClose, onFlyTo }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const d = layer?.describe(itemKey);
  if (!d) return null;

  return (
    <div className="flight-card info-card glass-panel" id="info-card">
      <div className="flight-card-header">
        <div>
          <div className="info-title">
            <span className="info-icon">{d.icon}</span>
            {d.title}
          </div>
          {d.subtitle && <div className="flight-sub">{d.subtitle}</div>}
        </div>
        <button className="panel-toggle-btn" onClick={onClose} title="Close (Esc)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {d.badges?.length > 0 && (
        <div className="badge-row">
          {d.badges.map((b) => (
            <span key={b.text} className="info-badge" style={{ borderColor: b.color, color: b.color }}>
              {b.text}
            </span>
          ))}
        </div>
      )}

      <dl className="info-rows">
        {d.rows.map(([k, v], i) => (
          <React.Fragment key={`${k}-${i}`}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>

      {d.note && <div className="hint">{d.note}</div>}

      <div className="flight-actions">
        {d.lat != null && (
          <button className="chip" onClick={() => onFlyTo(d)}>
            Fly to
          </button>
        )}
        {d.actions?.map((a) => (
          <button key={a.id} className="chip" onClick={() => layer.runAction?.(a.id)}>
            {a.label}
          </button>
        ))}
        {d.links?.slice(0, 2).map((l) => (
          <a key={l.url} className="chip" href={l.url} target="_blank" rel="noreferrer">
            {l.label} ↗
          </a>
        ))}
      </div>
    </div>
  );
}
