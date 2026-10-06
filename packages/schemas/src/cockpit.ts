import { z } from 'zod';
import { amountSchema, timestampSchema } from './common';
import {
  actionStateSchema,
  envelopeStatusSchema,
  incidentSeveritySchema,
  incidentStatusSchema,
  incidentTypeSchema,
  policyOutcomeSchema,
} from './enums';
import { idSchemas } from './ids';

/*
 * What the cockpit shows, worked out on the server. The web app does no arithmetic on money, so every
 * figure a widget draws arrives here already summed, and the few numbers that only shape a picture
 * (`usedPercent`, `weight`) are labelled as geometry, never as amounts.
 */

export const cockpitEnvelopeSchema = z.strictObject({
  missionId: idSchemas.mission,
  status: envelopeStatusSchema,
  ceiling: amountSchema,
  held: amountSchema,
  captured: amountSchema,
  refunded: amountSchema,
  settled: amountSchema,
  /** Whole percent of the ceiling that is held or captured. For drawing the gauge only. */
  usedPercent: z.int().min(0).max(100),
});

export const cockpitRuleSchema = z.strictObject({
  rule: z.string().min(1).max(40),
  outcome: policyOutcomeSchema,
  message: z.string().max(300),
});

export const cockpitDecisionSchema = z.strictObject({
  id: idSchemas.decision,
  actionId: idSchemas.action,
  type: z.string().min(1).max(40),
  state: actionStateSchema,
  outcome: policyOutcomeSchema,
  requiredApprovals: z.int().min(0).max(2),
  amount: amountSchema.nullable(),
  evaluatedAt: timestampSchema,
  rules: z.array(cockpitRuleSchema).max(40),
});

export const cockpitRuleHitSchema = z.strictObject({
  rule: z.string().min(1).max(40),
  outcome: policyOutcomeSchema,
  count: z.int().min(1),
});

export const cockpitFlowSchema = z.strictObject({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  amount: amountSchema,
  /** The relative width of the band. For drawing the diagram only. */
  weight: z.int().min(1),
});

export const cockpitIncidentSchema = z.strictObject({
  id: idSchemas.incident,
  type: incidentTypeSchema,
  severity: incidentSeveritySchema,
  status: incidentStatusSchema,
  openedAt: timestampSchema,
});

export const cockpitSchema = z
  .strictObject({
    generatedAt: timestampSchema,
    envelopes: z.array(cockpitEnvelopeSchema).max(200),
    decisions: z.array(cockpitDecisionSchema).max(200),
    ruleHits: z.array(cockpitRuleHitSchema).max(200),
    flows: z.array(cockpitFlowSchema).max(50),
    verification: z.strictObject({
      confirmed: z.int().min(0),
      waiting: z.int().min(0),
      unexplained: z.int().min(0),
    }),
    incidents: z.array(cockpitIncidentSchema).max(100),
  })
  .meta({ id: 'Cockpit', description: 'The figures the cockpit draws, worked out on the server.' });
export type Cockpit = z.infer<typeof cockpitSchema>;

/*
 * The Treasurer: the assistant inside Studio. It reads; it never moves money. Studio sends one turn of the
 * conversation, and the server answers with what the model said next: text, or a call to a read-only tool.
 * The items are Studio's own conversation items, so they are checked for their kind and no further.
 */
export const aiTurnRequestSchema = z.strictObject({
  input: z.array(z.looseObject({ type: z.string().min(1).max(40) })).max(200),
  instructions: z.string().max(20_000).optional(),
  tools: z.array(z.looseObject({ name: z.string().min(1).max(80) })).max(60),
});
export type AiTurnRequest = z.infer<typeof aiTurnRequestSchema>;

export const aiTurnResponseSchema = z.strictObject({
  id: z.string().min(1).max(80),
  createdAt: z.int().min(0),
  status: z.literal('completed'),
  output: z.array(z.looseObject({ type: z.string().min(1).max(40) })).max(20),
});
export type AiTurnResponse = z.infer<typeof aiTurnResponseSchema>;

/**
 * Everything the Treasurer may call. Each reads the workspace and nothing else: none names an amount, a payee or
 * an account, and none can order, capture, refund or pay. A test holds this list to that.
 */
export const TREASURER_TOOLS = [
  'get_envelope',
  'list_incidents',
  'explain_decision',
  'simulate_policy_change',
  'add_blocked_by_rule_widget',
] as const;
export type TreasurerTool = (typeof TREASURER_TOOLS)[number];
