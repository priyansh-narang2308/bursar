/*
 * A delivery plan is tasks that take whole days and wait for other tasks (optionally plus a lag). Everything
 * here is a pure function of its input: the same plan always gives the same dates, which is what lets a
 * golden test pin them and a replan be explained as a diff.
 */

export interface Dependency {
  readonly id: string;
  /** Days to wait after the predecessor finishes. */
  readonly lag?: number;
}

export interface Task {
  readonly id: string;
  readonly name: string;
  readonly days: number;
  readonly after: readonly Dependency[];
}

export interface Timing {
  readonly id: string;
  /** Earliest start and finish, in days from the plan's start. */
  readonly es: number;
  readonly ef: number;
  /** Latest start and finish that still meet the deadline (or the plan's own end if there is none). */
  readonly ls: number;
  readonly lf: number;
  /** How many days it can slip before the plan is late. Negative means it already is. */
  readonly slack: number;
  readonly critical: boolean;
}

export interface Schedule {
  readonly timings: readonly Timing[];
  /** Day on which the last task finishes. */
  readonly finish: number;
  /** The deadline's day, if one was given, and how many days to spare (negative when missed). */
  readonly deadline: number | null;
  readonly deadlineSlack: number | null;
  /** Tasks with the least slack, in order, from the start. */
  readonly criticalPath: readonly string[];
}

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleError';
  }
}

