import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, openWorkspace, type TestApp, type TestClient } from './support';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const usd = (cents: number) => ({ currency: 'USD', minor: String(cents) });

/** A workspace with an active mandate, a supplier, offers, a mission, and an agent holding a key. */
async function workspace() {
  const { browser, orgId } = await openWorkspace(t);
  const agent = (await browser.call('POST', '/v1/agents', { json: { name: 'Buyer' } })).json;
  const key = (await browser.call('POST', `/v1/agents/${agent.id}/keys`, { json: {} })).json
    .key as string;
  const bot = t.client();
  const auth = { authorization: `Bearer ${key}` };
  const started = (
    await browser.call('POST', '/v1/mandates', {
      json: {
        payerName: 'Pat',
        cap: usd(1_000_000),
        perMissionCap: usd(500_000),
        validFrom: '2020-01-01T00:00:00Z',
        validTo: '2100-01-01T00:00:00Z',
        returnUrl: 'https://a.test/r',
        cancelUrl: 'https://a.test/c',
      },
    })
  ).json;
  t.fake.approveSetupToken(started.setupTokenId);
  await browser.call('POST', `/v1/mandates/${started.mandateId}/complete`);
  const supplier = (
    await browser.call('POST', '/v1/suppliers', {
      json: { name: 'Paper Co', payoutEmail: 'paper@example.com' },
    })
  ).json;
  const offer = (
    await browser.call('POST', '/v1/offers', {
      json: {
        supplierId: supplier.id,
        title: 'Pens',
        category: 'office',
        url: 'https://shop.example/pens',
        price: usd(1_000),
      },
    })
  ).json;
  const mission = (
    await browser.call('POST', '/v1/missions', {
      json: { goal: 'Office supplies', budget: usd(10_000), mandateId: started.mandateId },
    })
  ).json;
  const call = (client: TestClient, method: string, path: string, json?: unknown) =>
    client.call(method, path, {
      ...(json === undefined ? {} : { json }),
      headers: client === bot ? auth : {},
    });
  return { browser, bot, orgId, offer, mission, mandateId: started.mandateId as string, call };
}

describe('the money loop over HTTP', () => {
  it('runs a purchase: an agent proposes, a person approves, PayPal confirms', async () => {
    const w = await workspace();
    const cart = await w.call(w.bot, 'POST', `/v1/missions/${w.mission.id}/carts`, {
      lines: [{ offerId: w.offer.id, quantity: 3, rationale: 'Running low' }],
    });
    expect(cart.status).toBe(201);
    expect(cart.json.total).toEqual(usd(3_000)); // worked out by the server

    const proposed = await w.call(w.bot, 'POST', '/v1/actions', {
      type: 'AUTHORIZE',
      missionId: w.mission.id,
      cartId: cart.json.cartId,
    });
    expect(proposed.json.proposal).toMatchObject({
      state: 'AWAITING_APPROVAL',
      outcome: 'REQUIRE_APPROVAL',
    }); // a first-time supplier
    const [approvalId] = proposed.json.proposal.approvalIds as [string];

    expect(
      (await w.call(w.bot, 'POST', `/v1/approvals/${approvalId}/decide`, { decision: 'APPROVE' }))
        .status,
    ).toBe(403); // an agent cannot approve
    const approved = await w.call(w.browser, 'POST', `/v1/approvals/${approvalId}/decide`, {
      decision: 'APPROVE',
    });
    expect(approved.json).toMatchObject({ state: 'APPROVED', execution: { outcome: 'confirmed' } });

    const capture = await w.call(w.bot, 'POST', '/v1/actions', {
      type: 'CAPTURE',
      missionId: w.mission.id,
      cartId: cart.json.cartId,
    });
    expect(capture.json).toMatchObject({
      proposal: { state: 'APPROVED' },
      execution: { outcome: 'submitted' },
    });
    expect(await t.deliver()).toEqual(['processed']);

    const actions = (await w.call(w.browser, 'GET', '/v1/actions')).json.items as {
      type: string;
      state: string;
    }[];
    expect(actions.map((a) => `${a.type}:${a.state}`).sort()).toEqual([
      'AUTHORIZE:CONFIRMED',
      'CAPTURE:CONFIRMED',
    ]);
    expect((await w.call(w.browser, 'GET', '/v1/audit-events')).json.items.length).toBeGreaterThan(
      10,
    );
  });

  it('refuses any field that would let a caller name an amount, a price or a payee', async () => {
    const w = await workspace();
    const cart = await w.call(w.bot, 'POST', `/v1/missions/${w.mission.id}/carts`, {
      lines: [{ offerId: w.offer.id, quantity: 1 }],
    });
    const withAmount = await w.call(w.bot, 'POST', '/v1/actions', {
      type: 'AUTHORIZE',
      missionId: w.mission.id,
      cartId: cart.json.cartId,
      amount: usd(1),
    });
    expect(withAmount).toMatchObject({ status: 400, json: { code: 'VALIDATION_FAILED' } });
    const withPrice = await w.call(w.bot, 'POST', `/v1/missions/${w.mission.id}/carts`, {
      lines: [{ offerId: w.offer.id, quantity: 1, unitPrice: usd(1) }],
    });
    expect(withPrice.status).toBe(400);
    expect(
      (
        await w.call(w.bot, 'POST', '/v1/actions', {
          type: 'AUTHORIZE',
          missionId: w.mission.id,
          cartId: cart.json.cartId,
          payee: 'me@evil.example',
        })
      ).status,
    ).toBe(400);
  });

  it('answers a refused rule with the catalog’s code', async () => {
    const w = await workspace();
    const revoked = await w.call(w.browser, 'POST', `/v1/mandates/${w.mandateId}/revoke`, {});
    expect(revoked.json.status).toBe('REVOKED');
    expect(await w.call(w.browser, 'POST', `/v1/mandates/${w.mandateId}/complete`)).toMatchObject({
      status: 409,
      json: { code: 'ILLEGAL_STATE_TRANSITION' },
    });
  });
});

