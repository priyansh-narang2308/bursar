import { describe, expect, it } from 'vitest';
import {
  LLM_TOOL_NAMES,
  LLM_TOOLS,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  MAX_QUERY_LENGTH,
  MAX_RATIONALE_LENGTH,
  MAX_SEARCH_RESULTS,
  proposeCartInputSchema,
  proposeCartRequestSchema,
  RESCHEDULE_REASONS,
  SWAP_REASONS,
} from '../src';
import { id, toolExamples } from './fixtures';
import { problemsOf } from './support';

const names = Object.keys(LLM_TOOLS);

describe('the LLM tool registry', () => {
  it('lists the ten tools, in snake_case, with a description each', () => {
    expect(LLM_TOOL_NAMES).toEqual(names);
    expect(names).toHaveLength(10);
    for (const [name, tool] of Object.entries(LLM_TOOLS)) {
      expect(name).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.description.length).toBeLessThanOrEqual(400);
    }
  });

  it('can only look or propose: no tool has an effect that moves money', () => {
    const effects = new Set(Object.values(LLM_TOOLS).map((tool) => tool.effect));

    expect([...effects].sort()).toEqual(['propose', 'read']);
    expect(
      Object.entries(LLM_TOOLS)
        .filter(([, tool]) => tool.effect === 'propose')
        .map(([name]) => name),
    ).toEqual(['propose_cart', 'request_swap', 'reschedule_task']);
  });

  it('has an example for every tool, which its own schema accepts', () => {
    expect(Object.keys(toolExamples).sort()).toEqual([...names].sort());
    for (const name of LLM_TOOL_NAMES) {
      expect(problemsOf(LLM_TOOLS[name].input, toolExamples[name])).toEqual([]);
    }
  });

  it('refuses an unknown key in any tool, so nothing extra can ride along', () => {
    for (const name of LLM_TOOL_NAMES) {
      expect(problemsOf(LLM_TOOLS[name].input, { ...toolExamples[name], surprise: 1 })).toEqual([
        ': Unrecognized key: "surprise"',
      ]);
    }
  });

  it('reuses the cart-proposal tool as the API request, so there is one shape for both', () => {
    expect(proposeCartRequestSchema).toBe(proposeCartInputSchema);
  });
});

describe('the tools that take no input', () => {
  it.each(['get_org_context', 'get_policy_summary'] as const)(
    '%s accepts only an empty object',
    (name) => {
      expect(problemsOf(LLM_TOOLS[name].input, {})).toEqual([]);
      expect(
        problemsOf(LLM_TOOLS[name].input, { missionId: id('mission') }).length,
      ).toBeGreaterThan(0);
      expect(problemsOf(LLM_TOOLS[name].input, null).length).toBeGreaterThan(0);
    },
  );
});

