import { type AgentRole, createToolbox } from '@bursar/agent-tools';
import { type Channel3Product, createCatalog, createFixtureApi } from '@bursar/channel3';
import { world } from '@bursar/core/testing';
import { standardPolicy } from '@bursar/policy';
import { newId } from '@bursar/schemas';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, describe, expect, it } from 'vitest';
import {
  classifyToolkitTool,
  handleMcp,
  PAYPAL_TOOLKIT_TOOLS,
  type Scopes,
  type ToolkitBridge,
} from '../src';

const product = (id: string, title: string, price: number): Channel3Product => ({
  id,
  title,
  offers: [
    {
      url: `https://shop.example/${id}`,
      domain: 'shop.example',
      price: { price, currency: 'USD' },
      availability: 'InStock',
    },
  ],
});
const CATALOG = [product('p1', 'Office chair', 120), product('p2', 'Gold chair', 900)];
const worlds: Awaited<ReturnType<typeof world>>[] = [];
afterAll(() => Promise.all(worlds.map((x) => x.close())));

/** An MCP client talking to the gateway over Streamable HTTP, with the HTTP handled in process. */
async function connect(
  options: { lenient?: boolean; scopes?: Scopes; bridge?: ToolkitBridge } = {},
) {
  const w = await world({
    lenient: options.lenient ?? true,
    budget: 1_000_000,
  });
  worlds.push(w);
  await w.core.catalog.createSupplier(w.orgId, w.owner, {
    name: 'shop.example',
    payoutEmail: 's@example.com',
  });
  const catalog = createCatalog({ api: createFixtureApi(CATALOG) });
  const toolbox = (role: AgentRole) =>
    createToolbox({
      db: w.db,
      core: w.core,
      catalog,
      policy: standardPolicy(),
      orgId: w.orgId,
      agentId: 'agt_mcp',
      role,
      missionId: w.missionId,
    });
  const deps = { toolbox, bridge: options.bridge };
  const scopes = options.scopes ?? { read: true, propose: true };
  const transport = new StreamableHTTPClientTransport(new URL('http://gateway.test/mcp'), {
    fetch: async (url, init) => handleMcp(new Request(url, init), deps, scopes),
  });
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  await client.connect(transport as never);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const first = (result.content as { text: string }[])[0];
    return {
      isError: result.isError === true,
      // biome-ignore lint/suspicious/noExplicitAny: a test client reads untyped JSON
      body: parse(first?.text ?? 'null') as Record<string, any>,
    };
  };
  return { client, call, w };
}

/** A tool's text as JSON, or as `{ message }` when it is a protocol error such as a failed validation. */
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

/** Searches for the chair and returns its offer id. */
async function findChair(
  call: Awaited<ReturnType<typeof connect>>['call'],
  title = 'Office chair',
) {
  const found = await call('search_offers', {
    needId: newId('need'),
    query: title,
    maxResults: 3,
  });
  return (found.body['data'].offers as { offerId: string }[])[0]?.offerId as string;
}

