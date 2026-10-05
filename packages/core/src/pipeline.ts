import { idempotencyKey, signApproval } from '@bursar/crypto';
import {
  actions,
  approvals,
  decisions,
  envelopes,
  mandates,
  missions,
  policyVersions,
  type Tx,
  withOrg,
} from '@bursar/db';
import { moneyFromJSON } from '@bursar/money';
import { type Evaluation, evaluate, explain, hashPolicy } from '@bursar/policy';
import {
  type ActionType,
  type AmountJSON,
  type CartId,
  idSchemas,
  type MissionId,
  newId,
  type OrganizationId,
} from '@bursar/schemas';
import { and, desc, eq } from 'drizzle-orm';
import { emit, record } from './audit';
import { type ActionRow, buildContext, loadCart } from './context';
import { type Actor, type CoreDeps, CoreError } from './types';
import { amountJson, money } from './util';

const APPROVAL_HOURS = 24;

export interface ProposeInput {
  readonly type: 'AUTHORIZE' | 'CAPTURE' | 'VOID' | 'REFUND';
  readonly missionId: MissionId;
  readonly cartId: CartId;
  /** Only a person may name a refund amount; for everyone else a refund is the whole capture. */
  readonly refundAmount?: AmountJSON | undefined;
  /** Tells apart actions of the same kind on the same cart, such as two refunds. */
  readonly ordinal?: number | undefined;
}

export interface Proposal {
  readonly actionId: string;
  readonly state: string;
  readonly outcome: string;
  readonly explanation: string;
  readonly approvalIds: string[];
  /** True if this proposal had been made before and nothing new was done. */
  readonly existing: boolean;
}

export async function setState(
  tx: Tx,
  deps: CoreDeps,
  orgId: OrganizationId,
  action: ActionRow,
  to: string,
  actor: Actor,
  note: JsonNote = {},
): Promise<void> {
  await tx
    .update(actions)
    .set({ state: to, updatedAt: deps.now() })
    .where(eq(actions.id, action.id));
  await record(
    tx,
    orgId,
    actor,
    `action.${to.toLowerCase()}`,
    { actionId: action.id, type: action.type, from: action.state, ...note },
    deps.now(),
  );
  await emit(tx, orgId, `action.${to.toLowerCase()}`, { actionId: action.id });
  action.state = to;
}
type JsonNote = Record<string, string | number | boolean | null>;

/** Changes what an envelope holds, under its row lock, so concurrent actions cannot overcommit it. */
export async function lockEnvelope(tx: Tx, missionId: string) {
  const [envelope] = await tx
    .select()
    .from(envelopes)
    .where(eq(envelopes.missionId, missionId as never))
    .for('update');
  return envelope;
}

export async function adjustHeld(tx: Tx, missionId: string, delta: bigint): Promise<void> {
  const envelope = await lockEnvelope(tx, missionId);
  if (envelope === undefined) throw new CoreError('NOT_FOUND', 'No envelope for this mission.');
  await tx
    .update(envelopes)
    .set({ heldMinor: envelope.heldMinor + delta })
    .where(eq(envelopes.id, envelope.id));
}

async function policyVersionFor(
  tx: Tx,
  deps: CoreDeps,
  orgId: OrganizationId,
  policySetId: string,
) {
  const policy = deps.policyFor(orgId);
  const hash = hashPolicy(policy);
  const versions = await tx
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.policySetId, policySetId as never))
    .orderBy(desc(policyVersions.version));
  const found = versions.find((v) => v.hash === hash);
  if (found !== undefined) return found;
  const [created] = await tx
    .insert(policyVersions)
    .values({
      id: newId('policyVersion'),
      orgId,
      policySetId: policySetId as never,
      version: (versions[0]?.version ?? 0) + 1,
      hash,
      content: {
        rules: policy.rules.map(({ rule, params }) => ({
          id: rule.id,
          version: rule.version,
          params,
        })),
      },
    })
    .returning();
  if (created === undefined) throw new Error('insert returned nothing');
  return created;
}

/** Evaluates the policy on the server's own facts and keeps the ruling with its trace. */
export async function rule(
  tx: Tx,
  deps: CoreDeps,
  orgId: OrganizationId,
  action: ActionRow,
  phase: 'PROPOSE' | 'EXECUTE',
) {
  const policy = deps.policyFor(orgId);
  const evaluation = evaluate(policy, await buildContext(tx, deps, orgId, action, policy));
  const [envelope] =
    action.missionId === null
      ? []
      : await tx.select().from(envelopes).where(eq(envelopes.missionId, action.missionId));
  const [mandate] =
    envelope === undefined
      ? []
      : await tx.select().from(mandates).where(eq(mandates.id, envelope.mandateId));
  const version = await policyVersionFor(tx, deps, orgId, mandate?.policySetId ?? '');
  const decisionId = newId('decision');
  await tx.insert(decisions).values({
    id: decisionId,
    orgId,
    actionId: action.id,
    policyVersionId: version.id,
    policyHash: evaluation.policyHash,
    phase,
    outcome: evaluation.outcome,
    requiredApprovals: evaluation.requiredApprovals,
    trace: evaluation.trace as never,
    inputsHash: evaluation.inputsHash,
    evaluatedAt: deps.now(),
  });
  return { evaluation, decisionId };
}

