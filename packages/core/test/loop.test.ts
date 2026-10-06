import { verifyChain } from '@bursar/audit';
import {
  actions,
  approvals,
  auditEvents,
  envelopes,
  executions,
  incidents,
  ledgerEntries,
  mandates,
  paypalEvents,
} from '@bursar/db';
import { type Account, isBalanced } from '@bursar/ledger';
import { desc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreError } from '../src';
import { money } from '../src/util';
import { usd, type World, world } from './support';

let w: World;
afterEach(() => w.close());

const authorize = async (cartId: string, who = w.agent) =>
  w.core.actions.propose(w.orgId, who, {
    type: 'AUTHORIZE',
    missionId: w.missionId,
    cartId: cartId as never,
  });
const followUp = (type: 'CAPTURE' | 'VOID' | 'REFUND', cartId: string, who = w.agent) =>
  w.core.actions.propose(w.orgId, who, {
    type: type,
    missionId: w.missionId,
    cartId: cartId as never,
  });
const envelope = async () => (await w.db.select().from(envelopes))[0];
const stateOf = async (id: string) =>
  (
    await w.db
      .select()
      .from(actions)
      .where(eq(actions.id, id as never))
  )[0]?.state;

/** An order that is authorized and confirmed, ready for the next step. */
async function held() {
  const cart = await w.cart();
  const proposal = await authorize(cart.cartId);
  const result = await w.core.actions.execute(w.orgId, proposal.actionId);
  return { cart, proposal, result };
}

describe('mandates', () => {
  it('walks PENDING to ACTIVE with the Vault token sealed, and revoking really deletes it at PayPal', async () => {
    w = await world();
    const [active] = await w.db
      .select()
      .from(mandates)
      .where(eq(mandates.id, w.mandateId as never));
    expect(active).toMatchObject({ status: 'ACTIVE', setupTokenId: null });
    expect(active?.vaultTokenSealed).toMatch(/^bursar:secret:v1:1:/);
    expect(active?.vaultTokenSealed).not.toContain('VT-0001');

    await w.core.mandates.change(w.orgId, w.owner, w.mandateId as never, 'REVOKED', 'testing');
    const [revoked] = await w.db
      .select()
      .from(mandates)
      .where(eq(mandates.id, w.mandateId as never));
    expect(revoked).toMatchObject({ status: 'REVOKED', vaultTokenSealed: null });
    // The token is gone at PayPal too: deleting it again finds nothing.
    await expect(w.paypal.vault.deletePaymentToken('VT-0001')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses moves that are not allowed, and freezes and unfreezes', async () => {
    w = await world();
    await w.core.mandates.change(w.orgId, w.owner, w.mandateId as never, 'FROZEN', 'pause');
    await w.core.mandates.change(w.orgId, w.owner, w.mandateId as never, 'ACTIVE', 'resume');
    await w.core.mandates.change(w.orgId, w.owner, w.mandateId as never, 'REVOKED', 'done');
    await expect(
      w.core.mandates.change(w.orgId, w.owner, w.mandateId as never, 'ACTIVE', 'again'),
    ).rejects.toMatchObject({ code: 'ILLEGAL_STATE_TRANSITION' });
  });

  it('expires a mandate when its window has passed', async () => {
    w = await world();
    expect(await w.core.mandates.expire(w.orgId)).toBe(0);
    w.advance(90 * 86_400_000);
    expect(await w.core.mandates.expire(w.orgId)).toBe(1);
  });
});

describe('carts are computed by the server', () => {
  it('prices every line from the offer snapshot, totals them, and hashes the result', async () => {
    w = await world();
    const cart = await w.cart();
    expect(cart.total).toEqual(usd(3_000)); // 2 x $10.00 + 2 x $5.00
    expect(cart.cartHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await w.cart()).version).toBe(2);
  });

  it('refuses unknown or unavailable offers, and an empty cart', async () => {
    w = await world();
    await expect(w.cart([])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      w.cart([{ offerId: 'ofr_01ARZ3NDEKTSV4RRFFQ69G5FAV', quantity: 1 }]),
    ).rejects.toMatchObject({ code: 'UNKNOWN_REFERENCE' });
    const gone = await w.core.catalog.recordOffer(w.orgId, {
      supplierId: w.supplier?.id as never,
      title: 'Gone',
      category: 'office',
      url: 'https://x.example',
      price: usd(100),
      availability: 'OUT_OF_STOCK',
    });
    await expect(w.cart([{ offerId: gone?.id ?? '', quantity: 1 }])).rejects.toMatchObject({
      code: 'OFFER_UNAVAILABLE',
    });
  });
});

