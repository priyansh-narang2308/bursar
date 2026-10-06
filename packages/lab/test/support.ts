import { type Actor, createCore, WEBHOOK_EVENT_TYPES } from '@bursar/core';
import { parseKeyring } from '@bursar/crypto';
import { organizations, users } from '@bursar/db';
import { createTestDb } from '@bursar/db/testing';
import { createPayPalClient } from '@bursar/paypal';
import { createFakePayPal } from '@bursar/paypal-fake';
import { newId, type OrganizationId } from '@bursar/schemas';
import { buildPolicy, type LabEnv, type PolicyConfig, type Scenario } from '../src';

const bytes = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => seed + i);
const usd = (cents: number) => ({ currency: 'USD' as const, minor: String(cents) });

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
  const policies = new Map<string, PolicyConfig>();
  const core = createCore({
    db,
    paypal,
    vaultKeys: parseKeyring(Buffer.from(bytes(1)).toString('hex')),
    approvalKey: bytes(40),
    provenanceKeys: [bytes(80)],
    webhookId: 'WH-0001',
    now: () => clock,
    policyFor: (orgId) => buildPolicy(policies.get(orgId) ?? { without: [], overrides: {} }),
  });
  await paypal.webhooks.register({
    requestId: 'hook',
    url: 'https://app.test/webhooks/paypal',
    eventTypes: WEBHOOK_EVENT_TYPES,
  });

  /** A fresh organisation with an active mandate, running under `config`, ready to take scenario steps. */
  async function makeEnv(config: PolicyConfig, scenario?: Scenario): Promise<LabEnv> {
    const budgetCents = scenario?.budgetCents ?? 5_000_000;
    const orgId: OrganizationId = newId('organization');
    await db.insert(organizations).values({ id: orgId, name: 'Lab' });
    policies.set(orgId, config);
    const userId = newId('user');
    await db
      .insert(users)
      .values({ id: userId, email: `${userId.toLowerCase()}@example.com`, displayName: 'Lab' });
    const owner: Actor = { kind: 'USER', id: userId };
    const agent: Actor = { kind: 'AGENT', id: 'agt_lab' };
    const started = await core.mandates.start(orgId, owner, {
      payerName: 'Lab',
      cap: usd(100_000_000),
      perMissionCap: usd(50_000_000),
      validFrom: new Date('2026-10-01T00:00:00Z'),
      validTo: new Date('2100-01-01T00:00:00Z'),
      returnUrl: 'https://app.test/r',
      cancelUrl: 'https://app.test/c',
    });
    fake.approveSetupToken(started.setupTokenId);
    await core.mandates.complete(orgId, owner, started.mandateId as never);
    const mission = await core.catalog.createMission(orgId, owner, {
      goal: 'Lab',
      budget: usd(budgetCents),
      mandateId: started.mandateId,
    });
    const suppliers = new Map<string, string>();
    const offers = new Map<string, string>();
    return {
      async order(step) {
        clock = new Date(clock.getTime() + step.afterMinutes * 60_000);
        let supplierId = suppliers.get(step.supplier);
        if (supplierId === undefined) {
          supplierId =
            (
              await core.catalog.createSupplier(orgId, owner, {
                name: step.supplier,
                payoutEmail: `${step.supplier.toLowerCase()}@example.com`,
              })
            )?.id ?? '';
          suppliers.set(step.supplier, supplierId);
        }
        const key = `${step.supplier}/${step.unitCents}`;
        let offerId = offers.get(key);
        if (offerId === undefined) {
          const offer = await core.catalog.recordOffer(orgId, {
            supplierId: supplierId as never,
            title: `item ${step.unitCents}`,
            category: 'office',
            url: 'https://shop.example/i',
            price: usd(step.unitCents),
          });
          offerId = offer?.id ?? '';
          offers.set(key, offerId);
        }
        const cart = await core.catalog.buildCart(orgId, agent, mission?.id as never, [
          { offerId: offerId as never, quantity: step.quantity },
        ]);
        const proposal = await core.actions.propose(orgId, agent, {
          type: 'AUTHORIZE',
          missionId: mission?.id as never,
          cartId: cart.cartId as never,
        });
        return {
          outcome:
            proposal.outcome === 'ALLOW' || proposal.outcome === 'DENY'
              ? proposal.outcome
              : 'REQUIRE_APPROVAL',
          amountCents: step.unitCents * step.quantity,
          note: proposal.explanation,
        };
      },
    };
  }
  return { makeEnv, close };
}