/** Acts on a ruling: deny, allow (and reserve the money), or ask people. */
async function apply(
  tx: Tx,
  deps: CoreDeps,
  orgId: OrganizationId,
  action: ActionRow,
  ruling: { evaluation: Evaluation; decisionId: string },
  actor: Actor,
  asking: boolean,
): Promise<string[]> {
  const { evaluation, decisionId } = ruling;
  const note = { outcome: evaluation.outcome, explanation: explain(evaluation).slice(0, 200) };
  if (evaluation.outcome === 'DENY') {
    await setState(tx, deps, orgId, action, 'DENIED', actor, note);
    return [];
  }
  if (evaluation.outcome === 'ALLOW') {
    if (action.type === 'AUTHORIZE' && action.missionId !== null && action.amountMinor !== null)
      await adjustHeld(tx, action.missionId, action.amountMinor);
    await setState(tx, deps, orgId, action, 'APPROVED', actor, note);
    return [];
  }
  if (action.state === 'PROPOSED')
    await setState(tx, deps, orgId, action, 'AWAITING_APPROVAL', actor, note);
  if (!asking) return [];
  const ids: string[] = [];
  for (let i = 0; i < evaluation.requiredApprovals; i++) {
    const id = newId('approval');
    await tx.insert(approvals).values({
      id,
      orgId,
      decisionId: decisionId as never,
      cartHash: action.cartHash ?? '',
      policyHash: evaluation.policyHash,
      expiresAt: new Date(deps.now().getTime() + APPROVAL_HOURS * 3_600_000),
    });
    ids.push(id);
  }
  return ids;
}

type Cart = NonNullable<Awaited<ReturnType<typeof loadCart>>>;
type Target = {
  cart: Cart;
  amount: ReturnType<typeof money>;
  compensates: string | null;
  cartHash: string;
};

const confirmedOf = async (tx: Tx, cart: Cart, type: ActionType) =>
  (
    await tx
      .select()
      .from(actions)
      .where(
        and(
          eq(actions.cartId, cart.cart.id),
          eq(actions.type, type),
          eq(actions.state, 'CONFIRMED'),
        ),
      )
  )[0];

async function resolveRefund(
  tx: Tx,
  cart: Cart,
  input: ProposeInput,
  actor: Actor,
): Promise<Target> {
  const captured = await confirmedOf(tx, cart, 'CAPTURE');
  if (captured === undefined || captured.amountMinor === null)
    throw new CoreError('ILLEGAL_STATE_TRANSITION', 'Nothing is captured for this cart yet.');
  const whole = money(captured.amountMinor, captured.currency ?? '');
  const amount =
    actor.kind === 'USER' && input.refundAmount !== undefined
      ? moneyFromJSON(input.refundAmount)
      : whole;
  if (amount.currency !== whole.currency || amount.greaterThan(whole) || !amount.isPositive())
    throw new CoreError('VALIDATION_FAILED', 'A refund is more than zero and at most the capture.');
  return { cart, amount, compensates: captured.id, cartHash: cart.hash };
}

async function resolveFollowUp(tx: Tx, cart: Cart, input: ProposeInput): Promise<Target> {
  const authorized = await confirmedOf(tx, cart, 'AUTHORIZE');
  if (authorized === undefined || authorized.amountMinor === null)
    throw new CoreError('ILLEGAL_STATE_TRANSITION', 'Nothing is authorized for this cart yet.');
  const amount = money(authorized.amountMinor, authorized.currency ?? '');
  if (input.type === 'CAPTURE') return { cart, amount, compensates: null, cartHash: cart.hash };
  if ((await confirmedOf(tx, cart, 'CAPTURE')) !== undefined)
    throw new CoreError(
      'ILLEGAL_STATE_TRANSITION',
      'This cart has been captured, so it is refunded rather than voided.',
    );
  return { cart, amount, compensates: authorized.id, cartHash: cart.hash };
}