describe('the happy path: hold, capture, confirm', () => {
  it('moves money once, confirms it from a signed webhook, and keeps the books balanced', async () => {
    w = await world();
    const { cart, proposal, result } = await held();
    expect(proposal).toMatchObject({ state: 'APPROVED', outcome: 'ALLOW' });
    expect(result).toMatchObject({ outcome: 'confirmed', state: 'CONFIRMED' });
    expect(await envelope()).toMatchObject({
      heldMinor: 3_000n,
      capturedMinor: 0n,
      status: 'ACTIVE',
      paypalAuthorizationId: 'AUTH-0001',
    });

    const capture = await followUp('CAPTURE', cart.cartId);
    expect(await w.core.actions.execute(w.orgId, capture.actionId)).toMatchObject({
      outcome: 'submitted',
    });
    expect(await stateOf(capture.actionId)).toBe('SUBMITTED'); // not confirmed until PayPal says so
    expect(await w.deliver()).toEqual(['processed']);
    expect(await stateOf(capture.actionId)).toBe('CONFIRMED');
    expect(await envelope()).toMatchObject({ heldMinor: 0n, capturedMinor: 3_000n });

    const entries = (await w.db.select().from(ledgerEntries)).map((e) => ({
      account: e.account as Account,
      side: e.side as 'DEBIT' | 'CREDIT',
      amount: money(e.amountMinor, e.currency),
    }));
    expect(isBalanced(entries, 'USD')).toBe(true);
  });

  it('ignores a repeated webhook', async () => {
    w = await world();
    const { cart } = await held();
    const capture = await followUp('CAPTURE', cart.cartId);
    await w.core.actions.execute(w.orgId, capture.actionId);
    const { headers, event } = w.takeEvent();
    const first = await w.core.webhooks.ingest(JSON.stringify(event), headers);
    expect(first).toBe('processed');
    expect(await w.core.webhooks.ingest(JSON.stringify(event), headers)).toBe('duplicate');
    expect((await w.db.select().from(ledgerEntries)).length).toBe(6); // the hold's 2 + the capture's 4, once
  });

  it('voids a hold and releases it', async () => {
    w = await world();
    const { cart } = await held();
    const voided = await followUp('VOID', cart.cartId);
    expect(await w.core.actions.execute(w.orgId, voided.actionId)).toMatchObject({
      outcome: 'confirmed',
    });
    expect(await envelope()).toMatchObject({ heldMinor: 0n, status: 'VOIDED' });
  });

  it('refunds a capture, and only a person can name the amount', async () => {
    w = await world();
    const { cart } = await held();
    const capture = await followUp('CAPTURE', cart.cartId);
    await w.core.actions.execute(w.orgId, capture.actionId);
    await w.deliver();
    const refund = await w.core.actions.propose(w.orgId, w.owner, {
      type: 'REFUND',
      missionId: w.missionId,
      cartId: cart.cartId as never,
      refundAmount: usd(500),
    });
    await w.core.actions.execute(w.orgId, refund.actionId);
    expect(await w.deliver()).toEqual(['processed']);
    expect(await envelope()).toMatchObject({ refundedMinor: 500n });
    const [row] = await w.db
      .select()
      .from(actions)
      .where(eq(actions.id, refund.actionId as never));
    expect(row?.amountMinor).toBe(500n);
    const byAgent = await w.core.actions.propose(w.orgId, w.agent, {
      type: 'REFUND',
      missionId: w.missionId,
      cartId: cart.cartId as never,
      refundAmount: usd(1),
      ordinal: 2,
    });
    expect(
      (
        await w.db
          .select()
          .from(actions)
          .where(eq(actions.id, byAgent.actionId as never))
      )[0]?.amountMinor,
    ).toBe(3_000n); // an agent's amount is ignored
  });
});

