import { sha256Hex } from '@bursar/crypto';
import { fromPayPalAmount, Money, MoneyError, toPayPalAmount } from '@bursar/money';

// A fake PayPal for tests. README.md says how faithful each behaviour is; the table is the contract.

export interface FakeOptions {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly now?: () => Date;
  /** Where signed webhook events are delivered. Events are always recorded in `events` too. */
  readonly deliver?: (
    url: string,
    headers: Record<string, string>,
    body: string,
  ) => void | Promise<void>;
  readonly webhookSecret?: string;
  /** How long after authorization a reauthorize is allowed. PayPal's honor period is three days. */
  readonly honorPeriodMs?: number;
  /** How long an authorization lasts. */
  readonly validityMs?: number;
}

export interface FakeEvent {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly event: {
    id: string;
    event_type: string;
    resource_type: string;
    resource: Record<string, unknown>;
  };
}

interface Authorization {
  id: string;
  orderId: string;
  customId: string | undefined;
  amount: Money;
  captured: Money;
  status: 'CREATED' | 'PARTIALLY_CAPTURED' | 'CAPTURED' | 'VOIDED';
  createdAt: Date;
  reauthorizedAt: Date | undefined;
}
interface Capture {
  id: string;
  authorizationId: string;
  amount: Money;
  refunded: Money;
  fee: Money;
  customId: string | undefined;
}
interface Payout {
  id: string;
  senderBatchId: string;
  status: 'PENDING' | 'SUCCESS';
  items: { id: string; senderItemId: string; receiver: string; amount: Money }[];
  total: Money;
}

class FakeError extends Error {
  readonly status: number;
  readonly issue: string;
  constructor(status: number, issue: string, message = issue) {
    super(message);
    this.status = status;
    this.issue = issue;
  }
}

interface Req {
  readonly query: URLSearchParams;
  readonly params: string[];
  readonly body: Record<string, unknown>;
  readonly headers: Headers;
}
interface Res {
  readonly status: number;
  readonly body?: unknown;
}
type Handler = (req: Req) => Res | Promise<Res>;

const MOCK_STATUS: Record<string, number> = {
  INTERNAL_SERVER_ERROR: 500,
  PERMISSION_DENIED: 403,
  RESOURCE_NOT_FOUND: 404,
};
const reply = (status: number, body?: unknown): Res => ({
  status,
  ...(body === undefined ? {} : { body }),
});

function parseAmount(raw: unknown): Money {
  try {
    return fromPayPalAmount(raw as never);
  } catch (error) {
    if (error instanceof MoneyError)
      throw new FakeError(400, 'INVALID_REQUEST', 'The amount is not valid.');
    throw error;
  }
}
const amountOf = (value: Money) => toPayPalAmount(value);

