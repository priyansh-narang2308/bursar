import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ACTION_TYPES,
  ACTOR_KINDS,
  actionSchema,
  approvalSchema,
  decisionSchema,
  MAX_TRACE_ENTRIES,
  mergeOutcomes,
  POLICY_OUTCOMES,
  RULE_IDS,
  ruleResultSchema,
} from '../src';
import { action, approval, decision, HASH_A, id, ruleResult, T0, T1, T2, usd } from './fixtures';
import { describeEntityContract, problemsOf } from './support';

describeEntityContract('Action', actionSchema, action);
describeEntityContract('RuleResult', ruleResultSchema, ruleResult);
describeEntityContract('Decision', decisionSchema, decision);
describeEntityContract('Approval', approvalSchema, approval);

describe('Action rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(actionSchema, action(overrides));

  it('needs an amount for the actions that move money, and has none for those that do not', () => {
    for (const type of ['AUTHORIZE', 'CAPTURE', 'REFUND', 'PAYOUT']) {
      const extras = type === 'PAYOUT' ? { supplierId: id('supplier') } : {};
      expect(problems({ type, amount: null, ...extras })).toEqual([
        'amount: This kind of action moves money, so it needs an amount',
      ]);
    }
    for (const type of ['FREEZE', 'REVOKE']) {
      expect(problems({ type, amount: usd('1'), mandateId: id('mandate') })).toEqual([
        'amount: This kind of action moves no money, so it has no amount',
      ]);
    }
  });

  it('lets a VOID or a REAUTHORIZE carry an amount or not', () => {
    for (const type of ['VOID', 'REAUTHORIZE']) {
      expect(problems({ type, amount: null })).toEqual([]);
      expect(problems({ type, amount: usd('1000') })).toEqual([]);
    }
  });

  it('names the supplier on a payout and nowhere else', () => {
    const message = 'supplierId: A payout names the supplier it pays, and nothing else does';

    expect(problems({ type: 'PAYOUT', supplierId: id('supplier') })).toEqual([]);
    expect(problems({ type: 'PAYOUT', supplierId: null })).toEqual([message]);
    expect(problems({ type: 'CAPTURE', supplierId: id('supplier') })).toEqual([message]);
  });

  it('names the mandate on a freeze or a revocation', () => {
    const message = 'mandateId: A freeze or revocation names the mandate it acts on';

    expect(problems({ type: 'FREEZE', amount: null, mandateId: id('mandate') })).toEqual([]);
    expect(problems({ type: 'REVOKE', amount: null, mandateId: null })).toEqual([message]);
  });

  it('keeps a cart and its hash together', () => {
    const message = 'cartHash: A cart and its hash come together';

    expect(problems({ cartId: null, cartHash: null })).toEqual([]);
    expect(problems({ cartId: id('cart'), cartHash: null })).toEqual([message]);
    expect(problems({ cartId: null, cartHash: HASH_A })).toEqual([message]);
  });

  it('lets only a void or a refund undo another action', () => {
    const message = 'compensatesActionId: Only a void or a refund undoes another action';

    expect(problems({ type: 'REFUND', compensatesActionId: id('action', 1) })).toEqual([]);
    expect(problems({ type: 'VOID', amount: null, compensatesActionId: id('action', 1) })).toEqual(
      [],
    );
    expect(problems({ type: 'CAPTURE', compensatesActionId: id('action', 1) })).toEqual([message]);
  });

  it('cannot be updated before it was created', () => {
    expect(problems({ createdAt: T1, updatedAt: T0 })).toEqual([
      'updatedAt: An action cannot be updated before it was created',
    ]);
  });

  it('can never let the Verifier spend, whatever the kind of action', () => {
    const protective = new Set(['FREEZE', 'VOID', 'REFUND', 'REVOKE']);
    const forType = (type: string, proposedBy: string): Record<string, unknown> => ({
      type,
      proposedBy,
      cartId: null,
      cartHash: null,
      amount: ['AUTHORIZE', 'CAPTURE', 'REFUND', 'PAYOUT'].includes(type) ? usd('100') : null,
      supplierId: type === 'PAYOUT' ? id('supplier') : null,
      mandateId: ['FREEZE', 'REVOKE'].includes(type) ? id('mandate') : null,
      compensatesActionId: null,
    });

    fc.assert(
      fc.property(
        fc.constantFrom(...ACTION_TYPES),
        fc.constantFrom(...ACTOR_KINDS),
        (type, who) => {
          const issues = problems(forType(type, who));

          if (who === 'VERIFIER' && !protective.has(type)) {
            expect(issues).toEqual([
              'type: The Verifier can protect (freeze, void, refund, revoke) but can never spend',
            ]);
          } else {
            expect(issues).toEqual([]);
          }
        },
      ),
    );
  });
});

describe('RuleResult rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(ruleResultSchema, ruleResult(overrides));

  it.each(RULE_IDS)('accepts the rule %s', (rule) => {
    expect(problems({ rule })).toEqual([]);
  });

  it('rejects a rule that is not in the catalog, or an explanation that is blank', () => {
    expect(problems({ rule: 'R-MADE-UP' })).toEqual([expect.stringContaining('rule:')]);
    expect(problems({ message: ' ' })).toEqual([expect.stringContaining('message:')]);
  });

  it('records what the rule looked at, as JSON', () => {
    expect(problems({ inputs: {}, threshold: null })).toEqual([]);
    expect(problems({ inputs: { nested: { list: [1, 'a', null] } }, threshold: 5 })).toEqual([]);
    expect(problems({ inputs: [1, 2] })).toEqual([expect.stringContaining('inputs:')]);
  });
});

