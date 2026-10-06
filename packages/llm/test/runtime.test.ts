import { agentRuns, organizations } from '@bursar/db';
import { createTestDb } from '@bursar/db/testing';
import { newId } from '@bursar/schemas';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  claudeProvider,
  createRuntime,
  LlmError,
  type LlmResponse,
  mockProvider,
  type Provider,
  persistRun,
  type Recording,
  recording,
  replaying,
  say,
  type Tools,
  useTool,
} from '../src';

const meta = { agentId: 'agt_1', role: 'PLANNER' };
const runtime = (provider: Provider, over: Partial<Parameters<typeof createRuntime>[0]> = {}) =>
  createRuntime({ provider, sleep: async () => undefined, ...over });
const Plan = z.strictObject({ steps: z.array(z.string()).min(1) });
const ask = {
  name: 'respond',
  description: 'Give the plan',
  system: 'You plan.',
  user: 'Plan a launch.',
};

describe('structured answers', () => {
  it('returns an answer that fits the schema, and reports what it cost', async () => {
    const model = mockProvider([useTool('respond', { steps: ['a', 'b'] })]);
    const run = runtime(model).start(meta);
    expect(await run.structured(Plan, ask)).toEqual({ steps: ['a', 'b'] });
    expect(model.calls[0]).toMatchObject({ forceTool: 'respond' });
    expect(await run.finish()).toMatchObject({
      steps: 1,
      inputTokens: 10,
      outputTokens: 10,
      status: 'OK',
    });
  });

  it('tells the model what was wrong and tries again, then gives up', async () => {
    const fixed = mockProvider([
      useTool('respond', { steps: [] }),
      useTool('respond', { steps: ['ok'] }),
    ]);
    expect(await runtime(fixed).start(meta).structured(Plan, ask)).toEqual({ steps: ['ok'] });
    expect(JSON.stringify(fixed.calls[1]?.messages)).toContain('Invalid. Fix: steps');
    const stubborn = mockProvider(() => useTool('respond', { nope: 1 }));
    const run = runtime(stubborn).start(meta);
    await expect(run.structured(Plan, ask)).rejects.toMatchObject({ code: 'invalid-output' });
    expect(stubborn.calls).toHaveLength(3);
    expect((await run.finish()).status).toBe('ERROR');
    await expect(
      runtime(mockProvider([say('no tool')]))
        .start(meta)
        .structured(Plan, ask),
    ).rejects.toMatchObject({ code: 'invalid-output' });
  });
});

describe('budgets, cache and retries', () => {
  it('stops at the step, token and time budgets', async () => {
    const loop = mockProvider(() => useTool('respond', { nope: 1 }, 'tu', 40));
    const steps = runtime(loop, {
      budget: { maxSteps: 2, maxTokens: 10_000, maxMs: 10_000 },
    }).start(meta);
    await expect(steps.structured(Plan, ask)).rejects.toMatchObject({ code: 'budget' });
    expect(loop.calls).toHaveLength(2);
    expect((await steps.finish()).status).toBe('BUDGET');
    const tokens = runtime(
      mockProvider(() => useTool('respond', { nope: 1 }, 'tu', 40)),
      { budget: { maxSteps: 9, maxTokens: 100, maxMs: 10_000 } },
    ).start(meta);
    await expect(tokens.structured(Plan, ask)).rejects.toMatchObject({ code: 'budget' });
    let clock = 0;
    const slow = runtime(
      mockProvider(() => {
        clock += 100;
        return useTool('respond', { nope: 1 });
      }),
      { now: () => clock, budget: { maxSteps: 9, maxTokens: 10_000, maxMs: 150 } },
    ).start(meta);
    await expect(slow.structured(Plan, ask)).rejects.toMatchObject({ code: 'budget' });
  });

  it('answers a repeated request from its cache without a step', async () => {
    const model = mockProvider(() => useTool('respond', { steps: ['x'] }));
    const cache = new Map<string, LlmResponse>();
    const rt = runtime(model, { cache });
    await rt.start(meta).structured(Plan, ask);
    const second = rt.start(meta);
    await second.structured(Plan, ask);
    expect(model.calls).toHaveLength(1);
    expect(await second.finish()).toMatchObject({ steps: 0, cacheHits: 1 });
  });

  it('retries a rate limit with backoff, but never a refusal', async () => {
    let n = 0;
    const waits: number[] = [];
    const flaky: Provider = {
      complete: async () => {
        if (n++ < 2) throw new LlmError('rate-limited', 'slow down');
        return useTool('respond', { steps: ['y'] });
      },
    };
    expect(
      await runtime(flaky, { sleep: async (ms) => void waits.push(ms) })
        .start(meta)
        .structured(Plan, ask),
    ).toEqual({ steps: ['y'] });
    expect(waits).toEqual([250, 500]);
    n = -10;
    await expect(
      runtime(flaky, { maxRetries: 1 }).start(meta).structured(Plan, ask),
    ).rejects.toMatchObject({ code: 'rate-limited' });
    const refused: Provider = {
      complete: async () => {
        throw new LlmError('rejected', 'no');
      },
    };
    await expect(runtime(refused).start(meta).structured(Plan, ask)).rejects.toMatchObject({
      code: 'rejected',
    });
  });
});

