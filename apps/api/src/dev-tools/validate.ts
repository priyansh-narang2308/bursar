import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decryptSecret, parseKeyring } from '@bursar/crypto';
import { Money } from '@bursar/money';
import { createPayPalClient, PayPalError } from '@bursar/paypal';

/*
 * Checks, against PayPal's real sandbox, the behaviours the fake PayPal only assumes (see the fidelity table in
 * `packages/paypal-fake/README.md`). It uses one pooled sandbox buyer, moves a few dollars of sandbox money, and
 * prints a JSON report: what it expected, what PayPal did, and PayPal's debug id. It never prints a key, a token or
 * a secret, and it masks every PayPal object id but its last four characters. Needs the sandbox keys in the
 * environment and a buyer in `.bursar/payers.json` (`pnpm dev:payer`). Run from the repository root:
 *
 *   node --env-file=.env --import tsx apps/api/src/dev-tools/validate.ts
 */

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. It belongs in .env.`);
  return value;
};
const ROOT = process.env['BURSAR_ROOT'] ?? process.cwd();
const POOL = join(ROOT, '.bursar', 'payers.json');
if (!existsSync(POOL)) throw new Error('The payer pool is empty. Run `pnpm dev:payer` first.');
const [first] = JSON.parse(readFileSync(POOL, 'utf8')) as { sealed: string }[];
if (!first) throw new Error('The payer pool is empty. Run `pnpm dev:payer` first.');

const BASE = 'https://api-m.sandbox.paypal.com';
const vault = decryptSecret(parseKeyring(need('VAULT_ENC_KEY')), first.sealed, 'payer-pool');
const clientId = need('PAYPAL_CLIENT_ID');
const clientSecret = need('PAYPAL_CLIENT_SECRET');
const paypal = createPayPalClient({ clientId, clientSecret, baseUrl: BASE, maxRetries: 0 });
const usd = (cents: number) => Money.of(BigInt(cents), 'USD');
const id = () => crypto.randomUUID();
const mask = (value: string | undefined) =>
  value === undefined ? undefined : `…${value.slice(-4)}`;

interface Finding {
  readonly check: string;
  readonly assumed: string;
  readonly observed: string;
  readonly debugId?: string | undefined;
}
const findings: Finding[] = [];
const note = (check: string, assumed: string, observed: string, debugId?: string) => {
  findings.push({ check, assumed, observed, debugId });
  process.stderr.write(`${check}: ${observed}\n`);
};

/** Runs a call and says what PayPal did: its answer, or its error's kind, status, issue and debug id. */
async function attempt<T>(call: () => Promise<T>) {
  try {
    return { ok: true as const, value: await call(), text: 'ok' };
  } catch (error) {
    if (error instanceof PayPalError)
      return {
        ok: false as const,
        text: `${error.kind}, HTTP ${error.status ?? '?'}, ${error.issue ?? 'no issue code'}`,
        debugId: error.debugId,
      };
    throw error;
  }
}

const tag = `validation-${Date.now().toString(36)}`;
let holds = 0;
/** A fresh $1.00 hold on the pooled buyer's vaulted PayPal. */
async function hold(cents = 100) {
  holds += 1;
  const requestId = id();
  const result = await paypal.orders.createAuthorizeOrder({
    requestId,
    vaultId: vault,
    amount: usd(cents),
    customId: `${tag}-${holds}`,
    referenceId: `${tag}-${holds}`,
  });
  return { ...result, requestId, customId: `${tag}-${holds}` };
}

async function oauth(): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  return ((await response.json()) as { access_token: string }).access_token;
}

// 1. A hold from a vaulted token: is the authorization in the order's own answer?
const a = await hold();
note(
  'A vaulted AUTHORIZE order returns its authorization inline',
  'Yes (the plan flagged this for a spike)',
  a.authorizationId
    ? `Yes: status ${a.status}, authorization ${mask(a.authorizationId)}`
    : `No: status ${a.status}`,
);

// 2. The same request id replays the first answer.
const replay = await attempt(() =>
  paypal.orders.createAuthorizeOrder({
    requestId: a.requestId,
    vaultId: vault,
    amount: usd(100),
    customId: a.customId,
    referenceId: a.customId,
  }),
);
note(
  'PayPal-Request-Id replays the first answer',
  'The same order id comes back',
  replay.ok
    ? replay.value.id === a.id
      ? 'Yes: the same order id'
      : 'No: a different order'
    : replay.text,
  replay.ok ? undefined : replay.debugId,
);

// 3. Partial captures, final capture, over-capture, capture after close.
const authId = a.authorizationId;
if (authId === undefined)
  throw new Error('No authorization to capture; the checks that follow need one.');
const c1 = await paypal.payments.capture({
  requestId: id(),
  authorizationId: authId,
  amount: usd(40),
  finalCapture: false,
});
note(
  'A partial capture leaves the authorization open',
  'Yes',
  `Yes: capture ${mask(c1.id)}, ${c1.status}`,
);
const over = await attempt(() =>
  paypal.payments.capture({
    requestId: id(),
    authorizationId: authId,
    amount: usd(80),
    finalCapture: false,
  }),
);
note(
  'Capturing more than is left',
  'AUTHORIZATION_AMOUNT_EXCEEDED (a guess)',
  over.ok ? 'PayPal allowed it' : over.text,
  over.ok ? undefined : over.debugId,
);
const c2 = await paypal.payments.capture({
  requestId: id(),
  authorizationId: authId,
  amount: usd(60),
  finalCapture: true,
});
note('final_capture closes the authorization', 'Yes', `Yes: capture ${mask(c2.id)}, ${c2.status}`);
const after = await attempt(() =>
  paypal.payments.capture({
    requestId: id(),
    authorizationId: authId,
    amount: usd(10),
    finalCapture: true,
  }),
);
note(
  'Capturing after the final capture',
  'AUTHORIZATION_ALREADY_CAPTURED',
  after.ok ? 'PayPal allowed it' : after.text,
  after.ok ? undefined : after.debugId,
);

// 4. Refunds: within the capture, beyond it, and again once it is fully refunded.
const r1 = await paypal.payments.refund({ requestId: id(), captureId: c1.id, amount: usd(15) });
note('A partial refund within the capture', 'Yes', `Yes: ${r1.status}`);
const rOver = await attempt(() =>
  paypal.payments.refund({ requestId: id(), captureId: c1.id, amount: usd(500) }),
);
note(
  'Refunding more than the capture',
  'REFUND_AMOUNT_EXCEEDED (🔶)',
  rOver.ok ? 'PayPal allowed it' : rOver.text,
  rOver.ok ? undefined : rOver.debugId,
);
const rRest = await paypal.payments.refund({ requestId: id(), captureId: c1.id, amount: usd(25) });
note('Refunding the rest of a capture', 'Yes', `Yes: ${rRest.status}`);
const rAgain = await attempt(() =>
  paypal.payments.refund({ requestId: id(), captureId: c1.id, amount: usd(1) }),
);
note(
  'Refunding a capture that is fully refunded',
  'CAPTURE_FULLY_REFUNDED (🔶)',
  rAgain.ok ? 'PayPal allowed it' : rAgain.text,
  rAgain.ok ? undefined : rAgain.debugId,
);
await paypal.payments.refund({ requestId: id(), captureId: c2.id, amount: usd(60) });

// 5. Void: once, again, and capture after void.
const b = await hold();
const bAuth = b.authorizationId;
if (bAuth === undefined) throw new Error('No authorization to void.');
const voided = await attempt(() =>
  paypal.payments.void({ requestId: id(), authorizationId: bAuth }),
);
note(
  'Void releases the hold',
  'Yes, with 204',
  voided.ok ? 'Yes' : voided.text,
  voided.ok ? undefined : voided.debugId,
);
const voidAgain = await attempt(() =>
  paypal.payments.void({ requestId: id(), authorizationId: bAuth }),
);
note(
  'Voiding twice',
  'An error',
  voidAgain.ok ? 'PayPal allowed it' : voidAgain.text,
  voidAgain.ok ? undefined : voidAgain.debugId,
);
const afterVoid = await attempt(() =>
  paypal.payments.capture({
    requestId: id(),
    authorizationId: bAuth,
    amount: usd(100),
    finalCapture: true,
  }),
);
note(
  'Capturing a voided authorization',
  'AUTHORIZATION_VOIDED',
  afterVoid.ok ? 'PayPal allowed it' : afterVoid.text,
  afterVoid.ok ? undefined : afterVoid.debugId,
);

// 6. Reauthorize right away: the 3-day honor period.
const d = await hold();
const dAuth = d.authorizationId;
if (dAuth === undefined) throw new Error('No authorization to reauthorize.');
const reauth = await attempt(() =>
  paypal.payments.reauthorize({ requestId: id(), authorizationId: dAuth, amount: usd(100) }),
);
note(
  'Reauthorizing inside the honor period',
  'REAUTHORIZATION_TOO_SOON',
  reauth.ok ? 'PayPal allowed it' : reauth.text,
  reauth.ok ? undefined : reauth.debugId,
);
await attempt(() => paypal.payments.void({ requestId: id(), authorizationId: dAuth }));

// 7. A forced decline with PayPal-Mock-Response.
const token = await oauth();
const mock = await fetch(`${BASE}/v2/checkout/orders`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'paypal-request-id': id(),
    'paypal-mock-response': '{"mock_application_codes":"INSTRUMENT_DECLINED"}',
  },
  body: JSON.stringify({
    intent: 'AUTHORIZE',
    purchase_units: [{ amount: { currency_code: 'USD', value: '1.00' } }],
    payment_source: { paypal: { vault_id: vault } },
  }),
});
const mockBody = (await mock.json()) as {
  name?: string;
  details?: { issue?: string }[];
  debug_id?: string;
};
note(
  'PayPal-Mock-Response forces INSTRUMENT_DECLINED',
  'A 422 the client reads as a decline',
  `HTTP ${mock.status}, ${mockBody.details?.[0]?.issue ?? mockBody.name ?? 'no issue code'}`,
  mockBody.debug_id,
);

// 8. A payout, and the same batch id again.
const supplier = process.env['PAYPAL_SUPPLIER_1_EMAIL'];
if (supplier) {
  const batchId = `${tag}-batch`;
  const payout = await attempt(() =>
    paypal.payouts.create({
      requestId: id(),
      batchId,
      items: [{ itemId: `${tag}-item`, receiver: supplier, amount: usd(100) }],
    }),
  );
  note(
    'A payout to a registered supplier',
    'PENDING, then SUCCESS in about 30 seconds',
    payout.ok ? `Accepted: ${payout.value.status}` : payout.text,
    payout.ok ? undefined : payout.debugId,
  );
  if (payout.ok) {
    let status = payout.value.status;
    for (let i = 0; i < 10 && status !== 'SUCCESS'; i += 1) {
      await new Promise((r) => setTimeout(r, 6_000));
      status = (await paypal.payouts.get(payout.value.batchId)).status;
    }
    note(
      'A payout settles',
      'SUCCESS within about 30 seconds',
      `Batch status after waiting: ${status}`,
    );
    const dup = await attempt(() =>
      paypal.payouts.create({
        requestId: id(),
        batchId,
        items: [{ itemId: `${tag}-item`, receiver: supplier, amount: usd(100) }],
      }),
    );
    note(
      'Reusing a sender_batch_id',
      'Refused (the error code is a guess)',
      dup.ok ? 'PayPal accepted it again' : dup.text,
      dup.ok ? undefined : dup.debugId,
    );
  }
}

// 9. Transaction Search: does it list what we just did, and how long does it take?
const began = Date.now();
const windowStart = new Date(began - 20 * 60_000);
let seen = false;
let searchNote = '';
for (let i = 0; i < 8 && !seen; i += 1) {
  const search = await attempt(() =>
    paypal.transactions.search({ start: windowStart, end: new Date() }),
  );
  if (!search.ok) {
    searchNote = search.text;
    break;
  }
  seen = search.value.some((t) => t.customId?.startsWith(tag));
  searchNote = `${search.value.length} transactions in the window; ours ${seen ? 'listed' : 'not yet listed'}`;
  if (!seen) await new Promise((r) => setTimeout(r, 15_000));
}
note(
  'Transaction Search lists a capture, and carries custom_field',
  'Yes, after a lag',
  `${searchNote}${seen ? ` (after ${Math.round((Date.now() - began) / 1000)}s)` : ''}`,
);

// 10. The webhook for a capture carries custom_id. PayPal lists events a little after it sends them.
const iso = (at: Date) => at.toISOString().replace(/\.\d+Z$/, 'Z');
type WebhookEvent = { event_type?: string; resource?: { custom_id?: string } };
let ours: WebhookEvent | undefined;
let listed = 0;
let listNote = '';
for (let i = 0; i < 6 && ours === undefined; i += 1) {
  const query = `page_size=30&start_time=${encodeURIComponent(iso(windowStart))}&end_time=${encodeURIComponent(iso(new Date()))}`;
  const events = await fetch(`${BASE}/v1/notifications/webhooks-events?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!events.ok) {
    listNote = `Could not list events: HTTP ${events.status}`;
    break;
  }
  const list = ((await events.json()) as { events?: WebhookEvent[] }).events ?? [];
  listed = list.length;
  ours = list.find(
    (e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED' && e.resource?.custom_id?.startsWith(tag),
  );
  if (ours === undefined) await new Promise((r) => setTimeout(r, 10_000));
}
note(
  'The capture webhook carries custom_id',
  'Yes (the provenance tag depends on it)',
  ours
    ? 'Yes: the event carries the custom_id we sent'
    : listNote || `Not found among ${listed} recent events`,
);

process.stdout.write(
  `${JSON.stringify({ at: new Date().toISOString(), holds, findings }, null, 2)}\n`,
);
process.exit(0);
