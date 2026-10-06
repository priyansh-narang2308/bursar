import '@bryntum/gantt/gantt.css';
import '@bryntum/gantt/svalbard-dark.css';
import '@bryntum/gantt/fontawesome/css/fontawesome.css';
import '@bryntum/gantt/fontawesome/css/solid.css';
import { BryntumGantt } from '@bryntum/gantt-react';
import { useMemo } from 'react';
import type { TimingView } from '../lib/types';

const DAY = 86_400_000;

// Bar colours, set on the bar itself: late is red, the critical path is brighter, the rest is quiet.
const barStyle = (critical: boolean, late: boolean): string =>
  late
    ? '--b-sch-event-background:#e5484d;--b-sch-event-color:#fff'
    : critical
      ? '--b-sch-event-background:#7b7d85;--b-sch-event-color:#fff'
      : '';

/**
 * Bryntum Gantt for a delivery schedule. The schedule is worked out on the server (earliest dates, slack, the
 * critical path); this only draws it. Tasks are fixed to those dates and the chart is read-only, so what is on
 * screen is what the scheduler said. Late tasks are red and the critical path is brighter.
 */
export default function ScheduleGantt({
  timing,
  names,
  start,
}: {
  timing: TimingView;
  names: Record<string, string>;
  start: string;
}) {
  const { tasks, dependencies, timeRanges, startDate, endDate } = useMemo(() => {
    const origin = new Date(start).getTime();
    const at = (day: number) => new Date(origin + day * DAY);
    const tasks = timing.timings.map((t) => ({
      id: t.id,
      name: names[t.id] ?? t.id,
      startDate: at(t.es),
      duration: t.ef - t.es,
      durationUnit: 'day',
      manuallyScheduled: true,
      style: barStyle(t.critical, timing.deadline !== null && t.ef > timing.deadline),
    }));
    // Each delivery is followed by its inspection; every inspection feeds the handover.
    const dependencies = timing.timings.flatMap((t) => {
      if (t.id.endsWith(':deliver'))
        return [{ id: `${t.id}>i`, from: t.id, to: t.id.replace(':deliver', ':inspect') }];
      if (t.id.endsWith(':inspect')) return [{ id: `${t.id}>h`, from: t.id, to: 'handover' }];
      return [];
    });
    const days = Math.max(timing.finish, timing.deadline ?? 0) + 1;
    return {
      tasks,
      dependencies,
      timeRanges:
        timing.deadline === null
          ? []
          : [{ id: 'deadline', name: 'Deadline', startDate: at(timing.deadline), duration: 0 }],
      startDate: at(-1),
      endDate: at(days + 1),
    };
  }, [timing, names, start]);

  return (
    <div className="gantt-host">
      <BryntumGantt
        key={`${timing.finish}-${timing.deadlineSlack}-${tasks.length}`}
        tasks={tasks as never}
        dependencies={dependencies as never}
        timeRanges={timeRanges as never}
        startDate={startDate}
        endDate={endDate}
        viewPreset="dayAndWeek"
        columns={[{ type: 'name', field: 'name', width: 280 }]}
        rowHeight={34}
        barMargin={9}
        readOnly
        timeRangesFeature
        projectLinesFeature={false}
        criticalPathsFeature={false}
      />
    </div>
  );
}