describe('who may do what', () => {
  it('keeps auditors and scoped agents from proposing', async () => {
    const w = await workspace();
    await w.browser.call('POST', '/v1/demo/role', { json: { role: 'AUDITOR' } });
    expect(
      (
        await w.call(w.browser, 'POST', '/v1/actions', {
          type: 'AUTHORIZE',
          missionId: w.mission.id,
          cartId: 'crt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        })
      ).status,
    ).toBe(403);
    await w.browser.call('POST', '/v1/demo/role', { json: { role: 'OWNER' } });
    const agent = (await w.browser.call('POST', '/v1/agents', { json: { name: 'Reader' } })).json;
    const key = (
      await w.browser.call('POST', `/v1/agents/${agent.id}/keys`, {
        json: { scopes: ['missions:read'] },
      })
    ).json.key as string;
    const reader = await t.client().call('POST', `/v1/missions/${w.mission.id}/carts`, {
      headers: { authorization: `Bearer ${key}` },
      json: { lines: [{ offerId: w.offer.id, quantity: 1 }] },
    });
    expect(reader.status).toBe(403);
  });

  it('shows nothing of another workspace', async () => {
    const [a, b] = [await workspace(), await workspace()];
    await a.call(a.bot, 'POST', `/v1/missions/${a.mission.id}/carts`, {
      lines: [{ offerId: a.offer.id, quantity: 1 }],
    });
    for (const path of [
      '/v1/missions',
      '/v1/mandates',
      '/v1/offers',
      '/v1/suppliers',
      '/v1/actions',
    ]) {
      const items = (await b.call(b.browser, 'GET', path)).json.items as { id: string }[];
      expect(
        items.every(
          (item) => item.id !== a.mission.id && item.id !== a.offer.id && item.id !== a.mandateId,
        ),
      ).toBe(true);
    }
    expect(
      (
        await b.call(b.browser, 'POST', `/v1/missions/${a.mission.id}/carts`, {
          lines: [{ offerId: a.offer.id, quantity: 1 }],
        })
      ).status,
    ).toBe(404);
  });
});

describe('the webhook door', () => {
  it('answers 200 to forged and malformed deliveries, and does nothing with them', async () => {
    const anon = t.client();
    const forged = await anon.call('POST', '/webhooks/paypal', {
      json: {
        id: 'WH-EVT-FORGED',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { custom_id: 'bursar:v1:x' },
      },
    });
    expect(forged).toMatchObject({ status: 200, json: { status: 'rejected' } });
    const garbage = await t.app.request('/webhooks/paypal', { method: 'POST', body: 'not json' });
    expect(((await garbage.json()) as { status: string }).status).toBe('rejected');
  });
});