describe('conversations with tools', () => {
  const tools = (log: string[]): Tools => ({
    definitions: () => [{ name: 'lookup', description: 'look', input_schema: {} }],
    call: async (name, input) => {
      log.push(`${name}:${JSON.stringify(input)}`);
      return { ok: name === 'lookup', data: 7 };
    },
  });

  it('runs the tools the model asks for and returns its final words', async () => {
    const log: string[] = [];
    const model = mockProvider([useTool('lookup', { q: 1 }), say('The answer is 7.')]);
    const run = runtime(model).start(meta);
    expect(await run.converse({ system: 's', user: 'u', tools: tools(log) })).toBe(
      'The answer is 7.',
    );
    expect(log).toEqual(['lookup:{"q":1}']);
    expect(JSON.stringify(model.calls[1]?.messages)).toContain('tool_result');
    expect(await run.finish()).toMatchObject({ steps: 2 });
  });

  it('marks a failing tool as an error for the model to read, and bounds a runaway loop', async () => {
    const model = mockProvider((_r, n) => (n === 0 ? useTool('bad', {}) : say('recovered')));
    expect(
      await runtime(model)
        .start(meta)
        .converse({ system: 's', user: 'u', tools: tools([]) }),
    ).toBe('recovered');
    expect(JSON.stringify(model.calls[1]?.messages)).toContain('"isError":true');
    const forever = mockProvider(() => useTool('lookup', {}));
    await expect(
      runtime(forever, { budget: { maxSteps: 3, maxTokens: 9_999, maxMs: 9_999 } })
        .start(meta)
        .converse({ system: 's', user: 'u', tools: tools([]) }),
    ).rejects.toMatchObject({ code: 'budget' });
  });
});

describe('record and replay', () => {
  it('replays a recorded run with no model, and refuses a request it never saw', async () => {
    const tape: Recording = new Map();
    const live = runtime(recording(mockProvider([useTool('respond', { steps: ['z'] })]), tape));
    await live.start(meta).structured(Plan, ask);
    const replay = runtime(replaying(tape));
    expect(await replay.start(meta).structured(Plan, ask)).toEqual({ steps: ['z'] });
    await expect(
      replay.start(meta).structured(Plan, { ...ask, user: 'something else' }),
    ).rejects.toMatchObject({ code: 'no-recording' });
  });
});

describe('the Claude provider', () => {
  const okBody = {
    content: [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 't1', name: 'n', input: { a: 1 } },
      { type: 'thinking' },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 6 },
  };
  const request = {
    system: 's',
    maxTokens: 50,
    tools: [{ name: 'n', description: 'd', input_schema: {} }],
    forceTool: 'n',
    messages: [
      {
        role: 'user' as const,
        content: [{ type: 'tool_result' as const, toolUseId: 't0', content: 'x' }],
      },
    ],
  };

  it('sends the documented request and reads the reply', async () => {
    let seen: { url: string; headers: Headers; body: Record<string, unknown> } | undefined;
    const provider = claudeProvider({
      apiKey: 'k',
      model: 'm',
      fetch: async (url, init) => {
        seen = {
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        };
        return Response.json(okBody);
      },
    });
    const out = await provider.complete(request);
    expect(out).toMatchObject({
      stopReason: 'tool_use',
      usage: { inputTokens: 5, outputTokens: 6 },
    });
    expect(out.content).toHaveLength(2);
    expect(seen?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen?.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(seen?.body).toMatchObject({ model: 'm', tool_choice: { type: 'tool', name: 'n' } });
    expect(JSON.stringify(seen?.body)).toContain('"tool_use_id":"t0"');
  });

  it('classifies failures for the retry logic and never leaks the key', async () => {
    const reply = (status: number) =>
      claudeProvider({
        apiKey: 'sekret',
        model: 'm',
        fetch: async () => new Response('{}', { status }),
      });
    await expect(reply(429).complete(request)).rejects.toMatchObject({
      code: 'rate-limited',
      retryable: true,
    });
    await expect(reply(503).complete(request)).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    });
    await expect(reply(400).complete(request)).rejects.toMatchObject({
      code: 'rejected',
      retryable: false,
    });
    const down = claudeProvider({
      apiKey: 'sekret',
      model: 'm',
      fetch: async () => {
        throw new TypeError('sekret reset');
      },
    });
    await expect(down.complete(request)).rejects.toThrow(/could not be reached/);
    const odd = claudeProvider({
      apiKey: 'k',
      model: 'm',
      fetch: async () => Response.json({ stop_reason: 'refusal' }),
    });
    expect(await odd.complete(request)).toMatchObject({ stopReason: 'other', content: [] });
  });
});

describe('run logging', () => {
  it('writes the run to agent_runs for its own organisation', async () => {
    const { db, close } = await createTestDb();
    const orgId = newId('organization');
    await db.insert(organizations).values({ id: orgId, name: 'Acme' });
    const run = runtime(mockProvider([useTool('respond', { steps: ['a'] })]), {
      onRun: (m, r) => persistRun(db, orgId, m, r),
    }).start({ ...meta, missionId: 'mis_1' });
    await run.structured(Plan, ask);
    await run.finish();
    const rows = await db.select().from(agentRuns);
    expect(rows).toMatchObject([
      { orgId, agentId: 'agt_1', status: 'OK', steps: 1, missionId: 'mis_1' },
    ]);
    await close();
  });
});
