import { describe, expect, it } from 'vitest';
import { MAX_GOAL_LENGTH, MISSION_STATUSES, missionSchema } from '../src';
import { mission, T0, usd } from './fixtures';
import { describeEntityContract, problemsOf } from './support';

describeEntityContract('Mission', missionSchema, mission);

describe('Mission rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(missionSchema, mission(overrides));

  it('lets a draft have no mandate, no envelope and no deadline yet', () => {
    expect(
      problems({ status: 'DRAFT', mandateId: null, envelopeId: null, deadline: null }),
    ).toEqual([]);
  });

  it.each(MISSION_STATUSES)('accepts the status %s', (status) => {
    expect(problems({ status })).toEqual([]);
  });

  it('rejects an unknown status', () => {
    expect(problems({ status: 'DONE' })).toEqual([expect.stringContaining('status:')]);
  });

  it.each([
    ['empty', ''],
    ['blank', '  \n '],
    ['too long', 'x'.repeat(MAX_GOAL_LENGTH + 1)],
    ['not text', 42],
  ])('rejects a goal that is %s', (_label, goal) => {
    expect(problems({ goal })).toEqual([expect.stringContaining('goal:')]);
  });

  it('accepts a goal of exactly the maximum length', () => {
    expect(problems({ goal: 'x'.repeat(MAX_GOAL_LENGTH) })).toEqual([]);
  });

  it('refuses a negative budget', () => {
    expect(problems({ budget: usd('-1') })).toEqual([expect.stringContaining('budget.minor:')]);
  });

  it('cannot be updated before it was created, but can be updated at the same instant', () => {
    expect(problems({ createdAt: '2026-10-05T11:00:00Z', updatedAt: T0 })).toEqual([
      'updatedAt: A mission cannot be updated before it was created',
    ]);
    expect(problems({ createdAt: T0, updatedAt: T0 })).toEqual([]);
  });
});
