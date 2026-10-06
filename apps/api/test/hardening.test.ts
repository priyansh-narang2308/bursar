import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webHeaders } from '../src/http/headers';
import { createTestApp, openWorkspace, type TestApp } from './support';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const post = (path: string, headers: Record<string, string>, body = '{}') =>
  t.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

describe('writes from another site', () => {
  it('are refused, because a cookie rides along with a request from any page', async () => {
    const { browser } = await openWorkspace(t);
    const cookie = browser.cookie ?? '';
    const other = await post(
      '/v1/demo/role',
      { cookie, origin: 'https://evil.example' },
      '{"role":"AUDITOR"}',
    );
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect((await browser.call('GET', '/v1/me')).json.role).toBe('OWNER'); // nothing changed
  });

  it('are allowed from our own site, and from callers that are not browsers', async () => {
    const { browser } = await openWorkspace(t);
    const cookie = browser.cookie ?? '';
    const own = await post(
      '/v1/demo/role',
      { cookie, origin: new URL(t.config.publicBaseUrl).origin },
      '{"role":"AUDITOR"}',
    );
    expect(own.status).toBe(200);
    expect((await post('/v1/demo/role', { cookie }, '{"role":"OWNER"}')).status).toBe(200); // no Origin: a script or a test
  });

  it('are allowed from the very host they were sent to, which is what a deployed site sees behind a proxy', async () => {
    const { browser } = await openWorkspace(t);
    const cookie = browser.cookie ?? '';
    const same = await post(
      '/v1/demo/role',
      { cookie, origin: 'https://demo.example.onrender.com', host: 'demo.example.onrender.com' },
      '{"role":"OWNER"}',
    );
    expect(same.status).toBe(200);
    const other = await post(
      '/v1/demo/role',
      { cookie, origin: 'https://evil.example', host: 'demo.example.onrender.com' },
      '{"role":"OWNER"}',
    );
    expect(other.status).toBe(403);
    expect(
      (await post('/v1/demo/role', { cookie, origin: 'not a url' }, '{"role":"OWNER"}')).status,
    ).toBe(403);
  });

  it('do not stop reading from another site', async () => {
    const { browser } = await openWorkspace(t);
    const read = await t.app.request('/v1/me', {
      headers: { cookie: browser.cookie ?? '', origin: 'https://evil.example' },
    });
    expect(read.status).toBe(200);
  });
});

describe('request size', () => {
  it('refuses a body far larger than anything a person or an agent sends', async () => {
    const { browser } = await openWorkspace(t);
    const big = JSON.stringify({ name: 'x'.repeat(100_000) });
    const response = await post('/v1/agents', { cookie: browser.cookie ?? '' }, big);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('roles in a demo workspace', () => {
  it('are different people, so one cannot approve what another proposed', async () => {
    const { browser } = await openWorkspace(t);
    const owner = (await browser.call('GET', '/v1/me')).json.userId;
    await browser.call('POST', '/v1/demo/role', { json: { role: 'APPROVER' } });
    const approver = (await browser.call('GET', '/v1/me')).json;
    expect(approver.role).toBe('APPROVER');
    expect(approver.userId).not.toBe(owner);
    await browser.call('POST', '/v1/demo/role', { json: { role: 'OWNER' } });
    expect((await browser.call('GET', '/v1/me')).json.userId).toBe(owner); // and back again
  });
});

describe('the scheduler door', () => {
  const knock = (app: TestApp, token?: string) =>
    app.app.request('/internal/jobs', {
      method: 'POST',
      headers: token === undefined ? {} : { 'x-job-token': token },
    });

  it('does not exist unless a job token is configured', async () => {
    expect((await knock(t, 'anything')).status).toBe(404);
  });

  it('runs the job for the right token, and for no one else', async () => {
    let runs = 0;
    const app = await createTestApp(undefined, undefined, {
      jobs: {
        token: 'a-long-shared-secret',
        run: async () => {
          runs++;
          return { reconciled: 3 };
        },
      },
    });
    expect((await knock(app)).status).toBe(403);
    expect((await knock(app, 'a-long-shared-secreT')).status).toBe(403);
    expect((await knock(app, 'short')).status).toBe(403);
    expect(runs).toBe(0);
    const ok = await knock(app, 'a-long-shared-secret');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, result: { reconciled: 3 } });
    expect(runs).toBe(1);
    await app.close();
  });
});

describe('what a browser is allowed to do with a page', () => {
  it('lets the API load nothing and keeps it out of frames', async () => {
    const reply = await t.app.request('/healthz');
    const policy = reply.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(reply.headers.get('x-content-type-options')).toBe('nosniff');
    expect(reply.headers.get('permissions-policy')).toMatch(/camera=\(\)/);
  });

  it('holds the web app to its own scripts, with no eval and no framing', async () => {
    const page = new Hono().use('*', webHeaders()).get('/', (c) => c.html('<p>hi</p>'));
    const policy = (await page.request('/')).headers.get('content-security-policy') ?? '';
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|\*/);
  });
});
