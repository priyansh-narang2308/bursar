import { cartHash, verifyApproval } from '@bursar/crypto';
import {
  actions,
  approvals,
  cartLines,
  carts,
  decisions,
  deliveries,
  envelopes,
  mandates,
  missions,
  offers,
  suppliers,
  type Tx,
} from '@bursar/db';
import { hashPolicy, type Policy } from '@bursar/policy';
import type { JsonObject, JsonValue, OrganizationId } from '@bursar/schemas';
import { and, countDistinct, eq, gt, inArray, ne } from 'drizzle-orm';
import type { CoreDeps } from './types';
import { amountJson } from './util';

export type ActionRow = typeof actions.$inferSelect;
const HOUR = 3_600_000;
/** After goods are inspected, a payout waits this long in case of a dispute. */
export const COOLING_OFF_HOURS = 24;

/**
 * An authorization reserves its amount when it is approved. When it is asked again at the moment of execution
 * that reservation is already in the envelope's held figure, so it must not be counted a second time.
 */
const ownReservation = (action: ActionRow): bigint =>
  action.type === 'AUTHORIZE' && action.state === 'SUBMITTING' ? (action.amountMinor ?? 0n) : 0n;

/** A cart read back from the database in the shape its hash is made from. */
export async function loadCart(tx: Tx, cartId: string) {
  const [cart] = await tx
    .select()
    .from(carts)
    .where(eq(carts.id, cartId as never));
  if (cart === undefined) return undefined;
  const rows = await tx
    .select({ line: cartLines, offer: offers, supplier: suppliers })
    .from(cartLines)
    .innerJoin(offers, eq(offers.id, cartLines.offerId))
    .innerJoin(suppliers, eq(suppliers.id, offers.supplierId))
    .where(eq(cartLines.cartId, cart.id));
  const content = {
    id: cart.id,
    orgId: cart.orgId,
    missionId: cart.missionId,
    version: cart.version,
    total: amountJson(cart.totalMinor, cart.currency),
    lines: rows.map(({ line }) => ({
      id: line.id,
      offerId: line.offerId,
      quantity: line.quantity,
      unitPrice: amountJson(line.unitPriceMinor, cart.currency),
      lineTotal: amountJson(line.lineTotalMinor, cart.currency),
      rationale: line.rationale,
    })),
  };
  return { cart, rows, content, hash: cartHash(content) };
}

async function payoutFacts(tx: Tx, action: ActionRow): Promise<JsonValue> {
  if (action.type !== 'PAYOUT' || action.cartId === null || action.supplierId === null) return null;
  const [delivery] = await tx
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.cartId, action.cartId), eq(deliveries.supplierId, action.supplierId)));
  if (delivery === undefined) return null;
  const [capture] = await tx
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.cartId, action.cartId),
        eq(actions.type, 'CAPTURE'),
        eq(actions.state, 'CONFIRMED'),
      ),
    );
  const inspectedAt = delivery.inspectedAt ?? new Date(0);
  return {
    inspected: delivery.status === 'INSPECTED',
    coolingOffEndsAt: new Date(inspectedAt.getTime() + COOLING_OFF_HOURS * HOUR).toISOString(),
    captureSettled: capture !== undefined,
  };
}

async function priorPayouts(tx: Tx, supplierId: string): Promise<number> {
  const [row] = await tx
    .select({ n: countDistinct(actions.id) })
    .from(actions)
    .innerJoin(cartLines, eq(cartLines.cartId, actions.cartId))
    .innerJoin(offers, eq(offers.id, cartLines.offerId))
    .where(
      and(
        eq(offers.supplierId, supplierId as never),
        eq(actions.state, 'CONFIRMED'),
        eq(actions.type, 'CAPTURE'),
      ),
    );
  return row?.n ?? 0;
}

/** Orders in the last day, one entry per supplier, for the duplicate and velocity rules. */
async function recentOrders(tx: Tx, action: ActionRow, now: Date): Promise<JsonValue[]> {
  const since = new Date(now.getTime() - 24 * HOUR);
  const rows = await tx
    .select({ action: actions, line: cartLines, offer: offers, supplier: suppliers })
    .from(actions)
    .innerJoin(cartLines, eq(cartLines.cartId, actions.cartId))
    .innerJoin(offers, eq(offers.id, cartLines.offerId))
    .innerJoin(suppliers, eq(suppliers.id, offers.supplierId))
    .where(
      and(
        eq(actions.type, 'AUTHORIZE'),
        ne(actions.id, action.id),
        action.cartId === null ? undefined : ne(actions.cartId, action.cartId),
        gt(actions.createdAt, since),
        inArray(actions.state, [
          'APPROVED',
          'AWAITING_APPROVAL',
          'SUBMITTING',
          'SUBMITTED',
          'CONFIRMED',
        ]),
      ),
    );
  const groups = new Map<
    string,
    {
      at: string;
      supplierId: string;
      payee: string;
      offerIds: string[];
      minor: bigint;
      currency: string;
    }
  >();
  for (const { action: a, line, offer, supplier } of rows) {
    const key = `${a.id}/${supplier.id}`;
    const group = groups.get(key) ?? {
      at: a.createdAt.toISOString(),
      supplierId: supplier.id,
      payee: supplier.payoutEmail,
      offerIds: [],
      minor: 0n,
      currency: offer.currency,
    };
    group.offerIds.push(offer.id);
    group.minor += line.lineTotalMinor;
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({
    at: g.at,
    supplierId: g.supplierId,
    payee: g.payee,
    offerIds: g.offerIds,
    amount: amountJson(g.minor, g.currency),
  }));
}

