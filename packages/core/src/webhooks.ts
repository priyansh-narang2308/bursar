import { actionIdFromTag, sha256Hex, verifyProvenanceTag } from '@bursar/crypto';
import { actions, envelopes, executions, incidents, paypalEvents, webhookInbox } from '@bursar/db';
import { fromPayPalAmount } from '@bursar/money';
import { PayPalError } from '@bursar/paypal';
import { type JsonObject, newId, type OrganizationId } from '@bursar/schemas';
import { and, eq, inArray } from 'drizzle-orm';
import { confirm } from './confirm';
import type { ActionRow } from './context';
import { openIncident } from './incidents';
import type { CoreDeps } from './types';
import { amountJson } from './util';
import { contain } from './verifier';

/** The money events Bursar acts on, and the action each one should be explained by. */
const EXPECTS = {
  'PAYMENT.CAPTURE.COMPLETED': 'CAPTURE',
  'PAYMENT.CAPTURE.REFUNDED': 'REFUND',
  'PAYMENT.AUTHORIZATION.VOIDED': 'VOID',
  'PAYMENT.PAYOUTSBATCH.SUCCESS': 'PAYOUT',
} as const;

interface PayPalEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  resource: {
    id?: string;
    custom_id?: string;
    capture_id?: string;
    amount?: { currency_code: string; value: string };
    batch_header?: { payout_batch_id?: string };
  };
  create_time?: string;
}

export type IngestStatus =
  | 'duplicate'
  | 'rejected'
  | 'ignored'
  | 'processed'
  | 'parked'
  | 'unmatched'
  | 'mismatch';
type Match = 'MATCHED' | 'UNMATCHED' | 'EARLY' | 'MISMATCH';
type Db = CoreDeps['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
interface Result {
  status: Match;
  action?: ActionRow;
  orgId?: OrganizationId;
  /** An incident this event opened. The Verifier answers it once the transaction has committed. */
  incidentId?: string;
}

/** What to do with an event that does match an action of ours, by where that action has got to. */
async function settle(
  tx: Tx,
  deps: CoreDeps,
  event: PayPalEvent,
  action: ActionRow,
  orgId: OrganizationId,
): Promise<Result> {
  if (['SUBMITTING', 'APPROVED', 'UNKNOWN'].includes(action.state))
    return { status: 'EARLY', action, orgId };
  if (['SUBMITTED', 'CONFIRMED'].includes(action.state)) {
    await confirm(tx, deps, orgId, action, 'webhook');
    return { status: 'MATCHED', action, orgId };
  }
  const incidentId = await openIncident(tx, deps, orgId, 'UNEXPLAINED_MOVEMENT', 'HIGH', {
    actionId: action.id,
    why: `Money moved for an action in state ${action.state}.`,
    eventId: event.id,
  });
  return { status: 'MISMATCH', action, orgId, incidentId };
}

/** A payout event carries no tag, so it is matched by the batch id PayPal gave us when we asked for it. */
async function matchPayout(tx: Tx, deps: CoreDeps, event: PayPalEvent): Promise<Result> {
  const batchId = event.resource.batch_header?.payout_batch_id;
  const [execution] =
    batchId === undefined
      ? []
      : await tx
          .select()
          .from(executions)
          .where(and(eq(executions.step, 'payout'), eq(executions.paypalResourceId, batchId)));
  const [action] =
    execution === undefined
      ? []
      : await tx.select().from(actions).where(eq(actions.id, execution.actionId));
  return action === undefined
    ? { status: 'UNMATCHED' }
    : settle(tx, deps, event, action, action.orgId);
}

/**
 * The Verifier refunds the capture it has just found unexplained. That refund's own webhook is the Verifier's
 * doing, so it is not another incident.
 */
async function explainedByContainment(
  tx: Tx,
  orgId: OrganizationId,
  event: PayPalEvent,
  resourceId: string | null,
): Promise<boolean> {
  if (event.event_type !== 'PAYMENT.CAPTURE.REFUNDED' || resourceId === null) return false;
  const found = await tx
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.orgId, orgId),
        eq(incidents.type, 'UNEXPLAINED_MOVEMENT'),
        inArray(incidents.status, ['OPEN', 'CONTAINED']),
      ),
    );
  return found.some(
    (i) =>
      (i.evidence as { resourceId?: string; eventType?: string }).resourceId === resourceId &&
      (i.evidence as { eventType?: string }).eventType === 'PAYMENT.CAPTURE.COMPLETED',
  );
}

