import { createHash } from 'node:crypto';
import { newId, type OrganizationId } from '@bursar/schemas';
import type { SQL } from 'drizzle-orm';
import { expect } from 'vitest';
import {
  actions,
  approvals,
  cartLines,
  carts,
  type Db,
  decisions,
  mandates,
  missions,
  offers,
  organizations,
  payers,
  type paypalEvents,
  policySets,
  policyVersions,
  suppliers,
  users,
} from '../src';

/** The rows a raw query returns (both drivers put them in `rows`). */
export async function query<T = unknown>(db: Db, statement: SQL): Promise<T[]> {
  return ((await db.execute(statement)) as { rows: T[] }).rows;
}

export const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** Awaits a promise that must fail, and checks the database said why. */
export async function rejects(promise: Promise<unknown>, reason: RegExp): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'the database should have refused this').toBeDefined();
  const text = [error, (error as { cause?: unknown }).cause]
    .map((e) => String((e as Error)?.message ?? e))
    .join(' ');
  expect(text).toMatch(reason);
}

/** An organisation with a mission, which is what most tests need to exist. */
export async function seedOrg(db: Db): Promise<OrganizationId> {
  const id = newId('organization');
  await db.insert(organizations).values({ id, name: 'Acme' });
  await db.insert(missions).values(MONEY.mission(id));
  return id;
}

const NOW = new Date('2026-10-05T12:00:00Z');
const LATER = new Date('2026-12-05T12:00:00Z');

export const MONEY = {
  mission: (orgId: OrganizationId = newId('organization')) => ({
    id: newId('mission'),
    orgId,
    goal: 'Office supplies',
    currency: 'USD',
    budgetMinor: 50_000n,
  }),

  action: (orgId: OrganizationId, over: Partial<typeof actions.$inferInsert> = {}) =>
    ({
      id: newId('action'),
      orgId,
      type: 'CAPTURE',
      currency: 'USD',
      amountMinor: 1_250n,
      proposedBy: 'AGENT',
      idempotencyKey: sha(newId('action')),
      ...over,
    }) as typeof actions.$inferInsert,

  envelope: (orgId: OrganizationId, missionId: string, mandateId: string) => ({
    id: newId('envelope'),
    orgId,
    missionId: missionId as never,
    mandateId: mandateId as never,
    currency: 'USD',
    ceilingMinor: 10_000n,
  }),

  /** A mission and a mandate (with the payer and policy set it needs) for an organisation. */
  async fundedMission(db: Db, orgId: OrganizationId) {
    const [mission] = await db.insert(missions).values(MONEY.mission(orgId)).returning();
    const mandate = await MONEY.mandate(db, orgId, {});
    return [mission?.id ?? '', mandate] as const;
  },

  async mandate(db: Db, orgId: OrganizationId, over: Partial<typeof mandates.$inferInsert>) {
    const [payer] = await db
      .insert(payers)
      .values({
        id: newId('payer'),
        orgId,
        paypalPayerId: `P-${newId('payer')}`,
        displayName: 'Pat',
      })
      .returning();
    const [policySet] = await db
      .insert(policySets)
      .values({ id: newId('policySet'), orgId, name: 'default' })
      .returning();
    const [mandate] = await db
      .insert(mandates)
      .values({
        id: newId('mandate'),
        orgId,
        payerId: payer?.id as never,
        policySetId: policySet?.id as never,
        currency: 'USD',
        capMinor: 100_000n,
        perMissionCapMinor: 50_000n,
        validFrom: NOW,
        validTo: LATER,
        ...over,
      })
      .returning();
    return mandate?.id ?? '';
  },

  async cartLine(db: Db, orgId: OrganizationId, over: Partial<typeof cartLines.$inferInsert>) {
    const [mission] = await db.insert(missions).values(MONEY.mission(orgId)).returning();
    const [supplier] = await db
      .insert(suppliers)
      .values({ id: newId('supplier'), orgId, name: 'S', payoutEmail: 's@example.com' })
      .returning();
    const [offer] = await db
      .insert(offers)
      .values({
        id: newId('offer'),
        orgId,
        supplierId: supplier?.id as never,
        title: 'Pen',
        category: 'office',
        url: 'https://example.com/pen',
        currency: 'USD',
        priceMinor: 100n,
        availability: 'IN_STOCK',
        source: 'DETAIL',
        observedAt: NOW,
      })
      .returning();
    const [cart] = await db
      .insert(carts)
      .values({
        id: newId('cart'),
        orgId,
        missionId: mission?.id as never,
        version: 1,
        currency: 'USD',
        totalMinor: 200n,
        cartHash: sha('cart'),
      })
      .returning();
    return db.insert(cartLines).values({
      id: newId('cartLine'),
      orgId,
      cartId: cart?.id as never,
      offerId: offer?.id as never,
      quantity: 2,
      unitPriceMinor: 100n,
      lineTotalMinor: 200n,
      ...over,
    });
  },

  async approval(db: Db, orgId: OrganizationId, over: Partial<typeof approvals.$inferInsert>) {
    const [action] = await db.insert(actions).values(MONEY.action(orgId)).returning();
    const [version] = await db
      .insert(policyVersions)
      .values({
        id: newId('policyVersion'),
        orgId,
        policySetId: (
          await db
            .insert(policySets)
            .values({ id: newId('policySet'), orgId, name: 'p' })
            .returning()
        )[0]?.id as never,
        version: 1,
        hash: sha('policy'),
        content: {},
      })
      .returning();
    const [decision] = await db
      .insert(decisions)
      .values({
        id: newId('decision'),
        orgId,
        actionId: action?.id as never,
        policyVersionId: version?.id as never,
        policyHash: sha('policy'),
        phase: 'PROPOSE',
        outcome: 'REQUIRE_APPROVAL',
        requiredApprovals: 1,
        trace: [],
        inputsHash: sha('inputs'),
        evaluatedAt: NOW,
      })
      .returning();
    const [person] = await db
      .insert(users)
      .values({
        id: newId('user'),
        email: `${newId('user')}@example.com`.toLowerCase(),
        displayName: 'Ann',
      })
      .returning();
    return db.insert(approvals).values({
      id: newId('approval'),
      orgId,
      decisionId: decision?.id as never,
      approverId: person?.id as never,
      cartHash: sha('cart'),
      policyHash: sha('policy'),
      expiresAt: LATER,
      decidedAt: NOW,
      ...over,
    });
  },

  paypalEvent: (orgId: OrganizationId) =>
    ({
      id: newId('paypalEvent'),
      orgId,
      eventId: `WH-${newId('paypalEvent')}`,
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
      resourceType: 'capture',
      resourceId: 'CAP-1',
      payload: {},
    }) as typeof paypalEvents.$inferInsert,
};
