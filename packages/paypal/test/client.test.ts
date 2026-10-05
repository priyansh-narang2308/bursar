import { Money } from '@bursar/money';
import { describe, expect, it } from 'vitest';
import { assertSandbox, createPayPalClient, PayPalError } from '../src';

const BASE = 'https://stub.paypal.test';
const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const TOKEN = reply(200, { access_token: 'tok', expires_in: 3600 });
const usd = (cents: number) => Money.of(BigInt(cents), 'USD');

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: unknown;
}

/** A client whose PayPal is a script: each call gets the next scripted answer (the token is answered by itself). */
function scripted(script: Array<Response | Error>, over: { now?: () => number } = {}) {
  const seen: Seen[] = [];
  const sleeps: number[] = [];
  const remaining = [...script];
  const client = createPayPalClient({
    clientId: 'id',
    clientSecret: 'secret',
    baseUrl: BASE,
    sleep: async (ms) => void sleeps.push(ms),
    ...over,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const body =
        typeof init?.body === 'string' && headers.get('content-type') === 'application/json'
          ? JSON.parse(init.body)
          : init?.body;
      seen.push({ method: init?.method ?? 'GET', path: url.pathname, headers, body });
      if (url.pathname === '/v1/oauth2/token')
        return remaining[0] === TOKEN ? (remaining.shift() as Response) : TOKEN.clone();
      const next = remaining.shift();
      if (next === undefined) throw new Error('unscripted request');
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { client, seen, sleeps, calls: () => seen.filter((s) => s.path !== '/v1/oauth2/token') };
}

const capture = (client: ReturnType<typeof scripted>['client']) =>
  client.payments.capture({
    requestId: 'req-1',
    authorizationId: 'AUTH-1',
    amount: usd(500),
    finalCapture: false,
  });

describe('assertSandbox', () => {
  it('accepts the sandbox, local hosts and the fake, and refuses live PayPal', () => {
    for (const url of [
      'https://api-m.sandbox.paypal.com',
      'http://localhost:9000',
      'https://x.paypal.test',
    ]) {
      expect(() => assertSandbox(url)).not.toThrow();
    }
    expect(() => assertSandbox('https://api-m.paypal.com')).toThrow(/sandbox only/);
    expect(() =>
      createPayPalClient({ clientId: 'a', clientSecret: 'b', baseUrl: 'https://api.paypal.com' }),
    ).toThrow();
  });
});

describe('authentication', () => {
  it('fetches one token for many calls, and another once it has expired', async () => {
    let clock = 0;
    const { client, seen } = scripted(
      [
        reply(200, { id: 'a', status: 'COMPLETED' }),
        reply(200, { id: 'b', status: 'COMPLETED' }),
        reply(200, { id: 'c', status: 'COMPLETED' }),
      ],
      { now: () => clock },
    );
    await capture(client);
    await capture(client);
    expect(seen.filter((s) => s.path === '/v1/oauth2/token')).toHaveLength(1);
    clock = 3_600_000;
    await capture(client);
    expect(seen.filter((s) => s.path === '/v1/oauth2/token')).toHaveLength(2);
  });

  it('shares one token fetch between calls that start together', async () => {
    const { client, seen } = scripted([
      reply(200, { id: 'a', status: 'X' }),
      reply(200, { id: 'b', status: 'X' }),
    ]);
    await Promise.all([capture(client), capture(client)]);
    expect(seen.filter((s) => s.path === '/v1/oauth2/token')).toHaveLength(1);
  });

  it('refreshes a refused token once and retries, but not forever', async () => {
    const { client, seen } = scripted([reply(401), reply(200, { id: 'a', status: 'X' })]);
    await capture(client);
    expect(seen.filter((s) => s.path === '/v1/oauth2/token')).toHaveLength(2);
    const stubborn = scripted([
      reply(401),
      reply(401, { name: 'AUTHENTICATION_FAILURE', debug_id: 'dbg-1' }),
    ]);
    await expect(capture(stubborn.client)).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
      debugId: 'dbg-1',
    });
  });

  it('reports bad credentials and an unreadable token as such', async () => {
    const refusing = createPayPalClient({
      clientId: 'a',
      clientSecret: 'b',
      baseUrl: BASE,
      fetch: async () => reply(401),
    });
    await expect(capture(refusing)).rejects.toMatchObject({ kind: 'auth' });
    const odd = createPayPalClient({
      clientId: 'a',
      clientSecret: 'b',
      baseUrl: BASE,
      fetch: async () => reply(200, { nope: 1 }),
    });
    await expect(capture(odd)).rejects.toMatchObject({ kind: 'invalid' });
  });
});

