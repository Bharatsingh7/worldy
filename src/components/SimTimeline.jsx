import React from 'react';

const SPEEDS = [1, 10, 60, 120, 300, 600, 1800, 3600];
const clock = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

/** Floating timeline while a simulation exists: play/pause, speed, clock and live numbers. */
export default function SimTimeline({ sim }) {
  const { status, stats, active } = sim;
  if (!active) return null;
  const playing = status === 'running';
  return (
    <div className="sim-timeline glass-panel">
      <button className="nav-btn" onClick={playing ? sim.pause : sim.resume} title={playing ? 'Pause' : 'Play'} disabled={status === 'done'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="sim-clock">
        <span className="sim-name">
          {active.scenario.icon} {active.scenario.name}
        </span>
        <span className="sim-time">{stats ? clock(stats.t) : '0:00:00'}</span>
      </div>
      <select className="select speed" value={sim.speed} onChange={(e) => sim.setSpeed(Number(e.target.value))} title="Simulation speed">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            ×{s}
          </option>
        ))}
      </select>
      {stats && (
        <div className="sim-stats">
          {stats.eye && <span>🌀 {Math.round(stats.eye.vmax * 3.6)} km/h · −{Math.round(stats.eye.dp)} hPa</span>}
          {stats.uplift != null && stats.t < 60 && <span>seafloor +{stats.uplift.toFixed(1)} m</span>}
          {stats.rainRate > 0 && <span>🌧 {stats.rainRate.toFixed(0)} mm/h</span>}
          {stats.maxDepth != null && <span>max {stats.maxDepth.toFixed(2)} m</span>}
          {stats.wetArea != null && <span>flooded {(stats.wetArea / 1e6).toFixed(2)} km²</span>}
          {stats.burntArea != null && <span>🔥 burnt {(stats.burntArea / 1e6).toFixed(2)} km² · head {stats.headRos.toFixed(0)} m/min</span>}
          {stats.plumeArea != null && <span>💨 covers {(stats.plumeArea / 1e6).toFixed(1)} km²</span>}
          {stats.awake != null && active.mode === 'swe' && <span title="Blocks being computed (others sleep)">⚙ {stats.awake}</span>}
        </div>
      )}
      {status === 'done' && <span className="sim-done">finished</span>}
    </div>
  );
}
