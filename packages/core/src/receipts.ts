import { verifyChain } from '@bursar/audit';
import {
  actions,
  approvals,
  auditEvents,
  decisions,
  executions,
  ledgerEntries,
  paypalEvents,
  policyVersions,
  withOrg,
} from '@bursar/db';
import { type Evaluation, RULES, replay } from '@bursar/policy';
import type { JsonObject, OrganizationId } from '@bursar/schemas';
import { asc, eq } from 'drizzle-orm';
import { loadCart } from './context';
import { type CoreDeps, CoreError } from './types';

const text = (value: bigint | null) => (value === null ? null : value.toString());

/**
 * Everything that happened to one action, in order, from the records themselves: what was asked and from
 * which cart, every ruling with the rules' trace and hashes, who approved and when, what was sent to PayPal
 * and what came back, the webhooks that confirmed it, the ledger entries, and the audit entries.
 */
export async function receipt(deps: CoreDeps, orgId: OrganizationId, actionId: string) {
  return withOrg(deps.db, orgId, async (tx) => {
    const [action] = await tx
      .select()
      .from(actions)
      .where(eq(actions.id, actionId as never));
    if (action === undefined) throw new CoreError('NOT_FOUND', 'No such action.');
    const cart = action.cartId === null ? undefined : await loadCart(tx, action.cartId);
    const rulings = await tx
      .select()
      .from(decisions)
      .where(eq(decisions.actionId, action.id))
      .orderBy(asc(decisions.evaluatedAt));
    const approvalRows = await tx
      .select({ a: approvals })
      .from(approvals)
      .innerJoin(decisions, eq(decisions.id, approvals.decisionId))
      .where(eq(decisions.actionId, action.id));
    const audit = (await tx.select().from(auditEvents).orderBy(asc(auditEvents.seq))).filter(
      (e) => (e.payload as JsonObject)['actionId'] === action.id,
    );
    return {
      action: {
        id: action.id,
        type: action.type,
        state: action.state,
        proposedBy: action.proposedBy,
        missionId: action.missionId,
        amountMinor: text(action.amountMinor),
        currency: action.currency,
        idempotencyKey: action.idempotencyKey,
        createdAt: action.createdAt,
      },
      cart: cart && {
        id: cart.cart.id,
        version: cart.cart.version,
        hash: cart.hash,
        totalMinor: text(cart.cart.totalMinor),
        lines: cart.rows.map(({ line, offer }) => ({
          title: offer.title,
          quantity: line.quantity,
          lineTotalMinor: text(line.lineTotalMinor),
        })),
      },
      decisions: rulings.map((d) => ({
        id: d.id,
        phase: d.phase,
        outcome: d.outcome,
        requiredApprovals: d.requiredApprovals,
        policyHash: d.policyHash,
        inputsHash: d.inputsHash,
        trace: d.trace,
        evaluatedAt: d.evaluatedAt,
      })),
      approvals: approvalRows.map(({ a }) => ({
        id: a.id,
        status: a.status,
        approverId: a.approverId,
        signed: a.signature !== null,
        decidedAt: a.decidedAt,
        expiresAt: a.expiresAt,
      })),
      executions: (
        await tx.select().from(executions).where(eq(executions.actionId, action.id))
      ).map((e) => ({
        step: e.step,
        requestId: e.requestId,
        status: e.status,
        paypalResourceId: e.paypalResourceId,
        debugId: e.debugId,
      })),
      paypalEvents: (
        await tx.select().from(paypalEvents).where(eq(paypalEvents.matchedActionId, action.id))
      ).map((e) => ({
        eventType: e.eventType,
        matchStatus: e.matchStatus,
        receivedAt: e.receivedAt,
      })),
      ledger: (
        await tx.select().from(ledgerEntries).where(eq(ledgerEntries.actionId, action.id))
      ).map((e) => ({
        account: e.account,
        side: e.side,
        amountMinor: text(e.amountMinor),
        currency: e.currency,
      })),
      audit: audit.map((e) => ({ seq: e.seq, type: e.type, ts: e.ts, hash: e.hash })),
    };
  });
}

/**
 * Runs a stored ruling again: rebuilds the policy from the version it was made under, feeds it the inputs it
 * saw, and says whether the outcome, the trace and both hashes come out exactly the same.
 */
export async function replayDecision(deps: CoreDeps, orgId: OrganizationId, decisionId: string) {
  return withOrg(deps.db, orgId, async (tx) => {
    const [decision] = await tx
      .select()
      .from(decisions)
      .where(eq(decisions.id, decisionId as never));
    if (decision === undefined) throw new CoreError('NOT_FOUND', 'No such decision.');
    const [version] = await tx
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.id, decision.policyVersionId));
    if (decision.inputs === null || version === undefined)
      return { reproduced: false, reason: 'This ruling kept no inputs to replay.' };
    const content = version.content as {
      rules: { id: keyof typeof RULES; version: number; params: never }[];
    };
    if (content.rules.some((r) => RULES[r.id]?.version !== r.version))
      return { reproduced: false, reason: 'A rule has changed since this ruling was made.' };
    const policy = { rules: content.rules.map((r) => RULES[r.id].use(r.params)) };
    const recorded = {
      outcome: decision.outcome,
      requiredApprovals: decision.requiredApprovals,
      trace: decision.trace,
      policyHash: decision.policyHash,
      inputsHash: decision.inputsHash,
    } as unknown as Evaluation;
    const { reproduced, evaluation } = replay(policy, decision.inputs as JsonObject, recorded);
    return {
      reproduced,
      outcome: evaluation.outcome,
      reason: reproduced ? 'The same outcome, trace and hashes.' : 'The ruling does not reproduce.',
    };
  });
}

/** Walks the organisation's audit chain and says whether it is unbroken. */
export async function verifyAudit(deps: CoreDeps, orgId: OrganizationId) {
  const rows = await withOrg(deps.db, orgId, (tx) =>
    tx.select().from(auditEvents).orderBy(asc(auditEvents.seq)),
  );
  const events = rows.map((e) => ({
    id: e.id,
    orgId: e.orgId,
    seq: e.seq,
    ts: e.ts,
    actor: { kind: e.actorKind, id: e.actorId },
    type: e.type,
    payload: e.payload,
    prevHash: e.prevHash,
    hash: e.hash,
  }));
  return verifyChain(events, { orgId });
}
