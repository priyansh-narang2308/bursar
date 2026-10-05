import { provenanceTag } from '@bursar/crypto';
import { actions, envelopes, executions, mandates, type Tx, withOrg } from '@bursar/db';
import { PayPalError } from '@bursar/paypal';
import type { OrganizationId } from '@bursar/schemas';
import { and, eq } from 'drizzle-orm';
import { record } from './audit';
import { confirm } from './confirm';
import type { ActionRow } from './context';
import { openIncident } from './incidents';
import { openVaultToken } from './mandates';
import { adjustHeld, rule, setState } from './pipeline';
import type { Actor, CoreDeps } from './types';
import { amountJson, money, requestIdFor } from './util';
import { settleEarly } from './webhooks';

const SYSTEM: Actor = { kind: 'SYSTEM', id: null };

export interface ExecuteResult {
  /** What happened: `noop` means the action was not in a state to be executed (a double submit lands here). */
  readonly outcome:
    | 'confirmed'
    | 'submitted'
    | 'failed'
    | 'denied'
    | 'unknown'
    | 'deferred'
    | 'noop';
  readonly state: string;
  readonly error?: { readonly kind: string; readonly debugId?: string | undefined };
}

type Call = () => Promise<string>;
type Plan = { readonly step: string; readonly requestId: string; readonly call: Call };

/** What to ask PayPal for, built from the server's records. Nothing about it comes from the caller. */
async function plan(
  tx: Tx,
  deps: CoreDeps,
  orgId: OrganizationId,
  action: ActionRow,
): Promise<Plan> {
  const [envelope] =
    action.missionId === null
      ? []
      : await tx.select().from(envelopes).where(eq(envelopes.missionId, action.missionId));
  const amount = money(action.amountMinor ?? 0n, action.currency ?? 'USD');
  const step = action.type.toLowerCase();
  const requestId = requestIdFor(action.idempotencyKey, step);
  const { paypal } = deps;
  const authorizationId = envelope?.paypalAuthorizationId ?? '';
  if (action.type === 'AUTHORIZE') {
    const [mandate] =
      envelope === undefined
        ? []
        : await tx.select().from(mandates).where(eq(mandates.id, envelope.mandateId));
    const sealed = mandate?.vaultTokenSealed;
    if (mandate === undefined || sealed === null || sealed === undefined)
      throw new PayPalError('rejected', 'The mandate has no payment token.');
    return {
      step,
      requestId,
      call: async () => {
        const order = await paypal.orders.createAuthorizeOrder({
          requestId,
          vaultId: openVaultToken(deps, mandate.id, sealed),
          amount,
          referenceId: action.id,
          customId: provenanceTag(deps.provenanceKeys[0] as Uint8Array, {
            orgId,
            actionId: action.id as never,
            amount: amountJson(amount.minor, amount.currency),
          }),
        });
        const id =
          order.authorizationId ??
          (
            await paypal.orders.authorize({
              requestId: requestIdFor(action.idempotencyKey, 'order-authorize'),
              orderId: order.id,
            })
          ).authorizationId;
        if (id === undefined)
          throw new PayPalError('invalid', 'PayPal did not return an authorization.');
        return id;
      },
    };
  }
  if (action.type === 'CAPTURE')
    return {
      step,
      requestId,
      call: async () =>
        (await paypal.payments.capture({ requestId, authorizationId, amount, finalCapture: true }))
          .id,
    };
  if (action.type === 'VOID')
    return {
      step,
      requestId,
      call: async () => {
        await paypal.payments.void({ requestId, authorizationId });
        return authorizationId;
      },
    };
  const [capture] =
    action.compensatesActionId === null
      ? []
      : await tx
          .select()
          .from(executions)
          .where(
            and(
              eq(executions.actionId, action.compensatesActionId),
              eq(executions.step, 'capture'),
            ),
          );
  return {
    step,
    requestId,
    call: async () =>
      (
        await paypal.payments.refund({
          requestId,
          captureId: capture?.paypalResourceId ?? '',
          amount,
        })
      ).id,
  };
}

const release = async (tx: Tx, action: ActionRow): Promise<void> => {
  if (action.type === 'AUTHORIZE' && action.missionId !== null && action.amountMinor !== null) {
    await adjustHeld(tx, action.missionId, -action.amountMinor);
  }
};

/** Wins the right to run an approved action, then asks the policy again, now, with the money about to move. */
async function startClaim(
  tx: Tx,
  deps: CoreDeps,
  orgId: OrganizationId,
  found: ActionRow,
): Promise<ExecuteResult | undefined> {
  const [won] = await tx
    .update(actions)
    .set({ state: 'SUBMITTING', updatedAt: deps.now() })
    .where(and(eq(actions.id, found.id), eq(actions.state, 'APPROVED')))
    .returning();
  if (won === undefined) return { outcome: 'noop', state: 'SUBMITTING' };
  found.state = 'SUBMITTING';
  await record(tx, orgId, SYSTEM, 'action.submitting', { actionId: found.id }, deps.now());
  const { evaluation } = await rule(tx, deps, orgId, found, 'EXECUTE');
  if (evaluation.outcome === 'ALLOW') return undefined;
  await release(tx, found);
  await setState(tx, deps, orgId, found, 'DENIED', SYSTEM, { phase: 'EXECUTE' });
  return { outcome: 'denied', state: 'DENIED' };
}