/** The approvals for an action, each checked against what the server holds now. */
async function approvalFacts(
  tx: Tx,
  deps: CoreDeps,
  action: ActionRow,
  currentCartHash: string | undefined,
  policy: Policy,
): Promise<JsonValue[]> {
  const rows = await tx
    .select({ approval: approvals })
    .from(approvals)
    .innerJoin(decisions, eq(decisions.id, approvals.decisionId))
    .where(eq(decisions.actionId, action.id));
  const currentPolicyHash = hashPolicy(policy);
  return rows.map(({ approval: a }) => {
    const signed =
      a.signature !== null && a.approverId !== null
        ? verifyApproval(
            deps.approvalKey,
            {
              approvalId: a.id,
              decisionId: a.decisionId,
              approverId: a.approverId as never,
              cartHash: a.cartHash as never,
              policyHash: a.policyHash as never,
              expiresAt: a.expiresAt.toISOString(),
            },
            a.signature,
            deps.now(),
          )
        : { valid: false as const, reason: 'bad-signature' as const };
    return {
      id: a.id,
      approverId: a.approverId ?? '',
      status: a.status,
      expiresAt: a.expiresAt.toISOString(),
      signatureValid: signed.valid || signed.reason === 'expired',
      cartHashMatches: a.cartHash === currentCartHash,
      policyHashMatches: a.policyHash === currentPolicyHash,
    };
  });
}

/**
 * Everything the policy rules may look at, read from the server's own records. Nothing here comes from the
 * caller: not the amount, not the prices, not who has approved.
 */
export async function buildContext(
  tx: Tx,
  deps: CoreDeps,
  orgId: OrganizationId,
  action: ActionRow,
  policy: Policy,
): Promise<JsonObject> {
  const now = deps.now();
  const [mission] =
    action.missionId === null
      ? []
      : await tx.select().from(missions).where(eq(missions.id, action.missionId));
  const [envelope] =
    action.missionId === null
      ? []
      : await tx.select().from(envelopes).where(eq(envelopes.missionId, action.missionId));
  const [mandate] =
    envelope === undefined
      ? []
      : await tx.select().from(mandates).where(eq(mandates.id, envelope.mandateId));
  const cart = action.cartId === null ? undefined : await loadCart(tx, action.cartId);
  const supplierIds = [...new Set(cart?.rows.map((r) => r.supplier.id) ?? [])];
  return {
    now: now.toISOString(),
    orgId,
    action: {
      type: action.type,
      orgId: action.orgId,
      proposedBy: action.proposedBy,
      proposerId: action.proposerId,
      agentRunId: action.proposedBy === 'AGENT' ? action.proposerId : null,
      amount:
        action.amountMinor === null || action.currency === null
          ? null
          : amountJson(action.amountMinor, action.currency),
      supplierId: action.supplierId,
    },
    mandate:
      mandate === undefined
        ? null
        : {
            orgId: mandate.orgId,
            status: mandate.status,
            validFrom: mandate.validFrom.toISOString(),
            validTo: mandate.validTo.toISOString(),
          },
    envelope:
      envelope === undefined
        ? null
        : {
            orgId: envelope.orgId,
            ceiling: amountJson(envelope.ceilingMinor, envelope.currency),
            held: amountJson(envelope.heldMinor - ownReservation(action), envelope.currency),
            captured: amountJson(envelope.capturedMinor, envelope.currency),
          },
    cart:
      cart === undefined
        ? null
        : {
            orgId: cart.cart.orgId,
            total: amountJson(cart.cart.totalMinor, cart.cart.currency),
            deadline: mission?.deadline?.toISOString() ?? null,
            lines: cart.rows.map(({ line, offer }) => ({
              offerId: offer.id,
              supplierId: offer.supplierId,
              category: offer.category,
              quantity: line.quantity,
              unitPrice: amountJson(line.unitPriceMinor, cart.cart.currency),
              lineTotal: amountJson(line.lineTotalMinor, cart.cart.currency),
              // The offer snapshot is the quote. A live re-quote service would put a fresher price here.
              quotedUnitPrice: amountJson(offer.priceMinor, offer.currency),
              estimatedArrival: null,
            })),
          },
    suppliers: await Promise.all(
      supplierIds.map(async (id) => {
        const supplier = cart?.rows.find((r) => r.supplier.id === id)?.supplier;
        return {
          id,
          orgId: supplier?.orgId ?? orgId,
          status: supplier?.status ?? 'BLOCKED',
          payee: supplier?.payoutEmail ?? '',
          // A supplier is new when a hold is placed. The capture that follows was vetted with it.
          priorPayouts: action.type === 'AUTHORIZE' ? await priorPayouts(tx, id) : 1,
        };
      }),
    ),
    recent: await recentOrders(tx, action, now),
    approvals: await approvalFacts(tx, deps, action, cart?.hash, policy),
    payout: await payoutFacts(tx, action),
  } as JsonObject;
}
