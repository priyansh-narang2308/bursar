import { auditEvents, deliveries, envelopes, incidents, mandates } from '@bursar/db';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { money } from '../src/util';
import { type World, world } from './support';

let w: World;
afterEach(() => w.close());

const authorize = (cartId: string) =>
  w.core.actions.propose(w.orgId, w.agent, {
    type: 'AUTHORIZE',
    missionId: w.missionId,
    cartId: cartId as never,
  });
const followUp = (type: 'CAPTURE' | 'VOID', cartId: string) =>
  w.core.actions.propose(w.orgId, w.agent, {
    type,
    missionId: w.missionId,
    cartId: cartId as never,
  });

async function captured() {
  const cart = await w.cart();
  const hold = await authorize(cart.cartId);
  await w.core.actions.execute(w.orgId, hold.actionId);
  const capture = await followUp('CAPTURE', cart.cartId);
  await w.core.actions.execute(w.orgId, capture.actionId);
  await w.deliver();
  return { cart, hold, capture };
}

describe('the kill switch', () => {
  it('freezes, refunds and revokes a rogue capture made outside the gateway, end to end', async () => {
    w = await world();
    const cart = await w.cart();
    await w.core.actions.execute(w.orgId, (await authorize(cart.cartId)).actionId);

    // Someone with PayPal access captures the hold directly, for money no approved action explains.
    await w.paypal.payments.capture({
      requestId: 'rogue',
      authorizationId: 'AUTH-0001',
      amount: money(3_000n, 'USD'),
      finalCapture: true,
    });
    expect(await w.deliver()).toEqual(['unmatched']);

    const [incident] = await w.db.select().from(incidents);
    expect(incident).toMatchObject({ type: 'UNEXPLAINED_MOVEMENT', status: 'CONTAINED' });
    const steps = ((incident?.autoResponse ?? []) as { step: string }[]).map((s) => s.step);
    expect(steps).toEqual([
      'FREEZE_MANDATE',
      'VOID_AUTHORIZATIONS',
      'REFUND_CAPTURE',
      'REVOKE_VAULT_TOKEN',
      'NOTIFY_OWNER',
    ]);

    const [mandate] = await w.db.select().from(mandates);
    expect(mandate).toMatchObject({ status: 'REVOKED', vaultTokenSealed: null });
    expect(w.fake.transactions.map((t) => t.code)).toEqual(['T0006', 'T1107']); // captured, then refunded
    expect(w.fake.transactions[1]?.amount.minor).toBe(3_000n);
    // The Verifier's own refund arrives as a webhook too. It is not a second incident.
    expect(await w.deliver()).toEqual(['processed']);
    expect(await w.db.select().from(incidents)).toHaveLength(1);
  });

  it('keeps a frozen mandate frozen until an owner resolves the incident', async () => {
    w = await world();
    const cart = await w.cart();
    const hold = await authorize(cart.cartId);
    w.wire.dropAnswerTo = /\/v2\/checkout\/orders$/;
    await w.core.actions.execute(w.orgId, hold.actionId); // an unknown outcome opens an incident
    await w.core.mandates.change(w.orgId, w.owner, w.mandateId as never, 'FROZEN', 'look into it');
    await expect(
      w.core.mandates.change(w.orgId, w.owner, w.mandateId as never, 'ACTIVE', 'ok now'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const [incident] = await w.db.select().from(incidents);
    await w.core.incidents.resolve(
      w.orgId,
      w.owner,
      incident?.id ?? '',
      'PayPal replayed the hold; nothing was lost.',
    );
    await w.core.mandates.change(w.orgId, w.owner, w.mandateId as never, 'ACTIVE', 'ok now');
    expect((await w.db.select().from(mandates))[0]?.status).toBe('ACTIVE');
    await expect(
      w.core.incidents.resolve(w.orgId, w.owner, incident?.id ?? '', 'again'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('reconciliation', () => {
  it('finds money PayPal moved that Bursar has no record of, and opens an incident', async () => {
    w = await world();
    const cart = await w.cart();
    await w.core.actions.execute(w.orgId, (await authorize(cart.cartId)).actionId);
    await w.paypal.payments.capture({
      requestId: 'rogue',
      authorizationId: 'AUTH-0001',
      amount: money(3_000n, 'USD'),
      finalCapture: true,
    });
    w.fake.events.splice(0); // the webhook is lost, so only the sweep can notice
    w.advance(4 * 3_600_000);
    const report = await w.core.incidents.reconcile();
    expect(report.gaps).toMatchObject([{ kind: 'unknown-to-bursar' }]);
    expect((await w.db.select().from(incidents))[0]).toMatchObject({
      type: 'RECONCILIATION_GAP',
      severity: 'HIGH',
    });
  });

  it('finds money Bursar recorded that PayPal does not report, and passes a clean book', async () => {
    w = await world();
    const { capture } = await captured();
    w.advance(4 * 3_600_000);
    expect((await w.core.incidents.reconcile()).gaps).toEqual([]);
    w.fake.transactions.splice(0);
    const report = await w.core.incidents.reconcile();
    expect(report.gaps).toMatchObject([{ kind: 'unknown-to-paypal' }]);
    expect(report.gaps[0]?.detail).toContain(capture.actionId);
  });
});

describe('paying suppliers', () => {
  const pay = (cartId: string, ordinal: number, supplierId = w.supplier?.id) =>
    w.core.actions.propose(w.orgId, w.owner, {
      type: 'PAYOUT',
      missionId: w.missionId,
      cartId: cartId as never,
      supplierId: supplierId as never,
      ordinal,
    });

  it('blocks a payout until goods are inspected and the cooling-off has passed, then pays the registered address', async () => {
    w = await world();
    const { cart } = await captured();
    w.fake.fund(money(10_000n, 'USD')); // the platform's float: PayPal's fee came out of the capture

    expect((await pay(cart.cartId, 1)).explanation).toContain('no delivery record');
    await w.core.deliveries.record(w.orgId, w.owner, {
      cartId: cart.cartId as never,
      supplierId: w.supplier?.id as never,
      status: 'INSPECTED',
    });
    expect((await pay(cart.cartId, 2)).explanation).toContain('cooling-off window is still open');
    w.advance(25 * 3_600_000);
    const allowed = await pay(cart.cartId, 3);
    expect(allowed).toMatchObject({ state: 'APPROVED', outcome: 'ALLOW' });

    expect(await w.core.actions.execute(w.orgId, allowed.actionId)).toMatchObject({
      outcome: 'submitted',
    });
    expect(w.fake.payouts()[0]?.items).toEqual([
      { receiver: 'paper@example.com', amount: money(3_000n, 'USD') },
    ]); // from the registry
    await w.fake.settlePayouts();
    expect(await w.deliver()).toContain('processed');
    expect((await w.db.select().from(envelopes))[0]?.settledMinor).toBe(3_000n);
    expect((await w.db.select().from(deliveries))[0]?.status).toBe('INSPECTED');
  });

  it('pays only suppliers that are on the cart, and only a person inspects', async () => {
    w = await world();
    const { cart } = await captured();
    const other = await w.core.catalog.createSupplier(w.orgId, w.owner, {
      name: 'Other',
      payoutEmail: 'other@example.com',
    });
    await expect(pay(cart.cartId, 1, other?.id)).rejects.toMatchObject({
      code: 'UNKNOWN_REFERENCE',
    });
    await expect(
      w.core.deliveries.record(w.orgId, w.agent, {
        cartId: cart.cartId as never,
        supplierId: w.supplier?.id as never,
        status: 'INSPECTED',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      w.core.actions.propose(w.orgId, w.owner, {
        type: 'PAYOUT',
        missionId: w.missionId,
        cartId: cart.cartId as never,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('receipts and replay', () => {
  it('shows every stage of an action, replays its ruling, and detects a tampered audit log', async () => {
    w = await world();
    const { capture } = await captured();
    const receipt = await w.core.receipts.get(w.orgId, capture.actionId);
    expect(receipt).toMatchObject({
      action: { type: 'CAPTURE', state: 'CONFIRMED' },
      cart: { totalMinor: '3000' },
    });
    expect(receipt.decisions.length).toBeGreaterThanOrEqual(2); // proposed, then re-checked at execution
    expect(receipt.executions[0]).toMatchObject({ step: 'capture', status: 'SUCCEEDED' });
    expect(receipt.paypalEvents).toMatchObject([
      { eventType: 'PAYMENT.CAPTURE.COMPLETED', matchStatus: 'MATCHED' },
    ]);
    expect(receipt.ledger).toHaveLength(4);
    expect(receipt.audit.map((a) => a.type)).toContain('action.confirmed');

    for (const decision of receipt.decisions)
      expect(await w.core.receipts.replay(w.orgId, decision.id)).toMatchObject({
        reproduced: true,
      });

    expect(await w.core.receipts.verifyAudit(w.orgId)).toMatchObject({ ok: true });
    await w.db.execute(sql`alter table audit_events disable trigger audit_events_append_only`);
    await w.db.update(auditEvents).set({ type: 'tampered.event' }).where(eq(auditEvents.seq, 2));
    expect(await w.core.receipts.verifyAudit(w.orgId)).toMatchObject({
      ok: false,
      reason: 'hash-mismatch',
      seq: 2,
    });
  });
});
