import type { Cockpit, TreasurerTool } from '@bursar/schemas';
import {
  type AgAiConversationItem,
  type AgAiEvent,
  type AgAiOutputItem,
  type AgAiToolDetailParams,
  type AgLlmAdapter,
  type AgLlmRequest,
  type AgLlmResponse,
  type AgReportState,
  type AgStudioApi,
  createAiHarness,
  directLlmRunner,
} from 'ag-studio';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { cockpitStore } from './store';

/*
 * The Treasurer: Studio's assistant, tuned to this product. It leads; Studio's own data, page, widget and
 * planning agents do the building when it hands work over. Everything it can call is read-only and listed in
 * `TREASURER_TOOLS`: none names an amount, a payee or an account, and none can move money. Its words come from
 * the server (`POST /v1/studio/ai/turn`), which is scripted today and would call a model behind the same door.
 */

interface TurnReply {
  id: string;
  createdAt: number;
  output: AgAiOutputItem[];
}

/** The events Studio expects for one item the model produced: a message, or a call to a tool. */
function* eventsOf(item: AgAiOutputItem): Generator<AgAiEvent> {
  if (item.type === 'function_call') {
    yield { type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name };
    yield { type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments };
    yield { type: 'TOOL_CALL_END', toolCallId: item.callId };
  } else if (item.type === 'message') {
    for (const part of item.content) {
      if (part.type !== 'text') continue;
      yield { type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' };
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: part.text };
      yield { type: 'TEXT_MESSAGE_END', messageId: item.id };
    }
  }
}

/** Sends one turn to the server and plays the reply back as the events Studio expects. */
export const treasurerAdapter: AgLlmAdapter = {
  executeTurn(request: AgLlmRequest) {
    const reply = api
      .post<TurnReply>('/v1/studio/ai/turn', {
        input: request.input as AgAiConversationItem[],
        ...(request.instructions === undefined ? {} : { instructions: request.instructions }),
        tools: (request.tools ?? []).map(({ name }) => ({ name })),
      })
      .catch((error: unknown) => {
        throw error instanceof Error ? error : new Error('The assistant could not be reached.');
      });
    return {
      stream: {
        async *[Symbol.asyncIterator]() {
          for (const item of (await reply).output) yield* eventsOf(item);
        },
      },
      complete: reply.then(
        (r): AgLlmResponse => ({
          id: r.id,
          createdAt: r.createdAt,
          status: 'completed',
          output: r.output,
        }),
      ),
    };
  },
};

// ---------------------------------------------------------------------------------------------------
// The read-only tools. Each answers in a sentence the Treasurer can say back, worked out here from the
// cockpit the server sent; none adds up money.
// ---------------------------------------------------------------------------------------------------

