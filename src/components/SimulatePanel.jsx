import React, { useState } from 'react';
import { SCENARIOS, scenarioById } from '../sim/scenarios';
import { isArea } from '../tools/useTools';
import GaugeChart from './GaugeChart';

const MODE_LABEL = {
  swe: { label: 'Full physics', desc: 'Shallow-water equations, event-driven local time stepping' },
  hbg: { label: 'Fast basin model', desc: 'Basin-graph hydrodynamics — whole regions in real time' },
};

function Param({ p, value, onChange }) {
  if (p.choices) {
    return (
      <div className="option-row">
        <span className="option-label">{p.label}</span>
        <div className="chip-row">
          {p.choices.map((c) => (
            <button key={c.value} className={`chip ${value === c.value ? 'active' : ''}`} onClick={() => onChange(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="slider-row">
      <span className="slider-label">{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="slider-value">
        {value} {p.unit}
      </span>
    </div>
  );
}

/**
 * Simulate tab — choose a disaster, an area (drawn in Tools) and parameters, then run the
 * physics engine live on the map.
 */
export default function SimulatePanel({ sim, tools }) {
  const [scenarioId, setScenarioId] = useState('rainfall');
  const scenario = scenarioById(scenarioId);
  const [values, setValues] = useState({});
  const [mode, setMode] = useState('swe');
  const [areaId, setAreaId] = useState('');
  const [pointId, setPointId] = useState('');
  const [buildings, setBuildings] = useState(true);

  const areas = tools.shapes.filter(isArea);
  const points = tools.shapes.filter((s) => s.type === 'point');
  const area = areas.find((a) => a.id === areaId) || areas[areas.length - 1];
  const point = points.find((p) => p.id === pointId) || points[points.length - 1];
  const params = Object.fromEntries(scenario.params.map((p) => [p.key, values[`${scenarioId}.${p.key}`] ?? p.default]));
  const needsPoint = scenario.needs.includes('point');
  const busy = sim.status === 'preparing';
  const running = sim.status === 'running' || sim.status === 'paused' || sim.status === 'done';
  const modeOk = scenario.modes.includes(mode) ? mode : scenario.modes[0];
  const canRun = area && (!needsPoint || point) && !busy;

  return (
    <div className="simulate-panel">
      <section className="layer-section">
        <div className="layer-section-title">Disaster</div>
        <div className="scenario-grid">
          {SCENARIOS.map((s) => (
            <button key={s.id} className={`scenario-card ${s.id === scenarioId ? 'active' : ''}`} onClick={() => setScenarioId(s.id)}>
              <span className="scenario-icon">{s.icon}</span>
              <span>{s.name}</span>
            </button>
          ))}
        </div>
        <p className="hint">{scenario.blurb}</p>
      </section>

      <section className="layer-section">
        <div className="layer-section-title">Where</div>
        {areas.length ? (
          <div className="inline-form">
            <span className="slider-label">{scenario.needs.includes('releaseArea') ? 'Release area' : 'Area'}</span>
            <select className="select" value={area?.id || ''} onChange={(e) => setAreaId(e.target.value)}>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="hint warn">Draw an Area, Box or Circle in the Tools tab first.</div>
        )}
        {needsPoint &&
          (points.length ? (
            <div className="inline-form">
              <span className="slider-label">{scenario.pointLabel}</span>
              <select className="select" value={point?.id || ''} onChange={(e) => setPointId(e.target.value)}>
                {points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="hint warn">Also draw a Point (Tools tab) for the {scenario.pointLabel.toLowerCase()}.</div>
          ))}
      </section>

      <section className="layer-section">
        <div className="layer-section-title">Parameters</div>
        {scenario.params.map((p) => (
          <Param key={p.key} p={p} value={params[p.key]} onChange={(v) => setValues((s) => ({ ...s, [`${scenarioId}.${p.key}`]: v }))} />
        ))}
        {scenario.modes.length > 1 && (
          <div className="option-row">
            <span className="option-label">Engine</span>
            <div className="chip-row">
              {scenario.modes.map((m) => (
                <button key={m} className={`chip ${modeOk === m ? 'active' : ''}`} onClick={() => setMode(m)} title={MODE_LABEL[m].desc}>
                  {MODE_LABEL[m].label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="toggle-row" onClick={() => setBuildings(!buildings)}>
          <div className="toggle-row-info">
            <div className="toggle-row-icon">🏙️</div>
            <div>
              <div className="toggle-row-label">3D buildings</div>
              <div className="toggle-row-sublabel">OpenStreetMap footprints — water flows around them</div>
            </div>
          </div>
          <div className={`toggle-switch ${buildings ? 'on' : ''}`} />
        </div>
      </section>

      <section className="layer-section">
        <div className="sim-actions">
          <button
            className="chip primary"
            disabled={!canRun}
            onClick={() => sim.start({ scenarioId, params, mode: modeOk, area, point, buildings })}
          >
            {busy ? 'Preparing…' : running ? 'Restart' : '▶ Run simulation'}
          </button>
          {running && (
            <button className="chip" onClick={sim.clear}>
              Clear
            </button>
          )}
          {running && scenarioId === 'rainfall' && (
            <button className="chip" onClick={() => sim.instant(params.total, params.soil === 'urban' ? 0.9 : params.soil === 'suburban' ? 0.6 : params.soil === 'rural' ? 0.4 : 1)}>
              Where it collects (instant)
            </button>
          )}
        </div>
        {sim.message && <div className={`hint ${sim.status === 'error' ? 'warn' : ''}`}>{sim.message}</div>}
        {sim.gridInfo && (
          <div className="hint">
            Grid {sim.gridInfo.nx}×{sim.gridInfo.ny} · {sim.gridInfo.cell.toFixed(1)} m cells · {sim.gridInfo.km2.toFixed(2)} km²
            {sim.gridInfo.buildings ? ` · ${sim.gridInfo.buildings.toLocaleString()} buildings` : ''}
          </div>
        )}
        {sim.instantStats && (
          <div className="hint">
            Instant answer: {sim.instantStats.lakes} ponds, deepest {sim.instantStats.deepest.toFixed(2)} m,{' '}
            {(sim.instantStats.ponded / 1e3).toFixed(1)}k m³ held, {(sim.instantStats.lost / 1e3).toFixed(1)}k m³ drains away.
          </div>
        )}
      </section>

      {running && (
        <section className="layer-section">
          <div className="layer-section-title">Gauges</div>
          <button className={`chip ${sim.placingGauge ? 'active' : ''}`} onClick={() => sim.setPlacingGauge(!sim.placingGauge)}>
            {sim.placingGauge ? 'Click on the map…' : '+ Add gauge'}
          </button>
          {sim.gauges.map((g, i) => (
            <GaugeChart key={g.id} gauge={g} index={i + 1} onRemove={() => sim.removeGauge(g.id)} />
          ))}
        </section>
      )}

      <details className="assumptions">
        <summary>Model & assumptions</summary>
        {scenario.assumptions}
        <br />
        <br />
        Engine: finite-volume shallow-water equations (hydrostatic reconstruction + HLLC, porosity buildings) advanced by
        EDLTS, a new event-driven local time-stepping scheduler (blocks sleep when dry or still; mass conserved to
        round-off). Fast mode: HBG, a new basin-graph model — exact hypsometry per depression, weir network with drowned-weir
        submergence, implicit integration. Both are validated against analytic tests in <code>wasm/test/</code>.
      </details>
    </div>
  );
}
