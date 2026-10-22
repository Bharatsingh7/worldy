import React, { useState } from 'react';
import { IMAGERY_LAYERS } from '../layers';
import { isArea } from '../tools/useTools';
import { fmtArea, fmtLen } from '../tools/format';

const DRAW = [
  { type: 'point', label: 'Point', icon: '•' },
  { type: 'line', label: 'Line', icon: '╱' },
  { type: 'polygon', label: 'Area', icon: '⬠' },
  { type: 'rect', label: 'Box', icon: '▭' },
  { type: 'circle', label: 'Circle', icon: '◯' },
];

const HINT = {
  point: 'Click on the globe to place a point.',
  line: 'Click to add points · double-click or right-click to finish.',
  polygon: 'Click to add corners · double-click or right-click to close the area.',
  rect: 'Click two opposite corners.',
  circle: 'Click the centre, then click the edge.',
};

const GROUND = [
  { value: 0.025, label: 'Open / farmland' },
  { value: 0.045, label: 'Town' },
  { value: 0.07, label: 'Forest / dense city' },
];

const TYPE_ICON = Object.fromEntries(DRAW.map((d) => [d.type, d.icon]));

function RunButton({ busy, onClick, children }) {
  return (
    <button className="chip" disabled={!!busy} onClick={onClick}>
      {busy ? 'Working…' : children}
    </button>
  );
}

/**
 * Tools tab — draw shapes, then analyse or simulate on the selected one.
 * Results show in the card bottom-left.
 */
export default function ToolsPanel({ tools, onFocus }) {
  const { shapes, selected, select, drawing, draw, cancelDraw, remove, results, actions } = tools;
  const [depth, setDepth] = useState(10);
  const [rise, setRise] = useState(2);
  const [mw, setMw] = useState(8.5);
  const [manning, setManning] = useState(0.045);
  const [sourceId, setSourceId] = useState('');
  const [mapId, setMapId] = useState('nasa-viirs');

  const points = shapes.filter((s) => s.type === 'point' && s.id !== selected?.id);
  const source = shapes.find((s) => s.id === sourceId) || points[0];
  const busy = (kind) => selected && results[selected.id]?.[kind]?.busy;

  return (
    <div className="tools-panel">
      <section className="layer-section">
        <div className="layer-section-title">Draw</div>
        <div className="draw-grid">
          {DRAW.map((d) => (
            <button key={d.type} className={`draw-btn ${drawing === d.type ? 'active' : ''}`} onClick={() => draw(d.type)}>
              <span className="draw-icon">{d.icon}</span>
              {d.label}
            </button>
          ))}
        </div>
        {drawing && (
          <div className="forecast-note">
            {HINT[drawing]}{' '}
            <button className="chip" onClick={cancelDraw}>
              Cancel (Esc)
            </button>
          </div>
        )}
      </section>

      <section className="layer-section">
        <div className="layer-section-title">Shapes</div>
        {!shapes.length && <div className="hint">Nothing drawn yet. Pick a tool above and click on the globe.</div>}
        <ul className="shape-list">
          {shapes.map((s) => {
            const m = results[s.id]?.measure;
            const summary = m?.area ? fmtArea(m.area) : m?.length ? fmtLen(m.length) : m?.lat != null ? `${m.lat.toFixed(3)}°, ${m.lon.toFixed(3)}°` : '';
            return (
              <li key={s.id} className={s.id === selected?.id ? 'active' : ''}>
                <button
                  className="shape-main"
                  onClick={() => {
                    select(s.id);
                    onFocus(s);
                  }}
                >
                  <span className="shape-icon">{TYPE_ICON[s.type]}</span>
                  <span className="shape-name">{s.name}</span>
                  <span className="shape-summary">{summary}</span>
                </button>
                <button className="panel-toggle-btn" title="Delete" onClick={() => remove(s.id)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {selected && (
        <>
          <section className="layer-section">
            <div className="layer-section-title">Analyse · {selected.name}</div>
            <div className="chip-row">
              <RunButton busy={busy('elevation')} onClick={() => actions.elevation(selected)}>
                {selected.type === 'line' ? 'Elevation profile' : 'Elevation here'}
              </RunButton>
              <RunButton busy={busy('nearby')} onClick={() => actions.nearby(selected)}>
                Nearby features
              </RunButton>
              {selected.type === 'point' && (
                <>
                  <RunButton busy={busy('viewshed')} onClick={() => actions.viewshed(selected)}>
                    What can I see from here
                  </RunButton>
                  <RunButton busy={busy('overhead')} onClick={() => actions.overhead(selected)}>
                    Satellites overhead now
                  </RunButton>
                </>
              )}
            </div>
          </section>

          {isArea(selected) && (
            <>
              <section className="layer-section">
                <div className="layer-section-title">Apply a map to this area only</div>
                <div className="inline-form">
                  <select className="select" value={mapId} onChange={(e) => setMapId(e.target.value)}>
                    {IMAGERY_LAYERS.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <RunButton busy={busy('applied')} onClick={() => actions.applyMap(selected, mapId)}>
                    Apply
                  </RunButton>
                </div>
              </section>

              <section className="layer-section">
                <div className="layer-section-title">Simulate (what if…)</div>

                <div className="sim-block">
                  <div className="sim-title">⛰️ Landslide from this area</div>
                  <div className="slider-row">
                    <span className="slider-label">Depth</span>
                    <input type="range" min="1" max="50" step="1" value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
                    <span className="slider-value">{depth} m</span>
                  </div>
                  <RunButton busy={busy('landslide')} onClick={() => actions.landslide(selected, { depth })}>
                    Run landslide
                  </RunButton>
                </div>

                <div className="sim-block">
                  <div className="sim-title">🌊 Flood / sea-level rise</div>
                  <div className="slider-row">
                    <span className="slider-label">Water +</span>
                    <input type="range" min="0.5" max="30" step="0.5" value={rise} onChange={(e) => setRise(Number(e.target.value))} />
                    <span className="slider-value">{rise} m</span>
                  </div>
                  <RunButton busy={busy('flood')} onClick={() => actions.flood(selected, { rise })}>
                    Run flood
                  </RunButton>
                </div>

                <div className="sim-block">
                  <div className="sim-title">🌊 Tsunami hitting this coast</div>
                  {points.length ? (
                    <>
                      <div className="inline-form">
                        <span className="slider-label">Source</span>
                        <select className="select" value={source?.id || ''} onChange={(e) => setSourceId(e.target.value)}>
                          {points.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="slider-row">
                        <span className="slider-label">Magnitude</span>
                        <input type="range" min="7" max="9.5" step="0.1" value={mw} onChange={(e) => setMw(Number(e.target.value))} />
                        <span className="slider-value">Mw {mw.toFixed(1)}</span>
                      </div>
                      <div className="chip-row">
                        {GROUND.map((g) => (
                          <button key={g.value} className={`chip ${manning === g.value ? 'active' : ''}`} onClick={() => setManning(g.value)}>
                            {g.label}
                          </button>
                        ))}
                      </div>
                      <RunButton busy={busy('tsunami')} onClick={() => actions.tsunami(selected, { source, mw, manning })}>
                        Run tsunami
                      </RunButton>
                    </>
                  ) : (
                    <div className="hint">Draw a Point in the ocean as the earthquake source, then select this area again.</div>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