describe('propose_cart', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(proposeCartInputSchema, { ...toolExamples['propose_cart'], ...overrides });
  const line = (overrides: Record<string, unknown> = {}) => ({
    offerId: id('offer'),
    quantity: 1,
    ...overrides,
  });

  it.each([
    'amount',
    'price',
    'total',
    'currency',
    'payee',
    'unitPrice',
    'cost',
    'budget',
    'paypalEmail',
  ])('refuses a top-level "%s": the model cannot name money', (key) => {
    expect(problems({ [key]: 1 })).toEqual([`: Unrecognized key: "${key}"`]);
  });

  it.each(['amount', 'price', 'lineTotal', 'currency', 'payee', 'unitPrice'])(
    'refuses "%s" on a line',
    (key) => {
      expect(problems({ lines: [line({ [key]: 100 })] })).toEqual([
        `lines.0: Unrecognized key: "${key}"`,
      ]);
    },
  );

  it('takes between one and the maximum number of lines', () => {
    expect(problems({ lines: [] })).toEqual([expect.stringContaining('lines:')]);
    expect(problems({ lines: Array.from({ length: MAX_CART_LINES }, () => line()) })).toEqual([]);
    expect(problems({ lines: Array.from({ length: MAX_CART_LINES + 1 }, () => line()) })).toEqual([
      expect.stringContaining('lines:'),
    ]);
  });

  it.each([0, -1, 1.5, MAX_LINE_QUANTITY + 1, '3', null])('refuses the quantity %j', (quantity) => {
    expect(problems({ lines: [line({ quantity })] })).toEqual([
      expect.stringContaining('lines.0.quantity:'),
    ]);
  });

  it('accepts the smallest and the largest quantity', () => {
    expect(
      problems({ lines: [line({ quantity: 1 }), line({ quantity: MAX_LINE_QUANTITY })] }),
    ).toEqual([]);
  });

  it('needs a real rationale, within its limit', () => {
    expect(problems({ rationale: ' ' })).toEqual([expect.stringContaining('rationale:')]);
    expect(problems({ rationale: 'x'.repeat(MAX_RATIONALE_LENGTH + 1) })).toEqual([
      expect.stringContaining('rationale:'),
    ]);
    expect(problems({ rationale: 'x'.repeat(MAX_RATIONALE_LENGTH) })).toEqual([]);
  });

  it('takes ids of the right kind: an offer is not a mission', () => {
    expect(problems({ missionId: id('offer') })).toEqual([
      expect.stringContaining('missionId: Expected a mission id'),
    ]);
    expect(problems({ lines: [line({ offerId: id('mission') })] })).toEqual([
      expect.stringContaining('lines.0.offerId: Expected an offer id'),
    ]);
  });
});

describe('the other tools', () => {
  const problems = (name: keyof typeof LLM_TOOLS, overrides: Record<string, unknown>) =>
    problemsOf(LLM_TOOLS[name].input, { ...toolExamples[name], ...overrides });

  it('request_swap and reschedule_task accept only the listed reasons', () => {
    for (const reason of SWAP_REASONS) {
      expect(problems('request_swap', { reason })).toEqual([]);
    }
    for (const reason of RESCHEDULE_REASONS) {
      expect(problems('reschedule_task', { reason })).toEqual([]);
    }
    expect(problems('request_swap', { reason: 'BORED' })).toEqual([
      expect.stringContaining('reason:'),
    ]);
    expect(problems('reschedule_task', { reason: 'SUPPLIER_DELAY ' })).toEqual([
      expect.stringContaining('reason:'),
    ]);
  });

  it('reschedule_task takes a UTC instant', () => {
    expect(problems('reschedule_task', { newStart: 'Friday' })).toEqual([
      expect.stringContaining('newStart:'),
    ]);
    expect(problems('reschedule_task', { newStart: '2026-10-09T09:00:00+02:00' })).toEqual([
      expect.stringContaining('newStart:'),
    ]);
  });

  it('search_offers bounds its query and its result count', () => {
    expect(problems('search_offers', { maxResults: 0 })).toEqual([
      expect.stringContaining('maxResults:'),
    ]);
    expect(problems('search_offers', { maxResults: MAX_SEARCH_RESULTS + 1 })).toEqual([
      expect.stringContaining('maxResults:'),
    ]);
    expect(problems('search_offers', { maxResults: MAX_SEARCH_RESULTS })).toEqual([]);
    expect(problems('search_offers', { query: 'x'.repeat(MAX_QUERY_LENGTH + 1) })).toEqual([
      expect.stringContaining('query:'),
    ]);
    expect(problems('search_offers', { query: '' })).toEqual([expect.stringContaining('query:')]);
  });

  it('compare_offers takes two to five offers', () => {
    const offers = (count: number) => Array.from({ length: count }, (_, n) => id('offer', n));

    expect(problems('compare_offers', { offerIds: offers(1) })).toEqual([
      expect.stringContaining('offerIds:'),
    ]);
    expect(problems('compare_offers', { offerIds: offers(2) })).toEqual([]);
    expect(problems('compare_offers', { offerIds: offers(5) })).toEqual([]);
    expect(problems('compare_offers', { offerIds: offers(6) })).toEqual([
      expect.stringContaining('offerIds:'),
    ]);
  });
});