/** An event that matches our records but no action of ours: ours to contain, unless the Verifier itself caused it. */
async function noActionFor(
  tx: Tx,
  deps: CoreDeps,
  orgId: OrganizationId,
  event: PayPalEvent,
  seen: JsonObject & { resourceId: string | null },
  expected: string,
): Promise<Result> {
  if (await explainedByContainment(tx, orgId, event, seen.resourceId))
    return { status: 'MATCHED', orgId };
  const incidentId = await openIncident(tx, deps, orgId, 'UNEXPLAINED_MOVEMENT', 'HIGH', {
    ...seen,
    why: `Money moved (${event.event_type}) with no approved ${expected} action to explain it.`,
  });
  return { status: 'UNMATCHED', orgId, incidentId };
}

/**
 * Decides what a verified event means. Every money event must trace, through the provenance tag in its
 * `custom_id`, to an approved action of ours, for the amount we approved; anything else is an incident.
 */
async function match(tx: Tx, deps: CoreDeps, event: PayPalEvent): Promise<Result> {
  if (event.event_type === 'PAYMENT.PAYOUTSBATCH.SUCCESS') return matchPayout(tx, deps, event);
  const expected = EXPECTS[event.event_type as keyof typeof EXPECTS];
  const tag = event.resource.custom_id;
  const tagged = tag === undefined ? undefined : actionIdFromTag(tag);
  const [origin] =
    tagged === undefined ? [] : await tx.select().from(actions).where(eq(actions.id, tagged));
  if (
    origin === undefined ||
    tag === undefined ||
    origin.amountMinor === null ||
    origin.currency === null
  )
    return { status: 'UNMATCHED' };
  const orgId = origin.orgId;
  const seen = {
    actionId: origin.id,
    eventId: event.id,
    eventType: event.event_type,
    resourceId: event.resource.id ?? event.resource.capture_id ?? null,
    amount: event.resource.amount ?? null,
  };
  if (
    !verifyProvenanceTag(deps.provenanceKeys, tag, {
      orgId,
      actionId: origin.id as never,
      amount: amountJson(origin.amountMinor, origin.currency),
    })
  ) {
    const incidentId = await openIncident(tx, deps, orgId, 'UNEXPLAINED_MOVEMENT', 'HIGH', {
      ...seen,
      why: 'The provenance tag does not verify.',
    });
    return { status: 'UNMATCHED', orgId, incidentId };
  }
  const candidates =
    origin.cartId === null
      ? []
      : await tx
          .select()
          .from(actions)
          .where(and(eq(actions.cartId, origin.cartId), eq(actions.type, expected)));
  const action = candidates[0];
  if (action === undefined) return noActionFor(tx, deps, orgId, event, seen, expected);
  const reported =
    event.resource.amount === undefined
      ? undefined
      : fromPayPalAmount(event.resource.amount as never);
  if (
    reported !== undefined &&
    action.amountMinor !== null &&
    (reported.currency !== action.currency || reported.minor !== action.amountMinor)
  ) {
    const incidentId = await openIncident(tx, deps, orgId, 'AMOUNT_MISMATCH', 'HIGH', {
      ...seen,
      actionId: action.id,
      approved: amountJson(action.amountMinor, action.currency ?? ''),
      reported: { currency: reported.currency, minor: reported.minor.toString() },
    });
    return { status: 'MISMATCH', action, orgId, incidentId };
  }
  return settle(tx, deps, event, action, orgId);
}

async function store(
  tx: Tx,
  deps: CoreDeps,
  event: PayPalEvent,
  result: Result,
  rowId?: string,
): Promise<void> {
  const latency =
    event.create_time === undefined
      ? null
      : Math.max(0, deps.now().getTime() - Date.parse(event.create_time));
  const values = {
    orgId: result.orgId ?? null,
    eventType: event.event_type,
    resourceType: event.resource_type ?? 'unknown',
    resourceId:
      event.resource.id ??
      event.resource.capture_id ??
      event.resource.batch_header?.payout_batch_id ??
      'unknown',
    customId: event.resource.custom_id ?? null,
    verificationStatus: 'SUCCESS',
    matchStatus: result.status,
    matchedActionId: result.action?.id ?? null,
    latencyMs: Number.isFinite(latency) ? latency : null,
    payload: event as never,
  };
  if (rowId === undefined)
    await tx
      .insert(paypalEvents)
      .values({ id: newId('paypalEvent'), eventId: event.id, ...values } as never);
  else
    await tx
      .update(paypalEvents)
      .set(values as never)
      .where(eq(paypalEvents.id, rowId as never));
}

