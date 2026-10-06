import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  dateOf,
  dayOf,
  diff,
  planFromBasket,
  replan,
  ScheduleError,
  schedule,
  type Task,
} from '../src';

const MON = new Date('2026-10-05T00:00:00Z'); // the plan starts Monday; Friday is day 4
const FRIDAY = dayOf(MON, new Date('2026-10-09T00:00:00Z'));
const basket = planFromBasket([
  { id: 'desks', label: 'Desks', leadDays: 2 },
  { id: 'chairs', label: 'Chairs', leadDays: 3 },
]);
const byId = (s: ReturnType<typeof schedule>, id: string) => s.timings.find((t) => t.id === id);

describe('the forward and backward pass', () => {
  it('works out dates, slack and the critical path (golden)', () => {
    const s = schedule(basket, { deadline: FRIDAY });
    expect(FRIDAY).toBe(4);
    expect(s.finish).toBe(4);
    expect(s.criticalPath).toEqual(['chairs:deliver', 'chairs:inspect', 'handover']);
    expect(byId(s, 'chairs:deliver')).toMatchObject({ es: 0, ef: 3, slack: 0, critical: true });
    expect(byId(s, 'desks:deliver')).toMatchObject({
      es: 0,
      ef: 2,
      ls: 1,
      slack: 1,
      critical: false,
    });
    expect(s.deadlineSlack).toBe(0);
    expect(dateOf(MON, s.finish).toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it('uses the plan’s own end when there is no deadline, and honours lags', () => {
    const tasks: Task[] = [
      { id: 'a', name: 'A', days: 2, after: [] },
      { id: 'b', name: 'B', days: 1, after: [{ id: 'a', lag: 3 }] },
    ];
    const s = schedule(tasks);
    expect(byId(s, 'b')).toMatchObject({ es: 5, ef: 6 });
    expect(s.deadline).toBeNull();
    expect(s.deadlineSlack).toBeNull();
    expect(s.criticalPath).toEqual(['a', 'b']);
  });

  it('refuses a loop, a dangling reference and a repeated id', () => {
    const loop: Task[] = [
      { id: 'a', name: 'A', days: 1, after: [{ id: 'b' }] },
      { id: 'b', name: 'B', days: 1, after: [{ id: 'a' }] },
    ];
    expect(() => schedule(loop)).toThrow(ScheduleError);
    expect(() => schedule([{ id: 'a', name: 'A', days: 1, after: [{ id: 'zzz' }] }])).toThrow(
      /not in the plan/,
    );
    expect(() => schedule([...basket, basket[0] as Task])).toThrow(/share an id/);
  });
});

describe('events, diffs and recovery', () => {
  it('shows chairs arriving four days late missing Friday', () => {
    const late = schedule(
      applyEvent(basket, { kind: 'DELAY', taskId: 'chairs:deliver', days: 4 }),
      { deadline: FRIDAY },
    );
    expect(late.finish).toBe(8);
    expect(late.deadlineSlack).toBe(-4);
    const d = diff(schedule(basket, { deadline: FRIDAY }), late);
    expect(d.finishDelta).toBe(4);
    expect(d.changes.map((c) => c.id)).toContain('handover');
    expect(d.newlyLate).toContain('handover');
    expect(() => applyEvent(basket, { kind: 'DELAY', taskId: 'nope', days: 1 })).toThrow(/No task/);
    expect(applyEvent(basket, { kind: 'EARLY', taskId: 'chairs:deliver', days: 9 })[2]?.days).toBe(
      0,
    );
  });

  it('recovers with the fewest swaps, and says so honestly when it cannot', () => {
    const event = { kind: 'DELAY', taskId: 'chairs:deliver', days: 4 } as const;
    const fast = {
      taskId: 'chairs:deliver',
      offerId: 'ofr_fast',
      label: 'In-stock chairs',
      leadDays: 2,
    };
    const r = replan(basket, event, {
      deadline: FRIDAY,
      alternatives: [fast, { ...fast, offerId: 'ofr_slow', leadDays: 6 }],
    });
    expect(r.delayed.deadlineSlack).toBe(-4);
    expect(r.swaps).toEqual([fast]);
    expect(r.recovered?.deadlineSlack).toBeGreaterThanOrEqual(0);
    expect(r.recoveryDiff?.finishDelta).toBeLessThan(0);
    const none = replan(basket, event, { deadline: FRIDAY, alternatives: [] });
    expect(none).toMatchObject({ swaps: [], recovered: null, recoveryDiff: null });
  });

  it('needs two swaps when one is not enough, and none when nothing is late', () => {
    const two = planFromBasket([
      { id: 'a', label: 'A', leadDays: 3 },
      { id: 'b', label: 'B', leadDays: 3 },
    ]);
    const event = { kind: 'DELAY', taskId: 'a:deliver', days: 3 } as const;
    // Both deliveries are late (a by 3 days, b by the same lateness against a tight deadline of 3 days).
    const alts = [
      { taskId: 'a:deliver', offerId: 'ofr_a', label: 'A fast', leadDays: 1 },
      { taskId: 'b:deliver', offerId: 'ofr_b', label: 'B fast', leadDays: 1 },
    ];
    const r = replan(two, event, { deadline: 2, alternatives: alts });
    expect(r.swaps).toHaveLength(2);
    expect(r.recovered?.deadlineSlack).toBeGreaterThanOrEqual(0);
    const fine = replan(
      basket,
      { kind: 'DELAY', taskId: 'desks:deliver', days: 1 },
      { deadline: FRIDAY, alternatives: [] },
    );
    expect(fine.swaps).toEqual([]);
    expect(fine.recovered).toBe(fine.delayed);
  });
});
