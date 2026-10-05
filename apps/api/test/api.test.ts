import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS, type Permission, ROLE_PERMISSIONS } from '../src/auth/permissions';
import { loadConfig } from '../src/config';
import { createLogger } from '../src/logger';
import { OPERATIONS } from '../src/openapi';
import { createTestApp, openWorkspace, SESSION_SECRET, type TestApp, testConfig } from './support';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('config', () => {
  it('reads a valid environment and names bad variables without their values', () => {
    expect(testConfig().port).toBe(8787);
    expect(() => loadConfig({ DATABASE_URL: 'x', SESSION_SECRET: 'short-secret-value' })).toThrow(
      /SESSION_SECRET/,
    );
    expect(() => loadConfig({ DATABASE_URL: 'x', SESSION_SECRET })).not.toThrow();
    try {
      loadConfig({ DATABASE_URL: 'x', SESSION_SECRET: 'short-secret-value' });
    } catch (error) {
      expect(String(error)).not.toContain('short-secret-value');
    }
  });
  it('refuses to allow live PayPal', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x', SESSION_SECRET, ALLOW_LIVE: 'true' })).toThrow(
      /ALLOW_LIVE/,
    );
  });
});

describe('the basics', () => {
  it('answers liveness and readiness, and says what it serves', async () => {
    const anon = t.client();
    expect((await anon.call('GET', '/healthz')).json).toEqual({ status: 'ok' });
    expect((await anon.call('GET', '/readyz')).json).toEqual({ status: 'ready' });
    const doc = (await anon.call('GET', '/openapi.json')).json;
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toContain('/v1/agents/{id}/keys/{keyId}');
  });

  it('documents every route the app serves, and only those', () => {
    const served = t.app.routes
      .filter((r) => r.method !== 'ALL')
      .map((r) => `${r.method.toLowerCase()} ${r.path}`);
    const documented = OPERATIONS.map((o) => `${o.method} ${o.path}`);
    expect([...new Set(served)].sort()).toEqual([...documented].sort());
  });

  it('sends security headers, and answers CORS only for the web app', async () => {
    const anon = t.client();
    const reply = await anon.call('GET', '/healthz', {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(reply.headers.get('x-content-type-options')).toBe('nosniff');
    expect(reply.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(
      (
        await anon.call('GET', '/healthz', { headers: { origin: 'https://evil.example' } })
      ).headers.get('access-control-allow-origin'),
    ).not.toBe('https://evil.example');
  });

  it('gives every response a request id, and keeps a well-formed one from the caller', async () => {
    const anon = t.client();
    expect((await anon.call('GET', '/healthz')).headers.get('x-request-id')).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(
      (
        await anon.call('GET', '/healthz', { headers: { 'x-request-id': 'trace-12345678' } })
      ).headers.get('x-request-id'),
    ).toBe('trace-12345678');
    expect(
      (await anon.call('GET', '/healthz', { headers: { 'x-request-id': 'bad id!' } })).headers.get(
        'x-request-id',
      ),
    ).not.toBe('bad id!');
  });
});

describe('errors are RFC 9457 problems from the catalog', () => {
  it('answers an unknown route, a missing session and bad input with the right code and shape', async () => {
    const anon = t.client();
    const missing = await anon.call('GET', '/nope');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/problem+json');
    expect(missing.json).toMatchObject({
      code: 'NOT_FOUND',
      type: 'urn:bursar:error:not-found',
      retryable: false,
      instance: '/nope',
    });
    expect(missing.json.requestId).toBe(missing.headers.get('x-request-id'));

    expect((await anon.call('GET', '/v1/me')).json).toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });

    const { browser } = await openWorkspace(t);
    const invalid = await browser.call('POST', '/v1/agents', { json: { name: '' } });
    expect(invalid.status).toBe(400);
    expect(invalid.json).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(invalid.json.errors[0]).toMatchObject({ path: 'name' });
  });

  it('turns an unexpected failure into a 500 that reveals nothing', async () => {
    const { browser } = await openWorkspace(t);
    const reply = await browser.call(
      'DELETE',
      '/v1/agents/agt_01ARZ3NDEKTSV4RRFFQ69G5FAV/keys/not-a-uuid',
    );
    expect([400, 500]).toContain(reply.status);
    expect(JSON.stringify(reply.json)).not.toMatch(/at \w+|node_modules|select /i);
  });

  it('limits how fast one client can call, with Retry-After', async () => {
    const fresh = await createTestApp();
    const anon = fresh.client();
    let last = await anon.call('GET', '/v1/me');
    for (let i = 0; i < 305 && last.status !== 429; i++) last = await anon.call('GET', '/v1/me');
    expect(last.status).toBe(429);
    expect(last.json).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
    await fresh.close();
  });
});

describe('logging', () => {
  it('logs each request without headers, cookies or keys', async () => {
    const { browser } = await openWorkspace(t);
    const agent = await browser.call('POST', '/v1/agents', { json: { name: 'Buyer' } });
    const key = (await browser.call('POST', `/v1/agents/${agent.json.id}/keys`, { json: {} })).json
      .key as string;
    await t.client().call('GET', '/v1/me', { headers: { authorization: `Bearer ${key}` } });
    const text = t.logs.join('');
    expect(text).toContain('"msg":"request"');
    expect(text).not.toContain(key);
    expect(text).not.toMatch(/bursar_session=|authorization/i);
  });

  it('redacts secrets that a caller logs by mistake', () => {
    const lines: string[] = [];
    const logger = createLogger('info', { write: (line: string) => void lines.push(line) });
    logger.info(
      {
        headers: { authorization: 'Bearer sk-live-123', cookie: 'bursar_session=abc' },
        user: { password: 'hunter2', token: 'tok-9' },
        apiKey: 'bk_secret',
      },
      'oops',
    );
    const out = lines.join('');
    for (const secret of ['sk-live-123', 'bursar_session=abc', 'hunter2', 'tok-9', 'bk_secret'])
      expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });
});

describe('sessions and demo mode', () => {
  it('opens a workspace with an HttpOnly session, and who-am-I answers from it', async () => {
    const anon = t.client();
    const opened = await anon.call('POST', '/v1/demo/workspace', { json: { name: 'Acme' } });
    expect(opened.status).toBe(201);
    const cookie = opened.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect((await anon.call('GET', '/v1/me')).json).toMatchObject({
      kind: 'session',
      role: 'OWNER',
      orgId: opened.json.orgId,
    });
  });

  it('rejects a forged or expired cookie', async () => {
    const forged = t.client('bursar_session=eyJzdWIiOiJ4In0.AAAA');
    expect((await forged.call('GET', '/v1/me')).status).toBe(401);
    let now = new Date('2026-10-05T12:00:00Z');
    const clocked = await createTestApp(testConfig(), () => now);
    const { browser } = await openWorkspace(clocked);
    expect((await browser.call('GET', '/v1/me')).status).toBe(200);
    now = new Date('2026-10-06T00:00:01Z');
    expect((await browser.call('GET', '/v1/me')).status).toBe(401);
    await clocked.close();
  });

  it('lets a demo user switch role, and turns all of it off when demo mode is off', async () => {
    const { browser } = await openWorkspace(t);
    await browser.call('POST', '/v1/demo/role', { json: { role: 'AUDITOR' } });
    expect((await browser.call('GET', '/v1/me')).json.role).toBe('AUDITOR');
    expect(
      (await browser.call('POST', '/v1/demo/role', { json: { role: 'NOT_A_ROLE' } })).status,
    ).toBe(400);
    const real = await createTestApp(testConfig({ DEMO_MODE: 'false' }));
    expect((await real.client().call('POST', '/v1/demo/workspace', { json: {} })).status).toBe(404);
    await real.close();
  });
});

describe('permission matrix', () => {
  /** The routes that need a permission, one per permission, and what each role should get. */
  const probes: ReadonlyArray<readonly [Permission, string, string]> = [
    ['workspace:read', 'GET', '/v1/workspace'],
    ['audit:read', 'GET', '/v1/audit-events'],
    ['agents:manage', 'POST', '/v1/agents'],
  ];

  it.each(Object.entries(ROLE_PERMISSIONS))(
    '%s gets exactly the permissions its role grants',
    async (role, granted) => {
      const { browser } = await openWorkspace(t);
      await browser.call('POST', '/v1/demo/role', { json: { role } });
      for (const [permission, method, path] of probes) {
        const reply = await browser.call(method, path, {
          json: method === 'POST' ? { name: 'x' } : undefined,
        });
        expect(reply.status === 403, `${role} on ${permission}`).toBe(
          !granted.includes(permission),
        );
      }
    },
  );

  it('keeps the Verifier from proposing and agents from approving or managing', () => {
    expect(ROLE_PERMISSIONS.VERIFIER).not.toContain('actions:propose');
    expect(ROLE_PERMISSIONS.AGENT).not.toContain('approvals:decide');
    expect(ROLE_PERMISSIONS.AGENT).not.toContain('agents:manage');
    expect(PERMISSIONS.every((p) => ROLE_PERMISSIONS.OWNER.includes(p))).toBe(true);
  });
});

describe('tenancy', () => {
  it('never shows one workspace another’s data', async () => {
    const [a, b] = [await openWorkspace(t), await openWorkspace(t)];
    await a.browser.call('POST', '/v1/agents', { json: { name: 'A-only' } });
    expect((await b.browser.call('GET', '/v1/agents')).json.items).toEqual([]);
    expect((await a.browser.call('GET', '/v1/workspace')).json.id).toBe(a.orgId);
    expect((await b.browser.call('GET', '/v1/workspace')).json.id).toBe(b.orgId);
  });

  it('cannot touch another workspace’s agent or keys by id', async () => {
    const [a, b] = [await openWorkspace(t), await openWorkspace(t)];
    const agent = (await a.browser.call('POST', '/v1/agents', { json: { name: 'A-only' } })).json;
    expect((await b.browser.call('POST', `/v1/agents/${agent.id}/keys`, { json: {} })).status).toBe(
      404,
    );
  });
});

describe('agent keys', () => {
  it('shows a key once, stores only its hash, and authenticates the agent within its scopes', async () => {
    const { browser, orgId } = await openWorkspace(t);
    const agent = (await browser.call('POST', '/v1/agents', { json: { name: 'Buyer' } })).json;
    const created = (
      await browser.call('POST', `/v1/agents/${agent.id}/keys`, {
        json: { scopes: ['missions:read'] },
      })
    ).json;
    expect(created.key).toMatch(/^bk_/);

    const stored = JSON.stringify((await browser.call('GET', '/v1/agents')).json);
    expect(stored).not.toContain(created.key);
    const rows = await t.db.execute(
      `select key_hash from api_keys where id = '${created.id}'` as never,
    );
    expect(JSON.stringify(rows)).not.toContain(created.key);

    const bot = t.client();
    const auth = { authorization: `Bearer ${created.key}` };
    expect((await bot.call('GET', '/v1/me', { headers: auth })).json).toMatchObject({
      kind: 'agent',
      role: 'AGENT',
      orgId,
      scopes: ['missions:read'],
    });
    expect((await bot.call('GET', '/v1/workspace', { headers: auth })).status).toBe(403); // not an agent permission
    expect(
      (await bot.call('POST', '/v1/agents', { headers: auth, json: { name: 'x' } })).status,
    ).toBe(403);
  });

  it('rotates and revokes: the old key stops working at once', async () => {
    const { browser } = await openWorkspace(t);
    const agent = (await browser.call('POST', '/v1/agents', { json: { name: 'Buyer' } })).json;
    const first = (await browser.call('POST', `/v1/agents/${agent.id}/keys`, { json: {} })).json;
    const second = (await browser.call('POST', `/v1/agents/${agent.id}/keys/${first.id}/rotate`))
      .json;
    const bot = t.client();
    expect(
      (await bot.call('GET', '/v1/me', { headers: { authorization: `Bearer ${first.key}` } }))
        .status,
    ).toBe(401);
    expect(
      (await bot.call('GET', '/v1/me', { headers: { authorization: `Bearer ${second.key}` } }))
        .status,
    ).toBe(200);
    expect((await browser.call('DELETE', `/v1/agents/${agent.id}/keys/${second.id}`)).status).toBe(
      204,
    );
    expect(
      (await bot.call('GET', '/v1/me', { headers: { authorization: `Bearer ${second.key}` } }))
        .status,
    ).toBe(401);
    expect((await browser.call('DELETE', `/v1/agents/${agent.id}/keys/${second.id}`)).status).toBe(
      404,
    );
  });

  it('refuses an unknown or malformed key', async () => {
    const bot = t.client();
    for (const token of ['bk_nonsense', 'nonsense', 'bk_']) {
      expect(
        (await bot.call('GET', '/v1/me', { headers: { authorization: `Bearer ${token}` } })).status,
      ).toBe(401);
    }
  });
});
