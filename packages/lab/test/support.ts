import { createCore, WEBHOOK_EVENT_TYPES } from '@bursar/core';
import { parseKeyring } from '@bursar/crypto';
import { createTestDb } from '@bursar/db/testing';
import { createPayPalClient } from '@bursar/paypal';
import { createFakePayPal } from '@bursar/paypal-fake';
import { standardPolicy } from '@bursar/policy';
import { createCoreLab, policyBook } from '../src';

const bytes = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => seed + i);

/** One database and one fake PayPal for a whole lab run. Each scenario gets its own organisation and mission. */
export async function labWorld() {
  const { db, close } = await createTestDb();
  let clock = new Date('2026-10-05T12:00:00Z');
  const fake = createFakePayPal({ now: () => clock });
  const paypal = createPayPalClient({
    clientId: fake.config.clientId,
    clientSecret: fake.config.clientSecret,
    baseUrl: 'https://fake.paypal.test',
    fetch: fake.fetch,
    sleep: async () => undefined,
    maxRetries: 0,
  });
  const book = policyBook(standardPolicy());
  const core = createCore({
    db,
    paypal,
    vaultKeys: parseKeyring(Buffer.from(bytes(1)).toString('hex')),
    approvalKey: bytes(40),
    provenanceKeys: [bytes(80)],
    webhookId: 'WH-0001',
    now: () => clock,
    policyFor: book.policyFor as never,
  });
  await paypal.webhooks.register({
    requestId: 'hook',
    url: 'https://app.test/webhooks/paypal',
    eventTypes: WEBHOOK_EVENT_TYPES,
  });
  const makeEnv = createCoreLab({
    core,
    db,
    book,
    advance: (minutes) => {
      clock = new Date(clock.getTime() + minutes * 60_000);
    },
  });
  return { makeEnv, close };
}
