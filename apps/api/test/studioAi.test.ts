import { TREASURER_TOOLS } from '@bursar/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { treasurerTurn } from '../src/ai/treasurer';
import { createTestApp, openWorkspace, type TestApp } from './support';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const tools = TREASURER_TOOLS.map((name) => ({ name }));
const said = (text: string) => ({
  type: 'message',
  role: 'user',
  content: [{ type: 'text', text }],
});
const asked = (text: string) => treasurerTurn({ input: [said(text)], tools }, 1000);
type Out = ReturnType<typeof asked>['output'][number];
const callOf = (output: readonly Out[]) => output.find((o) => o['type'] === 'function_call');

describe('the scripted Treasurer', () => {
  it('picks a read-only tool from what the person asked', () => {
    const picks: Array<[string, string]> = [
      ['How much of the envelope is left?', 'get_envelope'],
      ['Are there any incidents?', 'list_incidents'],
      ['Why was the latest ruling approval-only?', 'explain_decision'],
      ['What if we raise the daily limit?', 'simulate_policy_change'],
      ['Show me a widget of what is blocked by a rule', 'add_blocked_by_rule_widget'],
    ];
    for (const [question, tool] of picks)
      expect(callOf(asked(question).output)?.['name']).toBe(tool);
  });

  it('passes along the rule the person named, in its id or in words', () => {
    const named = (q: string) => JSON.parse(String(callOf(asked(q).output)?.['arguments']));
    expect(named('What if we removed the new vendor rule?')).toEqual({ rule: 'R-NEW-VENDOR' });
    expect(named('What if R-DUAL were removed?')).toEqual({ rule: 'R-DUAL' });
    expect(named('What if we changed the policy?')).toEqual({});
  });

  it('only calls tools it was offered, and says what it can do when it cannot help', () => {
    const none = treasurerTurn(
      { input: [said('How much is left in the envelope?')], tools: [] },
      1,
    );
    expect(callOf(none.output)).toBeUndefined();
    const lost = asked('Tell me a joke');
    expect(callOf(lost.output)).toBeUndefined();
    expect(JSON.stringify(lost.output)).toContain('never move money');
  });

  it('turns a tool result into a plain answer, and gives the same reply to the same turn', () => {
    const first = asked('How much of the envelope is left?');
    const made = callOf(first.output) as Record<string, string>;
    const turn = {
      input: [
        said('How much of the envelope is left?'),
        { type: 'function_call', callId: made['callId'], name: made['name'], arguments: '{}' },
        {
          type: 'function_call_output',
          callId: made['callId'],
          // Studio hands a tool's text back wrapped as { success, response }.
          output: JSON.stringify({
            success: true,
            response: JSON.stringify({ summary: '30% of the ceiling is in use.' }),
          }),
        },
      ],
      tools,
    };
    const reply = treasurerTurn(turn, 5);
    expect(JSON.stringify(reply.output)).toContain('30% of the ceiling is in use.');
    expect(treasurerTurn(turn, 5)).toEqual(reply);
    expect(callOf(reply.output)).toBeUndefined();
  });

  it('survives a tool that answered with something unreadable', () => {
    const reply = treasurerTurn(
      {
        input: [
          said('incidents?'),
          { type: 'function_call', callId: 'c', name: 'list_incidents', arguments: '{}' },
          { type: 'function_call_output', callId: 'c', output: 'not json' },
        ],
        tools,
      },
      1,
    );
    expect(JSON.stringify(reply.output)).toContain('no incidents');
  });

  it('gives every message and call in a conversation its own id', () => {
    const first = asked('incidents?');
    const second = treasurerTurn(
      { input: [said('incidents?'), ...first.output, said('envelope?')], tools },
      1,
    );
    const ids = [...first.output, ...second.output].map((o) => o['id']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds no tool that could move money', () => {
    for (const name of TREASURER_TOOLS)
      expect(name).not.toMatch(
        /pay|capture|refund|payout|authori[sz]e|order|approve|execute|transfer|send/i,
      );
  });
});

describe('the Studio assistant over HTTP', () => {
  it('answers a turn for a signed-in person, strictly, and refuses everyone else', async () => {
    const { browser } = await openWorkspace(t);
    const ok = await browser.call('POST', '/v1/studio/ai/turn', {
      json: { input: [said('incidents')], tools },
    });
    expect(ok.status).toBe(200);
    expect(callOf(ok.json.output)?.['name']).toBe('list_incidents');
    const extra = await browser.call('POST', '/v1/studio/ai/turn', {
      json: { input: [], tools, amount: { currency: 'USD', minor: '1' } },
    });
    expect(extra.status).toBe(400); // a caller cannot slip a field in
    expect(
      (await t.client().call('POST', '/v1/studio/ai/turn', { json: { input: [], tools } })).status,
    ).toBe(401);
  });
});
