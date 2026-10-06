import {
  type AiTurnRequest,
  type AiTurnResponse,
  RULE_IDS,
  type TreasurerTool,
} from '@bursar/schemas';

/*
 * The Treasurer's brain when no model is configured. It is scripted, not clever: it reads the last thing the
 * person said, picks a read-only tool, and once the tool has answered it says what the answer was. The same
 * conversation always gets the same reply, so the demo is repeatable and costs nothing. A real model would
 * sit behind the same request and response.
 *
 * Every tool it can reach is read-only: it names no amount, payee or account, and moves no money.
 */

type Item = AiTurnRequest['input'][number];
type Field = unknown;
const str = (value: Field): string => (typeof value === 'string' ? value : '');

const ROUTES: ReadonlyArray<readonly [RegExp, TreasurerTool, string]> = [
  [
    /\b(widget|chart|show me|build|add)\b.*\b(blocked|rule|denied|held back)\b|\bblocked by (a )?rule/i,
    'add_blocked_by_rule_widget',
    'Adding a widget of what each rule is holding back.',
  ],
  [
    /\b(what if|simulate|raise|lower|change (the )?(limit|policy)|would)\b/i,
    'simulate_policy_change',
    'Checking what that change would do to the rulings so far.',
  ],
  [/\b(incident|frozen|freez|unexplained|alarm)/i, 'list_incidents', 'Looking at the incidents.'],
  [
    /\b(envelope|budget|left|remaining|spent|used|ceiling)\b/i,
    'get_envelope',
    'Checking the envelope.',
  ],
  [
    /\b(why|explain|blocked|denied|approv|decision|ruling|rule)/i,
    'explain_decision',
    'Reading the latest ruling.',
  ],
];

const text = (value: string, n: number) => ({
  id: `msg_${n}`,
  kind: 'output' as const,
  type: 'message' as const,
  role: 'assistant' as const,
  status: 'completed' as const,
  content: [{ type: 'text' as const, text: value, annotations: [] }],
});
const call = (name: TreasurerTool, args: object, n: number) => ({
  id: `fc_${n}`,
  kind: 'output' as const,
  type: 'function_call' as const,
  callId: `call_${n}`,
  name,
  arguments: JSON.stringify(args),
  status: 'completed' as const,
});

function lastUserText(input: readonly Item[]): { index: number; text: string } {
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const item = input[i];
    if (item?.['type'] !== 'message' || item['role'] !== 'user') continue;
    const parts = Array.isArray(item['content'])
      ? (item['content'] as Array<Record<string, Field>>)
      : [];
    return { index: i, text: parts.map((p) => str(p['text'])).join(' ') };
  }
  return { index: -1, text: '' };
}

/** The rule the person named, in its id ("R-NEW-VENDOR") or in words ("the new vendor rule"). */
export function ruleNamed(words: string): string | undefined {
  const flat = words.toLowerCase().replaceAll('-', ' ');
  const spoken = (id: string) => id.toLowerCase().replaceAll('-', ' ');
  // "new vendor" also contains "vendor", so the longest name that appears is the one meant.
  return RULE_IDS.filter((id) => flat.includes(spoken(id)) || flat.includes(spoken(id).slice(2)))
    .sort((a, b) => b.length - a.length)
    .at(0);
}

function parse(output: string): Record<string, Field> {
  try {
    const value: unknown = JSON.parse(output);
    if (typeof value !== 'object' || value === null) return {};
    // Studio wraps what a tool returned as `{ success, response }`, where `response` is the tool's own text.
    const inner = (value as Record<string, Field>)['response'];
    return typeof inner === 'string' ? parse(inner) : (value as Record<string, Field>);
  } catch {
    return {};
  }
}

/** What the person is told once a tool has answered. The tools put plain-language figures in their results. */
function summarise(tool: string, result: Record<string, Field>): string {
  switch (tool) {
    case 'get_envelope':
      return (
        str(result['summary']) || 'There is no envelope yet. Run the agents on a mission first.'
      );
    case 'list_incidents':
      return str(result['summary']) || 'There are no incidents.';
    case 'explain_decision':
      return str(result['summary']) || 'There are no rulings to explain yet.';
    case 'simulate_policy_change':
      return str(result['summary']) || 'That change would not alter any ruling so far.';
    case 'add_blocked_by_rule_widget':
      return result['added'] === true
        ? 'I added a widget to the cockpit that counts what each rule is holding back. Click a rule in it to narrow the others.'
        : 'That widget is already on the cockpit.';
    default:
      return 'Done.';
  }
}

const HELP =
  'I can read this workspace but never move money. Ask me how much of the envelope is used, what incidents are open, why the latest ruling went the way it did, what a change to the policy would do, or to add a widget of what each rule is holding back.';

export function treasurerTurn(request: AiTurnRequest, now = Date.now()): AiTurnResponse {
  // The conversation only grows, so its length is a unique suffix for every id this turn produces.
  const n = request.input.length;
  const offered = new Set(request.tools.map((t) => str(t['name'])));
  const user = lastUserText(request.input);
  const after = request.input.slice(user.index + 1);
  const answered = after.filter((item) => item['type'] === 'function_call_output');
  const reply = (
    output:
      | ReturnType<typeof text>[]
      | ReturnType<typeof call>[]
      | Array<ReturnType<typeof text> | ReturnType<typeof call>>,
  ) => ({
    id: `resp_${now}`,
    createdAt: now,
    status: 'completed' as const,
    output,
  });

  // A tool has answered: say what it found.
  const last = answered.at(-1);
  if (last !== undefined) {
    const made = after.find(
      (item) => item['type'] === 'function_call' && item['callId'] === last['callId'],
    );
    return reply([text(summarise(str(made?.['name']), parse(str(last['output']))), n)]);
  }

  const route = ROUTES.find(([pattern, tool]) => pattern.test(user.text) && offered.has(tool));
  if (route === undefined) return reply([text(HELP, n)]);
  const [, tool, preface] = route;
  const rule = tool === 'simulate_policy_change' ? ruleNamed(user.text) : undefined;
  return reply([text(preface, n), call(tool, rule === undefined ? {} : { rule }, n)]);
}
