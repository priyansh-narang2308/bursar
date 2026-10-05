import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ACTION_STATES,
  ACTION_TYPES,
  type ActionState,
  POLICY_OUTCOMES,
  type PolicyOutcome,
} from '../src/enums';
import {
  ACTION_TRANSITIONS,
  canTransition,
  isTerminalState,
  mergeOutcomes,
  reversibilityRung,
} from '../src/lifecycle';

const targetsOf = (state: ActionState): readonly ActionState[] => ACTION_TRANSITIONS[state];

/** Every state reachable by following zero or more transitions from `start`. */
function reachableFrom(start: ActionState): Set<ActionState> {
  const seen = new Set<ActionState>([start]);
  const queue: ActionState[] = [start];
  for (const state of queue) {
    for (const next of targetsOf(state)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('the action state machine', () => {
  it('has exactly this shape, so any change shows up in review', () => {
    expect(ACTION_TRANSITIONS).toEqual({
      PROPOSED: ['DENIED', 'AWAITING_APPROVAL', 'APPROVED'],
      AWAITING_APPROVAL: ['APPROVED', 'REJECTED', 'EXPIRED'],
      APPROVED: ['SUBMITTING'],
      SUBMITTING: ['SUBMITTED', 'FAILED', 'UNKNOWN', 'DENIED'],
      SUBMITTED: ['CONFIRMED', 'INCIDENT'],
      UNKNOWN: ['SUBMITTED'],
      DENIED: [],
      REJECTED: [],
      EXPIRED: [],
      FAILED: [],
      CONFIRMED: [],
      INCIDENT: [],
    });
  });

  it('covers every state, and only ever leads to a real one', () => {
    expect(Object.keys(ACTION_TRANSITIONS).sort()).toEqual([...ACTION_STATES].sort());
    for (const state of ACTION_STATES) {
      for (const next of targetsOf(state)) {
        expect(ACTION_STATES).toContain(next);
      }
    }
  });

  it('starts at PROPOSED, which nothing leads back to', () => {
    const entered = new Set(ACTION_STATES.flatMap((state) => targetsOf(state)));

    expect(ACTION_STATES.filter((state) => !entered.has(state))).toEqual(['PROPOSED']);
  });

  it('lets every state be reached from PROPOSED', () => {
    expect([...reachableFrom('PROPOSED')].sort()).toEqual([...ACTION_STATES].sort());
  });

  it('has no cycles, so an action only ever moves forward', () => {
    for (const state of ACTION_STATES) {
      const downstream = new Set(targetsOf(state).flatMap((next) => [...reachableFrom(next)]));
      expect(downstream.has(state)).toBe(false);
    }
  });

  it('ends in exactly the six outcomes nothing can change', () => {
    expect(ACTION_STATES.filter(isTerminalState).sort()).toEqual([
      'CONFIRMED',
      'DENIED',
      'EXPIRED',
      'FAILED',
      'INCIDENT',
      'REJECTED',
    ]);
  });

  it('lets every state that is not terminal reach one', () => {
    for (const state of ACTION_STATES.filter((candidate) => !isTerminalState(candidate))) {
      expect([...reachableFrom(state)].some(isTerminalState)).toBe(true);
    }
  });

  it('agrees with canTransition for every pair of states, and never allows staying put', () => {
    for (const from of ACTION_STATES) {
      for (const to of ACTION_STATES) {
        expect(canTransition(from, to)).toBe(targetsOf(from).includes(to));
      }
      expect(canTransition(from, from)).toBe(false);
    }
  });

  it('never lets money skip ahead: nothing is submitted without being approved first', () => {
    const enteringSubmitting = ACTION_STATES.filter((state) => canTransition(state, 'SUBMITTING'));

    expect(enteringSubmitting).toEqual(['APPROVED']);
  });
});

describe('reversibilityRung', () => {
  it.each([
    ['AUTHORIZE', 'HELD'],
    ['REAUTHORIZE', 'HELD'],
    ['CAPTURE', 'CAPTURED'],
    ['PAYOUT', 'SETTLED'],
    ['VOID', null],
    ['REFUND', null],
    ['FREEZE', null],
    ['REVOKE', null],
  ] as const)('puts %s on the %s rung', (type, rung) => {
    expect(reversibilityRung(type)).toBe(rung);
  });

  it('covers every action type', () => {
    expect(ACTION_TYPES.map(reversibilityRung)).toHaveLength(ACTION_TYPES.length);
  });
});

describe('mergeOutcomes', () => {
  const outcomes = fc.array(fc.constantFrom(...POLICY_OUTCOMES), { minLength: 1, maxLength: 12 });

  it.each([
    [['ALLOW'], 'ALLOW'],
    [['ALLOW', 'REQUIRE_APPROVAL'], 'REQUIRE_APPROVAL'],
    [['REQUIRE_APPROVAL', 'DENY', 'ALLOW'], 'DENY'],
    [['DENY'], 'DENY'],
  ] as const)('merges %j into %s', (input, expected) => {
    expect(mergeOutcomes(input)).toBe(expected);
  });

  it('fails closed on no outcomes at all', () => {
    expect(mergeOutcomes([])).toBe('DENY');
  });

  it('is DENY whenever any rule says DENY, and ALLOW only when every rule does', () => {
    fc.assert(
      fc.property(outcomes, (list) => {
        expect(mergeOutcomes(list) === 'DENY').toBe(list.includes('DENY'));
        expect(mergeOutcomes(list) === 'ALLOW').toBe(list.every((outcome) => outcome === 'ALLOW'));
      }),
    );
  });

  it('is one of the outcomes it was given, whatever order they come in', () => {
    fc.assert(
      fc.property(outcomes, (list) => {
        const merged: PolicyOutcome = mergeOutcomes(list);

        expect(list).toContain(merged);
        expect(mergeOutcomes([...list].reverse())).toBe(merged);
        expect(mergeOutcomes([merged, ...list])).toBe(merged);
      }),
    );
  });
});
