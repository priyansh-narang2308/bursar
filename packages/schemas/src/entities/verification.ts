import { z } from 'zod';
import { jsonObjectSchema, textSchema, timestampSchema } from '../common';
import {
  incidentSeveritySchema,
  incidentStatusSchema,
  incidentTypeSchema,
  matchStatusSchema,
  verificationStatusSchema,
  verifierStepSchema,
} from '../enums';
import { idSchemas } from '../ids';
import { notBefore } from '../invariants';
import { rule } from '../rule';

/** One thing the Verifier did in response to an incident. */
export const incidentResponseSchema = z
  .strictObject({
    step: verifierStepSchema,
    /** The system action that carried it out, if it was one. */
    actionId: idSchemas.action.nullable(),
    at: timestampSchema,
  })
  .meta({
    id: 'IncidentResponse',
    description: 'One step the Verifier took in response to an incident.',
  });
export type IncidentResponse = z.infer<typeof incidentResponseSchema>;

/** The owner's review of an incident: who, and why it is safe to close. */
export const incidentResolutionSchema = z.strictObject({
  by: idSchemas.user,
  reason: textSchema(500),
});

/** Something that does not add up: money PayPal knows about that Bursar cannot explain, or the reverse. */
export const incidentSchema = z
  .strictObject({
    id: idSchemas.incident,
    orgId: idSchemas.organization,
    type: incidentTypeSchema,
    severity: incidentSeveritySchema,
    status: incidentStatusSchema,
    openedAt: timestampSchema,
    closedAt: timestampSchema.nullable(),
    /** What the Verifier saw: ids, amounts, event names. */
    evidence: jsonObjectSchema,
    autoResponse: z.array(incidentResponseSchema).max(10),
    resolution: incidentResolutionSchema.nullable(),
  })
  .refine(
    ({ status, closedAt, resolution }) =>
      (status === 'RESOLVED') === (closedAt !== null) &&
      (closedAt !== null) === (resolution !== null),
    rule('An incident has a closing time and a resolution exactly when it is resolved', 'status'),
  )
  .refine(
    ({ openedAt, closedAt }) => closedAt === null || notBefore(closedAt, openedAt),
    rule('An incident cannot close before it opened', 'closedAt'),
  )
  .meta({
    id: 'Incident',
    description: 'Something that does not add up, and what was done about it.',
  });
export type Incident = z.infer<typeof incidentSchema>;

/**
 * PayPal's event names are an open set: PayPal can add new ones, and the Verifier must store one it
 * has never seen rather than fail. So this is a pattern, not the list of events Bursar subscribes to.
 */
const PAYPAL_EVENT_TYPE = /^[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_-]+)+$/;

/**
 * One webhook delivery from PayPal, after it was verified and matched against Bursar's own records.
 * Money state changes only from events that passed verification.
 */
export const paypalEventSchema = z
  .strictObject({
    id: idSchemas.paypalEvent,
    /** PayPal's own id for the event, which is how duplicate deliveries are recognised. */
    eventId: z.string().min(1).max(100),
    eventType: z.string().max(100).regex(PAYPAL_EVENT_TYPE),
    resourceType: z.string().min(1).max(100),
    resourceId: z.string().min(1).max(100),
    /** Carries the provenance tag that ties the money back to an approved action. */
    customId: z.string().min(1).max(255).nullable(),
    invoiceId: z.string().min(1).max(127).nullable(),
    verificationStatus: verificationStatusSchema,
    matchStatus: matchStatusSchema,
    matchedActionId: idSchemas.action.nullable(),
    /** From PayPal's creation time to the moment Bursar verified the event. */
    latencyMs: z.int().min(0).max(86_400_000).nullable(),
    receivedAt: timestampSchema,
  })
  .refine(
    ({ matchStatus, verificationStatus }) =>
      !['MATCHED', 'MISMATCH'].includes(matchStatus) || verificationStatus === 'SUCCESS',
    rule('Only an event that passed verification can be matched to an action', 'matchStatus'),
  )
  .refine(
    ({ matchStatus, matchedActionId }) =>
      ['MATCHED', 'MISMATCH'].includes(matchStatus) === (matchedActionId !== null),
    rule('An action is named exactly when the event was matched to one', 'matchedActionId'),
  )
  .meta({ id: 'PayPalEvent', description: 'A verified, matched webhook delivery from PayPal.' });
export type PayPalEvent = z.infer<typeof paypalEventSchema>;
