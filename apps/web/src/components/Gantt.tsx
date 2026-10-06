import type { TimingView } from '../lib/types';

/** A schedule as bars on a day scale. Critical tasks are brighter, late ones red, and the deadline is a marked line. */
export function Gantt({
  timing,
  names,
  scaleTo,
}: {
  timing: TimingView;
  names: Record<string, string>;
  scaleTo?: number;
}) {
  const days = Math.max(timing.finish, timing.deadline ?? 0, scaleTo ?? 0) + 1;
  const pct = (day: number) => `${(day / days) * 100}%`;
  const ticks = Array.from({ length: days + 1 }, (_, d) => d);
  return (
    <div
      className="gantt"
      role="img"
      aria-label={`Schedule finishing on day ${timing.finish}${timing.deadline === null ? '' : `, deadline day ${timing.deadline}`}`}
    >
      <div className="gantt-axis">
        <span />
        <div className="gantt-track" style={{ height: 24 }}>
          {ticks.map((d) => (
            <span
              key={d}
              className="gantt-tick faint mono"
              style={{ left: pct(d), paddingLeft: 3, fontSize: 10 }}
            >
              {d}
            </span>
          ))}
        </div>
      </div>
      {timing.timings.map((t) => (
        <div key={t.id} className="gantt-row">
          <span className="gantt-name" title={names[t.id] ?? t.id}>
            {names[t.id] ?? t.id}
          </span>
          <div className="gantt-track">
            {ticks.map((d) => (
              <span key={d} className="gantt-tick" style={{ left: pct(d) }} />
            ))}
            <span
              className="gantt-bar"
              data-critical={t.critical}
              data-late={timing.deadline !== null && t.ef > timing.deadline}
              style={{ left: pct(t.es), width: pct(Math.max(t.ef - t.es, 0.15)) }}
            />
            {timing.deadline !== null && (
              <span className="gantt-deadline" style={{ left: pct(timing.deadline) }} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
