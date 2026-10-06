import { cartHash } from '@bursar/crypto';
import { cartLines, carts, missions, offers, suppliers, withOrg } from '@bursar/db';
import { Money } from '@bursar/money';
import {
  type AmountJSON,
  type MissionId,
  newId,
  type OfferId,
  type OrganizationId,
  type SupplierId,
} from '@bursar/schemas';
import { and, eq, inArray, max } from 'drizzle-orm';
import { record } from './audit';
import { type Actor, type CoreDeps, CoreError } from './types';
import { amountJson, money } from './util';

export async function createSupplier(
  deps: CoreDeps,
  orgId: OrganizationId,
  actor: Actor,
  input: { name: string; payoutEmail: string },
) {
  return withOrg(deps.db, orgId, async (tx) => {
    const [supplier] = await tx
      .insert(suppliers)
      .values({ id: newId('supplier'), orgId, ...input })
      .returning();
    await record(
      tx,
      orgId,
      actor,
      'supplier.created',
      { supplierId: supplier?.id ?? '' },
      deps.now(),
    );
    return supplier;
  });
}

export interface OfferInput {
  readonly supplierId: SupplierId;
  readonly title: string;
  readonly category: string;
  readonly url: string;
  readonly price: AmountJSON;
  readonly availability?: 'IN_STOCK' | 'LIMITED' | 'OUT_OF_STOCK' | 'UNKNOWN' | undefined;
  readonly source?: 'SEARCH' | 'DETAIL' | undefined;
  /** The catalog's own id for the product, so a later re-quote can find it. */
  readonly quoteId?: string | undefined;
  readonly brand?: string | undefined;
  readonly imageUrl?: string | undefined;
}

/** A frozen price quote. Carts use these, never a live price. */
export async function recordOffer(deps: CoreDeps, orgId: OrganizationId, input: OfferInput) {
  const price = money(BigInt(input.price.minor), input.price.currency);
  return withOrg(deps.db, orgId, async (tx) => {
    const [offer] = await tx
      .insert(offers)
      .values({
        id: newId('offer'),
        orgId,
        supplierId: input.supplierId,
        title: input.title,
        category: input.category,
        url: input.url,
        currency: price.currency,
        priceMinor: price.minor,
        availability: input.availability ?? 'IN_STOCK',
        source: input.source ?? 'DETAIL',
        quoteId: input.quoteId ?? null,
        brand: input.brand ?? null,
        imageUrl: input.imageUrl ?? null,
        observedAt: deps.now(),
      })
      .returning();
    return offer;
  });
}

export async function createMission(
  deps: CoreDeps,
  orgId: OrganizationId,
  actor: Actor,
  input: {
    goal: string;
    budget: AmountJSON;
    deadline?: Date | undefined;
    mandateId?: string | undefined;
  },
) {
  const budget = money(BigInt(input.budget.minor), input.budget.currency);
  return withOrg(deps.db, orgId, async (tx) => {
    const [mission] = await tx
      .insert(missions)
      .values({
        id: newId('mission'),
        orgId,
        goal: input.goal,
        currency: budget.currency,
        budgetMinor: budget.minor,
        ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
        ...(input.mandateId === undefined ? {} : { mandateId: input.mandateId as never }),
      })
      .returning();
    await record(tx, orgId, actor, 'mission.created', { missionId: mission?.id ?? '' }, deps.now());
    return mission;
  });
}

export interface CartLineInput {
  readonly offerId: OfferId;
  readonly quantity: number;
  readonly rationale?: string | undefined;
}

/**
 * Builds a cart from offer snapshots. The caller (often an LLM) says which offers and how many; every
 * price, line total, the order total and the hash are worked out here from stored data. A new cart for a
 * mission is a new version and supersedes the last.
 */
export async function buildCart(
  deps: CoreDeps,
  orgId: OrganizationId,
  actor: Actor,
  missionId: MissionId,
  lines: readonly CartLineInput[],
) {
  if (lines.length === 0)
    throw new CoreError('VALIDATION_FAILED', 'A cart needs at least one line.');
  return withOrg(deps.db, orgId, async (tx) => {
    const [mission] = await tx.select().from(missions).where(eq(missions.id, missionId));
    if (mission === undefined) throw new CoreError('NOT_FOUND', 'No such mission.');
    const found = await tx
      .select()
      .from(offers)
      .where(
        inArray(
          offers.id,
          lines.map((l) => l.offerId),
        ),
      );
    const byId = new Map(found.map((o) => [o.id, o]));
    const priced = lines.map((line) => {
      const offer = byId.get(line.offerId);
      if (offer === undefined)
        throw new CoreError('UNKNOWN_REFERENCE', `No such offer ${line.offerId}.`);
      if (offer.availability === 'OUT_OF_STOCK')
        throw new CoreError('OFFER_UNAVAILABLE', `${offer.title} is out of stock.`);
      if (offer.currency !== mission.currency)
        throw new CoreError('CURRENCY_MISMATCH', 'Every offer must be in the mission currency.');
      const unit = money(offer.priceMinor, offer.currency);
      return {
        id: newId('cartLine'),
        offerId: offer.id,
        quantity: line.quantity,
        unit,
        total: unit.multiply(BigInt(line.quantity)),
        rationale: line.rationale ?? null,
      };
    });
    const total = Money.sum(
      priced.map((l) => l.total),
      money(0n, mission.currency).currency,
    );
    const [latest] = await tx
      .select({ version: max(carts.version) })
      .from(carts)
      .where(eq(carts.missionId, missionId));
    const [version, cartId] = [(latest?.version ?? 0) + 1, newId('cart')];
    const hash = cartHash({
      id: cartId,
      orgId,
      missionId,
      version,
      total: total.toJSON(),
      lines: priced.map((l) => ({
        id: l.id,
        offerId: l.offerId,
        quantity: l.quantity,
        unitPrice: l.unit.toJSON(),
        lineTotal: l.total.toJSON(),
        rationale: l.rationale,
      })),
    });
    await tx
      .update(carts)
      .set({ status: 'SUPERSEDED' })
      .where(and(eq(carts.missionId, missionId), inArray(carts.status, ['DRAFT', 'PROPOSED'])));
    await tx.insert(carts).values({
      id: cartId,
      orgId,
      missionId,
      version,
      currency: total.currency,
      totalMinor: total.minor,
      cartHash: hash,
      status: 'PROPOSED',
    });
    await tx.insert(cartLines).values(
      priced.map((l) => ({
        id: l.id,
        orgId,
        cartId,
        offerId: l.offerId,
        quantity: l.quantity,
        unitPriceMinor: l.unit.minor,
        lineTotalMinor: l.total.minor,
        rationale: l.rationale,
      })),
    );
    await record(
      tx,
      orgId,
      actor,
      'cart.proposed',
      { cartId, version, total: amountJson(total.minor, total.currency), cartHash: hash },
      deps.now(),
    );
    return { cartId, version, total: total.toJSON(), cartHash: hash };
  });
}