const noun = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const summaries = {
  envelope(cockpit: Cockpit): string {
    const e = cockpit.envelopes[0];
    if (e === undefined) return '';
    const money = (m: { minor: string; currency: string }) => formatMoney(m.minor, m.currency);
    return `${e.usedPercent}% of the ceiling is in use. Ceiling ${money(e.ceiling)}, held ${money(e.held)}, captured ${money(e.captured)}, refunded ${money(e.refunded)}.`;
  },
  incidents(cockpit: Cockpit): string {
    const open = cockpit.incidents.filter((i) => i.status !== 'RESOLVED');
    if (cockpit.incidents.length === 0) return '';
    const names = open
      .slice(0, 3)
      .map((i) => `${i.type.toLowerCase().replaceAll('_', ' ')} (${i.severity.toLowerCase()})`);
    return `${noun(open.length, 'incident')} open out of ${cockpit.incidents.length}${names.length > 0 ? `: ${names.join(', ')}` : ''}.`;
  },
  decision(cockpit: Cockpit): string {
    // The ruling worth explaining is the latest one that held something back, or else the latest of all.
    const d = cockpit.decisions.find((x) => x.outcome !== 'ALLOW') ?? cockpit.decisions[0];
    if (d === undefined) return '';
    const held = d.rules.filter((r) => r.outcome !== 'ALLOW');
    const what = d.type.toLowerCase();
    if (held.length === 0)
      return `The latest ruling, an ${what}, was allowed: all ${d.rules.length} rules passed.`;
    const outcome = d.outcome === 'DENY' ? 'denied' : 'held for approval';
    return `The latest ruling that needed a person, an ${what}, was ${outcome} by ${held.map((r) => `${r.rule} (${r.message})`).join('; ')}.`;
  },
  simulation(cockpit: Cockpit, rule: string): string {
    const total = cockpit.decisions.length;
    if (total === 0) return '';
    const changed = cockpit.decisions.filter((d) => {
      const others = d.rules.filter((r) => r.rule !== rule && r.outcome !== 'ALLOW');
      const mine = d.rules.find((r) => r.rule === rule && r.outcome !== 'ALLOW');
      return mine !== undefined && others.length === 0;
    }).length;
    if (changed === 0)
      return `Removing ${rule} would not change any of the last ${noun(total, 'ruling')}. Nothing was changed.`;
    return `Removing ${rule} would change ${changed} of the last ${noun(total, 'ruling')}, because it is the only rule holding ${changed === 1 ? 'it' : 'them'} back. Nothing was changed.`;
  },
};

const BLOCKED_WIDGET = 'blocked-by-rule';

/** Adds the "held back by each rule" chart to the cockpit, unless it is already there. */
export function addBlockedByRuleWidget(state: AgReportState<never>): AgReportState<never> | null {
  const page = state.pages.find((p) => p.id === state.selectedPageId) ?? state.pages[0];
  if (page === undefined || BLOCKED_WIDGET in (page.widgets ?? {})) return null;
  const rows = Object.values(page.widgetLayout ?? {}).map(
    (l) => (l?.yTrack ?? 0) + (l?.ySpan ?? 0),
  );
  const widget = {
    type: 'column-chart-stacked',
    format: { title: { text: 'Held back by each rule', enabled: true } },
    dataMapping: {
      categoryKey: [{ id: 'rules.rule' }],
      valueKey: [{ id: 'rules.decision', aggregation: 'count' }],
      legendKey: [{ id: 'rules.outcome' }],
    },
  };
  const next = {
    ...state,
    pages: state.pages.map((p) =>
      p !== page
        ? p
        : ({
            ...p,
            widgets: { ...p.widgets, [BLOCKED_WIDGET]: widget },
            widgetLayout: {
              ...p.widgetLayout,
              [BLOCKED_WIDGET]: { xTrack: 0, yTrack: Math.max(0, ...rows), xSpan: 24, ySpan: 22 },
            },
          } as unknown as typeof p),
    ),
  };
  return next as AgReportState<never>;
}

const reply = (summary: string, extra: object = {}) => JSON.stringify({ summary, ...extra });

