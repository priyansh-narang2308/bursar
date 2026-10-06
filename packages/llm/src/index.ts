import { canonicalize, sha256Hex } from '@bursar/crypto';
import { agentRuns, type Db, withOrg } from '@bursar/db';
import type { JsonValue, OrganizationId } from '@bursar/schemas';
import { z } from 'zod';

// ---------------------------------------------------------------------------------------
// The wire-independent shapes
// ---------------------------------------------------------------------------------------

export type Block =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }
  | {
      readonly type: 'tool_result';
      readonly toolUseId: string;
      readonly content: string;
      readonly isError?: boolean;
    };

export interface Message {
  readonly role: 'user' | 'assistant';
  readonly content: readonly Block[];
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly input_schema: object;
}

export interface LlmRequest {
  readonly system: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolSpec[];
  /** Makes the model answer through this tool, which is how a structured answer is asked for. */
  readonly forceTool?: string;
  readonly maxTokens: number;
}

export interface LlmResponse {
  readonly content: readonly Block[];
  readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other';
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

export interface Provider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  readonly code:
    | 'rate-limited'
    | 'unavailable'
    | 'rejected'
    | 'budget'
    | 'invalid-output'
    | 'no-recording';
  readonly retryable: boolean;
  constructor(code: LlmError['code'], message: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.retryable = code === 'rate-limited' || code === 'unavailable';
  }
}

// ---------------------------------------------------------------------------------------
// Providers: Claude, a script, and record/replay
// ---------------------------------------------------------------------------------------

const wireBlock = (b: Block) =>
  b.type === 'tool_result'
    ? {
        type: 'tool_result',
        tool_use_id: b.toolUseId,
        content: b.content,
        is_error: b.isError ?? false,
      }
    : b;

