import { appendEvent, genesisHead } from '@bursar/audit';
import { auditEvents, outbox, type Tx } from '@bursar/db';
import { type JsonObject, newId, type OrganizationId } from '@bursar/schemas';
import { desc, eq } from 'drizzle-orm';
import type { Actor } from './types';

/** Appends to the organisation's audit chain, in the caller's transaction. The unique `(org, seq)` refuses a racing append. */
export async function record(
  tx: Tx,
  orgId: OrganizationId,
  actor: Actor,
  type: string,
  payload: JsonObject,
  now: Date,
): Promise<void> {
  const [last] = await tx
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.orgId, orgId))
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  const head = last === undefined ? genesisHead(orgId) : { orgId, seq: last.seq, hash: last.hash };
  const event = appendEvent(head, {
    id: newId('auditEvent'),
    ts: now.toISOString(),
    actor: { kind: actor.kind, id: actor.id },
    type,
    payload,
  });
  await tx.insert(auditEvents).values({ ...event, actorKind: actor.kind, actorId: actor.id });
}

/** Announces a change, in the same transaction as the change, for streams and workers to relay. */
export async function emit(
  tx: Tx,
  orgId: OrganizationId,
  topic: string,
  payload: JsonObject,
): Promise<void> {
  await tx.insert(outbox).values({ orgId, topic, payload });
}
