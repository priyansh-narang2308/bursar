import { z } from 'zod';
import {
  amountSchema,
  cartHashSchema,
  idempotencyKeySchema,
  inputsHashSchema,
  jsonObjectSchema,
  jsonValueSchema,
  policyHashSchema,
  textSchema,
  timestampSchema,
} from '../common';
import {
  type ActionType,
  actionStateSchema,
  actionTypeSchema,
  actorKindSchema,
  approvalStatusSchema,
  decisionPhaseSchema,
  policyOutcomeSchema,
  ruleIdSchema,
} from '../enums';
import { idSchemas } from '../ids';
import { notBefore } from '../invariants';
import { mergeOutcomes } from '../lifecycle';
import { rule } from '../rule';

/** The most rule results a decision may record. */
export const MAX_TRACE_ENTRIES = 64;

const MONEY_REQUIRED: ReadonlySet<ActionType> = new Set([
  'AUTHORIZE',
  'CAPTURE',
  'REFUND',
  'PAYOUT',
]);
const NO_MONEY: ReadonlySet<ActionType> = new Set(['FREEZE', 'REVOKE']);
const TARGETS_MANDATE: ReadonlySet<ActionType> = new Set(['FREEZE', 'REVOKE']);
const COMPENSATING: ReadonlySet<ActionType> = new Set(['VOID', 'REFUND']);
/** The Verifier only ever protects: it can freeze, void, refund and revoke, and can never spend. */
const VERIFIER_MAY_RAISE: ReadonlySet<ActionType> = new Set(['FREEZE', 'VOID', 'REFUND', 'REVOKE']);

/**
 * One thing Bursar does, or is asked to do, with money. The amount and the payee are filled in by
 * the server from verified records: they never come from an LLM or a client.
 */
export const actionSchema = z
  .strictObject({
    id: idSchemas.action,
    orgId: idSchemas.organization,
    missionId: idSchemas.mission.nullable(),
    /** The mandate a FREEZE or REVOKE acts on. */
    mandateId: idSchemas.mandate.nullable(),
    type: actionTypeSchema,
    amount: amountSchema.nullable(),
    /** The supplier a PAYOUT pays. It can only come from the supplier registry. */
    supplierId: idSchemas.supplier.nullable(),
    cartId: idSchemas.cart.nullable(),
    cartHash: cartHashSchema.nullable(),
    proposedBy: actorKindSchema,
    idempotencyKey: idempotencyKeySchema,
    state: actionStateSchema,
    /** The action this one undoes, for a VOID or REFUND. */
    compensatesActionId: idSchemas.action.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .refine(
    ({ type, amount }) => !MONEY_REQUIRED.has(type) || amount !== null,
    rule('This kind of action moves money, so it needs an amount', 'amount'),
  )
  .refine(
    ({ type, amount }) => !NO_MONEY.has(type) || amount === null,
    rule('This kind of action moves no money, so it has no amount', 'amount'),
  )
  .refine(
    ({ type, supplierId }) => (type === 'PAYOUT') === (supplierId !== null),
    rule('A payout names the supplier it pays, and nothing else does', 'supplierId'),
  )
  .refine(
    ({ type, mandateId }) => !TARGETS_MANDATE.has(type) || mandateId !== null,
    rule('A freeze or revocation names the mandate it acts on', 'mandateId'),
  )
  .refine(
    ({ cartId, cartHash }) => (cartId === null) === (cartHash === null),
    rule('A cart and its hash come together', 'cartHash'),
  )
  .refine(
    ({ type, compensatesActionId }) => compensatesActionId === null || COMPENSATING.has(type),
    rule('Only a void or a refund undoes another action', 'compensatesActionId'),
  )
  .refine(
    ({ proposedBy, type }) => proposedBy !== 'VERIFIER' || VERIFIER_MAY_RAISE.has(type),
    rule('The Verifier can protect (freeze, void, refund, revoke) but can never spend', 'type'),
  )
  .refine(
    ({ createdAt, updatedAt }) => notBefore(updatedAt, createdAt),
    rule('An action cannot be updated before it was created', 'updatedAt'),
  )
  .meta({
    id: 'Action',
    description: 'One thing Bursar does with money, and where it is in its life.',
  });
export type Action = z.infer<typeof actionSchema>;

/** What one rule concluded, in terms a person can read, with what it looked at. */
export const ruleResultSchema = z
  .strictObject({
    rule: ruleIdSchema,
    outcome: policyOutcomeSchema,
    /** A plain-language explanation, written by code, never by an LLM. */
    message: textSchema(300),
    inputs: jsonObjectSchema,
    threshold: jsonValueSchema,
  })
  .meta({
    id: 'RuleResult',
    description: 'What one policy rule concluded, and what it looked at.',
  });
export type RuleResult = z.infer<typeof ruleResultSchema>;

/**
 * The policy engine's ruling on an action: one rule result per rule that ran, and the outcome they
 * add up to. It is replayable: the same inputs and policy version always give the same decision.
 */
export const decisionSchema = z
  .strictObject({
    id: idSchemas.decision,
    actionId: idSchemas.action,
    policyVersionId: idSchemas.policyVersion,
    policyHash: policyHashSchema,
    phase: decisionPhaseSchema,
    outcome: policyOutcomeSchema,
    /** How many different people must approve: 0 unless approval is required, 2 for dual control. */
    requiredApprovals: z.int().min(0).max(2),
    trace: z.array(ruleResultSchema).min(1).max(MAX_TRACE_ENTRIES),
    inputsHash: inputsHashSchema,
    evaluatedAt: timestampSchema,
  })
  .refine(
    ({ outcome, trace }) => outcome === mergeOutcomes(trace.map((entry) => entry.outcome)),
    rule('The decision must be exactly as strict as its strictest rule', 'outcome'),
  )
  .refine(
    ({ outcome, requiredApprovals }) => (outcome === 'REQUIRE_APPROVAL') === requiredApprovals > 0,
    rule('Approvals are required exactly when the outcome asks for them', 'requiredApprovals'),
  )
  .meta({
    id: 'Decision',
    description: "The policy engine's ruling on an action, with the rules behind it.",
  });
export type Decision = z.infer<typeof decisionSchema>;

/**
 * A person's yes or no to a decision that asked for one. An approval is a signature over the cart
 * hash and the policy hash with an expiry, so changing either voids it.
 */
export const approvalSchema = z
  .strictObject({
    id: idSchemas.approval,
    decisionId: idSchemas.decision,
    /** Null until someone decides. */
    approverId: idSchemas.user.nullable(),
    status: approvalStatusSchema,
    cartHash: cartHashSchema,
    policyHash: policyHashSchema,
    /** Present exactly when approved. Base64url or hex. */
    signature: z
      .string()
      .min(16)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/)
      .nullable(),
    expiresAt: timestampSchema,
    decidedAt: timestampSchema.nullable(),
  })
  .refine(
    ({ status, decidedAt }) => ['APPROVED', 'REJECTED'].includes(status) === (decidedAt !== null),
    rule('A decision time is recorded exactly when someone approved or rejected', 'decidedAt'),
  )
  .refine(
    ({ decidedAt, approverId }) => decidedAt === null || approverId !== null,
    rule('Someone who decided is named', 'approverId'),
  )
  .refine(
    ({ status, signature }) => (status === 'APPROVED') === (signature !== null),
    rule('A signature is present exactly when the approval was given', 'signature'),
  )
  .meta({
    id: 'Approval',
    description: "A person's signed yes or no, bound to a cart hash and a policy hash.",
  });
export type Approval = z.infer<typeof approvalSchema>;