export function createFakePayPal(options: FakeOptions = {}) {
  const config = {
    clientId: 'fake-id',
    clientSecret: 'fake-secret',
    webhookSecret: 'fake-webhook',
    honorPeriodMs: 3 * 86_400_000,
    validityMs: 29 * 86_400_000,
    ...options,
  };
  const now = options.now ?? (() => new Date());
  const counters: Record<string, number> = {};
  const id = (prefix: string) => {
    const next = (counters[prefix] ?? 0) + 1;
    counters[prefix] = next;
    return `${prefix}-${String(next).padStart(4, '0')}`;
  };

  const tokens = new Set<string>();
  const setupTokens = new Map<string, { approved: boolean }>();
  const paymentTokens = new Map<string, { deleted: boolean }>();
  const orders = new Map<string, { authorizationId: string | undefined }>();
  const authorizations = new Map<string, Authorization>();
  const captures = new Map<string, Capture>();
  const payouts = new Map<string, Payout>();
  const webhooks = new Map<string, { url: string; types: string[] }>();
  const cached = new Map<string, Res>();
  const events: FakeEvent[] = [];
  const ledger: {
    id: string;
    code: string;
    amount: Money;
    customId: string | undefined;
    at: Date;
  }[] = [];
  const log = (id: string, code: string, amount: Money, customId?: string) =>
    ledger.push({ id, code, amount, customId, at: now() });
  let balance: Money | undefined;

  function credit(amount: Money): void {
    balance = (balance ?? Money.zero(amount.currency)).add(amount);
  }
  function debit(amount: Money): void {
    balance = (balance ?? Money.zero(amount.currency)).subtract(amount);
  }
  const pendingTotal = () =>
    [...payouts.values()]
      .filter((p) => p.status === 'PENDING')
      .reduce((sum, p) => sum + p.total.minor, 0n);

  // -- webhooks ---------------------------------------------------------------------------------
  const sign = (transmissionId: string, time: string, webhookId: string, body: string) =>
    sha256Hex(`${config.webhookSecret}|${transmissionId}|${time}|${webhookId}|${sha256Hex(body)}`);

  async function emit(
    type: string,
    resourceType: string,
    resource: Record<string, unknown>,
  ): Promise<void> {
    for (const [webhookId, hook] of webhooks) {
      if (!hook.types.includes(type)) continue;
      const event = { id: id('WH-EVT'), event_type: type, resource_type: resourceType, resource };
      const body = JSON.stringify(event);
      const [transmissionId, time] = [id('TRANS'), now().toISOString()];
      const headers = {
        'paypal-transmission-id': transmissionId,
        'paypal-transmission-time': time,
        'paypal-auth-algo': 'FAKE-SHA256',
        'paypal-cert-url': 'https://paypal.test/certs/fake',
        'paypal-transmission-sig': sign(transmissionId, time, webhookId, body),
      };
      events.push({ url: hook.url, headers, event });
      await config.deliver?.(hook.url, headers, body);
    }
  }

  // -- authorizations ---------------------------------------------------------------------------
  const authorizationView = (a: Authorization) => ({
    id: a.id,
    status: a.status,
    amount: amountOf(a.amount),
    custom_id: a.customId,
    create_time: a.createdAt.toISOString(),
    expiration_time: new Date(
      (a.reauthorizedAt ?? a.createdAt).getTime() + config.validityMs,
    ).toISOString(),
  });

  function authorize(orderId: string, amount: Money, customId: string | undefined): Authorization {
    const authorization: Authorization = {
      id: id('AUTH'),
      orderId,
      customId,
      amount,
      captured: amount.subtract(amount),
      status: 'CREATED',
      createdAt: now(),
      reauthorizedAt: undefined,
    };
    authorizations.set(authorization.id, authorization);
    const order = orders.get(orderId);
    if (order !== undefined) order.authorizationId = authorization.id;
    return authorization;
  }

  const orderView = (orderId: string, a: Authorization) => ({
    id: orderId,
    status: 'COMPLETED',
    purchase_units: [{ payments: { authorizations: [authorizationView(a)] } }],
  });

  function authorizationOf(authId: string | undefined): Authorization {
    const found = authorizations.get(authId ?? '');
    if (found === undefined) throw new FakeError(404, 'RESOURCE_NOT_FOUND');
    return found;
  }

  function expired(a: Authorization): boolean {
    return now().getTime() > (a.reauthorizedAt ?? a.createdAt).getTime() + config.validityMs;
  }

  function assertOpen(a: Authorization): void {
    if (a.status === 'VOIDED') throw new FakeError(422, 'AUTHORIZATION_VOIDED');
    if (a.status === 'CAPTURED') throw new FakeError(422, 'AUTHORIZATION_ALREADY_CAPTURED');
    if (expired(a)) throw new FakeError(422, 'AUTHORIZATION_EXPIRED');
  }

  /** PayPal's published fee is 2.9% plus 30 cents; the fake uses it for every currency. */
  const fee = (amount: Money) => Money.of((amount.minor * 29n) / 1000n + 30n, amount.currency);

  async function capture(req: Req): Promise<Res> {
    const a = authorizationOf(req.params[0]);
    assertOpen(a);
    const amount = parseAmount(req.body['amount'] ?? amountOf(a.amount.subtract(a.captured)));
    if (amount.currency !== a.amount.currency) throw new FakeError(422, 'CURRENCY_MISMATCH');
    if (a.captured.add(amount).greaterThan(a.amount))
      throw new FakeError(422, 'MAX_CAPTURE_AMOUNT_EXCEEDED');
    a.captured = a.captured.add(amount);
    a.status =
      req.body['final_capture'] === true || a.captured.equals(a.amount)
        ? 'CAPTURED'
        : 'PARTIALLY_CAPTURED';
    const taken: Capture = {
      id: id('CAP'),
      authorizationId: a.id,
      amount,
      refunded: amount.subtract(amount),
      fee: fee(amount),
      customId: a.customId,
    };
    captures.set(taken.id, taken);
    log(taken.id, 'T0006', amount, a.customId);
    credit(amount.subtract(taken.fee));
    await emit('PAYMENT.CAPTURE.COMPLETED', 'capture', {
      id: taken.id,
      status: 'COMPLETED',
      amount: amountOf(amount),
      custom_id: a.customId,
    });
    return reply(201, { id: taken.id, status: 'COMPLETED', amount: amountOf(amount) });
  }

  async function voidAuthorization(req: Req): Promise<Res> {
    const a = authorizationOf(req.params[0]);
    // Seen on the sandbox: voiding twice is PREVIOUSLY_VOIDED, though capturing a voided one is AUTHORIZATION_VOIDED.
    if (a.status === 'VOIDED') throw new FakeError(422, 'PREVIOUSLY_VOIDED');
    assertOpen(a);
    a.status = 'VOIDED';
    await emit('PAYMENT.AUTHORIZATION.VOIDED', 'authorization', {
      id: a.id,
      status: 'VOIDED',
      custom_id: a.customId,
    });
    return reply(204);
  }

  function reauthorize(req: Req): Res {
    const a = authorizationOf(req.params[0]);
    if (a.status === 'VOIDED') throw new FakeError(422, 'AUTHORIZATION_VOIDED');
    if (now().getTime() - a.createdAt.getTime() < config.honorPeriodMs)
      throw new FakeError(422, 'REAUTHORIZATION_TOO_SOON');
    if (a.reauthorizedAt !== undefined)
      throw new FakeError(
        422,
        'REAUTHORIZATION_NOT_ALLOWED',
        'An authorization can be reauthorized once.',
      );
    a.reauthorizedAt = now();
    return reply(201, { id: a.id, status: 'CREATED', amount: amountOf(a.amount) });
  }

  async function refund(req: Req): Promise<Res> {
    const taken = captures.get(req.params[0] ?? '');
    if (taken === undefined) throw new FakeError(404, 'RESOURCE_NOT_FOUND');
    const amount = parseAmount(
      req.body['amount'] ?? amountOf(taken.amount.subtract(taken.refunded)),
    );
    const left = taken.amount.subtract(taken.refunded);
    if (left.isZero()) throw new FakeError(422, 'CAPTURE_FULLY_REFUNDED');
    if (amount.greaterThan(left)) throw new FakeError(422, 'REFUND_AMOUNT_EXCEEDED');
    taken.refunded = taken.refunded.add(amount);
    debit(amount);
    await emit('PAYMENT.CAPTURE.REFUNDED', 'refund', {
      capture_id: taken.id,
      amount: amountOf(amount),
      custom_id: taken.customId,
    });
    const refundId = id('REF');
    log(refundId, 'T1107', amount, taken.customId);
    return reply(201, {
      id: refundId,
      status: 'COMPLETED',
      amount: amountOf(amount),
    });
  }

  // -- payouts ----------------------------------------------------------------------------------
  function createPayout(req: Req): Res {
    const header = (req.body['sender_batch_header'] ?? {}) as { sender_batch_id?: string };
    const items = (req.body['items'] ?? []) as {
      receiver: string;
      amount: { currency: string; value: string };
      sender_item_id: string;
    }[];
    if (header.sender_batch_id === undefined || items.length === 0)
      throw new FakeError(400, 'INVALID_REQUEST');
    if ([...payouts.values()].some((p) => p.senderBatchId === header.sender_batch_id))
      throw new FakeError(400, 'DUPLICATE_SENDER_BATCH_ID');
    const parsed = items.map((i) => ({
      id: id('ITEM'),
      senderItemId: i.sender_item_id,
      receiver: i.receiver,
      amount: parseAmount({ currency_code: i.amount.currency, value: i.amount.value }),
    }));
    const total = parsed.slice(1).reduce((sum, i) => sum.add(i.amount), parsed[0]?.amount as Money);
    if (balance === undefined || total.minor + pendingTotal() > balance.minor)
      throw new FakeError(422, 'INSUFFICIENT_FUNDS');
    const batch: Payout = {
      id: id('PAY'),
      senderBatchId: header.sender_batch_id,
      status: 'PENDING',
      items: parsed,
      total,
    };
    payouts.set(batch.id, batch);
    return reply(201, { batch_header: { payout_batch_id: batch.id, batch_status: 'PENDING' } });
  }

  const payoutView = (p: Payout) => ({
    batch_header: { payout_batch_id: p.id, batch_status: p.status },
    items: p.items.map((i) => ({
      payout_item_id: i.id,
      transaction_status: p.status,
      payout_item: {
        sender_item_id: i.senderItemId,
        receiver: i.receiver,
        amount: { currency: i.amount.currency, value: i.amount.toDecimal() },
      },
    })),
  });

  // -- the routes -------------------------------------------------------------------------------
  const routes: ReadonlyArray<readonly [string, RegExp, Handler]> = [
    [
      'POST',
      /^\/v3\/vault\/setup-tokens$/,
      () => {
        const token = id('ST');
        setupTokens.set(token, { approved: false });
        return reply(201, {
          id: token,
          status: 'PAYER_ACTION_REQUIRED',
          links: [{ rel: 'approve', href: `https://paypal.test/vault/approve?token=${token}` }],
        });
      },
    ],
    [
      'POST',
      /^\/v3\/vault\/payment-tokens$/,
      ({ body }) => {
        const source = (body['payment_source'] as { token?: { id?: string } } | undefined)?.token
          ?.id;
        if (setupTokens.get(source ?? '')?.approved !== true)
          throw new FakeError(422, 'PAYER_ACTION_REQUIRED', 'The payer has not approved.');
        const token = id('VT');
        paymentTokens.set(token, { deleted: false });
        return reply(201, { id: token, status: 'CREATED', customer: { id: id('CUST') } });
      },
    ],
    [
      'DELETE',
      /^\/v3\/vault\/payment-tokens\/([^/]+)$/,
      ({ params }) => {
        const token = paymentTokens.get(params[0] ?? '');
        if (token === undefined || token.deleted) throw new FakeError(404, 'RESOURCE_NOT_FOUND');
        token.deleted = true;
        return reply(204);
      },
    ],
    [
      'POST',
      /^\/v2\/checkout\/orders$/,
      ({ body }) => {
        const unit = (
          body['purchase_units'] as { amount: unknown; custom_id?: string }[] | undefined
        )?.[0];
        const vaultId = (body['payment_source'] as { paypal?: { vault_id?: string } } | undefined)
          ?.paypal?.vault_id;
        if (body['intent'] !== 'AUTHORIZE' || unit === undefined)
          throw new FakeError(400, 'INVALID_REQUEST');
        const amount = parseAmount(unit.amount);
        if (vaultId !== undefined && paymentTokens.get(vaultId)?.deleted !== false)
          throw new FakeError(422, 'BILLING_AGREEMENT_NOT_FOUND');
        const orderId = id('ORD');
        orders.set(orderId, { authorizationId: undefined });
        return reply(201, orderView(orderId, authorize(orderId, amount, unit.custom_id)));
      },
    ],
    [
      'POST',
      /^\/v2\/checkout\/orders\/([^/]+)\/authorize$/,
      ({ params }) => {
        const order = orders.get(params[0] ?? '');
        if (order === undefined) throw new FakeError(404, 'RESOURCE_NOT_FOUND');
        throw new FakeError(422, 'ORDER_ALREADY_AUTHORIZED');
      },
    ],
    [
      'GET',
      /^\/v2\/payments\/authorizations\/([^/]+)$/,
      ({ params }) => {
        const a = authorizationOf(params[0]);
        return reply(200, {
          ...authorizationView(a),
          status: expired(a) && a.status !== 'VOIDED' ? 'EXPIRED' : a.status,
        });
      },
    ],
    ['POST', /^\/v2\/payments\/authorizations\/([^/]+)\/capture$/, capture],
    ['POST', /^\/v2\/payments\/authorizations\/([^/]+)\/void$/, voidAuthorization],
    ['POST', /^\/v2\/payments\/authorizations\/([^/]+)\/reauthorize$/, reauthorize],
    ['POST', /^\/v2\/payments\/captures\/([^/]+)\/refund$/, refund],
    ['POST', /^\/v1\/payments\/payouts$/, createPayout],
    [
      'GET',
      /^\/v1\/payments\/payouts\/([^/]+)$/,
      ({ params }) => {
        const batch = payouts.get(params[0] ?? '');
        if (batch === undefined) throw new FakeError(404, 'RESOURCE_NOT_FOUND');
        return reply(200, payoutView(batch));
      },
    ],
    [
      'GET',
      /^\/v1\/reporting\/transactions$/,
      ({ query }) => {
        const [from, to] = [
          Date.parse(query.get('start_date') ?? ''),
          Date.parse(query.get('end_date') ?? ''),
        ];
        const inside = ledger.filter((t) => t.at.getTime() >= from && t.at.getTime() <= to);
        return reply(200, {
          transaction_details: inside.map((t) => ({
            transaction_info: {
              transaction_id: t.id,
              transaction_event_code: t.code,
              transaction_amount: amountOf(t.amount),
              custom_field: t.customId,
              transaction_initiation_date: t.at.toISOString(),
            },
          })),
        });
      },
    ],
    [
      'POST',
      /^\/v1\/notifications\/webhooks$/,
      ({ body }) => {
        const webhookId = id('WH');
        webhooks.set(webhookId, {
          url: String(body['url']),
          types: ((body['event_types'] ?? []) as { name: string }[]).map((t) => t.name),
        });
        return reply(201, { id: webhookId });
      },
    ],
    [
      'POST',
      /^\/v1\/notifications\/verify-webhook-signature$/,
      ({ body }) => {
        const event = JSON.stringify(body['webhook_event']);
        const expected = sign(
          String(body['transmission_id']),
          String(body['transmission_time']),
          String(body['webhook_id']),
          event,
        );
        return reply(200, {
          verification_status: body['transmission_sig'] === expected ? 'SUCCESS' : 'FAILURE',
        });
      },
    ],
  ];

  // -- the front door ---------------------------------------------------------------------------
  const debug = () => id('fake-debug');
  const failure = (e: FakeError): Response => {
    const debugId = debug();
    return new Response(
      JSON.stringify({
        name: e.status === 404 ? 'RESOURCE_NOT_FOUND' : 'UNPROCESSABLE_ENTITY',
        message: e.message,
        debug_id: debugId,
        details: [{ issue: e.issue, description: e.message }],
      }),
      {
        status: e.status,
        headers: { 'content-type': 'application/json', 'paypal-debug-id': debugId },
      },
    );
  };
  const toResponse = (r: Res): Response =>
    new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });

  function mock(headers: Headers): void {
    const raw = headers.get('paypal-mock-response');
    if (raw === null) return;
    const code =
      (JSON.parse(raw) as { mock_application_codes?: string }).mock_application_codes ??
      'UNPROCESSABLE_ENTITY';
    throw new FakeError(
      MOCK_STATUS[code] ?? 422,
      code,
      `Simulated by PayPal-Mock-Response: ${code}.`,
    );
  }

  function oauth(headers: Headers): Res {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    if (headers.get('authorization') !== `Basic ${basic}`)
      throw new FakeError(401, 'AUTHENTICATION_FAILURE', 'Client authentication failed.');
    const token = id('fake-token');
    tokens.add(token);
    return reply(200, { access_token: token, token_type: 'Bearer', expires_in: 32_400 });
  }

  function find(method: string, pathname: string) {
    const found = routes
      .map(([m, pattern, handler]) => ({ m, match: pattern.exec(pathname), handler }))
      .find((r) => r.m === method && r.match !== null);
    if (found === undefined) throw new FakeError(404, 'RESOURCE_NOT_FOUND', 'No such endpoint.');
    return { handler: found.handler, params: (found.match as RegExpExecArray).slice(1) };
  }

  function authenticate(headers: Headers): void {
    const bearer = headers.get('authorization')?.replace(/^Bearer /, '');
    if (bearer === undefined || !tokens.has(bearer)) {
      throw new FakeError(401, 'AUTHENTICATION_FAILURE', 'The token is missing or invalid.');
    }
  }

  /** Runs a request through the routes. A repeated PayPal-Request-Id gets the first answer back. */
  async function dispatch(request: Request, url: URL): Promise<Res> {
    if (request.method === 'POST' && url.pathname === '/v1/oauth2/token')
      return oauth(request.headers);
    authenticate(request.headers);
    const { handler, params } = find(request.method, url.pathname);
    mock(request.headers);
    const requestId = request.headers.get('paypal-request-id');
    const cacheKey =
      requestId === null ? undefined : `${request.method} ${url.pathname} ${requestId}`;
    const replay = cacheKey === undefined ? undefined : cached.get(cacheKey);
    if (replay !== undefined) return replay;
    const text = await request.text();
    const result = await handler({
      query: url.searchParams,
      params,
      body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
      headers: request.headers,
    });
    if (cacheKey !== undefined) cached.set(cacheKey, result);
    return result;
  }

  async function handle(request: Request): Promise<Response> {
    try {
      return toResponse(await dispatch(request, new URL(request.url)));
    } catch (error) {
      if (error instanceof FakeError) return failure(error);
      throw error;
    }
  }

  return {
    /** Use as the `fetch` of a client whose base URL ends in `.test`. */
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      handle(new Request(input, init))) as typeof fetch,
    /** The payer approves a setup token (in reality, they do this on PayPal's page). */
    approveSetupToken(token: string): void {
      const found = setupTokens.get(token);
      if (found === undefined) throw new Error(`No setup token ${token}`);
      found.approved = true;
    },
    /** PayPal finishes pending payouts: they succeed, the money leaves, and a webhook fires. */
    async settlePayouts(): Promise<void> {
      for (const batch of payouts.values()) {
        if (batch.status !== 'PENDING') continue;
        batch.status = 'SUCCESS';
        log(batch.id, 'T0400', batch.total);
        debit(batch.total);
        await emit('PAYMENT.PAYOUTSBATCH.SUCCESS', 'payouts', {
          batch_header: { payout_batch_id: batch.id, batch_status: 'SUCCESS' },
        });
      }
    },
    events,
    /** Puts money in the fake merchant's balance, as the platform's own float that payouts draw on. */
    fund(amount: Money): void {
      credit(amount);
    },
    /** The payouts it has accepted, with their receivers. */
    payouts: () =>
      [...payouts.values()].map((p) => ({
        id: p.id,
        status: p.status,
        items: p.items.map((i) => ({ receiver: i.receiver, amount: i.amount })),
      })),
    /** Money PayPal has moved, as Transaction Search reports it. A test can add one the gateway never made. */
    transactions: ledger,
    /** What the fake merchant holds: captures less fees, refunds and settled payouts. */
    balance: () => balance,
    config: { clientId: config.clientId, clientSecret: config.clientSecret },
  };
}

export type FakePayPal = ReturnType<typeof createFakePayPal>;