/**
 * Takes in a webhook: raw body first, then signature (PayPal's own verify endpoint), then dedupe, then
 * meaning. A forged or repeated delivery changes nothing. Respond 200 for every status returned here;
 * only a thrown error (PayPal could not be asked) should make PayPal deliver again. An incident opened
 * by the event is answered by the Verifier straight away.
 */
export async function ingest(
  deps: CoreDeps,
  rawBody: string,
  headers: Readonly<Record<string, string>>,
): Promise<IngestStatus> {
  let event: PayPalEvent | undefined;
  try {
    event = JSON.parse(rawBody) as PayPalEvent;
  } catch {
    event = undefined;
  }
  const eventId = event?.id ?? sha256Hex(rawBody);
  const [seen] = await deps.db.select().from(webhookInbox).where(eq(webhookInbox.eventId, eventId));
  if (seen !== undefined) return 'duplicate';
  const genuine =
    event !== undefined &&
    (await deps.paypal.webhooks.verify({ webhookId: deps.webhookId, headers, event }));
  await deps.db
    .insert(webhookInbox)
    .values({ eventId, headers, rawBody, verificationStatus: genuine ? 'SUCCESS' : 'FAILURE' })
    .onConflictDoNothing();
  if (!genuine || event === undefined) return 'rejected';
  if (!(event.event_type in EXPECTS)) return 'ignored';
  const result = await deps.db.transaction(async (tx) => {
    const found = await match(tx, deps, event);
    await store(tx, deps, event, found);
    return found;
  });
  await deps.db
    .update(webhookInbox)
    .set({ processedAt: deps.now() })
    .where(eq(webhookInbox.eventId, eventId));
  if (result.incidentId !== undefined) await contain(deps, result.incidentId);
  return (
    { MATCHED: 'processed', UNMATCHED: 'unmatched', EARLY: 'parked', MISMATCH: 'mismatch' } as const
  )[result.status];
}

/** Re-reads events that arrived before the executor had recorded its own call, now that it has. */
export async function settleEarly(deps: CoreDeps, actionId: string): Promise<number> {
  return deps.db.transaction(async (tx) => {
    const parked = await tx
      .select()
      .from(paypalEvents)
      .where(
        and(
          eq(paypalEvents.matchStatus, 'EARLY'),
          eq(paypalEvents.matchedActionId, actionId as never),
        ),
      );
    for (const row of parked)
      await store(
        tx,
        deps,
        row.payload as PayPalEvent,
        await match(tx, deps, row.payload as PayPalEvent),
        row.id,
      );
    return parked.length;
  });
}

/**
 * The fallback for a webhook that never came: asks PayPal about captures that have been submitted for a
 * while, and confirms the ones PayPal says happened. Returns how many it had to confirm this way, which
 * is also the "webhook missing" metric.
 */
export async function pollSubmitted(
  deps: CoreDeps,
  orgId: OrganizationId,
  olderThanMs: number,
): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - olderThanMs);
  return deps.db.transaction(async (tx) => {
    const waiting = await tx
      .select({ action: actions, authorizationId: envelopes.paypalAuthorizationId })
      .from(actions)
      .leftJoin(envelopes, eq(envelopes.missionId, actions.missionId))
      .where(
        and(eq(actions.orgId, orgId), eq(actions.state, 'SUBMITTED'), eq(actions.type, 'CAPTURE')),
      );
    let confirmed = 0;
    for (const { action, authorizationId } of waiting) {
      if (action.updatedAt > cutoff || !authorizationId) continue;
      const status = await deps.paypal.payments.getAuthorization(authorizationId).then(
        (a) => a.status,
        (e: unknown) => (e instanceof PayPalError ? e.kind : 'error'),
      );
      if (status === 'CAPTURED' || status === 'PARTIALLY_CAPTURED')
        confirmed += (await confirm(tx, deps, orgId, action, 'poll')) ? 1 : 0;
    }
    return confirmed;
  });
}

export const WEBHOOK_EVENT_TYPES = Object.keys(EXPECTS);