describe('errors, classified for the executor', () => {
  it.each([
    [
      422,
      { name: 'UNPROCESSABLE_ENTITY', debug_id: 'd1', details: [{ issue: 'INSTRUMENT_DECLINED' }] },
      'declined',
    ],
    [422, { debug_id: 'd2', details: [{ issue: 'AUTHORIZATION_VOIDED' }] }, 'rejected'],
    [404, { name: 'RESOURCE_NOT_FOUND', debug_id: 'd3' }, 'rejected'],
    [400, { name: 'INVALID_REQUEST', debug_id: 'd4' }, 'rejected'],
  ])('answers %s as %s, keeping PayPal’s debug_id', async (status, body, kind) => {
    const { client } = scripted([reply(status, body)]);
    const error = await capture(client).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ kind, status, debugId: body.debug_id });
  });

  it('takes the debug id from the header when the body has none, and survives a body that is not JSON', async () => {
    const { client } = scripted([
      new Response('<html>', { status: 400, headers: { 'paypal-debug-id': 'hdr-1' } }),
    ]);
    await expect(capture(client)).rejects.toMatchObject({ kind: 'rejected', debugId: 'hdr-1' });
  });

  it('treats no answer as an unknown outcome, never a failure', async () => {
    const { client } = scripted([new Error('socket hang up')]);
    await expect(capture(client)).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('refuses an answer it cannot read', async () => {
    const { client } = scripted([reply(200, { surprise: true })]);
    await expect(capture(client)).rejects.toMatchObject({ kind: 'invalid' });
  });
});

describe('retries', () => {
  it('waits as long as Retry-After says on a 429, then succeeds', async () => {
    const { client, sleeps } = scripted([
      reply(429, {}, { 'retry-after': '2' }),
      reply(200, { id: 'a', status: 'X' }),
    ]);
    await capture(client);
    expect(sleeps).toEqual([2000]);
  });

  it('backs off on 5xx, and reuses the same PayPal-Request-Id so a retry cannot double-charge', async () => {
    const { client, sleeps, calls } = scripted([
      reply(503),
      reply(500),
      reply(200, { id: 'a', status: 'X' }),
    ]);
    await capture(client);
    expect(sleeps).toEqual([250, 500]);
    expect(calls().map((c) => c.headers.get('paypal-request-id'))).toEqual([
      'req-1',
      'req-1',
      'req-1',
    ]);
  });

  it('gives up as retryable after its retries', async () => {
    const { client, calls } = scripted([reply(503), reply(503), reply(503), reply(503)]);
    await expect(capture(client)).rejects.toMatchObject({ kind: 'retryable', status: 503 });
    expect(calls()).toHaveLength(4);
  });

  it('never retries a decline', async () => {
    const { client, calls } = scripted([
      reply(422, { details: [{ issue: 'INSTRUMENT_DECLINED' }] }),
    ]);
    await expect(capture(client)).rejects.toMatchObject({ kind: 'declined' });
    expect(calls()).toHaveLength(1);
  });
});