describe('the decision pipeline', () => {
  it('denies what the envelope cannot hold, and records why', async () => {
    w = await world({ budget: 2_000 });
    const proposal = await authorize((await w.cart()).cartId); // $30 against a $20 envelope
    expect(proposal).toMatchObject({ state: 'DENIED', outcome: 'DENY' });
    expect(proposal.explanation).toContain('over its ceiling');
  });

  it('answers the same proposal made many times at once with one action and one reservation', async () => {
    w = await world();
    const cart = await w.cart();
    const proposals = await Promise.all(Array.from({ length: 8 }, () => authorize(cart.cartId)));
    expect(new Set(proposals.map((p) => p.actionId)).size).toBe(1);
    expect(proposals.filter((p) => !p.existing)).toHaveLength(1);
    expect((await envelope())?.heldMinor).toBe(3_000n);
  });

  it('asks a person for a first-time supplier, and wants someone other than the proposer', async () => {
    w = await world({ lenient: false });
    const cart = await w.cart();
    const proposal = await authorize(cart.cartId);
    expect(proposal).toMatchObject({ state: 'AWAITING_APPROVAL', outcome: 'REQUIRE_APPROVAL' });
    const [approvalId] = proposal.approvalIds as [string];
    await expect(
      w.core.actions.decide(w.orgId, w.agent, approvalId, 'APPROVE'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const maker = { kind: 'USER' as const, id: await w.person() };
    const proposedByPerson = await w.core.actions.propose(w.orgId, maker, {
      type: 'AUTHORIZE',
      missionId: w.missionId,
      cartId: (await w.cart()).cartId as never,
    });
    await expect(
      w.core.actions.decide(w.orgId, maker, proposedByPerson.approvalIds[0] as string, 'APPROVE'),
    ).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES' });
  });

  it('runs an approved action once a different person approves, and signs the approval', async () => {
    w = await world({ lenient: false });
    const proposal = await authorize((await w.cart()).cartId);
    const checker = { kind: 'USER' as const, id: await w.person() };
    await w.core.actions.decide(w.orgId, checker, proposal.approvalIds[0] as string, 'APPROVE');
    expect(await stateOf(proposal.actionId)).toBe('APPROVED');
    const [approval] = await w.db.select().from(approvals);
    expect(approval?.signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await w.core.actions.execute(w.orgId, proposal.actionId)).toMatchObject({
      outcome: 'confirmed',
    });
  });

  it('adopts a buyer’s earlier approval so a workspace can spend at once, and leaves a shared token alone on revoke', async () => {
    w = await world({ keepVaultTokens: true });
    const setup = await w.paypal.vault.createSetupToken({
      requestId: 'adopt-1',
      returnUrl: 'https://a.test/r',
      cancelUrl: 'https://a.test/c',
    });
    w.fake.approveSetupToken(setup.id);
    const token = await w.paypal.vault.createPaymentToken({
      requestId: 'adopt-2',
      setupTokenId: setup.id,
    });
    const adopted = await w.core.mandates.adopt(w.orgId, w.owner, {
      payerName: 'Pooled buyer',
      cap: usd(1_000_000),
      perMissionCap: usd(500_000),
      validFrom: new Date('2026-10-01T00:00:00Z'),
      validTo: new Date('2026-12-01T00:00:00Z'),
      paymentTokenId: token.id,
    });
    expect(adopted.status).toBe('ACTIVE');
    const mission = await w.core.catalog.createMission(w.orgId, w.owner, {
      goal: 'Pooled',
      budget: usd(10_000),
      mandateId: adopted.mandateId,
    });
    const cart = await w.core.catalog.buildCart(w.orgId, w.owner, mission?.id as never, [
      { offerId: w.offers.pens?.id as never, quantity: 1 },
    ]);
    const proposal = await w.core.actions.propose(w.orgId, w.agent, {
      type: 'AUTHORIZE',
      missionId: mission?.id as never,
      cartId: cart.cartId as never,
    });
    expect(await w.core.actions.execute(w.orgId, proposal.actionId)).toMatchObject({
      outcome: 'confirmed',
    });
    const spy = vi.spyOn(w.paypal.vault, 'deletePaymentToken');
    await w.core.mandates.change(w.orgId, w.owner, adopted.mandateId as never, 'REVOKED', 'done');
    expect(spy).not.toHaveBeenCalled();
    const [row] = await w.db.select().from(mandates).where(eq(mandates.id, adopted.mandateId));
    expect(row).toMatchObject({ status: 'REVOKED', vaultTokenSealed: null });
  });

  it('does not count an approved hold twice against the envelope when it runs', async () => {
    // The cart is 3,000 of a 5,000 envelope: reserved at approval, then asked again at execution.
    w = await world({ lenient: false, budget: 5_000 });
    const proposal = await authorize((await w.cart()).cartId);
    const checker = { kind: 'USER' as const, id: await w.person() };
    await w.core.actions.decide(w.orgId, checker, proposal.approvalIds[0] as string, 'APPROVE');
    expect(await w.core.actions.execute(w.orgId, proposal.actionId)).toMatchObject({
      outcome: 'confirmed',
    });
    expect((await envelope())?.heldMinor).toBe(3_000n);
  });

  it('refuses an approval that was altered after it was given: the policy checks it again at execution', async () => {
    w = await world({ lenient: false });
    const proposal = await authorize((await w.cart()).cartId);
    const checker = { kind: 'USER' as const, id: await w.person() };
    await w.core.actions.decide(w.orgId, checker, proposal.approvalIds[0] as string, 'APPROVE');
    await w.db.update(approvals).set({ cartHash: 'f'.repeat(64) }); // an approval for a different cart
    expect(await w.core.actions.execute(w.orgId, proposal.actionId)).toMatchObject({
      outcome: 'denied',
      state: 'DENIED',
    });
    expect((await envelope())?.heldMinor).toBe(0n); // the reservation was released
  });

  it('expires unanswered requests, and refuses to approve an expired one', async () => {
    w = await world({ lenient: false });
    const proposal = await authorize((await w.cart()).cartId);
    w.advance(25 * 3_600_000);
    const checker = { kind: 'USER' as const, id: await w.person() };
    await expect(
      w.core.actions.decide(w.orgId, checker, proposal.approvalIds[0] as string, 'APPROVE'),
    ).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED' });
    expect(await w.core.actions.expireApprovals(w.orgId)).toBe(1); // nobody answered in time
    expect(await stateOf(proposal.actionId)).toBe('EXPIRED');
    const another = await authorize((await w.cart()).cartId);
    w.advance(25 * 3_600_000);
    expect(await w.core.actions.expireApprovals(w.orgId)).toBe(1);
    expect(await stateOf(another.actionId)).toBe('EXPIRED');
  });

  it('records a rejection', async () => {
    w = await world({ lenient: false });
    const proposal = await authorize((await w.cart()).cartId);
    const checker = { kind: 'USER' as const, id: await w.person() };
    await w.core.actions.decide(w.orgId, checker, proposal.approvalIds[0] as string, 'REJECT');
    expect(await stateOf(proposal.actionId)).toBe('REJECTED');
  });

  it('asks the policy again when the money is about to move: a frozen mandate stops an approved action', async () => {
    w = await world();
    const proposal = await authorize((await w.cart()).cartId);
    await w.core.mandates.change(w.orgId, w.owner, w.mandateId as never, 'FROZEN', 'suspicious');
    expect(await w.core.actions.execute(w.orgId, proposal.actionId)).toMatchObject({
      outcome: 'denied',
    });
  });

  it('keeps an audit chain that verifies', async () => {
    w = await world();
    await held();
    const events = await w.db.select().from(auditEvents).orderBy(auditEvents.seq);
    const entries = events.map((e) => ({
      id: e.id,
      orgId: e.orgId,
      seq: e.seq,
      ts: e.ts,
      actor: { kind: e.actorKind, id: e.actorId },
      type: e.type,
      payload: e.payload,
      prevHash: e.prevHash,
      hash: e.hash,
    }));
    expect(entries.length).toBeGreaterThan(8);
    expect(verifyChain(entries, { orgId: w.orgId })).toMatchObject({ ok: true });
  });
});

describe('the executor', () => {
  it('moves money once however many times it is told to', async () => {
    w = await world();
    const proposal = await authorize((await w.cart()).cartId);
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => w.core.actions.execute(w.orgId, proposal.actionId)),
    );
    expect(results.filter((r) => r.outcome === 'confirmed')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'noop')).toHaveLength(3);
    expect((await w.db.select().from(ledgerEntries)).length).toBe(2);
    expect(await w.core.actions.execute(w.orgId, proposal.actionId)).toMatchObject({
      outcome: 'noop',
      state: 'CONFIRMED',
    });
  });

  it('treats a decline as final: the action fails, the money is released, nothing is retried', async () => {
    w = await world();
    const proposal = await authorize((await w.cart()).cartId);
    w.wire.mock = '{"mock_application_codes":"INSTRUMENT_DECLINED"}';
    const result = await w.core.actions.execute(w.orgId, proposal.actionId);
    expect(result).toMatchObject({
      outcome: 'failed',
      state: 'FAILED',
      error: { kind: 'declined' },
    });
    expect(result.error?.debugId).toMatch(/^fake-debug-/);
    expect((await envelope())?.heldMinor).toBe(0n);
    expect(await w.core.actions.execute(w.orgId, proposal.actionId)).toMatchObject({
      outcome: 'noop',
    });
  });

  it('keeps an unknown outcome unknown, then finishes it with the same request id: PayPal acts once', async () => {
    w = await world();
    const proposal = await authorize((await w.cart()).cartId);
    w.wire.dropAnswerTo = /\/v2\/checkout\/orders$/; // PayPal places the hold; Bursar never hears
    expect(await w.core.actions.execute(w.orgId, proposal.actionId)).toMatchObject({
      outcome: 'unknown',
      state: 'UNKNOWN',
    });
    const [incident] = await w.db.select().from(incidents);
    expect(incident).toMatchObject({ type: 'UNKNOWN_OUTCOME', status: 'OPEN' });

    expect(await w.core.actions.execute(w.orgId, proposal.actionId)).toMatchObject({
      outcome: 'confirmed',
    });
    expect((await envelope())?.paypalAuthorizationId).toBe('AUTH-0001'); // the original hold, replayed
    expect((await w.db.select().from(ledgerEntries)).length).toBe(2);
    expect(await w.db.select().from(executions)).toHaveLength(1);
  });

  it('stops calling PayPal after repeated failures, then tries again after a cooldown', async () => {
    w = await world();
    w.wire.mock = '{"mock_application_codes":"INTERNAL_SERVER_ERROR"}';
    const carts = [await w.cart()];
    const first = await authorize(carts[0]?.cartId ?? '');
    for (let i = 0; i < 3; i++) await w.core.actions.execute(w.orgId, first.actionId);
    expect(w.breaker.open).toBe(true);
    expect(await w.core.actions.execute(w.orgId, first.actionId)).toMatchObject({
      outcome: 'deferred',
    });
    w.wire.mock = undefined;
    w.advance(31_000);
    expect(await w.core.actions.execute(w.orgId, first.actionId)).toMatchObject({
      outcome: 'confirmed',
    });
  });
});

