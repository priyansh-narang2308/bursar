import { z } from 'zod';
import { classify, PayPalError } from './errors';

export interface PayPalConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseUrl: string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  /** The SDK's defaults are no timeout and no retries; this client sets both. */
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

const SANDBOX_HOST = 'api-m.sandbox.paypal.com';

/** Bursar is sandbox-only. The sandbox host, a local host, or a `.test` host (the fake) are the only ones accepted. */
export function assertSandbox(baseUrl: string): URL {
  const url = new URL(baseUrl);
  const ok =
    url.hostname === SANDBOX_HOST ||
    url.hostname.endsWith('.test') ||
    ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!ok) {
    throw new Error(`Refusing to use ${url.hostname}: Bursar talks to the PayPal sandbox only.`);
  }
  return url;
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});
const errorSchema = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  debug_id: z.string().optional(),
  details: z.array(z.object({ issue: z.string().optional() })).optional(),
});

interface CallOptions<S extends z.ZodType> {
  readonly body?: unknown;
  readonly requestId?: string;
  readonly schema: S;
}

/** Authentication, timeouts, retries and error classification: everything below the endpoints. */
export class Transport {
  private readonly config: PayPalConfig;
  private readonly base: URL;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private cached: { token: string; expiresAt: number } | undefined;
  private pending: Promise<string> | undefined;

  constructor(config: PayPalConfig) {
    this.config = config;
    this.base = assertSandbox(config.baseUrl);
    this.doFetch = config.fetch ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.now = config.now ?? Date.now;
  }

  private async send(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await this.doFetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
    } catch {
      throw new PayPalError('unknown', 'PayPal did not answer, so the outcome is unknown.');
    }
  }

  private async failure(response: Response): Promise<PayPalError> {
    const parsed = errorSchema.safeParse(await response.json().catch(() => undefined));
    const body = parsed.success ? parsed.data : {};
    const issue = body.details?.[0]?.issue ?? body.name;
    const debugId = body.debug_id ?? response.headers.get('paypal-debug-id') ?? undefined;
    const retryAfter = Number(response.headers.get('retry-after'));
    return new PayPalError(
      classify(response.status, issue),
      body.message ?? `PayPal answered ${response.status}.`,
      {
        status: response.status,
        ...(issue === undefined ? {} : { issue }),
        ...(debugId === undefined ? {} : { debugId }),
        ...(retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
      },
    );
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64',
    );
    const response = await this.send(new URL('/v1/oauth2/token', this.base), {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok)
      throw new PayPalError('auth', 'PayPal refused the client credentials.', {
        status: response.status,
      });
    const parsed = tokenSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success)
      throw new PayPalError('invalid', 'PayPal sent a token response this client cannot read.');
    this.cached = {
      token: parsed.data.access_token,
      expiresAt: this.now() + (parsed.data.expires_in - 60) * 1000,
    };
    return this.cached.token;
  }

  /** One token for everyone who asks at once, refreshed a minute before it expires. */
  private token(): Promise<string> {
    if (this.cached !== undefined && this.cached.expiresAt > this.now())
      return Promise.resolve(this.cached.token);
    this.pending ??= this.fetchToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async attempt(
    method: string,
    path: string,
    options: CallOptions<z.ZodType>,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await this.token()}`,
      accept: 'application/json',
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (method === 'POST' && options.requestId !== undefined)
      headers['paypal-request-id'] = options.requestId;
    return this.send(new URL(path, this.base), {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }

  /** Sends a request, retrying 429 and 5xx with the same request id, and refreshing a refused token once. */
  async call<S extends z.ZodType>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: CallOptions<S>,
  ): Promise<z.output<S>> {
    const retries = this.config.maxRetries ?? 3;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const response = await this.attempt(method, path, options);
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        this.cached = undefined;
        continue;
      }
      if (response.ok) return this.read(response, method, path, options.schema);
      const error = await this.failure(response);
      if (error.kind !== 'retryable' || attempt >= retries) throw error;
      await this.sleep(error.retryAfterMs ?? 250 * 2 ** attempt);
    }
  }

  private async read<S extends z.ZodType>(
    response: Response,
    method: string,
    path: string,
    schema: S,
  ): Promise<z.output<S>> {
    const parsed = schema.safeParse(
      response.status === 204 ? {} : await response.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new PayPalError('invalid', `PayPal's answer to ${method} ${path} could not be read.`, {
        status: response.status,
      });
    }
    return parsed.data;
  }

  post<S extends z.ZodType>(
    path: string,
    requestId: string,
    body: unknown,
    schema: S,
  ): Promise<z.output<S>> {
    return this.call('POST', path, { body, requestId, schema });
  }
}
