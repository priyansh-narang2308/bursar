import { Writable } from 'node:stream';
import { createCore, WEBHOOK_EVENT_TYPES } from '@bursar/core';
import { parseKeyring } from '@bursar/crypto';
import type { Db } from '@bursar/db';
import { createTestDb } from '@bursar/db/testing';
import { createPayPalClient } from '@bursar/paypal';
import { createFakePayPal } from '@bursar/paypal-fake';
import { createApp } from '../src/app';
import { type Config, loadConfig } from '../src/config';
import { createLogger } from '../src/logger';

export const SESSION_SECRET = 'a'.repeat(64);

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({ DATABASE_URL: 'pglite', SESSION_SECRET, LOG_LEVEL: 'info', ...over });
}

/** JSON when the body is JSON; an event stream or an empty body has none. */
const parseJson = (text: string) => (/^[[{]/.test(text) ? JSON.parse(text) : undefined);

export interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  // biome-ignore lint/suspicious/noExplicitAny: a test client reads untyped JSON
  readonly json: any;
}

/** The app on a throwaway database, with a small client that carries cookies and keeps the logs. */
export async function createTestApp(
  config: Config = testConfig(),
  clock: () => Date = () => new Date(),
) {
  const { db, close } = await createTestDb();
  const logs: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, done) {
      logs.push(String(chunk));
      done();
    },
  });
  const fake = createFakePayPal();
  const paypal = createPayPalClient({
    clientId: fake.config.clientId,
    clientSecret: fake.config.clientSecret,
    baseUrl: 'https://fake.paypal.test',
    fetch: fake.fetch,
    sleep: async () => undefined,
    maxRetries: 0,
  });
  const key = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => seed + i);
  const core = createCore({
    db,
    paypal,
    vaultKeys: parseKeyring(Buffer.from(key(1)).toString('hex')),
    approvalKey: key(40),
    provenanceKeys: [key(80)],
    webhookId: 'WH-0001',
    now: clock,
  });
  await paypal.webhooks.register({
    requestId: 'hook',
    url: 'https://app.test/webhooks/paypal',
    eventTypes: WEBHOOK_EVENT_TYPES,
  });
  const app = createApp({ config, db, logger: createLogger('info', sink), now: clock, core });

  /** A client with its own cookie jar, like one browser or one agent. */
  function client(initialCookie?: string) {
    let cookie = initialCookie;
    return {
      get cookie() {
        return cookie;
      },
      async call(
        method: string,
        path: string,
        options: { json?: unknown; headers?: Record<string, string> } = {},
      ): Promise<Reply> {
        const headers: Record<string, string> = { ...options.headers };
        if (cookie !== undefined) headers['cookie'] = cookie;
        if (options.json !== undefined) headers['content-type'] = 'application/json';
        const response = await app.request(path, {
          method,
          headers,
          ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
        });
        const set = response.headers.get('set-cookie');
        if (set !== null) cookie = set.split(';')[0];
        const text = await response.text();
        return {
          status: response.status,
          headers: response.headers,
          text,
          json: parseJson(text),
        };
      },
    };
  }
  /** Posts to the webhook door every event the fake PayPal has signed, as PayPal would. */
  async function deliver(): Promise<string[]> {
    const statuses: string[] = [];
    for (const { headers, event } of fake.events.splice(0)) {
      const response = await app.request('/webhooks/paypal', {
        method: 'POST',
        headers,
        body: JSON.stringify(event),
      });
      statuses.push(((await response.json()) as { status: string }).status);
    }
    return statuses;
  }
  return { app, db, logs, client, close, config, fake, deliver };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
export type TestClient = ReturnType<TestApp['client']>;

/** A browser that has opened a demo workspace. */
export async function openWorkspace(t: TestApp) {
  const browser = t.client();
  const reply = await browser.call('POST', '/v1/demo/workspace', { json: { name: 'Acme' } });
  return { browser, orgId: reply.json.orgId as string };
}

export type { Db };