interface WireResponse {
  content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Claude over its Messages API, with no SDK: a request, a status, a body. The key is sent and never logged. */
export function claudeProvider(options: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Provider {
  const doFetch = options.fetch ?? fetch;
  return {
    async complete(request) {
      const body = {
        model: options.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content.map(wireBlock),
        })),
        ...(request.tools.length > 0 ? { tools: request.tools } : {}),
        ...(request.forceTool === undefined
          ? {}
          : { tool_choice: { type: 'tool', name: request.forceTool } }),
      };
      const response = await doFetch(
        `${options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
        },
      ).catch(() => {
        throw new LlmError('unavailable', 'The model could not be reached.');
      });
      if (response.status === 429)
        throw new LlmError('rate-limited', 'The model is rate limiting us.');
      if (response.status >= 500)
        throw new LlmError('unavailable', `The model service failed (${response.status}).`);
      if (!response.ok)
        throw new LlmError('rejected', `The model refused the request (${response.status}).`);
      return fromWire((await response.json()) as WireResponse);
    },
  };
}

function fromWire(raw: WireResponse): LlmResponse {
  const content = (raw.content ?? []).flatMap((b): Block[] => {
    if (b.type === 'text') return [{ type: 'text', text: b.text ?? '' }];
    if (b.type === 'tool_use')
      return [{ type: 'tool_use', id: b.id ?? '', name: b.name ?? '', input: b.input }];
    return [];
  });
  const stop = raw.stop_reason;
  const stopReason =
    stop === 'end_turn' || stop === 'tool_use' || stop === 'max_tokens' ? stop : 'other';
  return {
    content,
    stopReason,
    usage: {
      inputTokens: raw.usage?.input_tokens ?? 0,
      outputTokens: raw.usage?.output_tokens ?? 0,
    },
  };
}

/** A model that answers from a script. A function sees the request, so a test can answer by what was asked. */
export function mockProvider(
  script: readonly LlmResponse[] | ((request: LlmRequest, call: number) => LlmResponse),
): Provider & { readonly calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(request) {
      const n = calls.push(request) - 1;
      const next = typeof script === 'function' ? script(request, n) : script[n];
      if (next === undefined) throw new LlmError('rejected', 'The mock model has no more answers.');
      return next;
    },
  };
}

export const say = (text: string, tokens = 10): LlmResponse => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { inputTokens: tokens, outputTokens: tokens },
});
export const useTool = (
  name: string,
  input: unknown,
  id = `tu_${name}`,
  tokens = 10,
): LlmResponse => ({
  content: [{ type: 'tool_use', id, name, input }],
  stopReason: 'tool_use',
  usage: { inputTokens: tokens, outputTokens: tokens },
});

export type Recording = Map<string, LlmResponse>;
/** What a request is, for caching and replay: a hash of its canonical form. */
export const requestKey = (request: LlmRequest): string =>
  sha256Hex(canonicalize(request as unknown as JsonValue));

/** Calls the real model and keeps every answer, so a run can be replayed offline and byte for byte. */
export function recording(inner: Provider, tape: Recording): Provider {
  return {
    async complete(request) {
      const response = await inner.complete(request);
      tape.set(requestKey(request), response);
      return response;
    },
  };
}

export function replaying(tape: Recording): Provider {
  return {
    async complete(request) {
      const found = tape.get(requestKey(request));
      if (found === undefined) throw new LlmError('no-recording', 'This request was not recorded.');
      return found;
    },
  };
}

// ---------------------------------------------------------------------------------------
// The runtime: budgets, cache, retries, structured answers, tool loops
// ---------------------------------------------------------------------------------------

export interface Budget {
  readonly maxSteps: number;
  readonly maxTokens: number;
  readonly maxMs: number;
}
export const DEFAULT_BUDGET: Budget = { maxSteps: 12, maxTokens: 60_000, maxMs: 120_000 };

export interface RunReport {
  readonly steps: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheHits: number;
  readonly status: 'OK' | 'BUDGET' | 'ERROR';
  readonly error: string | null;
}

export interface RunMeta {
  readonly agentId: string;
  readonly role: string;
  readonly missionId?: string | undefined;
}

export interface Tools {
  definitions(): readonly ToolSpec[];
  call(name: string, input: unknown): Promise<{ ok: boolean; [k: string]: unknown }>;
}

export interface RuntimeOptions {
  readonly provider: Provider;
  readonly budget?: Budget;
  readonly cache?: Map<string, LlmResponse>;
  readonly maxRetries?: number;
  readonly maxTokensPerAnswer?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onRun?: (meta: RunMeta, report: RunReport) => void | Promise<void>;
}

const RESULT_LIMIT = 8_000;
const FIX_ATTEMPTS = 2;

type Ask = (request: Omit<LlmRequest, 'maxTokens'>) => Promise<LlmResponse>;
const userSays = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });

async function structuredAnswer<S extends z.ZodType>(
  ask: Ask,
  schema: S,
  input: { name: string; description: string; system: string; user: string },
): Promise<z.output<S>> {
  const tool: ToolSpec = {
    name: input.name,
    description: input.description,
    input_schema: z.toJSONSchema(schema),
  };
  const messages: Message[] = [userSays(input.user)];
  for (let attempt = 0; ; attempt++) {
    const reply = await ask({
      system: input.system,
      messages,
      tools: [tool],
      forceTool: input.name,
    });
    const call = reply.content.find((b) => b.type === 'tool_use');
    const parsed = schema.safeParse(call?.type === 'tool_use' ? call.input : undefined);
    if (parsed.success) return parsed.data;
    if (attempt >= FIX_ATTEMPTS || call?.type !== 'tool_use')
      throw new LlmError('invalid-output', 'The model did not return a valid answer.');
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(answer)'}: ${i.message}`)
      .join('; ');
    messages.push(
      { role: 'assistant', content: reply.content },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: call.id,
            content: `Invalid. Fix: ${problems}`,
            isError: true,
          },
        ],
      },
    );
  }
}

async function runTools(tools: Tools, uses: readonly Block[]): Promise<Block[]> {
  const results: Block[] = [];
  for (const use of uses) {
    if (use.type !== 'tool_use') continue;
    const out = await tools.call(use.name, use.input);
    results.push({
      type: 'tool_result',
      toolUseId: use.id,
      content: JSON.stringify(out).slice(0, RESULT_LIMIT),
      isError: !out.ok,
    });
  }
  return results;
}

