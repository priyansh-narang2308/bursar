import type { Actor, Core } from '@bursar/core';
import { type Db, organizations, users } from '@bursar/db';
import type { Policy } from '@bursar/policy';
import { newId, type OrganizationId } from '@bursar/schemas';
import { buildPolicy, type LabEnv, type PolicyConfig, type Scenario } from './index';

const usd = (cents: number) => ({ currency: 'USD' as const, minor: String(cents) });

/** Which policy each lab organisation runs under. The core asks `policyFor` for every ruling it makes. */
export function policyBook(fallback: Policy) {
  const configs = new Map<string, PolicyConfig>();
  return {
    set: (orgId: string, config: PolicyConfig) => void configs.set(orgId, config),
    policyFor: (orgId: string): Policy => {
      const config = configs.get(orgId);
      return config === undefined ? fallback : buildPolicy(config);
    },
  };
}
export type PolicyBook = ReturnType<typeof policyBook>;

/**
 * Plays scenarios through the real decision pipeline: each one gets its own organisation, mandate and mission,
 * and each order is a real cart and a real proposal. Nothing goes to PayPal (an order is only ever proposed),
 * so the mandate adopts a placeholder token. `advance` moves the clock between orders, so a day's limit means a day.
 */
export function createCoreLab(deps: {
  core: Core;
  db: Db;
  book: PolicyBook;
  advance: (minutes: number) => void;
}) {
  const { core, db, book } = deps;
  return async function makeEnv(config: PolicyConfig, scenario?: Scenario): Promise<LabEnv> {
    const orgId: OrganizationId = newId('organization');
    await db.insert(organizations).values({ id: orgId, name: 'Lab' });
    book.set(orgId, config);
    const userId = newId('user');
    await db
      .insert(users)
      .values({ id: userId, email: `${userId.toLowerCase()}@lab.test`, displayName: 'Lab' });
    const owner: Actor = { kind: 'USER', id: userId };
    const agent: Actor = { kind: 'AGENT', id: 'agt_lab' };
    const now = Date.now();
    const mandate = await core.mandates.adopt(orgId, owner, {
      payerName: 'Lab',
      cap: usd(100_000_000),
      perMissionCap: usd(50_000_000),
      validFrom: new Date(now - 86_400_000),
      validTo: new Date(now + 3_650 * 86_400_000),
      paymentTokenId: 'lab-token',
    });
    const mission = await core.catalog.createMission(orgId, owner, {
      goal: 'Lab',
      budget: usd(scenario?.budgetCents ?? 5_000_000),
      mandateId: mandate.mandateId,
    });
    const suppliers = new Map<string, string>();
    const offers = new Map<string, string>();
    return {
      async order(step) {
        deps.advance(step.afterMinutes);
        let supplierId = suppliers.get(step.supplier);
        if (supplierId === undefined) {
          const made = await core.catalog.createSupplier(orgId, owner, {
            name: step.supplier,
            payoutEmail: `${step.supplier.toLowerCase()}@example.com`,
          });
          supplierId = made?.id ?? '';
          suppliers.set(step.supplier, supplierId);
        }
        // The same item again is the same offer, so a repeated order really is a repeat.
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
        const outcome =
          proposal.outcome === 'ALLOW' || proposal.outcome === 'DENY'
            ? proposal.outcome
            : 'REQUIRE_APPROVAL';
        return { outcome, amountCents: step.unitCents * step.quantity, note: proposal.explanation };
      },
    };
  };
}
