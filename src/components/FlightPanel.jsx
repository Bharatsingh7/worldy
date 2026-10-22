import React, { useState } from 'react';
import { FLIGHT_COLORS } from '../flights/FlightLayer';
import { MAX_ALT_FT } from '../flights/useFlights';

const MODES = [
  { id: 'all', label: 'All' },
  { id: 'military', label: 'Military' },
  { id: 'airborne', label: 'Airborne' },
];

const FEED_LABELS = {
  global: 'Global (OpenSky)',
  regional: 'Regional (adsb.lol)',
  military: 'Military (adsb.lol)',
};

const fmtAlt = (ft) => (ft >= MAX_ALT_FT ? 'any' : `${(ft / 1000).toFixed(0)}k ft`);

/**
 * Flights tab — feed toggle, filters, callsign search and the forecast simulator.
 */
export default function FlightPanel({ flights, embedded = false }) {
  const { enabled, setEnabled, filter, setFilter, forecastMin, setForecastMin, stats, feeds, findFlight } = flights;
  const [query, setQuery] = useState('');
  const [notFound, setNotFound] = useState(false);

  const onSearch = (e) => {
    e.preventDefault();
    setNotFound(!findFlight(query));
  };

  return (
    <div className="flight-panel">
      {!embedded && <section className="layer-section">
        <div className="toggle-row" onClick={() => setEnabled(!enabled)}>
          <div className="toggle-row-info">
            <div className="toggle-row-icon">✈️</div>
            <div>
              <div className="toggle-row-label">Live flights</div>
              <div className="toggle-row-sublabel">
                {enabled ? `${stats.shown.toLocaleString()} shown · ${stats.total.toLocaleString()} tracked` : 'Off'}
              </div>
            </div>
          </div>
          <div className={`toggle-switch ${enabled ? 'on' : ''}`} />
        </div>
      </section>}

      {enabled && (
        <>
          <section className="layer-section">
            <form className="flight-search" onSubmit={onSearch}>
              <input
                className="flight-search-input"
                placeholder="Callsign, registration or hex…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setNotFound(false);
                }}
                spellCheck="false"
              />
              <button className="chip" type="submit">Find</button>
            </form>
            {notFound && <div className="hint warn">Not in the current feed.</div>}
          </section>

          <section className="layer-section">
            <div className="layer-section-title">Show</div>
            <div className="chip-row">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  className={`chip ${filter.mode === m.id ? 'active' : ''}`}
                  onClick={() => setFilter((f) => ({ ...f, mode: m.id }))}
                >
                  {m.label}
                  {m.id === 'military' && <span className="chip-count">{stats.military}</span>}
                </button>
              ))}
            </div>
            <div className="slider-row">
              <span className="slider-label">Min alt</span>
              <input
                type="range"
                min="0"
                max={MAX_ALT_FT}
                step="1000"
                value={filter.minAltFt}
                onChange={(e) => setFilter((f) => ({ ...f, minAltFt: Math.min(Number(e.target.value), f.maxAltFt) }))}
              />
              <span className="slider-value">{filter.minAltFt ? fmtAlt(filter.minAltFt) : '0'}</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Max alt</span>
              <input
                type="range"
                min="0"
                max={MAX_ALT_FT}
                step="1000"
                value={filter.maxAltFt}
                onChange={(e) => setFilter((f) => ({ ...f, maxAltFt: Math.max(Number(e.target.value), f.minAltFt) }))}
              />
              <span className="slider-value">{fmtAlt(filter.maxAltFt)}</span>
            </div>
            <div className="legend">
              <span><i style={{ background: FLIGHT_COLORS.civil }} />Civil</span>
              <span><i style={{ background: FLIGHT_COLORS.military }} />Military</span>
              <span><i style={{ background: FLIGHT_COLORS.ground }} />On ground</span>
            </div>
          </section>

          <section className="layer-section">
            <div className="layer-section-title">Forecast simulation</div>
            <div className="slider-row">
              <span className="slider-label">Ahead</span>
              <input
                type="range"
                min="0"
                max="120"
                step="5"
                value={forecastMin}
                onChange={(e) => setForecastMin(Number(e.target.value))}
              />
              <span className="slider-value">+{forecastMin}m</span>
            </div>
            {forecastMin > 0 ? (
              <div className="forecast-note">
                <span className="sim-badge">SIMULATED</span>
                Planes shown {forecastMin} min ahead: known routes are flown to their destination, others hold course.
                <button className="chip" onClick={() => setForecastMin(0)}>Back to live</button>
              </div>
            ) : (
              <div className="hint">Drag to project every aircraft into the future.</div>
            )}
          </section>

          <section className="layer-section">
            <div className="layer-section-title">Data feeds</div>
            <ul className="feed-list">
              {Object.entries(FEED_LABELS).map(([key, label]) => (
                <li key={key}>
                  <span className={`feed-dot ${feeds[key]}`} />
                  {label}
                  {key === 'global' && feeds.credits != null && <span className="feed-meta">{feeds.credits} credits left</span>}
                  {key === 'global' && feeds.global === 'limited' && <span className="feed-meta warn">daily limit hit</span>}
                  {key === 'regional' && feeds.regional === 'idle' && <span className="feed-meta">zoom in to activate</span>}
                </li>
              ))}
            </ul>
            <p className="hint">
              Only aircraft broadcasting ADS-B/MLAT are visible. Stealth or military flights with transponders off
              do not appear in any public feed.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