/** Orders tasks so each follows what it waits for. A cycle or a dangling reference is an error. */
function order(tasks: readonly Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (byId.size !== tasks.length) throw new ScheduleError('Two tasks share an id.');
  const sorted: Task[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (task: Task) => {
    if (state.get(task.id) === 'done') return;
    if (state.get(task.id) === 'visiting')
      throw new ScheduleError(`The plan loops back to ${task.id}.`);
    state.set(task.id, 'visiting');
    for (const dep of task.after) {
      const before = byId.get(dep.id);
      if (before === undefined)
        throw new ScheduleError(`${task.id} waits for ${dep.id}, which is not in the plan.`);
      visit(before);
    }
    state.set(task.id, 'done');
    sorted.push(task);
  };
  for (const task of tasks) visit(task);
  return sorted;
}

const DAY_MS = 86_400_000;
/** The deadline as a day count from the start, rounded up so a deadline mid-day gives the whole day. */
export const dayOf = (start: Date, when: Date): number =>
  Math.ceil((when.getTime() - start.getTime()) / DAY_MS);
export const dateOf = (start: Date, day: number): Date => new Date(start.getTime() + day * DAY_MS);

/** The forward and backward pass. `deadline` is a day count; without one the plan's own end is the target. */
export function schedule(
  tasks: readonly Task[],
  options: { deadline?: number | undefined } = {},
): Schedule {
  const sorted = order(tasks);
  const early = new Map<string, { es: number; ef: number }>();
  for (const t of sorted) {
    const es = Math.max(0, ...t.after.map((d) => (early.get(d.id)?.ef ?? 0) + (d.lag ?? 0)));
    early.set(t.id, { es, ef: es + t.days });
  }
  const finish = Math.max(0, ...[...early.values()].map((e) => e.ef));
  const target = options.deadline ?? finish;
  const late = new Map<string, { ls: number; lf: number }>();
  for (const t of [...sorted].reverse()) {
    const followers = sorted.filter((o) => o.after.some((d) => d.id === t.id));
    const lf = Math.min(
      target,
      ...followers.map(
        (o) => (late.get(o.id)?.ls ?? target) - (o.after.find((d) => d.id === t.id)?.lag ?? 0),
      ),
    );
    late.set(t.id, { ls: lf - t.days, lf });
  }
  const timings = sorted.map((t): Timing => {
    const e = early.get(t.id) ?? { es: 0, ef: 0 };
    const l = late.get(t.id) ?? { ls: 0, lf: 0 };
    return { id: t.id, ...e, ...l, slack: l.ls - e.es, critical: false };
  });
  const least = Math.min(...timings.map((t) => t.slack));
  const marked = timings.map((t) => ({ ...t, critical: t.slack === least }));
  return {
    timings: marked,
    finish,
    deadline: options.deadline ?? null,
    deadlineSlack: options.deadline === undefined ? null : options.deadline - finish,
    criticalPath: marked
      .filter((t) => t.critical)
      .sort((a, b) => a.es - b.es)
      .map((t) => t.id),
  };
}

export interface Change {
  readonly id: string;
  readonly esDelta: number;
  readonly efDelta: number;
  readonly slackDelta: number;
}
export interface Diff {
  readonly finishDelta: number;
  readonly changes: readonly Change[];
  /** Tasks that were on time and are now past the deadline's latest finish. */
  readonly newlyLate: readonly string[];
}

/** What moved between a baseline and a new schedule of the same tasks. */
export function diff(baseline: Schedule, current: Schedule): Diff {
  const before = new Map(baseline.timings.map((t) => [t.id, t]));
  const changes = current.timings.flatMap((t): Change[] => {
    const b = before.get(t.id);
    if (b === undefined) return [];
    const change = {
      id: t.id,
      esDelta: t.es - b.es,
      efDelta: t.ef - b.ef,
      slackDelta: t.slack - b.slack,
    };
    return change.esDelta === 0 && change.efDelta === 0 && change.slackDelta === 0 ? [] : [change];
  });
  return {
    finishDelta: current.finish - baseline.finish,
    changes,
    newlyLate: current.timings
      .filter((t) => t.slack < 0 && (before.get(t.id)?.slack ?? 0) >= 0)
      .map((t) => t.id),
  };
}

// ---------------------------------------------------------------------------------------
// From a basket to a plan, and what can go wrong with it
// ---------------------------------------------------------------------------------------

export interface BasketLine {
  readonly id: string;
  readonly label: string;
  /** Days from the order to delivery, from the supplier. */
  readonly leadDays: number;
}

/** Each line is delivered, then inspected; the handover waits for every inspection. */
export function planFromBasket(
  lines: readonly BasketLine[],
  options: { inspectDays?: number } = {},
): Task[] {
  const inspect = options.inspectDays ?? 1;
  return [
    ...lines.flatMap((l): Task[] => [
      { id: `${l.id}:deliver`, name: `${l.label} delivered`, days: l.leadDays, after: [] },
      {
        id: `${l.id}:inspect`,
        name: `${l.label} inspected`,
        days: inspect,
        after: [{ id: `${l.id}:deliver` }],
      },
    ]),
    {
      id: 'handover',
      name: 'Handover',
      days: 0,
      after: lines.map((l) => ({ id: `${l.id}:inspect` })),
    },
  ];
}

/** A carrier event from the simulator: a delivery runs late, or arrives early. */
export interface CarrierEvent {
  readonly kind: 'DELAY' | 'EARLY';
  readonly taskId: string;
  readonly days: number;
}

export function applyEvent(tasks: readonly Task[], event: CarrierEvent): Task[] {
  if (!tasks.some((t) => t.id === event.taskId))
    throw new ScheduleError(`No task ${event.taskId}.`);
  const change = event.kind === 'DELAY' ? event.days : -event.days;
  return tasks.map((t) =>
    t.id === event.taskId ? { ...t, days: Math.max(0, t.days + change) } : t,
  );
}

export interface Alternative {
  readonly taskId: string;
  readonly offerId: string;
  readonly label: string;
  /** How long this replacement takes to deliver. */
  readonly leadDays: number;
}

export interface Recovery {
  readonly baseline: Schedule;
  readonly delayed: Schedule;
  readonly delayDiff: Diff;
  /** The swaps that bring the plan back inside the deadline, fewest first; empty if it was never late. */
  readonly swaps: readonly Alternative[];
  readonly recovered: Schedule | null;
  readonly recoveryDiff: Diff | null;
}

/**
 * After an event, finds the fewest swaps to a faster alternative that bring the plan back inside its deadline.
 * It tries one swap, then two; if none is enough it says so with `recovered: null` rather than guessing.
 */
export function replan(
  tasks: readonly Task[],
  event: CarrierEvent,
  options: { deadline: number; alternatives: readonly Alternative[] },
): Recovery {
  const baseline = schedule(tasks, { deadline: options.deadline });
  const moved = applyEvent(tasks, event);
  const delayed = schedule(moved, { deadline: options.deadline });
  const base = { baseline, delayed, delayDiff: diff(baseline, delayed) };
  if ((delayed.deadlineSlack ?? 0) >= 0)
    return { ...base, swaps: [], recovered: delayed, recoveryDiff: null };
  const swap = (plan: readonly Task[], a: Alternative) =>
    plan.map((t) => (t.id === a.taskId ? { ...t, days: a.leadDays } : t));
  const usable = options.alternatives.filter((a) =>
    moved.some((t) => t.id === a.taskId && a.leadDays < t.days),
  );
  const tries = [
    ...usable.map((a) => [a]),
    ...usable.flatMap((a, i) =>
      usable
        .slice(i + 1)
        .filter((b) => b.taskId !== a.taskId)
        .map((b) => [a, b]),
    ),
  ];
  for (const swaps of tries) {
    const recovered = schedule(swaps.reduce(swap, moved), { deadline: options.deadline });
    if ((recovered.deadlineSlack ?? 0) >= 0)
      return { ...base, swaps, recovered, recoveryDiff: diff(delayed, recovered) };
  }
  return { ...base, swaps: [], recovered: null, recoveryDiff: null };
}
