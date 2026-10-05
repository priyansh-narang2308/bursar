import type { ActionState, ActionType, PolicyOutcome, ReversibilityRung } from './enums';

/**
 * The legal moves of an action, and the only ones. The graph has no cycles, so an action only ever
 * moves forward, and the database enforces the same table with a trigger.
 *
 * ```
 * PROPOSED ─┬─ DENIED
 *           ├─ AWAITING_APPROVAL ─┬─ APPROVED ─ SUBMITTING ─┬─ SUBMITTED ─┬─ CONFIRMED
 *           │                     ├─ REJECTED               ├─ FAILED     └─ INCIDENT
 *           │                     └─ EXPIRED                ├─ UNKNOWN ─ SUBMITTED
 *           └─ APPROVED                                     └─ DENIED
 * ```
 *
 * The executor claims an action (APPROVED to SUBMITTING) before it re-checks policy, because state
 * can change between approval and execution; if the re-check now says no, SUBMITTING goes to DENIED.
 */
export const ACTION_TRANSITIONS: Readonly<Record<ActionState, readonly ActionState[]>> = {
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
};

/** Whether an action may move from `from` to `to`. Staying in the same state is not a move. */
export function canTransition(from: ActionState, to: ActionState): boolean {
  return ACTION_TRANSITIONS[from].includes(to);
}

/** Whether an action in `state` can never change again. */
export function isTerminalState(state: ActionState): boolean {
  return ACTION_TRANSITIONS[state].length === 0;
}

const RUNGS: Readonly<Record<ActionType, ReversibilityRung | null>> = {
  AUTHORIZE: 'HELD',
  REAUTHORIZE: 'HELD',
  CAPTURE: 'CAPTURED',
  PAYOUT: 'SETTLED',
  VOID: null,
  REFUND: null,
  FREEZE: null,
  REVOKE: null,
};

/**
 * The rung of the reversibility ladder an action's money reaches, or null for actions that undo
 * money (VOID, REFUND) or move none (FREEZE, REVOKE). Policy treats later rungs more strictly.
 */
export function reversibilityRung(type: ActionType): ReversibilityRung | null {
  return RUNGS[type];
}

const SEVERITY: Readonly<Record<PolicyOutcome, number>> = {
  ALLOW: 0,
  REQUIRE_APPROVAL: 1,
  DENY: 2,
};

/**
 * Combines rule outcomes into one: the strictest wins (DENY, then REQUIRE_APPROVAL, then ALLOW).
 * With no outcomes at all it fails closed and returns DENY: a decision nobody evaluated is not a yes.
 */
export function mergeOutcomes(outcomes: readonly PolicyOutcome[]): PolicyOutcome {
  if (outcomes.length === 0) {
    return 'DENY';
  }
  return outcomes.reduce((worst, outcome) =>
    SEVERITY[outcome] > SEVERITY[worst] ? outcome : worst,
  );
}