/** Claims an approved action (so nobody else can run it), or picks up one whose outcome was unknown. */
async function claim(
  deps: CoreDeps,
  orgId: OrganizationId,
  actionId: string,
): Promise<{ action: ActionRow; plan: Plan } | ExecuteResult> {
  return withOrg(deps.db, orgId, async (tx) => {
    const [found] = await tx
      .select()
      .from(actions)
      .where(eq(actions.id, actionId as never));
    if (found === undefined || (found.state !== 'APPROVED' && found.state !== 'UNKNOWN'))
      return { outcome: 'noop', state: found?.state ?? 'MISSING' } as const;
    const stopped =
      found.state === 'APPROVED' ? await startClaim(tx, deps, orgId, found) : undefined;
    if (stopped !== undefined) return stopped;
    const chosen = await plan(tx, deps, orgId, found);
    await tx
      .insert(executions)
      .values({ orgId, actionId: found.id, step: chosen.step, requestId: chosen.requestId })
      .onConflictDoNothing();
    return { action: found, plan: chosen };
  });
}

type Scope = {
  tx: Tx;
  deps: CoreDeps;
  orgId: OrganizationId;
  action: ActionRow;
  where: ReturnType<typeof and>;
};

async function succeeded(
  { tx, deps, orgId, action, where }: Scope,
  id: string,
): Promise<ExecuteResult> {
  await tx
    .update(executions)
    .set({ status: 'SUCCEEDED', paypalResourceId: id, finishedAt: deps.now() })
    .where(where);
  if (action.type === 'AUTHORIZE' && action.missionId !== null)
    await tx
      .update(envelopes)
      .set({ paypalAuthorizationId: id })
      .where(eq(envelopes.missionId, action.missionId));
  await setState(tx, deps, orgId, action, 'SUBMITTED', SYSTEM, { resource: id });
  // A hold and a void are answered by PayPal's own response. Captures and refunds wait for the signed webhook.
  if (action.type !== 'AUTHORIZE' && action.type !== 'VOID')
    return { outcome: 'submitted', state: 'SUBMITTED' };
  await confirm(tx, deps, orgId, action, 'response');
  return { outcome: 'confirmed', state: 'CONFIRMED' };
}

async function failed(
  { tx, deps, orgId, action, where }: Scope,
  failure: PayPalError,
): Promise<ExecuteResult> {
  const { kind, debugId } = failure;
  const terminal = kind === 'declined' || kind === 'rejected';
  await tx
    .update(executions)
    .set({
      status: terminal ? 'FAILED' : 'UNKNOWN',
      debugId: debugId ?? null,
      finishedAt: deps.now(),
    })
    .where(where);
  const error = { kind, debugId };
  if (terminal && action.state === 'SUBMITTING') {
    await release(tx, action);
    await setState(tx, deps, orgId, action, 'FAILED', SYSTEM, { kind, debugId: debugId ?? null });
    return { outcome: 'failed', state: 'FAILED', error };
  }
  if (action.state === 'SUBMITTING')
    await setState(tx, deps, orgId, action, 'UNKNOWN', SYSTEM, { kind });
  await openIncident(tx, deps, orgId, 'UNKNOWN_OUTCOME', 'MEDIUM', {
    actionId: action.id,
    kind,
    debugId: debugId ?? null,
  });
  return { outcome: terminal ? 'failed' : 'unknown', state: 'UNKNOWN', error };
}

/** Writes down what PayPal said, and moves the action on. */
async function settle(
  deps: CoreDeps,
  orgId: OrganizationId,
  action: ActionRow,
  chosen: Plan,
  result: { id: string } | { error: PayPalError },
): Promise<ExecuteResult> {
  return withOrg(deps.db, orgId, async (tx) => {
    const scope = {
      tx,
      deps,
      orgId,
      action,
      where: and(eq(executions.actionId, action.id), eq(executions.step, chosen.step)),
    };
    return 'id' in result ? succeeded(scope, result.id) : failed(scope, result.error);
  });
}

/**
 * Claim, call, record. The claim is one atomic update, so of any number of simultaneous calls exactly one
 * proceeds and money moves once. The call carries a request id derived from the action, so repeating it
 * after an unknown outcome makes PayPal answer with the original result instead of acting again.
 */
export async function execute(
  deps: CoreDeps,
  orgId: OrganizationId,
  actionId: string,
): Promise<ExecuteResult> {
  if (!deps.breaker.allow()) return { outcome: 'deferred', state: 'APPROVED' };
  const claimed = await claim(deps, orgId, actionId);
  if ('outcome' in claimed) return claimed;
  const { action, plan: chosen } = claimed;
  let result: { id: string } | { error: PayPalError };
  try {
    result = { id: await chosen.call() };
    deps.breaker.success();
  } catch (error) {
    const known =
      error instanceof PayPalError
        ? error
        : new PayPalError('unknown', 'The call failed before PayPal answered.');
    if (known.kind === 'declined' || known.kind === 'rejected') deps.breaker.success();
    else deps.breaker.failure();
    result = { error: known };
  }
  const done = await settle(deps, orgId, action, chosen, result);
  if (done.outcome === 'submitted') await settleEarly(deps, action.id);
  return done;
}
