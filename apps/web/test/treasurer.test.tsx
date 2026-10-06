import { type Cockpit, TREASURER_TOOLS } from '@bursar/schemas';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cockpitStore } from '../src/studio/store';

// Studio's harness needs a browser it does not get here, so its two builders are stand-ins that hand back
// their configuration: what is under test is what the Treasurer asks for, not Studio's loop.
vi.mock('ag-studio', () => ({
  createAiHarness: (
    _api: unknown,
    build: (ctx: { builtIn: Record<string, { id: string }> }) => unknown,
  ) =>
    build({
      builtIn: {
        data: { id: 'data' },
        page: { id: 'page' },
        widget: { id: 'widget' },
        planning: { id: 'planning' },
      },
    }),
  directLlmRunner: (config: unknown) => config,
}));

const {
  addBlockedByRuleWidget,
  createTreasurerHarness,
  summaries,
  treasurerAdapter,
  treasurerToolDisplay,
  treasurerTools,
} = await import('../src/studio/ai');
const { DEFAULT_STATE } = await import('../src/studio/model');

const usd = (minor: string) => ({ currency: 'USD' as const, minor });
const COCKPIT: Cockpit = {
  generatedAt: '2026-10-05T12:00:00Z',
  envelopes: [
    {
      missionId: 'mis_1',
      status: 'ACTIVE',
      ceiling: usd('100000'),
      held: usd('25196'),
      captured: usd('0'),
      refunded: usd('0'),
      settled: usd('0'),
      usedPercent: 25,
    },
  ],
  decisions: [
    {
      id: 'dec_2',
      actionId: 'act_1',
      type: 'AUTHORIZE',
      state: 'APPROVED',
      outcome: 'ALLOW',
      requiredApprovals: 0,
      amount: usd('25196'),
      evaluatedAt: '2026-10-05T12:05:00Z',
      rules: [{ rule: 'R-MANDATE', outcome: 'ALLOW', message: 'Active' }],
    },
    {
      id: 'dec_1',
      actionId: 'act_1',
      type: 'AUTHORIZE',
      state: 'AWAITING_APPROVAL',
      outcome: 'REQUIRE_APPROVAL',
      requiredApprovals: 1,
      amount: usd('25196'),
      evaluatedAt: '2026-10-05T12:00:00Z',
      rules: [
        {
          rule: 'R-NEW-VENDOR',
          outcome: 'REQUIRE_APPROVAL',
          message: 'First order from this supplier',
        },
        { rule: 'R-MANDATE', outcome: 'ALLOW', message: 'Active' },
      ],
    },
  ],
  ruleHits: [],
  flows: [],
  verification: { confirmed: 1, waiting: 0, unexplained: 0 },
  incidents: [
    {
      id: 'inc_1',
      type: 'UNEXPLAINED_MOVEMENT',
      severity: 'HIGH',
      status: 'OPEN',
      openedAt: '2026-10-05T12:10:00Z',
    },
  ],
};

/** A Studio with just the parts the tools touch: a place to define a tool, and a layout it can read and write. */
function fakeStudio(initial = DEFAULT_STATE) {
  let state = initial;
  return {
    defineAiTool: (config: unknown) => config,
    getState: () => state,
    setState: (next: typeof state) => {
      state = next;
    },
    current: () => state,
  };
}
type Tool = {
  name: string;
  execute: (args: Record<string, unknown>, ctx: unknown) => { response: string };
};
const ctx = { success: (response: string) => ({ response }) };
const run = (
  studio: ReturnType<typeof fakeStudio>,
  name: string,
  args: Record<string, unknown> = {},
) => {
  const tool = (treasurerTools(studio as never) as unknown as Tool[]).find((t) => t.name === name);
  if (tool === undefined) throw new Error(`no tool ${name}`);
  return JSON.parse(tool.execute(args, ctx).response) as { summary: string; added?: boolean };
};

beforeEach(() => cockpitStore.setCockpit(COCKPIT));

