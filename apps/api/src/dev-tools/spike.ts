import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Actor, createCore } from '@bursar/core';
import { decodeKey, decryptSecret, parseKeyring } from '@bursar/crypto';
import { executions, organizations, users, withOrg } from '@bursar/db';
import { createTestDb } from '@bursar/db/testing';
import { createPayPalClient } from '@bursar/paypal';
import { standardPolicy } from '@bursar/policy';
import { newId } from '@bursar/schemas';
import { eq } from 'drizzle-orm';

/*
 * One real purchase on PayPal's sandbox, end to end, through the same money loop the product uses: place a
 * hold on a pooled buyer's PayPal, capture it, refund it. It prints each step and PayPal's debug id, never a
 * token. Needs the sandbox keys in .env and a buyer in the pool (`pnpm dev:payer`). Sandbox money only.
 */

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. It belongs in .env.`);
  return value;
};
const POOL = fileURLToPath(new URL('../../../../.bursar/payers.json', import.meta.url));
if (!existsSync(POOL)) throw new Error('The payer pool is empty. Run `pnpm dev:payer` first.');
const vaultKeys = parseKeyring(need('VAULT_ENC_KEY'));
const [first] = JSON.parse(readFileSync(POOL, 'utf8')) as { sealed: string }[];
if (!first) throw new Error('The payer pool is empty. Run `pnpm dev:payer` first.');

const usd = (cents: number) => ({ currency: 'USD' as const, minor: String(cents) });
const say = (line: string) => process.stdout.write(`${line}\n`);
const paypal = createPayPalClient({
  clientId: need('PAYPAL_CLIENT_ID'),
  clientSecret: need('PAYPAL_CLIENT_SECRET'),
  baseUrl: 'https://api-m.sandbox.paypal.com',
});
const { db, close } = await createTestDb();
// A policy for the spike alone: no first-supplier or delivery-estimate approvals, so nothing waits for a person.
const policy = standardPolicy();
const core = createCore({
  db,
  paypal,
  vaultKeys,
  approvalKey: crypto.getRandomValues(new Uint8Array(32)),
  provenanceKeys: [decodeKey(need('PROVENANCE_HMAC_KEY'))],
  webhookId: process.env['PAYPAL_WEBHOOK_ID'] ?? 'unset',
  keepVaultTokens: true,
  policyFor: () => ({
    rules: policy.rules.filter((r) => !['R-NEW-VENDOR', 'R-DELIVERY'].includes(r.rule.id)),
  }),
});

const orgId = newId('organization');
const userId = newId('user');
await db.insert(organizations).values({ id: orgId, name: 'Spike' });
await db
  .insert(users)
  .values({ id: userId, email: `${userId.toLowerCase()}@spike.test`, displayName: 'Spike' });
const owner: Actor = { kind: 'USER', id: userId };
const agent: Actor = { kind: 'AGENT', id: 'agt_spike' };
const now = Date.now();
const mandate = await core.mandates.adopt(orgId, owner, {
  payerName: 'Pooled sandbox buyer',
  cap: usd(100_000),
  perMissionCap: usd(50_000),
  validFrom: new Date(now - 86_400_000),
  validTo: new Date(now + 86_400_000),
  paymentTokenId: decryptSecret(vaultKeys, first.sealed, 'payer-pool'),
});
const supplier = await core.catalog.createSupplier(orgId, owner, {
  name: 'spike.example',
  payoutEmail: process.env['PAYPAL_SUPPLIER_1_EMAIL'] ?? 'supplier@example.com',
});
const offer = await core.catalog.recordOffer(orgId, {
  supplierId: supplier?.id as never,
  title: 'Spike item',
  category: 'Test',
  url: 'https://spike.example/item',
  price: usd(1_200),
});
const mission = await core.catalog.createMission(orgId, owner, {
  goal: 'Spike',
  budget: usd(10_000),
  mandateId: mandate.mandateId,
});
const cart = await core.catalog.buildCart(orgId, agent, mission?.id as never, [
  { offerId: offer?.id as never, quantity: 1 },
]);
const ref = { missionId: mission?.id as never, cartId: cart.cartId as never };

async function step(type: 'AUTHORIZE' | 'CAPTURE' | 'REFUND') {
  const proposal = await core.actions.propose(orgId, agent, { type, ...ref });
  say(`${type.padEnd(9)} ruling: ${proposal.outcome} (${proposal.state})`);
  if (proposal.state !== 'APPROVED') throw new Error(`Not approved: ${proposal.explanation}`);
  const result = await core.actions.execute(orgId, proposal.actionId);
  say(`${''.padEnd(9)} PayPal: ${result.outcome} -> ${result.state}`);
  const rows = await withOrg(db, orgId, (tx) =>
    tx.select().from(executions).where(eq(executions.actionId, proposal.actionId)),
  );
  for (const r of rows)
    say(`${''.padEnd(9)} call ${r.step}: ${r.status}${r.debugId ? `, debug id ${r.debugId}` : ''}`);
  return { proposal, result };
}

try {
  say('A $12.00 purchase on PayPal sandbox, through the money loop:\n');
  await step('AUTHORIZE');
  const capture = await step('CAPTURE');
  // No public webhook address here, so ask PayPal whether the capture went through.
  for (let i = 0; i < 6 && capture.result.state !== 'CONFIRMED'; i++) {
    await new Promise((r) => setTimeout(r, 3_000));
    const confirmed = await core.webhooks.pollSubmitted(orgId, 0);
    say(`${''.padEnd(9)} checked with PayPal: ${confirmed} confirmed`);
    if (confirmed > 0) break;
  }
  await step('REFUND');
  say('\nDone. Sandbox money only.');
} finally {
  await close();
}
process.exit(0);