async function conversation(
  ask: Ask,
  input: { system: string; user: string; tools: Tools },
): Promise<string> {
  const messages: Message[] = [userSays(input.user)];
  for (;;) {
    const reply = await ask({ system: input.system, messages, tools: input.tools.definitions() });
    const uses = reply.content.filter((b) => b.type === 'tool_use');
    if (reply.stopReason !== 'tool_use' || uses.length === 0)
      return reply.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
    messages.push(
      { role: 'assistant', content: reply.content },
      { role: 'user', content: await runTools(input.tools, uses) },
    );
  }
}

export function createRuntime(options: RuntimeOptions) {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? 2;

  return {
    /** One run of one agent. Its budget is its own; `finish` reports what it cost. */
    start(meta: RunMeta) {
      const started = now();
      const used = { steps: 0, inputTokens: 0, outputTokens: 0, cacheHits: 0 };
      let failure: LlmError | Error | undefined;

      function checkBudget() {
        if (used.steps >= budget.maxSteps)
          throw new LlmError('budget', 'The run used all its steps.');
        if (used.inputTokens + used.outputTokens >= budget.maxTokens)
          throw new LlmError('budget', 'The run used all its tokens.');
        if (now() - started >= budget.maxMs)
          throw new LlmError('budget', 'The run ran out of time.');
      }

      async function withRetries(request: LlmRequest): Promise<LlmResponse> {
        for (let attempt = 0; ; attempt++) {
          try {
            return await options.provider.complete(request);
          } catch (error) {
            if (!(error instanceof LlmError) || !error.retryable || attempt >= maxRetries)
              throw error;
            await sleep(250 * 2 ** attempt);
          }
        }
      }

      async function ask(request: Omit<LlmRequest, 'maxTokens'>): Promise<LlmResponse> {
        const full = { ...request, maxTokens: options.maxTokensPerAnswer ?? 2_000 };
        const key = requestKey(full);
        const cached = options.cache?.get(key);
        if (cached !== undefined) {
          used.cacheHits++;
          return cached;
        }
        checkBudget();
        const response = await withRetries(full);
        used.steps++;
        used.inputTokens += response.usage.inputTokens;
        used.outputTokens += response.usage.outputTokens;
        options.cache?.set(key, response);
        return response;
      }

      /** Runs `work`, remembering how it failed so `finish` can say so, and rethrowing. */
      async function guarded<T>(work: () => Promise<T>): Promise<T> {
        try {
          return await work();
        } catch (error) {
          failure = error as Error;
          throw error;
        }
      }

      return {
        /** An answer in the shape of `schema`, asked for as a forced tool call and checked, with a fix-and-retry. */
        structured<S extends z.ZodType>(
          schema: S,
          input: { name: string; description: string; system: string; user: string },
        ): Promise<z.output<S>> {
          return guarded(() => structuredAnswer(ask, schema, input));
        },

        /** A conversation in which the model may call tools until it has an answer. */
        converse(input: { system: string; user: string; tools: Tools }): Promise<string> {
          return guarded(() => conversation(ask, input));
        },

        async finish(): Promise<RunReport> {
          const report: RunReport = {
            ...used,
            status:
              failure === undefined
                ? 'OK'
                : failure instanceof LlmError && failure.code === 'budget'
                  ? 'BUDGET'
                  : 'ERROR',
            error: failure?.message ?? null,
          };
          await options.onRun?.(meta, report);
          return report;
        },
      };
    },
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
export type Run = ReturnType<Runtime['start']>;

/** Writes a run's cost and outcome to `agent_runs` as the organisation that owns it. */
export async function persistRun(db: Db, orgId: OrganizationId, meta: RunMeta, report: RunReport) {
  await withOrg(db, orgId, (tx) =>
    tx.insert(agentRuns).values({
      orgId,
      agentId: meta.agentId,
      role: meta.role,
      missionId: meta.missionId ?? null,
      status: report.status,
      steps: report.steps,
      inputTokens: report.inputTokens,
      outputTokens: report.outputTokens,
      cacheHits: report.cacheHits,
      error: report.error,
    }),
  );
}
