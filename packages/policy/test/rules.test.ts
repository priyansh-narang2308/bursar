import { type JsonObject, type JsonValue, RULE_IDS, type RuleId } from '@bursar/schemas';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, evaluate, explain, RULES, standardPolicy } from '../src';

const ORG = 'org_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER_ORG = 'org_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const [SUP_A, SUP_B] = ['sup_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'sup_01ARZ3NDEKTSV4RRFFQ69G5FAW'];
const [OFFER_1, OFFER_2] = ['ofr_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'ofr_01ARZ3NDEKTSV4RRFFQ69G5FAW'];
const usd = (cents: number) => ({ currency: 'USD', minor: String(cents) });

const line = (offerId: string, supplierId: string, quantity: number, unit: number): JsonObject => ({
  offerId,
  supplierId,
  category: 'office',
  quantity,
  unitPrice: usd(unit),
  lineTotal: usd(unit * quantity),
  quotedUnitPrice: usd(unit),
  estimatedArrival: null,
});

const supplier = (id: string, payee: string, priorPayouts = 3): JsonObject => ({
  id,
  orgId: ORG,
  status: 'ACTIVE',
  payee,
  priorPayouts,
});

/** A clean $30 order from a known supplier, under an active mandate, with room in the envelope. */
const base = (): JsonObject => ({
  now: '2026-10-05T12:00:00Z',
  orgId: ORG,
  action: {
    type: 'AUTHORIZE',
    orgId: ORG,
    proposedBy: 'AGENT',
    proposerId: 'agt_1',
    agentRunId: 'run_1',
    amount: usd(3_000),
    supplierId: null,
  },
  mandate: {
    orgId: ORG,
    status: 'ACTIVE',
    validFrom: '2026-10-01T00:00:00Z',
    validTo: '2026-11-01T00:00:00Z',
  },
  envelope: { orgId: ORG, ceiling: usd(100_000), held: usd(0), captured: usd(0) },
  cart: {
    orgId: ORG,
    total: usd(3_000),
    deadline: null,
    lines: [line(OFFER_1, SUP_A, 2, 1_000), line(OFFER_2, SUP_A, 1, 1_000)],
  },
  suppliers: [supplier(SUP_A, 'a@pay.example')],
  recent: [],
  approvals: [],
  payout: null,
});

type Edit = readonly [path: string, value: JsonValue];

/** The base context with some values replaced, by dotted path (`cart.lines.0.quantity`). */
function ctx(...edits: Edit[]): JsonObject {
  const context = base();
  for (const [path, value] of edits) {
    const keys = path.split('.');
    const last = keys.pop() as string;
    let node: unknown = context;
    for (const key of keys) node = (node as Record<string, unknown>)[key];
    (node as Record<string, unknown>)[last] = value;
  }
  return context;
}

const approval = (approverId: string, over: JsonObject = {}): JsonObject => ({
  id: 'apv_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  approverId,
  status: 'APPROVED',
  expiresAt: '2026-10-05T13:00:00Z',
  signatureValid: true,
  cartHashMatches: true,
  policyHashMatches: true,
  ...over,
});

/** What one rule says about a context, with the catalog's default parameters unless given. */
function run(id: RuleId, context: JsonObject, params: unknown = DEFAULT_PARAMS[id]) {
  const result = evaluate({ rules: [RULES[id].use(params)] }, context).trace[0];
  if (result === undefined) throw new Error('no result');
  return result;
}
const outcome = (id: RuleId, context: JsonObject, params?: unknown) =>
  run(id, context, params).outcome;

describe('R-MANDATE', () => {
  it.each(['PENDING', 'FROZEN', 'REVOKED', 'EXPIRED'])('denies a %s mandate', (status) => {
    expect(outcome('R-MANDATE', ctx(['mandate.status', status]))).toBe('DENY');
  });
  it('allows an active mandate inside its window and denies either side of it', () => {
    expect(outcome('R-MANDATE', ctx(['now', '2026-10-01T00:00:00Z']))).toBe('ALLOW');
    expect(outcome('R-MANDATE', ctx(['now', '2026-09-30T23:59:59Z']))).toBe('DENY');
    expect(outcome('R-MANDATE', ctx(['now', '2026-10-31T23:59:59Z']))).toBe('ALLOW');
    expect(outcome('R-MANDATE', ctx(['now', '2026-11-01T00:00:00Z']))).toBe('DENY');
  });
  it('denies when there is no mandate, but never blocks a freeze', () => {
    expect(outcome('R-MANDATE', ctx(['mandate', null]))).toBe('DENY');
    expect(outcome('R-MANDATE', ctx(['mandate.status', 'FROZEN'], ['action.type', 'FREEZE']))).toBe(
      'ALLOW',
    );
  });
});

describe('R-ENVELOPE', () => {
  const room = (held: number, captured: number) =>
    [
      ['envelope.held', usd(held)],
      ['envelope.captured', usd(captured)],
    ] as Edit[];
  it('allows up to the ceiling and denies one cent over', () => {
    expect(outcome('R-ENVELOPE', ctx(...room(60_000, 37_000)))).toBe('ALLOW'); // 97,000 + 3,000 = 100,000
    expect(outcome('R-ENVELOPE', ctx(...room(60_000, 37_001)))).toBe('DENY');
  });
  it('lets a capture take what is held and no more', () => {
    const capture = (cents: number): Edit[] => [
      ['action.type', 'CAPTURE'],
      ['action.amount', usd(cents)],
      ['envelope.held', usd(3_000)],
    ];
    expect(outcome('R-ENVELOPE', ctx(...capture(3_000)))).toBe('ALLOW');
    expect(outcome('R-ENVELOPE', ctx(...capture(3_001)))).toBe('DENY');
  });
  it('denies a currency mismatch and a missing envelope', () => {
    expect(
      outcome('R-ENVELOPE', ctx(['envelope.ceiling', { currency: 'EUR', minor: '100000' }])),
    ).toBe('DENY');
    expect(outcome('R-ENVELOPE', ctx(['envelope', null]))).toBe('DENY');
  });
});

describe('caps', () => {
  it('R-ITEM-CAP allows a line at the cap and denies one cent over', () => {
    const cap = { max: usd(2_000) };
    expect(outcome('R-ITEM-CAP', base(), cap)).toBe('ALLOW');
    expect(outcome('R-ITEM-CAP', base(), { max: usd(1_999) })).toBe('DENY');
    expect(outcome('R-ITEM-CAP', base(), { max: { currency: 'EUR', minor: '2000' } })).toBe('DENY');
  });
  it('R-ORDER-CAP allows an order at the cap and denies one cent over', () => {
    expect(outcome('R-ORDER-CAP', base(), { max: usd(3_000) })).toBe('ALLOW');
    expect(outcome('R-ORDER-CAP', base(), { max: usd(2_999) })).toBe('DENY');
  });
  it('R-ORDER-CAP insists the amount is the cart total, and that there is a cart', () => {
    expect(outcome('R-ORDER-CAP', ctx(['action.amount', usd(2_999)]))).toBe('DENY');
    expect(outcome('R-ORDER-CAP', ctx(['cart', null]))).toBe('DENY');
    expect(outcome('R-ORDER-CAP', ctx(['action.type', 'CAPTURE']))).toBe('ALLOW');
  });
  it('R-CATEGORY caps spend per category', () => {
    const caps = (cents: number) => ({ caps: [{ category: 'office', max: usd(cents) }] });
    expect(outcome('R-CATEGORY', base(), caps(3_000))).toBe('ALLOW');
    expect(outcome('R-CATEGORY', base(), caps(2_999))).toBe('DENY');
    expect(outcome('R-CATEGORY', base(), { caps: [{ category: 'toys', max: usd(1) }] })).toBe(
      'ALLOW',
    );
  });
});

describe('R-VENDOR and R-TENANT', () => {
  it('R-VENDOR needs a registered, active, listed supplier', () => {
    expect(outcome('R-VENDOR', base(), {})).toBe('ALLOW');
    expect(outcome('R-VENDOR', ctx(['suppliers', []]), {})).toBe('DENY');
    expect(outcome('R-VENDOR', ctx(['suppliers.0.status', 'BLOCKED']), {})).toBe('DENY');
    expect(outcome('R-VENDOR', base(), { block: [SUP_A] })).toBe('DENY');
    expect(outcome('R-VENDOR', base(), { allow: [SUP_B] })).toBe('DENY');
    expect(outcome('R-VENDOR', base(), { allow: [SUP_A] })).toBe('ALLOW');
  });
  it('R-TENANT denies anything from another organisation, and names it', () => {
    expect(outcome('R-TENANT', base())).toBe('ALLOW');
    for (const path of [
      'mandate.orgId',
      'cart.orgId',
      'envelope.orgId',
      'action.orgId',
      'suppliers.0.orgId',
    ]) {
      expect(run('R-TENANT', ctx([path, OTHER_ORG])).outcome).toBe('DENY');
    }
  });
});

describe('R-PROVENANCE', () => {
  it('needs an agent run for an agent’s action', () => {
    expect(outcome('R-PROVENANCE', ctx(['action.agentRunId', null]))).toBe('DENY');
    expect(
      outcome('R-PROVENANCE', ctx(['action.agentRunId', null], ['action.proposedBy', 'USER'])),
    ).toBe('ALLOW');
  });
  it.each([
    ['a bad signature', { signatureValid: false }],
    ['a changed cart', { cartHashMatches: false }],
    ['a changed policy', { policyHashMatches: false }],
    ['an expired approval', { expiresAt: '2026-10-05T12:00:00Z' }],
  ])('denies %s', (_what, over) => {
    expect(outcome('R-PROVENANCE', ctx(['approvals', [approval('usr_1', over)]]))).toBe('DENY');
  });
  it('accepts a genuine approval', () => {
    expect(outcome('R-PROVENANCE', ctx(['approvals', [approval('usr_1')]]))).toBe('ALLOW');
  });
});

describe('asking a person', () => {
  const fresh = ctx(['suppliers.0.priorPayouts', 0]);
  it('R-NEW-VENDOR asks, and is satisfied by someone else’s valid approval but not the maker’s own', () => {
    expect(run('R-NEW-VENDOR', fresh)).toMatchObject({ outcome: 'REQUIRE_APPROVAL' });
    expect(
      outcome(
        'R-NEW-VENDOR',
        ctx(['suppliers.0.priorPayouts', 0], ['approvals', [approval('usr_9')]]),
      ),
    ).toBe('ALLOW');
    expect(
      outcome(
        'R-NEW-VENDOR',
        ctx(['suppliers.0.priorPayouts', 0], ['approvals', [approval('agt_1')]]),
      ),
    ).toBe('REQUIRE_APPROVAL');
    expect(
      outcome(
        'R-NEW-VENDOR',
        ctx(
          ['suppliers.0.priorPayouts', 0],
          ['approvals', [approval('usr_9', { signatureValid: false })]],
        ),
      ),
    ).toBe('REQUIRE_APPROVAL');
  });
  it('R-QTY asks above the limit', () => {
    expect(outcome('R-QTY', ctx(['cart.lines.0.quantity', 10]))).toBe('ALLOW');
    expect(outcome('R-QTY', ctx(['cart.lines.0.quantity', 11]))).toBe('REQUIRE_APPROVAL');
  });
  it('R-DELIVERY asks when an item may be late or has no estimate', () => {
    const dated = (arrival: string | null): Edit[] => [
      ['cart.deadline', '2026-10-10T00:00:00Z'],
      ['cart.lines.0.estimatedArrival', arrival],
      ['cart.lines.1.estimatedArrival', '2026-10-09T00:00:00Z'],
    ];
    expect(outcome('R-DELIVERY', ctx(...dated('2026-10-10T00:00:00Z')))).toBe('ALLOW');
    expect(outcome('R-DELIVERY', ctx(...dated('2026-10-10T00:00:01Z')))).toBe('REQUIRE_APPROVAL');
    expect(outcome('R-DELIVERY', ctx(...dated(null)))).toBe('REQUIRE_APPROVAL');
    expect(outcome('R-DELIVERY', base())).toBe('ALLOW');
  });
  it('R-REFUND-AUTH limits what an agent may refund alone', () => {
    const refund = (cents: number, by = 'AGENT'): Edit[] => [
      ['action.type', 'REFUND'],
      ['action.amount', usd(cents)],
      ['action.proposedBy', by],
    ];
    expect(outcome('R-REFUND-AUTH', ctx(...refund(5_000)))).toBe('ALLOW');
    expect(outcome('R-REFUND-AUTH', ctx(...refund(5_001)))).toBe('REQUIRE_APPROVAL');
    expect(outcome('R-REFUND-AUTH', ctx(...refund(500_000, 'USER')))).toBe('ALLOW');
  });
});

describe('R-PRICE-DRIFT', () => {
  const quoted = (cents: number) => ctx(['cart.lines.0.quotedUnitPrice', usd(cents)]);
  it('allows 500 basis points of rise, denies one cent more, and ignores a fall', () => {
    expect(outcome('R-PRICE-DRIFT', quoted(1_050))).toBe('ALLOW');
    expect(outcome('R-PRICE-DRIFT', quoted(1_051))).toBe('DENY');
    expect(outcome('R-PRICE-DRIFT', quoted(10))).toBe('ALLOW');
  });
  it('denies a mixed currency', () => {
    expect(
      outcome(
        'R-PRICE-DRIFT',
        ctx(['cart.lines.0.quotedUnitPrice', { currency: 'EUR', minor: '1000' }]),
      ),
    ).toBe('DENY');
  });
});

describe('R-DUPLICATE', () => {
  const bought = (hoursAgo: number, supplierId = SUP_A) =>
    ctx([
      'recent',
      [
        {
          at: new Date(Date.parse('2026-10-05T12:00:00Z') - hoursAgo * 3_600_000).toISOString(),
          supplierId,
          payee: 'a@pay.example',
          offerIds: [OFFER_1],
          amount: usd(1_000),
        },
      ],
    ]);
  it('asks when the same item from the same supplier was bought inside the window', () => {
    expect(outcome('R-DUPLICATE', bought(23))).toBe('REQUIRE_APPROVAL');
    expect(outcome('R-DUPLICATE', bought(25))).toBe('ALLOW');
    expect(outcome('R-DUPLICATE', bought(1, SUP_B))).toBe('ALLOW');
  });
});

describe('R-VELOCITY', () => {
  const ago = (hours: number) =>
    new Date(Date.parse('2026-10-05T12:00:00Z') - hours * 3_600_000).toISOString();
  const order = (supplierId: string, payee: string, cents: number, hours = 1): JsonObject => ({
    at: ago(hours),
    supplierId,
    payee,
    offerIds: [],
    amount: usd(cents),
  });
  const limits = { windowHours: 24, maxOrders: 5, max: usd(10_000) };

  it('counts orders and spend in the window', () => {
    const many = Array.from({ length: 5 }, () => order(SUP_A, 'a@pay.example', 100));
    expect(outcome('R-VELOCITY', ctx(['recent', many.slice(0, 4)]), limits)).toBe('ALLOW');
    expect(outcome('R-VELOCITY', ctx(['recent', many]), limits)).toBe('REQUIRE_APPROVAL');
    expect(
      outcome('R-VELOCITY', ctx(['recent', [order(SUP_A, 'a@pay.example', 7_000)]]), limits),
    ).toBe('ALLOW'); // 7,000 + 3,000
    expect(
      outcome('R-VELOCITY', ctx(['recent', [order(SUP_A, 'a@pay.example', 7_001)]]), limits),
    ).toBe('REQUIRE_APPROVAL');
    expect(
      outcome('R-VELOCITY', ctx(['recent', [order(SUP_A, 'a@pay.example', 9_000, 30)]]), limits),
    ).toBe('ALLOW'); // outside the window
  });

  it('is not escaped by splitting the buying across suppliers that share a payee', () => {
    // Each earlier order is from a different supplier, and none is large. Together they are one payee.
    const split = [order(SUP_B, 'a@pay.example', 4_000), order(SUP_B, 'a@pay.example', 3_100)];
    const shared = ctx(['recent', split]);
    expect(outcome('R-VELOCITY', shared, limits)).toBe('REQUIRE_APPROVAL');
    const unrelated = ctx(['recent', split.map((o) => ({ ...o, payee: 'someone@else.example' }))]);
    expect(outcome('R-VELOCITY', unrelated, limits)).toBe('ALLOW');
  });
});

describe('R-VELOCITY across the organisation', () => {
  const at = new Date(Date.parse('2026-10-05T12:00:00Z') - 3_600_000).toISOString();
  const spread = Array.from({ length: 4 }, (_, i) => ({
    at,
    supplierId: `sup_01ARZ3NDEKTSV4RRFFQ69G5FA${'XYZ0'[i]}`,
    payee: `p${i}@pay.example`,
    offerIds: [],
    amount: usd(2_000),
  }));
  const limits = { windowHours: 24, maxOrders: 5, max: usd(10_000) };

  it('stops buying split across unrelated suppliers, but only when an organisation limit is set', () => {
    expect(outcome('R-VELOCITY', ctx(['recent', spread]), limits)).toBe('ALLOW'); // each supplier alone is fine
    expect(outcome('R-VELOCITY', ctx(['recent', spread]), { ...limits, orgMax: usd(10_000) })).toBe(
      'REQUIRE_APPROVAL',
    ); // 8,000 + 3,000 together
    expect(
      outcome('R-VELOCITY', ctx(['recent', spread.slice(0, 2)]), {
        ...limits,
        orgMax: usd(10_000),
      }),
    ).toBe('ALLOW');
  });
});

describe('R-DUAL', () => {
  const big = (...more: Edit[]) =>
    ctx(['action.amount', usd(150_000)], ['cart.total', usd(150_000)], ...more);
  it('asks for two people above the threshold and not at it', () => {
    expect(run('R-DUAL', big())).toMatchObject({ outcome: 'REQUIRE_APPROVAL' });
    expect(outcome('R-DUAL', ctx(['action.amount', usd(100_000)]))).toBe('ALLOW');
    expect(outcome('R-DUAL', ctx(['action.amount', usd(100_001)]))).toBe('REQUIRE_APPROVAL');
  });
  it('is satisfied only by two different valid approvers', () => {
    expect(outcome('R-DUAL', big(['approvals', [approval('usr_1')]]))).toBe('REQUIRE_APPROVAL');
    expect(outcome('R-DUAL', big(['approvals', [approval('usr_1'), approval('usr_1')]]))).toBe(
      'REQUIRE_APPROVAL',
    );
    expect(outcome('R-DUAL', big(['approvals', [approval('usr_1'), approval('usr_2')]]))).toBe(
      'ALLOW',
    );
  });
  it('never lets a maker approve their own action', () => {
    expect(outcome('R-DUAL', big(['approvals', [approval('agt_1'), approval('usr_2')]]))).toBe(
      'DENY',
    );
  });
});

describe('R-PAYOUT-GATE', () => {
  const payout = (over: JsonObject = {}): Edit[] => [
    ['action.type', 'PAYOUT'],
    [
      'payout',
      { inspected: true, coolingOffEndsAt: '2026-10-05T12:00:00Z', captureSettled: true, ...over },
    ],
  ];
  it('needs inspection, a closed cooling-off window and a settled capture', () => {
    expect(outcome('R-PAYOUT-GATE', ctx(...payout()))).toBe('ALLOW');
    expect(outcome('R-PAYOUT-GATE', ctx(...payout({ inspected: false })))).toBe('DENY');
    expect(
      outcome('R-PAYOUT-GATE', ctx(...payout({ coolingOffEndsAt: '2026-10-05T12:00:01Z' }))),
    ).toBe('DENY');
    expect(outcome('R-PAYOUT-GATE', ctx(...payout({ captureSettled: false })))).toBe('DENY');
    expect(outcome('R-PAYOUT-GATE', ctx(['action.type', 'PAYOUT'], ['payout', null]))).toBe('DENY');
    expect(outcome('R-PAYOUT-GATE', base())).toBe('ALLOW');
  });
});

describe('the catalog', () => {
  it('has a rule, a summary and valid default parameters for every id in RULE_IDS', () => {
    for (const id of RULE_IDS) {
      expect(RULES[id].id).toBe(id);
      expect(RULES[id].summary.length).toBeGreaterThan(10);
      expect(() => RULES[id].use(DEFAULT_PARAMS[id])).not.toThrow();
    }
    expect(
      standardPolicy()
        .rules.map(({ rule }) => rule.id)
        .sort(),
    ).toEqual([...RULE_IDS].sort());
  });
  it('refuses bad parameters when a policy is written, not when it is used', () => {
    expect(() => RULES['R-ITEM-CAP'].use({})).toThrow();
    expect(() => RULES['R-QTY'].use({ maxPerLine: 0 })).toThrow();
    expect(() => RULES['R-QTY'].use({ unknown: 1 })).toThrow();
  });
  it('denies everything when the context is malformed, because no rule can be trusted to read it', () => {
    const broken = { ...base(), cart: 'not a cart' };
    const result = evaluate(standardPolicy(), broken);
    expect(result.outcome).toBe('DENY');
    expect(result.trace.every((r) => r.outcome === 'DENY')).toBe(true);
  });
});

describe('scenarios with the standard policy', () => {
  const scenarios: Record<string, JsonObject> = {
    'a routine order': base(),
    'a large order from a new supplier': ctx(
      ['action.amount', usd(150_000)],
      ['cart.total', usd(150_000)],
      ['cart.lines.0.unitPrice', usd(50_000)],
      ['cart.lines.0.lineTotal', usd(100_000)],
      ['cart.lines.0.quotedUnitPrice', usd(50_000)],
      ['cart.lines.1.unitPrice', usd(50_000)],
      ['cart.lines.1.lineTotal', usd(50_000)],
      ['cart.lines.1.quotedUnitPrice', usd(50_000)],
      ['suppliers.0.priorPayouts', 0],
      ['envelope.ceiling', usd(1_000_000)],
    ),
    'structuring across suppliers that share a payee': ctx([
      'recent',
      [1, 2, 3].map((hours) => ({
        at: new Date(Date.parse('2026-10-05T12:00:00Z') - hours * 3_600_000).toISOString(),
        supplierId: SUP_B,
        payee: 'a@pay.example',
        offerIds: [],
        amount: usd(120_000),
      })),
    ]),
    'a frozen mandate': ctx(['mandate.status', 'FROZEN']),
  };

  it('behave as reviewed, so a change to a ruling shows up as a diff', async () => {
    const summary = Object.entries(scenarios).map(([name, context]) => {
      const overrides = name.startsWith('a large order')
        ? { 'R-ITEM-CAP': { max: usd(200_000) } }
        : {};
      const result = evaluate(standardPolicy(overrides), context);
      return {
        scenario: name,
        outcome: result.outcome,
        requiredApprovals: result.requiredApprovals,
        explanation: explain(result),
        notAllowed: result.trace
          .filter((r) => r.outcome !== 'ALLOW')
          .map((r) => `${r.rule}: ${r.outcome}`),
      };
    });
    await expect(`${JSON.stringify(summary, null, 2)}\n`).toMatchFileSnapshot(
      './__snapshots__/scenarios.json',
    );
    expect(summary.map((s) => s.outcome)).toEqual([
      'ALLOW',
      'REQUIRE_APPROVAL',
      'REQUIRE_APPROVAL',
      'DENY',
    ]);
    expect(summary[1]?.requiredApprovals).toBe(2);
  });
});
