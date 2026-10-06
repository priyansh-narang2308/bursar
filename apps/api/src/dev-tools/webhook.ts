import { randomUUID } from 'node:crypto';
import { WEBHOOK_EVENT_TYPES } from '@bursar/core';
import { createPayPalClient } from '@bursar/paypal';

/*
 * Registers Bursar's webhook with PayPal's sandbox, so PayPal can tell a deployed server about captures,
 * refunds and payouts. Run it once per address:
 *
 *   pnpm --filter @bursar/api webhook https://<your-host>/webhooks/paypal
 *
 * It prints the webhook id, which the server needs as PAYPAL_WEBHOOK_ID to check PayPal's signatures.
 */
const url = process.argv[2];
if (!url?.startsWith('https://'))
  throw new Error('Give the public https address, such as https://<host>/webhooks/paypal');
const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. It belongs in .env.`);
  return value;
};
const paypal = createPayPalClient({
  clientId: need('PAYPAL_CLIENT_ID'),
  clientSecret: need('PAYPAL_CLIENT_SECRET'),
  baseUrl: 'https://api-m.sandbox.paypal.com',
});
const { id } = await paypal.webhooks.register({
  requestId: randomUUID(),
  url,
  eventTypes: WEBHOOK_EVENT_TYPES,
});
process.stdout.write(`Registered. PAYPAL_WEBHOOK_ID=${id}\n`);