/** The Treasurer's tools, built against a live Studio. */
export function treasurerTools(studio: AgStudioApi) {
  const read = () => cockpitStore.get().cockpit;
  const empty = (what: string) =>
    reply(`There is nothing to say about ${what} yet. Run the agents on a mission first.`);
  const tool = (
    name: TreasurerTool,
    description: string,
    run: (cockpit: Cockpit | null, args: Record<string, unknown>) => string,
  ) =>
    studio.defineAiTool({
      name,
      description,
      params: (s) =>
        s.object({
          rule: s.string({ description: 'A policy rule id such as R-NEW-VENDOR' }).optional(),
        }),
      execute: (args, ctx) => ctx.success(run(read(), args)),
    });
  return [
    tool(
      'get_envelope',
      'How much of the mission envelope is held, captured and still free.',
      (c) =>
        c === null || c.envelopes.length === 0
          ? empty('the envelope')
          : reply(summaries.envelope(c)),
    ),
    tool(
      'list_incidents',
      'The incidents raised when money moved that no approved action explains.',
      (c) =>
        c === null
          ? empty('incidents')
          : reply(summaries.incidents(c) || 'There are no incidents.'),
    ),
    tool(
      'explain_decision',
      'Why the latest policy ruling went the way it did, rule by rule.',
      (c) =>
        c === null || c.decisions.length === 0 ? empty('rulings') : reply(summaries.decision(c)),
    ),
    tool(
      'simulate_policy_change',
      'What removing a rule would change among the recent rulings. Changes nothing.',
      (c, args) => {
        const rule =
          typeof args['rule'] === 'string' && args['rule'] !== '' ? args['rule'] : 'R-NEW-VENDOR';
        return c === null || c.decisions.length === 0
          ? empty('rulings')
          : reply(summaries.simulation(c, rule));
      },
    ),
    studio.defineAiTool({
      name: 'add_blocked_by_rule_widget' satisfies TreasurerTool,
      description: 'Adds a chart of what each policy rule is holding back to the cockpit.',
      params: (s) => s.object({}),
      execute: (_args, ctx) => {
        const next = addBlockedByRuleWidget(studio.getState() as unknown as AgReportState<never>);
        if (next !== null) studio.setState(next as never);
        return ctx.success(reply('', { added: next !== null }));
      },
    }),
  ];
}

const PROMPT_STARTERS = [
  { label: 'How much is left?', prompt: 'How much of the envelope is left?' },
  { label: 'Why was it held?', prompt: 'Why was the latest ruling held for approval?' },
  { label: 'Any incidents?', prompt: 'Are there any incidents?' },
  { label: 'What if…', prompt: 'What if we removed the new-vendor rule?' },
  { label: 'Chart what is blocked', prompt: 'Add a widget of what is blocked by a rule.' },
];

const DELEGATES = ['data', 'page', 'widget', 'planning'] as const;

/** The Treasurer leads and Studio's own agents build; every agent talks to the model through the server. */
export function createTreasurerHarness(
  studio: AgStudioApi,
  adapter: AgLlmAdapter = treasurerAdapter,
) {
  return createAiHarness(studio, ({ builtIn }) => ({
    agents: [
      directLlmRunner({
        id: 'treasurer',
        name: 'Treasurer',
        description: 'Reads the workspace and builds the cockpit. Never moves money.',
        instructions: () =>
          'You are the Treasurer for a spend-control product. You answer questions about envelopes, rulings, rules and incidents using your read-only tools, and hand charting work to the other agents. You never move money, and you never state an amount you did not get from a tool.',
        tools: (ctx) => [...treasurerTools(studio), ctx.tools.delegateTo(DELEGATES)],
        adapter,
      }),
      ...DELEGATES.map((id) => directLlmRunner({ ...builtIn[id], adapter })),
    ],
    primary: 'treasurer',
    promptStarters: PROMPT_STARTERS,
  }));
}

/** How a Treasurer tool's calls read in the chat: the words, and the answer when it has come back. */
const LABELS: Record<TreasurerTool, string> = {
  get_envelope: 'Checking the envelope',
  list_incidents: 'Looking at incidents',
  explain_decision: 'Reading the latest ruling',
  simulate_policy_change: 'Simulating a policy change',
  add_blocked_by_rule_widget: 'Adding a widget',
};

function ToolAnswer({ result }: AgAiToolDetailParams) {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? {});
  let summary = '';
  try {
    summary = String((JSON.parse(text) as { summary?: unknown }).summary ?? '');
  } catch {
    summary = '';
  }
  return summary === '' ? null : <p className="sw-sub">{summary}</p>;
}

export const treasurerToolDisplay = Object.fromEntries(
  Object.entries(LABELS).map(([name, text]) => [
    name,
    { label: () => ({ text }), detail: ToolAnswer },
  ]),
);
