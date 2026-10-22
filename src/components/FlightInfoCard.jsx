import React from 'react';
import { projectRoute, routeIsPlausible } from '../flights/predict';
import { categoryOf, FLIGHT_COLORS } from '../flights/FlightLayer';

const FT = 0.3048;
const KT = 0.514444;

const fmtDuration = (ms) => {
  const min = Math.max(0, Math.round(ms / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
};
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Details for the selected aircraft: identity, live numbers,
 * origin → destination with progress, ETA and follow camera.
 */
export default function FlightInfoCard({ flights }) {
  const { selectedFlight: f, details, follow, setFollow, select, flyTo, forecastMin } = flights;
  if (!f) return null;

  const route = details?.route;
  const plausible = route && routeIsPlausible(f, route);
  const proj = plausible ? projectRoute(f, route) : null;
  const aircraft = details?.aircraft;
  const cat = categoryOf(f);
  const vs = f.vertRateMs / FT * 60;

  return (
    <div className="flight-card glass-panel" id="flight-card">
      <div className="flight-card-header">
        <div>
          <div className="flight-callsign">
            <span className="flight-dot" style={{ background: FLIGHT_COLORS[cat] }} />
            {f.callsign || f.id.toUpperCase()}
            {f.military && <span className="mil-badge">MILITARY</span>}
          </div>
          <div className="flight-sub">
            {[route?.airline, aircraft?.model || f.type, aircraft?.reg || f.reg].filter(Boolean).join(' · ') || f.country || 'Unknown aircraft'}
          </div>
        </div>
        <button className="panel-toggle-btn" onClick={() => select(null)} title="Close (Esc)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Route */}
      {details?.loading ? (
        <div className="hint">Looking up route…</div>
      ) : route ? (
        <div className="route">
          <div className="route-ends">
            <div title={route.origin.name}>
              <div className="route-code">{route.origin.iata || route.origin.icao}</div>
              <div className="route-city">{route.origin.city}</div>
            </div>
            <div className="route-arrow">✈</div>
            <div title={route.destination.name} className="right">
              <div className="route-code">{route.destination.iata || route.destination.icao}</div>
              <div className="route-city">{route.destination.city}</div>
            </div>
          </div>
          {proj ? (
            <>
              <div className="progress"><div style={{ width: `${proj.progress * 100}%` }} /></div>
              <div className="route-meta">
                <span>{Math.round(proj.remainingM / 1000).toLocaleString()} km left</span>
                {proj.etaMs && <span>ETA {fmtTime(proj.etaMs)} · in {fmtDuration(proj.etaMs - Date.now())}</span>}
              </div>
            </>
          ) : (
            <div className="hint warn">Scheduled route doesn't match the aircraft's position — may be outdated.</div>
          )}
        </div>
      ) : (
        <div className="hint">No published route for this callsign. Dashed line shows the projected track.</div>
      )}

      {/* Live numbers */}
      <div className="flight-stats">
        <div><span className="label">ALT</span>{f.onGround ? 'Ground' : `${Math.round(f.altM / FT).toLocaleString()} ft`}</div>
        <div><span className="label">SPEED</span>{Math.round(f.speedMs / KT)} kt</div>
        <div><span className="label">HDG</span>{Math.round(f.headingDeg)}°</div>
        <div><span className="label">V/S</span>{Math.abs(vs) < 50 ? 'level' : `${vs > 0 ? '+' : ''}${Math.round(vs)} fpm`}</div>
        <div><span className="label">SQUAWK</span>{f.squawk || '—'}</div>
        <div><span className="label">SOURCE</span>{f.source}</div>
      </div>

      {f.lost && <div className="hint warn">Signal lost — aircraft no longer in the feed.</div>}
      {forecastMin > 0 && <div className="hint"><span className="sim-badge">SIMULATED</span> map shows +{forecastMin} min</div>}

      <div className="flight-actions">
        <button className={`chip ${follow ? 'active' : ''}`} onClick={() => setFollow(!follow)}>
          {follow ? 'Following' : 'Follow'}
        </button>
        <button className="chip" onClick={() => flyTo(f.id)}>Fly to</button>
        <span className="flight-hex">{f.id.toUpperCase()}</span>
      </div>
    </div>
  );
}
