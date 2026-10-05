import { Writable } from 'node:stream';
import type { Db } from '@bursar/db';
import { createTestDb } from '@bursar/db/testing';
import { createApp } from '../src/app';
import { type Config, loadConfig } from '../src/config';
import { createLogger } from '../src/logger';

export const SESSION_SECRET = 'a'.repeat(64);

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({ DATABASE_URL: 'pglite', SESSION_SECRET, LOG_LEVEL: 'info', ...over });
}

export interface Reply {
  readonly status: number;
  readonly headers: Headers;
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
  const app = createApp({ config, db, logger: createLogger('info', sink), now: clock });

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
          json: text === '' ? undefined : JSON.parse(text),
        };
      },
    };
  }
  return { app, db, logs, client, close, config };
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
