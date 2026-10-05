import { z } from 'zod';
import {
  amountSchema,
  cartHashSchema,
  pageQuerySchema,
  pageSchema,
  policyHashSchema,
  textSchema,
  timestampSchema,
} from './common';
import { cartSchema } from './entities/commerce';
import { actionSchema, approvalSchema, decisionSchema } from './entities/decision';
import { MAX_GOAL_LENGTH } from './entities/mission';
import { decisionPhaseSchema, policyOutcomeSchema } from './enums';
import { idSchemas } from './ids';

/*
 * The request and response shapes of the HTTP API that are not simply an entity. Every request is
 * strict, so a client that sends a field the server does not know is told, not silently ignored;
 * and none of them lets a client or an LLM name a price, a total or a payee.
 */

/** Proposing a cart uses the same shape as the LLM tool: the offers and quantities, nothing else. */
export { proposeCartInputSchema as proposeCartRequestSchema } from './tools';

/** Start a mission: a goal, an optional deadline and a budget. */
export const createMissionRequestSchema = z.strictObject({
  goal: textSchema(MAX_GOAL_LENGTH),
  deadline: timestampSchema.nullable(),
  budget: amountSchema,
});
export type CreateMissionRequest = z.infer<typeof createMissionRequestSchema>;

/**
 * What proposing a cart returns: the cart with the prices the server worked out, the action it
 * created, and the policy decision. Whether it can proceed is in `decision.outcome`.
 */
export const proposalResultSchema = z
  .strictObject({
    cart: cartSchema,
    action: actionSchema,
    decision: decisionSchema,
  })
  .meta({
    id: 'ProposalResult',
    description: 'A proposed cart, its action and the policy decision on it.',
  });
export type ProposalResult = z.infer<typeof proposalResultSchema>;

/**
 * Approve a decision. The approver sends back the cart hash and the policy hash they were shown;
 * the server refuses the approval if either has changed since, so nobody approves what they did not see.
 */
export const approveActionRequestSchema = z.strictObject({
  decisionId: idSchemas.decision,
  cartHash: cartHashSchema,
  policyHash: policyHashSchema,
});
export type ApproveActionRequest = z.infer<typeof approveActionRequestSchema>;
export { approvalSchema as approveActionResponseSchema };

export const rejectActionRequestSchema = z.strictObject({
  decisionId: idSchemas.decision,
  reason: textSchema(500),
});
export type RejectActionRequest = z.infer<typeof rejectActionRequestSchema>;

/** Freeze, unfreeze or revoke a mandate. Always with a reason, which goes in the audit log. */
export const mandateActionRequestSchema = z.strictObject({
  reason: textSchema(500),
});
export type MandateActionRequest = z.infer<typeof mandateActionRequestSchema>;

/** Filters for listing decisions. */
export const listDecisionsQuerySchema = pageQuerySchema.extend({
  missionId: idSchemas.mission.optional(),
  outcome: policyOutcomeSchema.optional(),
  phase: decisionPhaseSchema.optional(),
});
export type ListDecisionsQuery = z.infer<typeof listDecisionsQuerySchema>;

export const decisionPageSchema = pageSchema(decisionSchema);
export type DecisionPage = z.infer<typeof decisionPageSchema>;