/** The target of an action, worked out from the cart and the actions already confirmed: the caller names no amount. */
async function resolve(tx: Tx, input: ProposeInput, actor: Actor): Promise<Target> {
  const cart = await loadCart(tx, input.cartId);
  if (cart === undefined || cart.cart.missionId !== input.missionId)
    throw new CoreError('UNKNOWN_REFERENCE', 'No such cart on this mission.');
  if (input.type === 'REFUND') return resolveRefund(tx, cart, input, actor);
  if (input.type !== 'AUTHORIZE') return resolveFollowUp(tx, cart, input);
  if (cart.cart.status !== 'PROPOSED')
    throw new CoreError('CONFLICT', 'This cart has been superseded.');
  return {
    cart,
    amount: money(cart.cart.totalMinor, cart.cart.currency),
    compensates: null,
    cartHash: cart.hash,
  };
}

/** Makes sure the mission's envelope exists (an AUTHORIZE creates it) and locks it for the rest of the transaction. */
async function prepareEnvelope(
  tx: Tx,
  orgId: OrganizationId,
  mission: typeof missions.$inferSelect,
  type: ProposeInput['type'],
): Promise<void> {
  if ((await lockEnvelope(tx, mission.id)) !== undefined) return;
  if (type !== 'AUTHORIZE' || mission.mandateId === null)
    throw new CoreError('NOT_FOUND', 'No envelope for this mission.');
  const [mandate] = await tx.select().from(mandates).where(eq(mandates.id, mission.mandateId));
  if (mandate === undefined || mandate.currency !== mission.currency)
    throw new CoreError('CURRENCY_MISMATCH', 'The mission and mandate must use one currency.');
  const ceiling =
    mission.budgetMinor < mandate.perMissionCapMinor
      ? mission.budgetMinor
      : mandate.perMissionCapMinor;
  await tx.insert(envelopes).values({
    id: newId('envelope'),
    orgId,
    missionId: mission.id,
    mandateId: mandate.id,
    currency: mission.currency,
    ceilingMinor: ceiling,
  });
  await lockEnvelope(tx, mission.id);
}

/**
 * Turns a proposal into a ruling. The amount comes from the cart, the envelope is locked while the policy
 * runs, the ruling and its trace are kept, and the action moves on: denied, approved (with the money
 * reserved) or waiting for people. Proposing the same thing twice returns the first action.
 */
export async function propose(
  deps: CoreDeps,
  orgId: OrganizationId,
  actor: Actor,
  input: ProposeInput,
): Promise<Proposal> {
  return withOrg(deps.db, orgId, async (tx) => {
    const [mission] = await tx.select().from(missions).where(eq(missions.id, input.missionId));
    if (mission === undefined) throw new CoreError('NOT_FOUND', 'No such mission.');
    if (mission.mandateId === null)
      throw new CoreError('MANDATE_INACTIVE', 'This mission has no mandate.');
    const target = await resolve(tx, input, actor);
    const key = idempotencyKey({
      orgId,
      type: input.type,
      missionId: mission.id,
      mandateId: null,
      supplierId: null,
      cartHash: target.cartHash as never,
      compensatesActionId: target.compensates as never,
      ordinal: input.ordinal ?? 1,
    });
    const [existing] = await tx.select().from(actions).where(eq(actions.idempotencyKey, key));
    if (existing !== undefined)
      return {
        actionId: existing.id,
        state: existing.state,
        outcome: 'EXISTING',
        explanation: 'This was already proposed.',
        approvalIds: [],
        existing: true,
      };

    await prepareEnvelope(tx, orgId, mission, input.type);

    const [created] = await tx
      .insert(actions)
      .values({
        id: newId('action'),
        orgId,
        missionId: mission.id,
        type: input.type,
        currency: target.amount.currency,
        amountMinor: target.amount.minor,
        cartId: target.cart.cart.id,
        cartHash: target.cartHash,
        createdAt: deps.now(),
        updatedAt: deps.now(),
        proposedBy: actor.kind,
        proposerId: actor.id,
        idempotencyKey: key,
        compensatesActionId: target.compensates as never,
      })
      .returning();
    if (created === undefined) throw new Error('insert returned nothing');
    await record(
      tx,
      orgId,
      actor,
      'action.proposed',
      {
        actionId: created.id,
        type: created.type,
        amount: amountJson(target.amount.minor, target.amount.currency),
      },
      deps.now(),
    );
    const ruling = await rule(tx, deps, orgId, created, 'PROPOSE');
    const approvalIds = await apply(tx, deps, orgId, created, ruling, actor, true);
    return {
      actionId: created.id,
      state: created.state,
      outcome: ruling.evaluation.outcome,
      explanation: explain(ruling.evaluation),
      approvalIds,
      existing: false,
    };
  });
}