describe('endpoints', () => {
  it('places a hold from a vaulted token, tagged with the provenance id, in decimal amounts', async () => {
    const { client, calls } = scripted([
      reply(201, {
        id: 'ORD-1',
        status: 'COMPLETED',
        purchase_units: [
          {
            payments: {
              authorizations: [
                {
                  id: 'AUTH-1',
                  status: 'CREATED',
                  amount: { currency_code: 'USD', value: '30.00' },
                },
              ],
            },
          },
        ],
      }),
    ]);
    const result = await client.orders.createAuthorizeOrder({
      requestId: 'r',
      vaultId: 'VT-1',
      amount: usd(3000),
      customId: 'bursar:v1:x',
      referenceId: 'act_1',
    });
    expect(result).toEqual({ id: 'ORD-1', status: 'COMPLETED', authorizationId: 'AUTH-1' });
    expect(calls()[0]).toMatchObject({ method: 'POST', path: '/v2/checkout/orders' });
    expect(calls()[0]?.body).toMatchObject({
      intent: 'AUTHORIZE',
      payment_source: { paypal: { vault_id: 'VT-1' } },
      purchase_units: [
        { custom_id: 'bursar:v1:x', amount: { currency_code: 'USD', value: '30.00' } },
      ],
    });
  });

  it('captures, voids, reauthorizes and refunds with exact amounts', async () => {
    const op = reply(201, {
      id: 'X-1',
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '5.00' },
    });
    const { client, calls } = scripted([op.clone(), reply(204), op.clone(), op.clone()]);
    await client.payments.capture({
      requestId: 'c',
      authorizationId: 'AUTH-1',
      amount: usd(500),
      finalCapture: true,
      invoiceId: 'inv',
    });
    await client.payments.void({ requestId: 'v', authorizationId: 'AUTH-1' });
    await client.payments.reauthorize({
      requestId: 'ra',
      authorizationId: 'AUTH-1',
      amount: usd(500),
    });
    await client.payments.refund({ requestId: 'rf', captureId: 'CAP-1', amount: usd(250) });
    expect(calls().map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /v2/payments/authorizations/AUTH-1/capture',
      'POST /v2/payments/authorizations/AUTH-1/void',
      'POST /v2/payments/authorizations/AUTH-1/reauthorize',
      'POST /v2/payments/captures/CAP-1/refund',
    ]);
    expect(calls()[0]?.body).toMatchObject({
      final_capture: true,
      invoice_id: 'inv',
      amount: { value: '5.00' },
    });
    expect(calls()[3]?.body).toMatchObject({ amount: { value: '2.50' } });
  });

  it('reads an authorization and a payout batch', async () => {
    const { client } = scripted([
      reply(200, {
        id: 'AUTH-1',
        status: 'CREATED',
        amount: { currency_code: 'USD', value: '30.00' },
        expiration_time: 'soon',
      }),
      reply(200, {
        batch_header: { payout_batch_id: 'B1', batch_status: 'SUCCESS' },
        items: [{ transaction_status: 'SUCCESS', payout_item: { sender_item_id: 'i1' } }],
      }),
    ]);
    expect(await client.payments.getAuthorization('AUTH-1')).toMatchObject({
      status: 'CREATED',
      amount: usd(3000),
    });
    expect(await client.payouts.get('B1')).toEqual({
      batchId: 'B1',
      status: 'SUCCESS',
      items: [{ itemId: 'i1', status: 'SUCCESS' }],
    });
  });

  it('creates payouts with the batch and item ids that make a retry one payout', async () => {
    const { client, calls } = scripted([
      reply(201, { batch_header: { payout_batch_id: 'B1', batch_status: 'PENDING' } }),
    ]);
    expect(
      await client.payouts.create({
        requestId: 'p',
        batchId: 'b_act_1',
        items: [{ itemId: 'i_act_1', receiver: 's@example.com', amount: usd(1250) }],
      }),
    ).toEqual({ batchId: 'B1', status: 'PENDING' });
    expect(calls()[0]?.body).toMatchObject({
      sender_batch_header: { sender_batch_id: 'b_act_1' },
      items: [
        {
          sender_item_id: 'i_act_1',
          receiver: 's@example.com',
          amount: { currency: 'USD', value: '12.50' },
        },
      ],
    });
  });

  it('runs the vault flow and deletes a token on revocation', async () => {
    const { client, calls } = scripted([
      reply(201, {
        id: 'ST-1',
        status: 'PAYER_ACTION_REQUIRED',
        links: [{ rel: 'approve', href: 'https://paypal.test/approve' }],
      }),
      reply(201, { id: 'VT-1', customer: { id: 'CUST-1' } }),
      reply(204),
    ]);
    expect(
      await client.vault.createSetupToken({
        requestId: 's',
        returnUrl: 'https://a.test/r',
        cancelUrl: 'https://a.test/c',
      }),
    ).toMatchObject({ id: 'ST-1', approveUrl: 'https://paypal.test/approve' });
    expect(await client.vault.createPaymentToken({ requestId: 'p', setupTokenId: 'ST-1' })).toEqual(
      { id: 'VT-1', customerId: 'CUST-1' },
    );
    await client.vault.deletePaymentToken('VT-1');
    expect(calls().at(-1)).toMatchObject({
      method: 'DELETE',
      path: '/v3/vault/payment-tokens/VT-1',
    });
  });

  it('registers webhooks and treats anything but SUCCESS as not genuine', async () => {
    const { client } = scripted([
      reply(201, { id: 'WH-1' }),
      reply(200, { verification_status: 'SUCCESS' }),
      reply(200, { verification_status: 'FAILURE' }),
    ]);
    expect(
      await client.webhooks.register({
        requestId: 'w',
        url: 'https://a.test/hook',
        eventTypes: ['PAYMENT.CAPTURE.COMPLETED'],
      }),
    ).toEqual({ id: 'WH-1' });
    const check = () =>
      client.webhooks.verify({
        webhookId: 'WH-1',
        headers: { 'paypal-transmission-id': 't' },
        event: { id: 'E' },
      });
    expect(await check()).toBe(true);
    expect(await check()).toBe(false);
  });
});
