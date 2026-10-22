import React from 'react';
import { fmtArea, fmtLen } from '../tools/format';

const fmtM = (m) => `${Math.round(m).toLocaleString()} m`;
const fmtVol = (m3) => (m3 >= 1e6 ? `${(m3 / 1e6).toFixed(2)} million m³` : `${Math.round(m3).toLocaleString()} m³`);

function Rows({ rows }) {
  return (
    <dl className="info-rows">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function Profile({ profile }) {
  const { dist, heights, total } = profile;
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const W = 280;
  const H = 80;
  const y = (h) => H - 4 - ((h - min) / Math.max(1, max - min)) * (H - 8);
  const d = heights.map((h, i) => `${i ? 'L' : 'M'}${((dist[i] / total) * W).toFixed(1)},${y(h).toFixed(1)}`).join(' ');
  return (
    <svg className="profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Elevation profile">
      <path d={`${d} L${W},${H} L0,${H} Z`} className="profile-fill" />
      <path d={d} className="profile-line" />
      <text x="4" y="12">{fmtM(max)}</text>
      <text x="4" y={H - 4}>{fmtM(min)}</text>
      <text x={W - 4} y={H - 4} textAnchor="end">{fmtLen(total)}</text>
    </svg>
  );
}

function Settlements({ list }) {
  if (list === undefined) return <div className="hint">Looking up settlements in the affected zone…</div>;
  if (list === null) return <div className="hint">Settlement lookup unavailable (OpenStreetMap busy).</div>;
  if (!list.length) return <div className="hint">No mapped settlements in the affected zone.</div>;
  return (
    <div className="hint warn">
      Settlements affected: {list.slice(0, 8).map((s) => s.name).join(', ')}
      {list.length > 8 ? ` +${list.length - 8} more` : ''}
    </div>
  );
}

function Section({ title, onClear, children }) {
  return (
    <section className="result-section">
      <div className="result-head">
        <span>{title}</span>
        {onClear && (
          <button className="panel-toggle-btn" title="Remove" onClick={onClear}>
            ×
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

const status = (r) => (r?.busy ? <div className="hint">Computing…</div> : r?.error ? <div className="hint warn">{r.error}</div> : null);

/**
 * Results for the selected shape: measurement, analyses and simulation outputs,
 * each with its model assumptions spelled out.
 */
export default function ResultCard({ tools, onFlyTo }) {
  const { selected, results, select, clearResult } = tools;
  if (!selected) return null;
  const r = results[selected.id] || {};
  const clear = (kind) => () => clearResult(selected.id, kind);

  return (
    <div className="flight-card info-card glass-panel result-card">
      <div className="flight-card-header">
        <div className="info-title">📐 {selected.name}</div>
        <button className="panel-toggle-btn" onClick={() => select(null)} title="Close">
          ×
        </button>
      </div>

      {r.measure && (
        <Section title="Size">
          {status(r.measure) || (
            <>
              <Rows
                rows={[
                  ...(r.measure.area ? [['Area', fmtArea(r.measure.area)]] : []),
                  ...(r.measure.length ? [[r.measure.area ? 'Perimeter' : 'Length', fmtLen(r.measure.length)]] : []),
                  ...(r.measure.radius ? [['Radius', fmtLen(r.measure.radius)]] : []),
                  ...(r.measure.lat != null ? [['Position', `${r.measure.lat.toFixed(5)}°, ${r.measure.lon.toFixed(5)}°`]] : []),
                ]}
              />
              {r.measure.compare?.map((c) => (
                <div key={c} className="compare">
                  {c}
                </div>
              ))}
            </>
          )}
        </Section>
      )}

      {r.elevation && (
        <Section title="Elevation" onClear={clear('elevation')}>
          {status(r.elevation) || (
            <>
              {r.elevation.profile && <Profile profile={r.elevation.profile} />}
              <Rows
                rows={[
                  ['Lowest', fmtM(r.elevation.min)],
                  ['Highest', fmtM(r.elevation.max)],
                  ...(r.elevation.mean != null ? [['Mean', `${fmtM(r.elevation.mean)} ± ${Math.round(r.elevation.std)}`]] : []),
                  ...(r.elevation.slopeMean != null ? [['Slope', `avg ${r.elevation.slopeMean.toFixed(1)}° · max ${r.elevation.slopeMax.toFixed(0)}°`]] : []),
                  ...(r.elevation.gain != null ? [['Climb / descent', `+${fmtM(r.elevation.gain)} / −${fmtM(r.elevation.loss)}`]] : []),
                ]}
              />
              {r.elevation.cellM && (
                <div className="legend-bar elev">
                  <span>{fmtM(r.elevation.min)}</span>
                  <span>{fmtM(r.elevation.max)}</span>
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {r.nearby && (
        <Section title="Nearby features" onClear={clear('nearby')}>
          {status(r.nearby) || (
            <>
              <Rows rows={r.nearby.counts.length ? r.nearby.counts : [['Found', 'nothing mapped']]} />
              <ul className="near-list">
                {r.nearby.items.slice(0, 12).map((it) => (
                  <li key={`${it.lat},${it.lon}`}>
                    <button onClick={() => onFlyTo(it.lon, it.lat)}>
                      {it.name} <span>{it.cat}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {r.nearby.coarse && <div className="hint">Large area: only towns, airports and power plants are listed.</div>}
            </>
          )}
        </Section>
      )}

      {r.applied && (
        <Section title="Map applied here" onClear={clear('applied')}>
          {status(r.applied) || <div className="hint">{r.applied.name} is shown inside this area's bounding box.</div>}
        </Section>
      )}

      {r.viewshed && (
        <Section title="Visible from here" onClear={clear('viewshed')}>
          {status(r.viewshed) || (
            <>
              <Rows
                rows={[
                  ['Visible', `${r.viewshed.pct.toFixed(0)}% · ${r.viewshed.km2.toFixed(1)} km²`],
                  ['Within', fmtLen(r.viewshed.radiusM)],
                  ['Eye height', `${r.viewshed.obsH} m above ${fmtM(r.viewshed.ground)}`],
                ]}
              />
              <div className="hint">Green = in line of sight, red = hidden by terrain (earth curvature included; buildings and trees are not).</div>
            </>
          )}
        </Section>
      )}

      {r.overhead && (
        <Section title="Satellites overhead now (≥10°)" onClear={clear('overhead')}>
          {status(r.overhead) || (
            <Rows
              rows={
                r.overhead.list.length
                  ? r.overhead.list.slice(0, 12).map((s) => [s.name, `${s.el.toFixed(0)}° · ${Math.round(s.rangeKm).toLocaleString()} km`])
                  : [['None', 'from the enabled groups']]
              }
            />
          )}
        </Section>
      )}

      {r.landslide && (
        <Section title="Landslide simulation" onClear={clear('landslide')}>
          {status(r.landslide) || (
            <>
              <Rows
                rows={[
                  ['Volume released', fmtVol(r.landslide.volume)],
                  ['Reach (H/L)', `${r.landslide.hl.toFixed(2)} · angle ${r.landslide.reachAngle.toFixed(1)}°`],
                  ['Max runout', fmtLen(r.landslide.runout)],
                  ['Area affected', fmtArea(r.landslide.area)],
                  ['Deepest deposit', `${r.landslide.maxDeposit.toFixed(1)} m`],
                  ...(r.landslide.lost > 0 ? [['Left the grid', fmtVol(r.landslide.lost)]] : []),
                ]}
              />
              <Settlements list={r.landslide.settlements} />
              <details className="assumptions">
                <summary>Model & assumptions</summary>
                Release area × {r.landslide.depth} m depth. Travel distance from Scheidegger's (1973) volume–reach-angle
                relation; flow routed downhill (multiple flow directions) while the energy line stays above ground;
                deposits relax to a 12° angle of repose. Terrain cell ≈ {Math.round(r.landslide.cellM)} m. Ignores water
                content, vegetation, buildings and erosion.
              </details>
            </>
          )}
        </Section>
      )}

      {r.flood && (
        <Section title={r.flood.mode === 'sea' ? 'Sea-level rise' : 'Local flood'} onClear={clear('flood')}>
          {status(r.flood) || (
            <>
              <Rows
                rows={[
                  ['Water level', `+${r.flood.rise} m ${r.flood.mode === 'sea' ? 'above sea' : 'above the lowest point'}`],
                  ['Area flooded', `${r.flood.areaKm2.toFixed(2)} km²`],
                  ['Deepest water', `${r.flood.maxDepth.toFixed(1)} m`],
                ]}
              />
              <Settlements list={r.flood.settlements} />
              <details className="assumptions">
                <summary>Model & assumptions</summary>
                Static "bathtub" fill: water spreads only through connected ground below the new level (it can't jump
                ridges). No defences, drainage, tides or flow dynamics.
              </details>
            </>
          )}
        </Section>
      )}

      {r.tsunami && (
        <Section title="Tsunami simulation" onClear={clear('tsunami')}>
          {status(r.tsunami) || (
            <>
              <Rows
                rows={[
                  ['Earthquake', `Mw ${r.tsunami.mw.toFixed(1)} · rupture ${Math.round(r.tsunami.source.lengthKm)}×${Math.round(r.tsunami.source.widthKm)} km`],
                  ['Fault slip → wave', `${r.tsunami.source.slip.toFixed(1)} m → ${r.tsunami.source.amplitude.toFixed(1)} m`],
                  ['Ocean depth at source', fmtM(r.tsunami.srcDepth)],
                  ['First arrival', `${Math.round(r.tsunami.arrivalMin)} min`],
                  ['Wave near coast', `${r.tsunami.coastAmp.toFixed(1)} m`],
                  ['Run-up height', `${r.tsunami.runup.toFixed(1)} m`],
                  ['Land flooded', fmtArea(r.tsunami.area)],
                  ['Furthest inland', fmtLen(r.tsunami.inland)],
                  ['Deepest water', `${r.tsunami.maxDepth.toFixed(1)} m`],
                ]}
              />
              {!r.tsunami.seaInArea && <div className="hint warn">The area has no sea cells — include some coastline.</div>}
              <Settlements list={r.tsunami.settlements} />
              <div className="legend-bar time">
                <span>0 min</span>
                <span>arrival time</span>
                <span>later</span>
              </div>
              <details className="assumptions">
                <summary>Model & assumptions</summary>
                Rupture size from Strasser et al. (2010), slip from seismic moment (μ = 30 GPa), initial wave ≈ half the
                slip. Travel time with shallow-water speed √(g·depth) over NOAA ETOPO bathymetry; amplitude falls with
                distance and grows in shallow water (Green's law). Run-up ≈ 2 × near-shore wave; inland reach from Hills
                & Mader (1997), X ≈ 0.06·H^4/3/n² with roughness n = {r.tsunami.manning}. A screening estimate, not a
                hydrodynamic model.
              </details>
            </>
          )}
        </Section>
      )}
    </div>
  );
}
