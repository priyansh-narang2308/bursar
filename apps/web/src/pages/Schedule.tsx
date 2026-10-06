import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  EmptyState,
  ErrorNote,
  Panel,
  SimBadge,
  TableSkeleton,
  useToast,
} from '../components/ui';
import { api } from '../lib/api';
import { useMissions, useSchedule } from '../lib/queries';
import type { ReplanView, TimingView } from '../lib/types';
import { PageHead } from './parts';

// The Gantt library is large, so it is fetched only when this page is opened.
const ScheduleGantt = lazy(() => import('../components/ScheduleGantt'));

type View = 'plan' | 'delayed' | 'recovered';

function Verdict({ timing }: { timing: TimingView }) {
  const slack = timing.deadlineSlack;
  if (slack === null) return <Badge>No deadline</Badge>;
  const plural = Math.abs(slack) === 1 ? '' : 's';
  if (slack < 0)
    return (
      <Badge tone="bad">
        {-slack} day{plural} late
      </Badge>
    );
  return (
    <Badge tone="ok">{slack === 0 ? 'On the deadline' : `${slack} day${plural} to spare`}</Badge>
  );
}

function Tabs({
  view,
  onView,
  result,
}: {
  view: View;
  onView: (v: View) => void;
  result: ReplanView | null;
}) {
  const tabs: [View, string, boolean][] = [
    ['plan', 'The plan', true],
    ['delayed', 'After the delay', result !== null],
    ['recovered', 'Recovery', result?.recovered != null && result.swaps.length > 0],
  ];
  return (
    <span className="row" role="tablist" aria-label="Schedule view" style={{ gap: 4 }}>
      {tabs
        .filter(([, , shown]) => shown)
        .map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={view === id ? 'btn btn-sm' : 'btn btn-sm btn-ghost'}
            onClick={() => onView(id)}
          >
            {label}
          </button>
        ))}
    </span>
  );
}

function DelayControls({
  days,
  onDays,
  busy,
  onRun,
}: {
  days: number;
  onDays: (d: number) => void;
  busy: boolean;
  onRun: () => void;
}) {
  return (
    <Panel
      title={
        <span className="row">
          Simulate a carrier delay <SimBadge />
        </span>
      }
      action={
        <span className="row">
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">Delay by</span>
            <select
              className="select"
              style={{ width: 90, minHeight: 28, padding: '2px 8px' }}
              value={days}
              onChange={(e) => onDays(Number(e.target.value))}
            >
              {[2, 4, 7].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onRun}>
            Delay the longest delivery
          </button>
        </span>
      }
    >
      <p className="muted">
        The carrier says the longest delivery will be late. The scheduler recomputes the plan and
        looks for the fewest swaps to a faster offer that still meets the deadline.
      </p>
    </Panel>
  );
}

function Recovery({
  result,
  busy,
  onApply,
}: {
  result: ReplanView;
  busy: boolean;
  onApply: () => void;
}) {
  const [first] = result.swaps;
  if (!result.recovered)
    return (
      <div className="callout callout-warn">
        No alternative is fast enough to meet the deadline. A person needs to decide.
      </div>
    );
  if (!first)
    return <div className="callout">The delay is absorbed: the plan still meets its deadline.</div>;
  return (
    <Panel title="Recovery">
      <div className="row-between">
        <span className="muted">
          Swap to <strong style={{ color: 'var(--text)' }}>{first.label}</strong> ({first.leadDays}{' '}
          day{first.leadDays === 1 ? '' : 's'} to deliver). It is only a proposal: policy and a
          person still decide.
        </span>
        {result.applied ? (
          <Link to="/dashboard/approvals" className="btn btn-sm">
            Proposed:{' '}
            {String(result.applied.state ?? '')
              .toLowerCase()
              .replaceAll('_', ' ')}
            . Open approvals
          </Link>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={onApply}
          >
            Propose the recovery
          </button>
        )}
      </div>
    </Panel>
  );
}

/** Which schedule a tab asks for. A tab with nothing behind it shows the plan. */
function timingFor(
  view: View,
  plan: TimingView | undefined,
  result: ReplanView | null,
): TimingView | undefined {
  if (result && view === 'delayed') return result.delayed;
  if (result?.recovered && view === 'recovered') return result.recovered;
  return plan;
}

export function Schedule() {
  const missions = useMissions();
  const [pick, setPick] = useState<string | undefined>();
  const missionId = pick ?? missions.data?.[0]?.id;
  const schedule = useSchedule(missionId);
  const [days, setDays] = useState(4);
  const [result, setResult] = useState<ReplanView | null>(null);
  const [view, setView] = useState<View>('plan');
  const client = useQueryClient();
  const toast = useToast();
  const replan = useMutation({
    mutationFn: (apply: boolean) =>
      api.post<ReplanView>(`/v1/missions/${missionId}/replan`, { days, apply }),
    onSuccess: (r, apply) => {
      setResult(r);
      if (!apply) {
        setView('delayed');
        return;
      }
      toast('ok', 'The recovery was proposed. It goes through the same policy as any purchase.');
      setView('recovered');
      void client.invalidateQueries();
    },
    onError: (e: Error) => toast('bad', (e as { readable?: string }).readable ?? e.message),
  });
  const base = schedule.data;
  const plan = result?.baseline ?? (base?.timings ? (base as TimingView) : undefined);
  const shown = timingFor(view, plan, result);
  const names = result?.names ?? base?.names ?? {};
  const reset = () => {
    setResult(null);
    setView('plan');
  };
  return (
    <div className="content">
      <PageHead
        title="Schedule"
        sub="When each delivery should arrive, what is on the critical path, and what happens when a carrier is late. A recovery is only ever a proposal."
        action={
          missions.data && missions.data.length > 1 ? (
            <select
              className="select"
              style={{ width: 280 }}
              aria-label="Mission"
              value={missionId}
              onChange={(e) => {
                setPick(e.target.value);
                reset();
              }}
            >
              {missions.data.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.goal.slice(0, 60)}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />
      {schedule.isPending && missionId !== undefined && (
        <Panel flush>
          <TableSkeleton rows={5} />
        </Panel>
      )}
      {schedule.isError && (
        <Panel>
          <ErrorNote error={schedule.error} retry={() => void schedule.refetch()} />
        </Panel>
      )}
      {schedule.isSuccess && !plan && (
        <Panel>
          <EmptyState
            title="There is nothing to schedule yet"
            action={
              <Link
                className="btn btn-sm"
                to={missionId ? `/dashboard/missions/${missionId}` : '/dashboard/missions'}
              >
                Run the agents first
              </Link>
            }
          >
            A schedule is made from a mission’s cart. Run the agents on the mission and it will
            appear here.
          </EmptyState>
        </Panel>
      )}
      {plan && shown && base?.start && (
        <>
          <Panel
            title={<Tabs view={view} onView={setView} result={result} />}
            action={<Verdict timing={shown} />}
            flush
          >
            <Suspense fallback={<TableSkeleton rows={6} />}>
              <ScheduleGantt timing={shown} names={names} start={base.start} />
            </Suspense>
          </Panel>
          <DelayControls
            days={days}
            onDays={(d) => {
              setDays(d);
              reset();
            }}
            busy={replan.isPending}
            onRun={() => replan.mutate(false)}
          />
        </>
      )}
      {result && (
        <Recovery result={result} busy={replan.isPending} onApply={() => replan.mutate(true)} />
      )}
    </div>
  );
}