describe('webhooks and the Verifier', () => {
  it('rejects a forged webhook and changes nothing', async () => {
    w = await world();
    const { cart } = await held();
    const capture = await followUp('CAPTURE', cart.cartId);
    await w.core.actions.execute(w.orgId, capture.actionId);
    const { headers, event } = w.takeEvent();
    const forged = {
      ...event,
      resource: { ...event.resource, amount: { currency_code: 'USD', value: '0.01' } },
    };
    expect(await w.core.webhooks.ingest(JSON.stringify(forged), headers)).toBe('rejected');
    expect(await stateOf(capture.actionId)).toBe('SUBMITTED');
    expect(await w.core.webhooks.ingest('not json at all', {})).toBe('rejected');
  });

  it('parks a webhook that arrives before the executor has recorded its call, then settles it', async () => {
    w = await world();
    const { cart } = await held();
    const capture = await followUp('CAPTURE', cart.cartId);
    w.wire.afterCall = async (path) => {
      if (path.endsWith('/capture')) expect(await w.deliver()).toEqual(['parked']);
    };
    expect(await w.core.actions.execute(w.orgId, capture.actionId)).toMatchObject({
      outcome: 'submitted',
    });
    expect(await stateOf(capture.actionId)).toBe('CONFIRMED');
    expect(
      (await w.db.select().from(paypalEvents).where(eq(paypalEvents.matchStatus, 'MATCHED')))
        .length,
    ).toBe(1);
  });

  it('raises an incident when the amount PayPal reports is not the amount approved', async () => {
    w = await world();
    const { cart } = await held();
    const capture = await followUp('CAPTURE', cart.cartId);
    await w.core.actions.execute(w.orgId, capture.actionId);
    await w.db
      .update(actions)
      .set({ amountMinor: 2_999n })
      .where(eq(actions.id, capture.actionId as never));
    expect(await w.deliver()).toEqual(['mismatch']);
    expect(
      (await w.db.select().from(incidents).where(eq(incidents.type, 'AMOUNT_MISMATCH'))).length,
    ).toBe(1);
    expect(await stateOf(capture.actionId)).toBe('SUBMITTED');
  });

  it('raises an incident for a capture made outside the gateway, even with a genuine tag', async () => {
    w = await world();
    await held();
    // Someone with PayPal access captures the hold directly. Bursar proposed no capture.
    await w.paypal.payments.capture({
      requestId: 'rogue',
      authorizationId: 'AUTH-0001',
      amount: money(3_000n, 'USD'),
      finalCapture: true,
    });
    expect(await w.deliver()).toEqual(['unmatched']);
    const [incident] = await w.db
      .select()
      .from(incidents)
      .where(eq(incidents.type, 'UNEXPLAINED_MOVEMENT'));
    expect(incident).toMatchObject({ severity: 'HIGH', status: 'CONTAINED' }); // the Verifier has already acted (see verifier.test.ts)
  });

  it('records a capture it cannot attribute to anyone, without inventing an owner', async () => {
    w = await world();
    const token = await (async () => {
      const setup = await w.paypal.vault.createSetupToken({
        requestId: 'x',
        returnUrl: 'https://a.test/r',
        cancelUrl: 'https://a.test/c',
      });
      w.fake.approveSetupToken(setup.id);
      return w.paypal.vault.createPaymentToken({ requestId: 'y', setupTokenId: setup.id });
    })();
    const order = await w.paypal.orders.createAuthorizeOrder({
      requestId: 'o',
      vaultId: token.id,
      amount: money(100n, 'USD'),
      customId: 'bursar:v1:act_01ARZ3NDEKTSV4RRFFQ69G5FAV:00000000000000000000000000000000',
      referenceId: 'r',
    });
    await w.paypal.payments.capture({
      requestId: 'c',
      authorizationId: order.authorizationId ?? '',
      amount: money(100n, 'USD'),
      finalCapture: true,
    });
    expect(await w.deliver()).toEqual(['unmatched']);
    const [row] = await w.db.select().from(paypalEvents).orderBy(desc(paypalEvents.receivedAt));
    expect(row).toMatchObject({ matchStatus: 'UNMATCHED', orgId: null });
  });

  it('confirms a capture from PayPal itself when the webhook never comes', async () => {
    w = await world();
    const { cart } = await held();
    const capture = await followUp('CAPTURE', cart.cartId);
    await w.core.actions.execute(w.orgId, capture.actionId);
    w.fake.events.splice(0); // the webhook is lost
    expect(await w.core.webhooks.pollSubmitted(w.orgId, 60_000)).toBe(0); // too soon to worry
    w.advance(120_000);
    expect(await w.core.webhooks.pollSubmitted(w.orgId, 60_000)).toBe(1);
    expect(await stateOf(capture.actionId)).toBe('CONFIRMED');
    expect(await w.core.webhooks.pollSubmitted(w.orgId, 60_000)).toBe(0);
  });

  it('is told an unsigned-for event type is not one it acts on', async () => {
    w = await world();
    const delivered = await w.core.webhooks.ingest(
      JSON.stringify({ id: 'WH-EVT-X', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: {} }),
      {},
    );
    expect(delivered).toBe('rejected'); // the fake's verify endpoint does not know this signature
  });
});

describe('errors speak the catalog', () => {
  it('uses catalog codes', async () => {
    w = await world();
    await expect(
      w.core.mandates.complete(w.orgId, w.owner, w.mandateId as never),
    ).rejects.toBeInstanceOf(CoreError);
    await expect(
      w.core.actions.decide(w.orgId, w.owner, 'apv_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'APPROVE'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