async function assertOpen(
  tx: Tx,
  deps: CoreDeps,
  approval: typeof approvals.$inferSelect,
): Promise<void> {
  if (approval.status !== 'PENDING')
    throw new CoreError('CONFLICT', `This approval is already ${approval.status.toLowerCase()}.`);
  if (approval.expiresAt <= deps.now()) {
    await tx.update(approvals).set({ status: 'EXPIRED' }).where(eq(approvals.id, approval.id));
    throw new CoreError('APPROVAL_EXPIRED', 'This approval request has expired.');
  }
}

function assertIndependent(
  actor: Actor,
  action: ActionRow,
  siblings: (typeof approvals.$inferSelect)[],
): void {
  if (
    actor.id === action.proposerId ||
    siblings.some((s) => s.status === 'APPROVED' && s.approverId === actor.id)
  ) {
    throw new CoreError(
      'SEPARATION_OF_DUTIES',
      'Nobody approves their own action, and nobody approves twice.',
    );
  }
}

/**
 * A person's yes or no. A yes is signed over the cart hash, policy hash and expiry; it counts only if the
 * person is not the one who proposed, has not already approved, and it has not expired. Once enough people
 * have said yes the policy is run again, with their approvals as evidence, and decides.
 */
export async function decide(
  deps: CoreDeps,
  orgId: OrganizationId,
  actor: Actor,
  approvalId: string,
  verdict: 'APPROVE' | 'REJECT',
) {
  return withOrg(deps.db, orgId, async (tx) => {
    const [approval] = await tx
      .select()
      .from(approvals)
      .where(eq(approvals.id, idSchemas.approval.parse(approvalId)));
    if (approval === undefined) throw new CoreError('NOT_FOUND', 'No such approval.');
    const [decision] = await tx
      .select()
      .from(decisions)
      .where(eq(decisions.id, approval.decisionId));
    const [action] =
      decision === undefined
        ? []
        : await tx.select().from(actions).where(eq(actions.id, decision.actionId));
    if (decision === undefined || action === undefined)
      throw new CoreError('NOT_FOUND', 'No such action.');
    if (actor.kind !== 'USER' || actor.id === null)
      throw new CoreError('FORBIDDEN', 'Only a person can decide an approval.');
    await assertOpen(tx, deps, approval);
    const siblings = await tx.select().from(approvals).where(eq(approvals.decisionId, decision.id));
    assertIndependent(actor, action, siblings);
    const decidedAt = deps.now();
    if (verdict === 'REJECT') {
      await tx
        .update(approvals)
        .set({ status: 'REJECTED', approverId: actor.id as never, decidedAt })
        .where(eq(approvals.id, approval.id));
      await setState(tx, deps, orgId, action, 'REJECTED', actor, { approvalId });
      return { actionId: action.id, state: action.state };
    }
    const signature = signApproval(deps.approvalKey, {
      approvalId: approval.id,
      decisionId: approval.decisionId,
      approverId: actor.id as never,
      cartHash: approval.cartHash as never,
      policyHash: approval.policyHash as never,
      expiresAt: approval.expiresAt.toISOString(),
    });
    await tx
      .update(approvals)
      .set({ status: 'APPROVED', approverId: actor.id as never, decidedAt, signature })
      .where(eq(approvals.id, approval.id));
    await record(
      tx,
      orgId,
      actor,
      'approval.granted',
      { approvalId, actionId: action.id },
      decidedAt,
    );
    const granted = siblings.filter((s) => s.status === 'APPROVED').length + 1;
    if (granted >= decision.requiredApprovals && action.missionId !== null) {
      await lockEnvelope(tx, action.missionId);
      await apply(
        tx,
        deps,
        orgId,
        action,
        await rule(tx, deps, orgId, action, 'PROPOSE'),
        actor,
        false,
      );
    }
    return { actionId: action.id, state: action.state };
  });
}

/** Expires approval requests nobody answered, and the actions waiting on them. System work; run it on a schedule. */
export async function expireApprovals(deps: CoreDeps, orgId: OrganizationId): Promise<number> {
  return withOrg(deps.db, orgId, async (tx) => {
    const waiting = await tx.select().from(actions).where(eq(actions.state, 'AWAITING_APPROVAL'));
    let expired = 0;
    for (const action of waiting) {
      const pending = await tx
        .select({ a: approvals })
        .from(approvals)
        .innerJoin(decisions, eq(decisions.id, approvals.decisionId))
        .where(and(eq(decisions.actionId, action.id), eq(approvals.status, 'PENDING')));
      if (pending.length > 0 && pending.every(({ a }) => a.expiresAt <= deps.now())) {
        for (const { a } of pending)
          await tx.update(approvals).set({ status: 'EXPIRED' }).where(eq(approvals.id, a.id));
        await setState(tx, deps, orgId, action, 'EXPIRED', { kind: 'SYSTEM', id: null });
        expired += 1;
      }
    }
    return expired;
  });
}
