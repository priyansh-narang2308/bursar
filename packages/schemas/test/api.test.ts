import { describe, expect, it } from 'vitest';
import {
  approveActionRequestSchema,
  createMissionRequestSchema,
  decisionPageSchema,
  listDecisionsQuerySchema,
  MAX_GOAL_LENGTH,
  MAX_PAGE_SIZE,
  mandateActionRequestSchema,
  proposalResultSchema,
  rejectActionRequestSchema,
} from '../src';
import {
  approveActionRequest,
  createMissionRequest,
  decision,
  HASH_A,
  id,
  mandateActionRequest,
  proposalResult,
  rejectActionRequest,
  T1,
  usd,
} from './fixtures';
import { describeEntityContract, problemsOf } from './support';

describeEntityContract('CreateMissionRequest', createMissionRequestSchema, createMissionRequest);
describeEntityContract('ProposalResult', proposalResultSchema, proposalResult);
describeEntityContract('ApproveActionRequest', approveActionRequestSchema, approveActionRequest);
describeEntityContract('RejectActionRequest', rejectActionRequestSchema, rejectActionRequest);
describeEntityContract('MandateActionRequest', mandateActionRequestSchema, mandateActionRequest);

describe('CreateMissionRequest rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(createMissionRequestSchema, createMissionRequest(overrides));

  it('takes a goal, a deadline that may be absent, and a budget', () => {
    expect(problems({ deadline: null })).toEqual([]);
    expect(problems({ goal: ' ' })).toEqual([expect.stringContaining('goal:')]);
    expect(problems({ goal: 'x'.repeat(MAX_GOAL_LENGTH + 1) })).toEqual([
      expect.stringContaining('goal:'),
    ]);
    expect(problems({ budget: usd('-1') })).toEqual([expect.stringContaining('budget.minor:')]);
  });

  it('does not let a client choose the state of what it creates', () => {
    for (const key of ['status', 'id', 'orgId', 'mandateId', 'createdAt']) {
      expect(problems({ [key]: 'x' })).toEqual([`: Unrecognized key: "${key}"`]);
    }
  });
});

describe('ProposalResult rules', () => {
  it('is the cart, the action and the decision, each valid on its own', () => {
    expect(
      problemsOf(proposalResultSchema, proposalResult({ decision: decision({ outcome: 'DENY' }) })),
    ).toEqual(['decision.outcome: The decision must be exactly as strict as its strictest rule']);
  });
});

describe('ApproveActionRequest rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(approveActionRequestSchema, approveActionRequest(overrides));

  it('echoes the hashes the approver was shown', () => {
    expect(problems({ cartHash: 'nope' })).toEqual([expect.stringContaining('cartHash:')]);
    expect(problems({ policyHash: HASH_A.toUpperCase() })).toEqual([
      expect.stringContaining('policyHash:'),
    ]);
  });

  it('cannot be used to choose who approves, or to bring a signature of its own', () => {
    for (const key of ['approverId', 'signature', 'status', 'decidedAt', 'expiresAt']) {
      expect(problems({ [key]: id('user') })).toEqual([`: Unrecognized key: "${key}"`]);
    }
  });
});

describe('RejectActionRequest and MandateActionRequest rules', () => {
  it('need a real reason, which is kept in the audit log', () => {
    expect(problemsOf(rejectActionRequestSchema, rejectActionRequest({ reason: '  ' }))).toEqual([
      expect.stringContaining('reason:'),
    ]);
    expect(
      problemsOf(rejectActionRequestSchema, rejectActionRequest({ reason: 'x'.repeat(501) })),
    ).toEqual([expect.stringContaining('reason:')]);
    expect(problemsOf(mandateActionRequestSchema, mandateActionRequest({ reason: '' }))).toEqual([
      expect.stringContaining('reason:'),
    ]);
    expect(problemsOf(mandateActionRequestSchema, {})).toEqual([
      expect.stringContaining('reason:'),
    ]);
  });
});

describe('listDecisionsQuerySchema', () => {
  it('has a default page size and takes optional filters', () => {
    expect(listDecisionsQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(
      listDecisionsQuerySchema.parse({
        missionId: id('mission'),
        outcome: 'DENY',
        phase: 'EXECUTE',
        limit: '5',
        cursor: 'abc',
      }),
    ).toEqual({
      missionId: id('mission'),
      outcome: 'DENY',
      phase: 'EXECUTE',
      limit: 5,
      cursor: 'abc',
    });
  });

  it('refuses a filter of the wrong kind, an unknown filter, and a page that is too big', () => {
    expect(problemsOf(listDecisionsQuerySchema, { missionId: id('action') })).toEqual([
      expect.stringContaining('missionId:'),
    ]);
    expect(problemsOf(listDecisionsQuerySchema, { outcome: 'MAYBE' })).toEqual([
      expect.stringContaining('outcome:'),
    ]);
    expect(problemsOf(listDecisionsQuerySchema, { phase: 'LATER' })).toEqual([
      expect.stringContaining('phase:'),
    ]);
    expect(problemsOf(listDecisionsQuerySchema, { orgId: id('organization') })).toEqual([
      ': Unrecognized key: "orgId"',
    ]);
    expect(
      problemsOf(listDecisionsQuerySchema, {
        limit: String(MAX_PAGE_SIZE + 1),
      }),
    ).toEqual([expect.stringContaining('limit:')]);
  });
});

describe('decisionPageSchema', () => {
  it('is a page of decisions', () => {
    expect(problemsOf(decisionPageSchema, { items: [decision()], nextCursor: null })).toEqual([]);
    expect(
      problemsOf(decisionPageSchema, {
        items: [decision({ outcome: 'DENY' })],
        nextCursor: 'next',
      }),
    ).toEqual(['items.0.outcome: The decision must be exactly as strict as its strictest rule']);
    expect(problemsOf(decisionPageSchema, { items: [], nextCursor: T1 })).toEqual([]);
  });
});
