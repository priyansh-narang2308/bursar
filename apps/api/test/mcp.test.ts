import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, openWorkspace, type TestApp } from './support';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const ACCEPT = 'application/json, text/event-stream';

/** An agent key with the given scopes, and an MCP client that uses it over the app's own /v1/mcp. */
async function agentClient(scopes: string[]) {
  const { browser } = await openWorkspace(t);
  const agent = (await browser.call('POST', '/v1/agents', { json: { name: 'Buyer' } })).json;
  const key = (await browser.call('POST', `/v1/agents/${agent.id}/keys`, { json: { scopes } })).json
    .key as string;
  const transport = new StreamableHTTPClientTransport(new URL('http://api.test/v1/mcp'), {
    fetch: async (url, init) =>
      t.app.request(String(url), {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          authorization: `Bearer ${key}`,
        },
      }),
  });
  const client = new Client({ name: 'claude', version: '0' });
  await client.connect(transport as never);
  return client;
}

const toolNames = async (client: Client) => (await client.listTools()).tools.map((x) => x.name);

describe('the MCP door', () => {
  it('shows an agent key the tools its scopes allow, over the app’s own authentication', async () => {
    const full = await toolNames(await agentClient(['missions:read', 'actions:propose']));
    expect(full).toEqual(expect.arrayContaining(['search_offers', 'propose_cart', 'pay_order']));
    const readOnly = await toolNames(await agentClient(['missions:read']));
    expect(readOnly).toContain('search_offers');
    expect(readOnly).not.toContain('propose_cart');
  });

  it('turns away a caller with no key, a bad key, and a signed-in person', async () => {
    const post = (headers: Record<string, string>) =>
      t.app.request('/v1/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: ACCEPT, ...headers },
        body: '{}',
      });
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: 'Bearer bk_nope' })).status).toBe(401);
    const { browser } = await openWorkspace(t);
    expect((await post({ cookie: browser.cookie ?? '' })).status).toBe(403);
  });
});