describe('Decision rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(decisionSchema, decision(overrides));
  const strictest = 'outcome: The decision must be exactly as strict as its strictest rule';
  const approvals =
    'requiredApprovals: Approvals are required exactly when the outcome asks for them';

  it('is exactly as strict as its strictest rule', () => {
    const trace = [ruleResult(), ruleResult({ rule: 'R-QTY', outcome: 'DENY' })];

    expect(problems({ trace, outcome: 'ALLOW' })).toEqual([strictest]);
    expect(problems({ trace, outcome: 'DENY' })).toEqual([]);
  });

  it('asks for approvals exactly when the outcome is to require approval', () => {
    const trace = [ruleResult({ outcome: 'REQUIRE_APPROVAL' })];

    expect(problems({ trace, outcome: 'REQUIRE_APPROVAL', requiredApprovals: 1 })).toEqual([]);
    expect(problems({ trace, outcome: 'REQUIRE_APPROVAL', requiredApprovals: 2 })).toEqual([]);
    expect(problems({ trace, outcome: 'REQUIRE_APPROVAL', requiredApprovals: 0 })).toEqual([
      approvals,
    ]);
    expect(problems({ requiredApprovals: 1 })).toEqual([approvals]);
  });

  it('needs at least one rule result, and at most the maximum', () => {
    expect(problems({ trace: [] })).toEqual([expect.stringContaining('trace:')]);
    expect(
      problems({ trace: Array.from({ length: MAX_TRACE_ENTRIES }, () => ruleResult()) }),
    ).toEqual([]);
    expect(
      problems({ trace: Array.from({ length: MAX_TRACE_ENTRIES + 1 }, () => ruleResult()) }),
    ).toEqual([expect.stringContaining('trace:')]);
  });

  it('allows at most two approvers', () => {
    expect(problems({ requiredApprovals: 3 })).toEqual([
      expect.stringContaining('requiredApprovals:'),
    ]);
  });

  it('is valid for any trace exactly when its outcome is the merge of the rule outcomes', () => {
    const outcomes = fc.array(fc.constantFrom(...POLICY_OUTCOMES), { minLength: 1, maxLength: 10 });

    fc.assert(
      fc.property(outcomes, fc.constantFrom(...POLICY_OUTCOMES), (list, claimed) => {
        const trace = list.map((outcome) => ruleResult({ outcome }));
        const merged = mergeOutcomes(list);
        const requiredApprovals = claimed === 'REQUIRE_APPROVAL' ? 1 : 0;

        expect(problems({ trace, outcome: claimed, requiredApprovals }).length === 0).toBe(
          claimed === merged,
        );
      }),
    );
  });
});

describe('Approval rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(approvalSchema, approval(overrides));
  const pending = { status: 'PENDING', approverId: null, signature: null, decidedAt: null };

  it('has the right shape for each status', () => {
    expect(problems(pending)).toEqual([]);
    expect(problems({ status: 'APPROVED' })).toEqual([]);
    expect(problems({ status: 'REJECTED', signature: null })).toEqual([]);
    expect(problems({ ...pending, status: 'EXPIRED' })).toEqual([]);
  });

  it('records when someone decided, exactly when they approved or rejected', () => {
    const message =
      'decidedAt: A decision time is recorded exactly when someone approved or rejected';

    expect(problems({ ...pending, decidedAt: T1 })).toEqual(
      [message, 'signature: A signature is present exactly when the approval was given'].slice(
        0,
        1,
      ),
    );
    expect(problems({ status: 'APPROVED', decidedAt: null })).toEqual([message]);
    expect(problems({ status: 'REJECTED', signature: null, decidedAt: null })).toEqual([message]);
  });

  it('names whoever decided', () => {
    expect(problems({ status: 'APPROVED', approverId: null })).toEqual([
      'approverId: Someone who decided is named',
    ]);
  });

  it('carries a signature exactly when it was approved', () => {
    const message = 'signature: A signature is present exactly when the approval was given';

    expect(problems({ status: 'APPROVED', signature: null })).toEqual([message]);
    expect(problems({ status: 'REJECTED' })).toEqual([message]);
  });

  it.each([
    ['too short', 'abc'],
    ['with a space', `${'a'.repeat(20)} b`],
    ['with padding characters', `${'a'.repeat(20)}==`],
    ['too long', 'a'.repeat(513)],
  ])('rejects a signature that is %s', (_label, signature) => {
    expect(problems({ signature })).toEqual([expect.stringContaining('signature:')]);
  });

  it('accepts a hex or a base64url signature', () => {
    expect(problems({ signature: 'ab'.repeat(32) })).toEqual([]);
    expect(problems({ signature: 'A-Za-z0-9_-A-Za-z0-9_-' })).toEqual([]);
  });

  it('binds to a cart hash and a policy hash, and expires', () => {
    expect(problems({ cartHash: 'nope' })).toEqual([expect.stringContaining('cartHash:')]);
    expect(problems({ policyHash: 'nope' })).toEqual([expect.stringContaining('policyHash:')]);
    expect(problems({ expiresAt: 'tomorrow' })).toEqual([expect.stringContaining('expiresAt:')]);
    expect(problems({ expiresAt: T2 })).toEqual([]);
  });
});
