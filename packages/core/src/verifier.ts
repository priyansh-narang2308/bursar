import { actions, envelopes, incidents, mandates, withOrg } from '@bursar/db';
import { fromPayPalAmount } from '@bursar/money';
import type { JsonObject, OrganizationId } from '@bursar/schemas';
import { and, eq } from 'drizzle-orm';
import { emit, record } from './audit';
import { execute } from './executor';
import { changeMandate } from './mandates';
import { propose } from './pipeline';
import { type Actor, type CoreDeps, CoreError } from './types';
import { requestIdFor } from './util';

const VERIFIER: Actor = { kind: 'VERIFIER', id: null };

interface Step {
  readonly step:
    | 'FREEZE_MANDATE'
    | 'VOID_AUTHORIZATIONS'
    | 'REFUND_CAPTURE'
    | 'REVOKE_VAULT_TOKEN'
    | 'NOTIFY_OWNER';
  readonly actionId: string | null;
  readonly at: string;
}

/** Asks for every hold that is still open on a mandate to be voided, as Verifier actions that go through the ordinary pipeline. */
async function voidOpenHolds(
  deps: CoreDeps,
  orgId: OrganizationId,
  mandateId: string,
): Promise<string[]> {
  const holds = await withOrg(deps.db, orgId, async (tx) => {
    const rows = await tx
      .select({ action: actions, envelope: envelopes })
      .from(actions)
      .innerJoin(envelopes, eq(envelopes.missionId, actions.missionId))
      .where(
        and(
          eq(actions.type, 'AUTHORIZE'),
          eq(actions.state, 'CONFIRMED'),
          eq(envelopes.mandateId, mandateId as never),
        ),
      );
    const done = await tx.select().from(actions).where(eq(actions.state, 'CONFIRMED'));
    return rows
      .filter(
        ({ action }) =>
          !done.some(
            (d) => d.cartId === action.cartId && (d.type === 'VOID' || d.type === 'CAPTURE'),
          ),
      )
      .map(({ action }) => action);
  });
  const voided: string[] = [];
  for (const hold of holds) {
    if (hold.missionId === null || hold.cartId === null) continue;
    const proposal = await propose(deps, orgId, VERIFIER, {
      type: 'VOID',
      missionId: hold.missionId as never,
      cartId: hold.cartId as never,
    });
    if (proposal.state === 'APPROVED') await execute(deps, orgId, proposal.actionId);
    voided.push(proposal.actionId);
  }
  return voided;
}

/**
 * The kill switch. When money has moved that no approved action explains, the Verifier acts in this order,
 * each step on its own so one failing does not stop the rest: freeze the mandate, void the open holds,
 * refund the unexplained capture, revoke the PayPal token, tell the owner. The steps are written onto the
 * incident. Only an owner can unfreeze afterwards, and only once the incident is resolved.
 */
export async function contain(deps: CoreDeps, incidentId: string): Promise<readonly Step[]> {
  const [incident] = await deps.db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId as never));
  if (incident === undefined || incident.status !== 'OPEN') return [];
  const { orgId } = incident;
  const evidence = incident.evidence as JsonObject;
  const steps: Step[] = [];
  const note = (step: Step['step'], actionId: string | null = null) =>
    steps.push({ step, actionId, at: deps.now().toISOString() });
  const attempt = async (step: Step['step'], work: () => Promise<string | null | undefined>) => {
    try {
      note(step, (await work()) ?? null);
    } catch {
      // A failing step is recorded as not done, and the next one still runs.
    }
  };

  const [origin] =
    typeof evidence['actionId'] === 'string'
      ? await deps.db
          .select()
          .from(actions)
          .where(eq(actions.id, evidence['actionId'] as never))
      : [];
  const [envelope] =
    origin?.missionId == null
      ? []
      : await deps.db.select().from(envelopes).where(eq(envelopes.missionId, origin.missionId));
  const [mandate] =
    envelope === undefined
      ? []
      : await deps.db.select().from(mandates).where(eq(mandates.id, envelope.mandateId));
  if (mandate?.status === 'ACTIVE') {
    await attempt(
      'FREEZE_MANDATE',
      async () =>
        void (await changeMandate(
          deps,
          orgId,
          VERIFIER,
          mandate.id,
          'FROZEN',
          `Incident ${incidentId}`,
        )),
    );
  }
  if (mandate !== undefined)
    await attempt(
      'VOID_AUTHORIZATIONS',
      async () => (await voidOpenHolds(deps, orgId, mandate.id))[0],
    );
  if (
    evidence['eventType'] === 'PAYMENT.CAPTURE.COMPLETED' &&
    typeof evidence['resourceId'] === 'string' &&
    evidence['amount'] !== null
  ) {
    const amount = fromPayPalAmount(evidence['amount'] as never);
    await attempt(
      'REFUND_CAPTURE',
      async () =>
        void (await deps.paypal.payments.refund({
          requestId: requestIdFor(incidentId, 'refund'),
          captureId: evidence['resourceId'] as string,
          amount,
        })),
    );
  }
  if (mandate !== undefined && mandate.status !== 'REVOKED') {
    await attempt(
      'REVOKE_VAULT_TOKEN',
      async () =>
        void (await changeMandate(
          deps,
          orgId,
          VERIFIER,
          mandate.id,
          'REVOKED',
          `Incident ${incidentId}`,
        )),
    );
  }
  await withOrg(deps.db, orgId, async (tx) => {
    await emit(tx, orgId, 'incident.owner_notified', { incidentId });
    await record(
      tx,
      orgId,
      VERIFIER,
      'incident.contained',
      { incidentId, steps: steps.map((s) => s.step) },
      deps.now(),
    );
    await tx
      .update(incidents)
      .set({
        status: 'CONTAINED',
        autoResponse: [
          ...steps,
          { step: 'NOTIFY_OWNER', actionId: null, at: deps.now().toISOString() },
        ] as never,
      })
      .where(eq(incidents.id, incident.id));
  });
  return steps;
}

/** An owner closes an incident with a note on what was found. Only then can a frozen mandate be unfrozen. */
export async function resolveIncident(
  deps: CoreDeps,
  orgId: OrganizationId,
  actor: Actor,
  incidentId: string,
  note: string,
) {
  return withOrg(deps.db, orgId, async (tx) => {
    const [incident] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId as never));
    if (incident === undefined) throw new CoreError('NOT_FOUND', 'No such incident.');
    if (incident.status === 'RESOLVED')
      throw new CoreError('CONFLICT', 'This incident is already resolved.');
    await tx
      .update(incidents)
      .set({
        status: 'RESOLVED',
        closedAt: deps.now(),
        resolution: { note, resolvedBy: actor.id, at: deps.now().toISOString() },
      })
      .where(eq(incidents.id, incident.id));
    await record(tx, orgId, actor, 'incident.resolved', { incidentId, note }, deps.now());
    return { incidentId, status: 'RESOLVED' as const };
  });
}
