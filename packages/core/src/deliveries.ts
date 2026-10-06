import { deliveries, withOrg } from '@bursar/db';
import type { CartId, OrganizationId, SupplierId } from '@bursar/schemas';
import { record } from './audit';
import { type Actor, type CoreDeps, CoreError } from './types';

/**
 * Records that goods arrived, were inspected, or were rejected. Only a person inspects. A payout to the
 * supplier waits for INSPECTED, and then for the cooling-off window.
 */
export async function recordDelivery(
  deps: CoreDeps,
  orgId: OrganizationId,
  actor: Actor,
  input: { cartId: CartId; supplierId: SupplierId; status: 'DELIVERED' | 'INSPECTED' | 'REJECTED' },
) {
  if (input.status !== 'DELIVERED' && actor.kind !== 'USER')
    throw new CoreError('FORBIDDEN', 'Only a person inspects goods.');
  const now = deps.now();
  return withOrg(deps.db, orgId, async (tx) => {
    const stamps = {
      status: input.status,
      ...(input.status === 'DELIVERED' ? { deliveredAt: now } : { inspectedAt: now }),
    };
    const [row] = await tx
      .insert(deliveries)
      .values({ orgId, cartId: input.cartId, supplierId: input.supplierId, ...stamps })
      .onConflictDoUpdate({ target: [deliveries.cartId, deliveries.supplierId], set: stamps })
      .returning();
    await record(
      tx,
      orgId,
      actor,
      `delivery.${input.status.toLowerCase()}`,
      { cartId: input.cartId, supplierId: input.supplierId },
      now,
    );
    return row;
  });
}
