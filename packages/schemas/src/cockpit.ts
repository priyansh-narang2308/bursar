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
