import React from 'react';
import { DATA_LAYERS, GROUPS } from '../datalayers/registry';

const STATUS_CLASS = { ok: 'ok', loading: 'loading', error: 'error', idle: 'idle' };

/** Chips for one option of a layer (single or multi choice). */
function OptionChips({ layer, schema }) {
  const value = layer.options[schema.key];
  const isOn = (v) => (schema.multi ? value.includes(v) : value === v);
  const pick = (v) => {
    if (!schema.multi) return layer.setOption(schema.key, v);
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    if (next.length) layer.setOption(schema.key, next);
  };
  return (
    <div className="option-row">
      <span className="option-label">{schema.label}</span>
      <div className="chip-row">
        {schema.choices.map((c) => (
          <button key={c.value} className={`chip ${isOn(c.value) ? 'active' : ''}`} onClick={() => pick(c.value)}>
            {c.color && <i className="chip-swatch" style={{ background: c.color }} />}
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LayerRow({ icon, name, on, onToggle, sublabel, statusClass, children }) {
  return (
    <div className={`overlay-item ${on ? 'on' : ''}`}>
      <div className="toggle-row" onClick={onToggle}>
        <div className="toggle-row-info">
          <div className="toggle-row-icon">{icon}</div>
          <div>
            <div className="toggle-row-label">
              {name}
              {statusClass && <span className={`feed-dot inline ${statusClass}`} />}
            </div>
            <div className="toggle-row-sublabel">{sublabel}</div>
          </div>
        </div>
        <div className={`toggle-switch ${on ? 'on' : ''}`} />
      </div>
      {on && children && <div className="layer-settings">{children}</div>}
    </div>
  );
}

/**
 * Layers tab — every data layer grouped (Air, Sea, Space, Sites, Hazards, Weather, Sky)
 * plus the tile overlays. Switched-off layers cost nothing: they aren't created.
 */
export default function DataLayersPanel({ dataLayers, flights, flightsSettings, overlays }) {
  const { enabled, toggle, get } = dataLayers;

  return (
    <div className="data-layers">
      {GROUPS.map((group) => (
        <section className="layer-section" key={group}>
          <div className="layer-section-title">{group}</div>

          {group === 'Air' && (
            <LayerRow
              icon="✈️"
              name="Flights"
              on={flights.enabled}
              onToggle={() => flights.setEnabled(!flights.enabled)}
              sublabel={flights.enabled ? `${flights.stats.shown.toLocaleString()} shown · ${flights.stats.military} military` : 'ADS-B aircraft worldwide'}
              statusClass={flights.enabled ? STATUS_CLASS[flights.feeds.global === 'loading' ? 'loading' : 'ok'] : null}
            >
              {flightsSettings}
            </LayerRow>
          )}

          {DATA_LAYERS.filter((d) => d.group === group).map((def) => {
            const inst = enabled[def.id] ? get(def.id) : null;
            const sublabel = inst
              ? [inst.count ? `${inst.count.toLocaleString()} shown` : null, inst.message].filter(Boolean).join(' · ') || def.note
              : def.note;
            return (
              <LayerRow
                key={def.id}
                icon={def.icon}
                name={def.name}
                on={!!enabled[def.id]}
                onToggle={() => toggle(def.id)}
                sublabel={sublabel}
                statusClass={inst ? STATUS_CLASS[inst.status] : null}
              >
                {inst && inst.optionSchema().map((s) => <OptionChips key={s.key} layer={inst} schema={s} />)}
              </LayerRow>
            );
          })}
        </section>
      ))}

      <section className="layer-section">
        <div className="layer-section-title">Map overlays</div>
        {overlays}
      </section>
    </div>
  );
}
