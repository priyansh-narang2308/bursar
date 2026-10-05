import type { JsonObject, PolicyOutcome } from '@bursar/schemas';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  explain,
  hashPolicy,
  type Policy,
  type PolicyRule,
  type Rule,
  replay,
} from '../src';

/** A toy cap rule, enough to exercise the engine. The real rules arrive in the next tasks. */
const cap: Rule<{ max: number }> = {
  id: 'R-ITEM-CAP',
  version: 1,
  evaluate: (context, { max }) => {
    const amount = Number(context['minor']);
    return amount > max
      ? {
          outcome: 'DENY',
          message: `${amount} is over the cap of ${max}.`,
          inputs: { amount },
          threshold: max,
        }
      : { outcome: 'ALLOW', message: 'Within the cap.', inputs: { amount }, threshold: max };
  },
};

const big: Rule<{ above: number; approvals: number }> = {
  id: 'R-DUAL',
  version: 1,
  evaluate: (context, { above, approvals }) =>
    Number(context['minor']) > above
      ? { outcome: 'REQUIRE_APPROVAL', message: 'A large amount needs a second look.', approvals }
      : { outcome: 'ALLOW', message: 'Small enough.' },
};

const fixed = (id: 'R-VENDOR' | 'R-TENANT', outcome: PolicyOutcome): Rule<never> => ({
  id,
  version: 1,
  evaluate: () => ({ outcome, message: `${id} says ${outcome}.` }),
});

const policy = (...rules: PolicyRule[]): Policy => ({ rules });
const withCap = { rule: cap as Rule<never>, params: { max: 5_000 } };
const withDual = { rule: big as Rule<never>, params: { above: 1_000, approvals: 1 } };
const context = (minor: number): JsonObject => ({ minor, payee: 'sup_1' });

describe('evaluate', () => {
  it('allows when every rule allows', () => {
    const result = evaluate(policy(withCap, withDual), context(500));
    expect(result).toMatchObject({ outcome: 'ALLOW', requiredApprovals: 0 });
    expect(result.trace.map((r) => r.rule)).toEqual(['R-ITEM-CAP', 'R-DUAL']);
  });

  it('lets the strictest rule win: DENY, then REQUIRE_APPROVAL, then ALLOW', () => {
    expect(evaluate(policy(withCap, withDual), context(2_000)).outcome).toBe('REQUIRE_APPROVAL');
    expect(evaluate(policy(withCap, withDual), context(9_000)).outcome).toBe('DENY');
  });

  it('runs every rule, so the trace explains the whole ruling', () => {
    expect(evaluate(policy(withCap, withDual), context(9_000)).trace).toHaveLength(2);
  });

  it('asks for as many approvers as the strictest rule says, between one and two', () => {
    const asks = (approvals: number) =>
      evaluate(policy({ rule: big as Rule<never>, params: { above: 0, approvals } }), context(5));
    expect([asks(0), asks(1), asks(2), asks(9)].map((e) => e.requiredApprovals)).toEqual([
      1, 1, 2, 2,
    ]);
  });

  it('denies a policy with no rules', () => {
    expect(evaluate(policy(), context(1))).toMatchObject({ outcome: 'DENY', trace: [] });
  });

  describe('fails closed', () => {
    const broken = (evaluateFn: Rule['evaluate']): PolicyRule => ({
      rule: { id: 'R-VENDOR', version: 1, evaluate: evaluateFn } as Rule<never>,
      params: {},
    });

    it.each([
      [
        'throws',
        () => {
          throw new Error('boom');
        },
      ],
      ['answers with no outcome', () => ({ outcome: 'MAYBE', message: 'x' }) as never],
      ['answers with nothing', () => undefined as never],
    ])('denies a rule that %s, without losing the other rules', (_what, fn) => {
      const result = evaluate(policy(withCap, broken(fn)), context(1));
      expect(result.outcome).toBe('DENY');
      expect(result.trace.map((r) => r.outcome)).toEqual(['ALLOW', 'DENY']);
      expect(result.trace[1]?.message).toContain('could not be evaluated');
    });

    it('does not let an error message into the trace', () => {
      const result = evaluate(
        policy(
          broken(() => {
            throw new Error('secret detail');
          }),
        ),
        context(1),
      );
      expect(JSON.stringify(result)).not.toContain('secret detail');
    });

    it('keeps messages within the limit and never blank', () => {
      const loud = broken(() => ({ outcome: 'ALLOW', message: 'x'.repeat(500) }));
      const quiet = broken(() => ({ outcome: 'ALLOW', message: '   ' }));
      const [a, b] = evaluate(policy(loud, quiet), context(1)).trace;
      expect(a?.message).toHaveLength(300);
      expect(b?.message).toBe('No explanation given.');
    });
  });

  it('is deterministic, and does not depend on the order context keys were written in', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20_000 }), (minor) => {
        const a = evaluate(policy(withCap, withDual), { minor, payee: 'sup_1' });
        const b = evaluate(policy(withCap, withDual), { payee: 'sup_1', minor });
        expect(a).toEqual(b);
      }),
    );
  });
});

describe('hashPolicy', () => {
  it('changes with the parameters, the rules and a rule’s version, and with nothing else', () => {
    const base = hashPolicy(policy(withCap, withDual));
    expect(hashPolicy(policy(withCap, withDual))).toBe(base);
    expect(hashPolicy(policy({ ...withCap, params: { max: 5_001 } }, withDual))).not.toBe(base);
    expect(hashPolicy(policy(withCap))).not.toBe(base);
    expect(
      hashPolicy(
        policy({ rule: { ...cap, version: 2 } as Rule<never>, params: { max: 5_000 } }, withDual),
      ),
    ).not.toBe(base);
  });
});

describe('replay', () => {
  const recorded = evaluate(policy(withCap, withDual), context(2_000));

  it('reproduces a recorded ruling', () => {
    expect(replay(policy(withCap, withDual), context(2_000), recorded).reproduced).toBe(true);
  });

  it('notices when the policy or the inputs are not the ones recorded', () => {
    expect(
      replay(policy({ ...withCap, params: { max: 1 } }, withDual), context(2_000), recorded)
        .reproduced,
    ).toBe(false);
    expect(replay(policy(withCap, withDual), context(2_001), recorded).reproduced).toBe(false);
  });
});

describe('explain', () => {
  it('says why, in words', () => {
    expect(explain(evaluate(policy(withCap), context(1)))).toBe('Allowed: every rule passed.');
    expect(explain(evaluate(policy(withCap, withDual), context(2_000)))).toBe(
      'Needs approval from one person: A large amount needs a second look.',
    );
    expect(explain(evaluate(policy(withCap, withDual), context(9_000)))).toBe(
      'Denied: 9000 is over the cap of 5000.',
    );
    expect(explain(evaluate(policy(), context(1)))).toContain('no rules apply');
    const two = evaluate(
      policy({ rule: big as Rule<never>, params: { above: 0, approvals: 2 } }),
      context(5),
    );
    expect(explain(two)).toContain('two different people');
  });
});

describe('golden trace', () => {
  it('stays exactly as reviewed, so a change to a ruling shows up as a diff', async () => {
    const result = evaluate(
      policy(
        withCap,
        withDual,
        { rule: fixed('R-VENDOR', 'ALLOW'), params: {} },
        { rule: fixed('R-TENANT', 'ALLOW'), params: {} },
      ),
      context(2_000),
    );
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot(
      './__snapshots__/golden-trace.json',
    );
  });
});
