import type { Cockpit } from '@bursar/schemas';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgWidgetParams } from 'ag-studio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STATE, loadLayout, saveLayout, toSources } from '../src/studio/model';
import { cockpitStore } from '../src/studio/store';
import {
  DecisionStream,
  EnvelopeGauge,
  LabScorecard,
  MoneyFlowSankey,
  RuleHeatmap,
  sankey,
  VerificationStatus,
} from '../src/studio/widgets';

const usd = (minor: string) => ({ currency: 'USD' as const, minor });
const COCKPIT: Cockpit = {
  generatedAt: '2026-10-05T12:00:00Z',
  envelopes: [
    {
      missionId: 'mis_1',
      status: 'ACTIVE',
      ceiling: usd('100000'),
      held: usd('30000'),
      captured: usd('50000'),
      refunded: usd('0'),
      settled: usd('0'),
      usedPercent: 80,
    },
  ],
  decisions: [
    {
      id: 'dec_1',
      actionId: 'act_1',
      type: 'AUTHORIZE',
      state: 'AWAITING_APPROVAL',
      outcome: 'REQUIRE_APPROVAL',
      requiredApprovals: 1,
      amount: usd('125000'),
      evaluatedAt: '2026-10-05T12:00:00Z',
      rules: [
        { rule: 'R-NEW-VENDOR', outcome: 'REQUIRE_APPROVAL', message: 'First order' },
        { rule: 'R-MANDATE', outcome: 'ALLOW', message: 'Active' },
      ],
    },
    {
      id: 'dec_2',
      actionId: 'act_2',
      type: 'CAPTURE',
      state: 'CONFIRMED',
      outcome: 'ALLOW',
      requiredApprovals: 0,
      amount: usd('50000'),
      evaluatedAt: '2026-10-05T12:05:00Z',
      rules: [{ rule: 'R-MANDATE', outcome: 'ALLOW', message: 'Active' }],
    },
  ],
  ruleHits: [
    { rule: 'R-NEW-VENDOR', outcome: 'REQUIRE_APPROVAL', count: 1 },
    { rule: 'R-MANDATE', outcome: 'ALLOW', count: 2 },
  ],
  flows: [
    { from: 'Mandate', to: 'Held', amount: usd('30000'), weight: 30000 },
    { from: 'Mandate', to: 'Captured', amount: usd('50000'), weight: 50000 },
    { from: 'Captured', to: 'Refunded', amount: usd('10000'), weight: 10000 },
  ],
  verification: { confirmed: 4, waiting: 1, unexplained: 2 },
  incidents: [],
};

const setDisplayState = vi.fn();
const params = { widgetApi: { setDisplayState } } as unknown as AgWidgetParams;

beforeEach(() => {
  setDisplayState.mockClear();
  cockpitStore.setCockpit(COCKPIT);
  cockpitStore.clearRule();
});
afterEach(() => cleanup());

describe('the custom Studio widgets', () => {
  it('draw the envelope from the server figures and tell Studio they are displayed', () => {
    render(<EnvelopeGauge {...params} />);
    expect(screen.getByRole('img', { name: /80 percent/ })).toBeInTheDocument();
    expect(screen.getByText('$300.00')).toBeInTheDocument(); // held, formatted from exact minor units
    expect(setDisplayState).toHaveBeenLastCalledWith('displayed');
  });

  it('say there is no data, rather than draw an empty picture', () => {
    cockpitStore.setCockpit({ ...COCKPIT, envelopes: [] });
    render(<EnvelopeGauge {...params} />);
    expect(setDisplayState).toHaveBeenLastCalledWith('noData');
  });

  it('narrow the stream to the rule picked in the heatmap, and clear again', async () => {
    render(
      <>
        <RuleHeatmap {...params} />
        <DecisionStream {...params} />
      </>,
    );
    const stream = () => screen.getByRole('list');
    expect(within(stream()).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(
      within(screen.getByRole('table')).getByRole('button', { name: 'R-NEW-VENDOR' }),
    );
    expect(within(stream()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /narrowed to r-new-vendor/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /narrowed to/i }));
    expect(within(stream()).getAllByRole('listitem')).toHaveLength(2);
  });

  it('count verification by status and flag unexplained money', () => {
    render(<VerificationStatus {...params} />);
    expect(screen.getByText('Unexplained').closest('div')).toHaveTextContent('2');
    expect(screen.getByText(/no approved action explains/i)).toBeInTheDocument();
  });

  it('lay the money flow out with a band for each flow', () => {
    render(<MoneyFlowSankey {...params} />);
    expect(screen.getByRole('img', { name: 'Where the money went' })).toBeInTheDocument();
    expect(screen.getByText('Mandate to Captured')).toBeInTheDocument();
    const layout = sankey(COCKPIT.flows);
    expect(layout.links).toHaveLength(3);
    expect(layout.nodes.map((n) => n.name).sort()).toEqual([
      'Captured',
      'Held',
      'Mandate',
      'Refunded',
    ]);
    expect(sankey([]).nodes).toEqual([]);
  });

  it('run the lab on request and show how many attacks got through', async () => {
    const run = {
      policy: 'standard',
      total: 24,
      broken: 0,
      byFamily: { 'split-orders': 12 },
      brokenByFamily: {},
      findings: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(run), { headers: { 'content-type': 'application/json' } }),
      ),
    );
    render(<LabScorecard {...params} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run the lab' }));
    expect(await screen.findByText('attacks tried')).toBeInTheDocument();
    expect(screen.getByText('split orders').closest('li')).toHaveTextContent('0 of 12');
    vi.unstubAllGlobals();
  });
});

describe('the cockpit model', () => {
  it('turns the server figures into tables with declared fields and no sums', () => {
    const { sources } = toSources(COCKPIT);
    expect(sources.map((s) => s.id)).toEqual(['decisions', 'rules', 'incidents']);
    const decisions = sources[0];
    expect(decisions && 'data' in decisions && decisions.data[0]).toMatchObject({
      amount: '$1,250.00',
    });
    // A table with no rows still has its fields, so Studio does not refuse it.
    expect(sources[2] && 'fields' in sources[2] && sources[2].fields?.length).toBeGreaterThan(0);
  });

  it('keeps a layout in this browser, and falls back to the default when storage is unusable', () => {
    expect(loadLayout('org_a')).toBe(DEFAULT_STATE);
    saveLayout('org_a', { pages: [], selectedPageId: 'x' } as never);
    expect(loadLayout('org_a')).toEqual({ pages: [], selectedPageId: 'x' });
    saveLayout('org_a', null);
    expect(loadLayout('org_a')).toBe(DEFAULT_STATE);
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadLayout('org_a')).toBe(DEFAULT_STATE);
    blocked.mockRestore();
  });

  it('refuses nothing it needs: the default layout names only widgets that exist', () => {
    const page = (
      DEFAULT_STATE as unknown as { pages: { widgets: Record<string, { type: string }> }[] }
    ).pages[0];
    const known = new Set([
      'envelope-gauge',
      'verification-status',
      'rule-heatmap',
      'money-flow-sankey',
      'decision-stream',
      'lab-scorecard',
      'donut-chart',
      'column-chart-grouped',
      'grid',
    ]);
    for (const w of Object.values(page?.widgets ?? {})) expect(known.has(w.type)).toBe(true);
    act(() => cockpitStore.clearRule());
  });
});
