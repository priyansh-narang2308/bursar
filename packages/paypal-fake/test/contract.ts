import { Money } from '@bursar/money';
import { type PayPalClient, PayPalError } from '@bursar/paypal';
import { describe, expect, it } from 'vitest';

export interface Harness {
  readonly client: PayPalClient;
  /** Stands in for the payer approving a setup token on PayPal's page. */
  approveSetupToken(id: string): void;
  /** Lets pending payouts finish. */
  settlePayouts(): Promise<void>;
}

const usd = (cents: number) => Money.of(BigInt(cents), 'USD');
const attempt = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (e: unknown) => e,
  );

/**
 * What Bursar relies on PayPal doing. It passes against the fake on every run; the same behaviours
 * are what the live sandbox is expected to do, which `PAYPAL_LIVE_TESTS=1` is for.
 */
export function contract(name: string, make: () => Promise<Harness> | Harness): void {
  describe(`PayPal contract: ${name}`, () => {
    const vaulted = async (h: Harness) => {
      const setup = await h.client.vault.createSetupToken({
        requestId: 'setup-1',
        returnUrl: 'https://app.test/r',
        cancelUrl: 'https://app.test/c',
      });
      h.approveSetupToken(setup.id);
      return h.client.vault.createPaymentToken({ requestId: 'pay-1', setupTokenId: setup.id });
    };
    const hold = async (h: Harness, cents: number, requestId = 'order-1') => {
      const token = await vaulted(h);
      const order = await h.client.orders.createAuthorizeOrder({
        requestId,
        vaultId: token.id,
        amount: usd(cents),
        customId: 'bursar:v1:act:abc',
        referenceId: 'act_1',
      });
      if (order.authorizationId === undefined) throw new Error('no authorization');
      return { token, authorizationId: order.authorizationId };
    };

    it('holds funds from a vaulted token and reads the authorization back', async () => {
      const h = await make();
      const { authorizationId } = await hold(h, 10_000);
      expect(await h.client.payments.getAuthorization(authorizationId)).toMatchObject({
        status: 'CREATED',
        amount: usd(10_000),
      });
    });

    it('answers a repeated request with the original result, so a retry cannot double-hold', async () => {
      const h = await make();
      const token = await vaulted(h);
      const place = () =>
        h.client.orders.createAuthorizeOrder({
          requestId: 'same-id',
          vaultId: token.id,
          amount: usd(500),
          customId: 'c',
          referenceId: 'r',
        });
      expect((await place()).authorizationId).toBe((await place()).authorizationId);
    });

    it('captures in parts, never more than was authorized', async () => {
      const h = await make();
      const { authorizationId } = await hold(h, 10_000);
      const take = (cents: number, finalCapture: boolean, requestId: string) =>
        h.client.payments.capture({ requestId, authorizationId, amount: usd(cents), finalCapture });
      await take(6_000, false, 'cap-1');
      expect((await h.client.payments.getAuthorization(authorizationId)).status).toBe(
        'PARTIALLY_CAPTURED',
      );
      expect(await attempt(take(4_001, false, 'cap-2'))).toMatchObject({ kind: 'rejected' });
      await take(4_000, true, 'cap-3');
      expect((await h.client.payments.getAuthorization(authorizationId)).status).toBe('CAPTURED');
      expect(await attempt(take(1, false, 'cap-4'))).toMatchObject({
        issue: 'AUTHORIZATION_ALREADY_CAPTURED',
      });
    });

    it('voids what is left, once', async () => {
      const h = await make();
      const { authorizationId } = await hold(h, 10_000);
      await h.client.payments.capture({
        requestId: 'c',
        authorizationId,
        amount: usd(2_000),
        finalCapture: false,
      });
      await h.client.payments.void({ requestId: 'v-1', authorizationId });
      expect((await h.client.payments.getAuthorization(authorizationId)).status).toBe('VOIDED');
      expect(
        await attempt(h.client.payments.void({ requestId: 'v-2', authorizationId })),
      ).toMatchObject({ issue: 'AUTHORIZATION_VOIDED' });
    });

    it('refunds a capture, never more than was captured', async () => {
      const h = await make();
      const { authorizationId } = await hold(h, 10_000);
      const { id } = await h.client.payments.capture({
        requestId: 'c',
        authorizationId,
        amount: usd(5_000),
        finalCapture: true,
      });
      await h.client.payments.refund({ requestId: 'r-1', captureId: id, amount: usd(3_000) });
      expect(
        await attempt(
          h.client.payments.refund({ requestId: 'r-2', captureId: id, amount: usd(2_001) }),
        ),
      ).toBeInstanceOf(PayPalError);
      await h.client.payments.refund({ requestId: 'r-3', captureId: id, amount: usd(2_000) });
    });

    it('pays out only what the balance covers, and a batch id can be used once', async () => {
      const h = await make();
      const { authorizationId } = await hold(h, 10_000);
      await h.client.payments.capture({
        requestId: 'c',
        authorizationId,
        amount: usd(10_000),
        finalCapture: true,
      });
      const pay = (batchId: string, cents: number, requestId: string) =>
        h.client.payouts.create({
          requestId,
          batchId,
          items: [{ itemId: `i_${batchId}`, receiver: 'supplier@example.com', amount: usd(cents) }],
        });
      expect(await attempt(pay('b1', 20_000, 'p-1'))).toMatchObject({
        issue: 'INSUFFICIENT_FUNDS',
      });
      const batch = await pay('b2', 5_000, 'p-2');
      expect(await attempt(pay('b2', 100, 'p-3'))).toBeInstanceOf(PayPalError);
      await h.settlePayouts();
      expect((await h.client.payouts.get(batch.batchId)).status).toBe('SUCCESS');
    });

    it('stops charging a token once it is deleted: revoking a mandate is real', async () => {
      const h = await make();
      const token = await vaulted(h);
      await h.client.vault.deletePaymentToken(token.id);
      const charge = h.client.orders.createAuthorizeOrder({
        requestId: 'late',
        vaultId: token.id,
        amount: usd(100),
        customId: 'c',
        referenceId: 'r',
      });
      expect(await attempt(charge)).toMatchObject({ kind: 'rejected' });
    });

    it('will not save a payment method the payer has not approved', async () => {
      const h = await make();
      const setup = await h.client.vault.createSetupToken({
        requestId: 's',
        returnUrl: 'https://app.test/r',
        cancelUrl: 'https://app.test/c',
      });
      expect(
        await attempt(
          h.client.vault.createPaymentToken({ requestId: 'p', setupTokenId: setup.id }),
        ),
      ).toMatchObject({ issue: 'PAYER_ACTION_REQUIRED' });
    });
  });
}