describe('what an agent is given', () => {
  it('lists only Bursar’s guarded tools and the money redirects, never a raw PayPal tool', async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['search_offers', 'get_offer', 'compare_offers', 'propose_cart']),
    );
    const toolkit = names.filter((n) => (PAYPAL_TOOLKIT_TOOLS as readonly string[]).includes(n));
    expect(toolkit.every((n) => classifyToolkitTool(n) === 'MONEY')).toBe(true);
    expect(toolkit).toContain('pay_order');
    expect(names).not.toContain('list_transactions'); // read-only toolkit tools need a bridge
  });

  it('hides what the key’s scopes do not allow', async () => {
    const { client, call } = await connect({
      scopes: { read: true, propose: false },
    });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('search_offers');
    expect(names).not.toContain('propose_cart');
    expect(await call('propose_cart', {})).toMatchObject({
      isError: true,
      body: { message: expect.stringMatching(/not found/i) },
    });
    const none = await connect({ scopes: { read: false, propose: false } });
    expect(
      (await none.client.listTools()).tools
        .map((t) => t.name)
        .every((n) => classifyToolkitTool(n) === 'MONEY'),
    ).toBe(true);
  });

  it('classifies every tool of the toolkit, denying by default', () => {
    const kinds = PAYPAL_TOOLKIT_TOOLS.map(classifyToolkitTool);
    expect(new Set(kinds)).toEqual(new Set(['READ', 'MONEY', 'BLOCKED']));
    expect(classifyToolkitTool('a_tool_added_next_year')).toBe('BLOCKED');
    expect(classifyToolkitTool('get_something_new')).toBe('BLOCKED'); // read-looking but not known
    expect(classifyToolkitTool('delete_invoice')).toBe('BLOCKED');
    expect(classifyToolkitTool('get_order')).toBe('READ');
    expect(classifyToolkitTool('create_refund')).toBe('MONEY');
  });
});

describe('blocked, approved and pending', () => {
  it('blocks PayPal’s money tools and says where to go', async () => {
    const { call } = await connect();
    for (const name of ['pay_order', 'create_order', 'create_refund']) {
      const out = await call(name, {
        amount: '5000.00',
        payee: 'me@evil.example',
      });
      expect(out).toMatchObject({
        isError: true,
        body: { status: 'BLOCKED', useInstead: 'propose_cart' },
      });
    }
  });

  it('approves a trusted purchase and leaves a first-time supplier waiting for a person', async () => {
    const trusted = await connect({ lenient: true });
    const id = await findChair(trusted.call);
    const ok = await trusted.call('propose_cart', {
      missionId: trusted.w.missionId,
      lines: [{ offerId: id, quantity: 2 }],
      rationale: 'Two chairs',
    });
    expect(ok.body).toMatchObject({
      ok: true,
      status: 'APPROVED',
      total: 'USD 240.00',
    });

    const strict = await connect({ lenient: false });
    const pending = await strict.call('propose_cart', {
      missionId: strict.w.missionId,
      lines: [{ offerId: await findChair(strict.call), quantity: 1 }],
      rationale: 'A chair',
    });
    expect(pending.body).toMatchObject({
      status: 'PENDING_APPROVAL',
      next: expect.stringContaining('person'),
    });
  });

  it('blocks what policy refuses, and refuses a field that names a payee or an amount', async () => {
    const { call, w } = await connect();
    const gold = await findChair(call, 'Gold chair');
    const denied = await call('propose_cart', {
      missionId: w.missionId,
      lines: [{ offerId: gold, quantity: 1 }],
      rationale: 'Fancy',
    });
    expect(denied.body).toMatchObject({ status: 'BLOCKED' }); // over the single-item cap
    const sneaky = await call('propose_cart', {
      missionId: w.missionId,
      lines: [{ offerId: gold, quantity: 1 }],
      rationale: 'x',
      payee: 'me@evil.example',
    });
    expect(sneaky.isError).toBe(true);
    expect(JSON.stringify(sneaky.body)).toMatch(/payee|unrecognized/i);
  });
});

describe('PayPal’s read-only tools', () => {
  it('pass through when a bridge is given, and nothing else does', async () => {
    const seen: string[] = [];
    const bridge: ToolkitBridge = {
      call: async (name) => {
        seen.push(name);
        return { transactions: [] };
      },
    };
    const { client, call } = await connect({ bridge });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('list_transactions');
    for (const name of PAYPAL_TOOLKIT_TOOLS) {
      if (names.includes(name)) await call(name, {});
      else
        expect(await call(name, {})).toMatchObject({
          isError: true,
          body: { message: expect.stringMatching(/not found/i) },
        }); // unreachable
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.every((n) => classifyToolkitTool(n) === 'READ')).toBe(true);
  });
});
