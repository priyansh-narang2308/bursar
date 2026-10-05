import { Money } from '@bursar/money';
import { createPayPalClient, PayPalError } from '@bursar/paypal';
import { describe, expect, it } from 'vitest';
import { createFakePayPal, type FakeOptions } from '../src';
import { contract } from './contract';

const BASE = 'https://fake.paypal.test';
const usd = (cents: number) => Money.of(BigInt(cents), 'USD');

function setup(options: FakeOptions = {}, headers: Record<string, string> = {}) {
  const fake = createFakePayPal(options);
  const wrapped: typeof fetch = (input, init) =>
    fake.fetch(input, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers)), ...headers },
    });
  const client = createPayPalClient({
    clientId: fake.config.clientId,
    clientSecret: fake.config.clientSecret,
    baseUrl: BASE,
    fetch: wrapped,
    sleep: async () => undefined,
    maxRetries: 1,
  });
  return { fake, client };
}

const harness = () => {
  const { fake, client } = setup();
  return {
    client,
    approveSetupToken: (id: string) => fake.approveSetupToken(id),
    settlePayouts: () => fake.settlePayouts(),
  };
};

contract('the fake', harness);

describe('the fake’s own rules', () => {
  const held = async (options: FakeOptions = {}, headers: Record<string, string> = {}) => {
    const { fake, client } = setup(options, headers);
    const st = await client.vault.createSetupToken({
      requestId: 's',
      returnUrl: 'https://a.test/r',
      cancelUrl: 'https://a.test/c',
    });
    fake.approveSetupToken(st.id);
    const vt = await client.vault.createPaymentToken({ requestId: 'p', setupTokenId: st.id });
    const order = await client.orders.createAuthorizeOrder({
      requestId: 'o',
      vaultId: vt.id,
      amount: usd(10_000),
      customId: 'bursar:v1:x',
      referenceId: 'r',
    });
    return { fake, client, authorizationId: order.authorizationId as string };
  };

  it('refuses a client with the wrong credentials, and a call without a token', async () => {
    const fake = createFakePayPal();
    const bad = createPayPalClient({
      clientId: 'x',
      clientSecret: 'y',
      baseUrl: BASE,
      fetch: fake.fetch,
    });
    await expect(bad.payments.getAuthorization('AUTH-0001')).rejects.toMatchObject({
      kind: 'auth',
    });
    const raw = await fake.fetch(`${BASE}/v2/payments/authorizations/AUTH-0001`);
    expect(raw.status).toBe(401);
  });

  it('allows a reauthorize only after the honor period, and only once', async () => {
    let clock = new Date('2026-10-05T00:00:00Z');
    const { client, authorizationId } = await held({ now: () => clock });
    const again = (requestId: string) =>
      client.payments.reauthorize({ requestId, authorizationId, amount: usd(10_000) });
    await expect(again('ra-1')).rejects.toMatchObject({ issue: 'REAUTHORIZATION_TOO_SOON' });
    clock = new Date('2026-10-08T00:00:01Z');
    await again('ra-2');
    await expect(again('ra-3')).rejects.toMatchObject({ issue: 'REAUTHORIZATION_NOT_ALLOWED' });
  });

  it('lets an authorization expire', async () => {
    let clock = new Date('2026-10-05T00:00:00Z');
    const { client, authorizationId } = await held({ now: () => clock });
    clock = new Date('2026-11-05T00:00:00Z');
    expect((await client.payments.getAuthorization(authorizationId)).status).toBe('EXPIRED');
    await expect(
      client.payments.capture({
        requestId: 'c',
        authorizationId,
        amount: usd(1),
        finalCapture: true,
      }),
    ).rejects.toMatchObject({ issue: 'AUTHORIZATION_EXPIRED' });
  });

  it('simulates failures on request with PayPal-Mock-Response', async () => {
    const declined = await held({}, {}).then(() => undefined);
    expect(declined).toBeUndefined();
    const { client } = setup(
      {},
      { 'paypal-mock-response': '{"mock_application_codes":"INSTRUMENT_DECLINED"}' },
    );
    const error = await client.orders
      .createAuthorizeOrder({
        requestId: 'o',
        vaultId: 'VT-0001',
        amount: usd(1),
        customId: 'c',
        referenceId: 'r',
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ kind: 'declined', issue: 'INSTRUMENT_DECLINED' });
    const outage = setup(
      {},
      { 'paypal-mock-response': '{"mock_application_codes":"INTERNAL_SERVER_ERROR"}' },
    );
    await expect(outage.client.payments.getAuthorization('AUTH-0001')).rejects.toMatchObject({
      kind: 'retryable',
      status: 500,
    });
  });

  it('gives every error a debug_id, as PayPal does', async () => {
    const { client } = setup();
    const error = await client.payments.getAuthorization('nope').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 404, debugId: expect.stringMatching(/^fake-debug-/) });
  });

  it('delivers signed webhooks that its verify endpoint accepts, and refuses a tampered one', async () => {
    const delivered: string[] = [];
    const { fake, client, authorizationId } = await held({
      deliver: (_url, _headers, body) => void delivered.push(body),
    });
    await client.webhooks.register({
      requestId: 'w',
      url: 'https://app.test/hooks',
      eventTypes: ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.AUTHORIZATION.VOIDED'],
    });
    await client.payments.capture({
      requestId: 'c',
      authorizationId,
      amount: usd(2_500),
      finalCapture: false,
    });
    await client.payments.void({ requestId: 'v', authorizationId });
    expect(fake.events.map((e) => e.event.event_type)).toEqual([
      'PAYMENT.CAPTURE.COMPLETED',
      'PAYMENT.AUTHORIZATION.VOIDED',
    ]);
    expect(delivered).toHaveLength(2);
    const [first] = fake.events;
    expect(first?.event.resource).toMatchObject({ custom_id: 'bursar:v1:x', status: 'COMPLETED' });
    const check = (event: unknown) =>
      client.webhooks.verify({ webhookId: 'WH-0001', headers: first?.headers ?? {}, event });
    expect(await check(first?.event)).toBe(true);
    expect(await check({ ...first?.event, resource: { amount: 'tampered' } })).toBe(false);
  });

  it('settles payouts into the balance and fires a webhook', async () => {
    const { fake, client, authorizationId } = await held();
    await client.webhooks.register({
      requestId: 'w',
      url: 'https://app.test/hooks',
      eventTypes: ['PAYMENT.PAYOUTSBATCH.SUCCESS'],
    });
    await client.payments.capture({
      requestId: 'c',
      authorizationId,
      amount: usd(10_000),
      finalCapture: true,
    });
    const before = fake.balance()?.minor as bigint;
    await client.payouts.create({
      requestId: 'p',
      batchId: 'b',
      items: [{ itemId: 'i', receiver: 's@example.com', amount: usd(3_000) }],
    });
    await fake.settlePayouts();
    expect(before - (fake.balance()?.minor as bigint)).toBe(3_000n);
    expect(fake.events.at(-1)?.event.event_type).toBe('PAYMENT.PAYOUTSBATCH.SUCCESS');
  });

  it('takes PayPal’s fee out of a capture', async () => {
    const { fake, client, authorizationId } = await held();
    await client.payments.capture({
      requestId: 'c',
      authorizationId,
      amount: usd(10_000),
      finalCapture: true,
    });
    expect(fake.balance()?.minor).toBe(10_000n - 320n); // 2.9% of $100.00 plus 30 cents
  });
});
