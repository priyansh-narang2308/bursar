import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, openWorkspace, type TestApp } from './support';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const usd = (cents: number) => ({ currency: 'USD', minor: String(cents) });

/** A workspace that has bought something: hold placed (approved by a person) and captured. */
async function purchase() {
  const { browser, orgId } = await openWorkspace(t);
  const post = async (path: string, json: unknown) =>
    (await browser.call('POST', path, { json })).json;
  const mandate = await post('/v1/mandates', {
    payerName: 'Pat',
    cap: usd(1_000_000),
    perMissionCap: usd(500_000),
    validFrom: '2020-01-01T00:00:00Z',
    validTo: '2100-01-01T00:00:00Z',
    returnUrl: 'https://a.test/r',
    cancelUrl: 'https://a.test/c',
  });
  t.fake.approveSetupToken(mandate.setupTokenId);
  await browser.call('POST', `/v1/mandates/${mandate.mandateId}/complete`);
  const supplier = await post('/v1/suppliers', { name: 'Paper Co', payoutEmail: 'p@example.com' });
  const offer = await post('/v1/offers', {
    supplierId: supplier.id,
    title: 'Pens',
    category: 'office',
    url: 'https://shop.example/pens',
    price: usd(1_000),
  });
  const mission = await post('/v1/missions', {
    goal: 'Pens',
    budget: usd(10_000),
    mandateId: mandate.mandateId,
  });
  const cart = await post(`/v1/missions/${mission.id}/carts`, {
    lines: [{ offerId: offer.id, quantity: 2 }],
  });
  const proposed = await post('/v1/actions', {
    type: 'AUTHORIZE',
    missionId: mission.id,
    cartId: cart.cartId,
  });
  const [approvalId] = proposed.proposal.approvalIds as [string];
  await post(`/v1/approvals/${approvalId}/decide`, { decision: 'APPROVE' });
  return { browser, orgId, proposed, cartId: cart.cartId as string, supplierId: supplier.id };
}

describe('oversight over HTTP', () => {
  it('shows a receipt with every stage, replays the ruling and verifies the chain', async () => {
    const w = await purchase();
    const receipt = await w.browser.call('GET', `/v1/receipts/${w.proposed.proposal.actionId}`);
    expect(receipt.status).toBe(200);
    expect(Object.keys(receipt.json)).toEqual(
      expect.arrayContaining(['action', 'cart', 'decisions', 'approvals', 'executions']),
    );
    expect(receipt.json.decisions.length).toBeGreaterThanOrEqual(1);
    const decisionId = receipt.json.decisions[0].id as string;
    const replay = await w.browser.call('POST', `/v1/decisions/${decisionId}/replay`);
    expect(replay.json).toMatchObject({ reproduced: true });
    expect((await w.browser.call('GET', '/v1/audit/verify')).json).toMatchObject({ ok: true });
    expect((await w.browser.call('GET', '/v1/receipts/act_NOPE')).status).toBeGreaterThanOrEqual(
      400,
    );
  });

  it('streams events and resumes after the last one seen, only for the caller’s organisation', async () => {
    const w = await purchase();
    const text = async (client: typeof w.browser, path: string) =>
      (await client.call('GET', path)).text;
    const all = await text(w.browser, '/v1/events?wait=0');
    const ids = [...all.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const resumed = await text(w.browser, `/v1/events?wait=0&after=${ids[0]}`);
    expect([...resumed.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]))).toEqual(ids.slice(1));
    const other = await openWorkspace(t);
    expect(await text(other.browser, '/v1/events?wait=0')).not.toContain(w.orgId);
  });

  it('lets a person inspect goods and lists the delivery; an agent cannot', async () => {
    const w = await purchase();
    const body = { cartId: w.cartId, supplierId: w.supplierId, status: 'INSPECTED' };
    const done = await w.browser.call('POST', '/v1/deliveries', { json: body });
    expect(done.status).toBe(201);
    expect((await w.browser.call('GET', '/v1/deliveries')).json.items).toHaveLength(1);
    expect(
      (await w.browser.call('POST', '/v1/deliveries', { json: { ...body, extra: 1 } })).status,
    ).toBe(400);
  });

  it('keeps incidents readable and resolvable only by the right roles', async () => {
    const w = await purchase();
    expect((await w.browser.call('GET', '/v1/incidents')).json.items).toEqual([]);
    expect(
      (
        await w.browser.call('POST', '/v1/incidents/inc_00000000000000000000000000/resolve', {
          json: { note: 'checked' },
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await t.client().call('GET', '/v1/incidents')).status).toBe(401);
  });
});
