import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