describe('the Treasurer', () => {
  it('holds exactly the read-only tools in the shared list, and nothing that moves money', () => {
    const names = (treasurerTools(fakeStudio() as never) as unknown as Tool[]).map((t) => t.name);
    expect([...names].sort()).toEqual([...TREASURER_TOOLS].sort());
    for (const name of names)
      expect(name).not.toMatch(
        /pay|capture|refund|payout|authori[sz]e|order|approve|execute|transfer|send/i,
      );
    expect(Object.keys(treasurerToolDisplay).sort()).toEqual([...TREASURER_TOOLS].sort());
  });

  it('leads Studio’s own agents: it delegates to data, page, widget and planning', () => {
    const delegateTo = vi.fn((ids: readonly string[]) => ({ name: 'delegate', ids }));
    const harness = createTreasurerHarness(
      fakeStudio() as never,
      { executeTurn: vi.fn() } as never,
    ) as unknown as {
      primary: string;
      agents: { id: string; tools?: (c: unknown) => { name: string }[] }[];
      promptStarters: unknown[];
    };
    expect(harness.primary).toBe('treasurer');
    expect(harness.agents.map((a) => a.id)).toEqual([
      'treasurer',
      'data',
      'page',
      'widget',
      'planning',
    ]);
    const tools = harness.agents[0]?.tools?.({ tools: { delegateTo } }) ?? [];
    expect(delegateTo).toHaveBeenCalledWith(['data', 'page', 'widget', 'planning']);
    expect(tools.some((t) => t.name === 'delegate')).toBe(true);
    expect(harness.promptStarters.length).toBeGreaterThan(3);
  });

  it('answers in plain sentences worked out from the cockpit', () => {
    expect(summaries.envelope(COCKPIT)).toBe(
      '25% of the ceiling is in use. Ceiling $1,000.00, held $251.96, captured $0.00, refunded $0.00.',
    );
    expect(summaries.incidents(COCKPIT)).toBe(
      '1 incident open out of 1: unexplained movement (high).',
    );
    expect(summaries.decision(COCKPIT)).toContain(
      'held for approval by R-NEW-VENDOR (First order from this supplier)',
    );
    expect(summaries.simulation(COCKPIT, 'R-NEW-VENDOR')).toContain(
      'would change 1 of the last 2 rulings',
    );
    expect(summaries.simulation(COCKPIT, 'R-MANDATE')).toContain('would not change any');
    expect(summaries.envelope({ ...COCKPIT, envelopes: [] })).toBe('');
  });

  it('says there is nothing to report, rather than inventing it, when the workspace is empty', () => {
    cockpitStore.setCockpit({ ...COCKPIT, envelopes: [], decisions: [], incidents: [] });
    const studio = fakeStudio();
    expect(run(studio, 'get_envelope').summary).toMatch(/nothing to say about the envelope/);
    expect(run(studio, 'explain_decision').summary).toMatch(/nothing to say about rulings/);
    expect(run(studio, 'list_incidents').summary).toBe('There are no incidents.');
    cockpitStore.setCockpit(null);
    expect(run(studio, 'list_incidents').summary).toMatch(/nothing to say/);
  });

  it('builds a "held back by each rule" widget once, and leaves the layout otherwise alone', () => {
    const studio = fakeStudio();
    expect(run(studio, 'add_blocked_by_rule_widget').added).toBe(true);
    const page = studio.current().pages[0] as unknown as {
      widgets: Record<string, { type: string; dataMapping: { legendKey: { id: string }[] } }>;
      widgetLayout: Record<string, { yTrack: number }>;
    };
    expect(page.widgets['blocked-by-rule']?.type).toBe('column-chart-stacked');
    expect(page.widgets['blocked-by-rule']?.dataMapping.legendKey).toEqual([
      { id: 'rules.outcome' },
    ]);
    expect(page.widgetLayout['blocked-by-rule']?.yTrack).toBeGreaterThan(60); // below the others
    expect(page.widgets['envelope']).toBeDefined();
    expect(run(studio, 'add_blocked_by_rule_widget').added).toBe(false);
    expect(addBlockedByRuleWidget({ pages: [], selectedPageId: 'x' } as never)).toBeNull();
  });
});

describe('the Treasurer’s line to the server', () => {
  it('plays a reply back as the events Studio expects, and sends no field it should not', async () => {
    const post = vi.fn(async () => ({
      id: 'r1',
      createdAt: 1,
      output: [
        {
          id: 'm1',
          kind: 'output',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'text', text: 'Hello', annotations: [] }],
        },
        {
          id: 'f1',
          kind: 'output',
          type: 'function_call',
          callId: 'c1',
          name: 'get_envelope',
          arguments: '{}',
        },
        { id: 'x', kind: 'output', type: 'reasoning', summary: [] },
      ],
    }));
    vi.doMock('../src/lib/api', () => ({ api: { post } }));
    vi.resetModules();
    const { treasurerAdapter: adapter } = await import('../src/studio/ai');
    const handler = adapter.executeTurn({
      input: [],
      instructions: 'Be brief',
      tools: [{ name: 'get_envelope', description: 'd', parameters: {} }],
      toolChoice: 'auto',
      responseFormat: { type: 'text' },
    } as never);
    const events: { type: string }[] = [];
    for await (const event of handler.stream as AsyncIterable<{ type: string }>) events.push(event);
    expect(events.map((e) => e.type)).toEqual([
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
    ]);
    expect((await handler.complete).status).toBe('completed');
    expect(post).toHaveBeenCalledWith('/v1/studio/ai/turn', {
      input: [],
      instructions: 'Be brief',
      tools: [{ name: 'get_envelope' }], // names only: Studio's tool descriptions stay in the browser
    });
    expect(treasurerAdapter).toBeDefined();
  });

  it('shows the answer a tool came back with, in the chat row', () => {
    const Detail = (treasurerToolDisplay['get_envelope'] as { detail: (p: never) => ReactNode })
      .detail;
    render(<div>{Detail({ result: JSON.stringify({ summary: '25% in use.' }) } as never)}</div>);
    expect(screen.getByText('25% in use.')).toBeInTheDocument();
    expect(Detail({ result: 'not json' } as never)).toBeNull();
  });
});
