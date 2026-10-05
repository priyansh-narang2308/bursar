import { z } from 'zod';
import { timestampSchema } from './common';
import { envelopeSchema } from './entities/funding';
import {
  actionStateSchema,
  decisionPhaseSchema,
  incidentSeveritySchema,
  incidentStatusSchema,
  incidentTypeSchema,
  mandateStatusSchema,
  matchStatusSchema,
  missionStatusSchema,
  policyOutcomeSchema,
} from './enums';
import { type EventId, idSchemas } from './ids';
import { canTransition } from './lifecycle';
import { rule } from './rule';

/*
 * The live event stream the browser listens to (server-sent events). Each message is one envelope:
 * who it is for, when it happened, what kind it is, and a small payload. Payloads carry ids and
 * the facts that changed, not whole records, so a client refetches what it needs. Every event id
 * is a time-ordered ULID, which is what makes `Last-Event-ID` resumption possible.
 */

function event<Type extends string, Data extends z.ZodType>(type: Type, data: Data) {
  return z.strictObject({
    id: idSchemas.event,
    orgId: idSchemas.organization,
    occurredAt: timestampSchema,
    type: z.literal(type),
    data,
  });
}

export const sseEventSchema = z
  .discriminatedUnion('type', [
    event(
      'action.state_changed',
      z
        .strictObject({
          actionId: idSchemas.action,
          missionId: idSchemas.mission.nullable(),
          from: actionStateSchema,
          to: actionStateSchema,
        })
        .refine(
          ({ from, to }) => canTransition(from, to),
          rule('An action cannot make that move', 'to'),
        ),
    ),
    event(
      'decision.recorded',
      z.strictObject({
        decisionId: idSchemas.decision,
        actionId: idSchemas.action,
        phase: decisionPhaseSchema,
        outcome: policyOutcomeSchema,
      }),
    ),
    event(
      'approval.requested',
      z.strictObject({
        approvalId: idSchemas.approval,
        decisionId: idSchemas.decision,
        actionId: idSchemas.action,
        expiresAt: timestampSchema,
      }),
    ),
    event(
      'approval.decided',
      z.strictObject({
        approvalId: idSchemas.approval,
        decisionId: idSchemas.decision,
        status: z.enum(['APPROVED', 'REJECTED', 'EXPIRED']),
      }),
    ),
    event('envelope.updated', z.strictObject({ envelope: envelopeSchema })),
    event(
      'mandate.status_changed',
      z
        .strictObject({
          mandateId: idSchemas.mandate,
          from: mandateStatusSchema,
          to: mandateStatusSchema,
        })
        .refine(({ from, to }) => from !== to, rule('A status change changes the status', 'to')),
    ),
    event(
      'mission.updated',
      z.strictObject({ missionId: idSchemas.mission, status: missionStatusSchema }),
    ),
    event(
      'incident.opened',
      z.strictObject({
        incidentId: idSchemas.incident,
        type: incidentTypeSchema,
        severity: incidentSeveritySchema,
      }),
    ),
    event(
      'incident.updated',
      z.strictObject({ incidentId: idSchemas.incident, status: incidentStatusSchema }),
    ),
    event(
      'paypal.event.verified',
      z.strictObject({
        paypalEventId: idSchemas.paypalEvent,
        eventType: z.string().min(1).max(100),
        matchStatus: matchStatusSchema,
        latencyMs: z.int().min(0).max(86_400_000).nullable(),
      }),
    ),
  ])
  .meta({ id: 'SseEvent', description: 'One message on the live event stream.' });
export type SseEvent = z.infer<typeof sseEventSchema>;

/** The kinds of event on the stream. (A keep-alive is an SSE comment line, not an event.) */
export const SSE_EVENT_TYPES = [
  'action.state_changed',
  'decision.recorded',
  'approval.requested',
  'approval.decided',
  'envelope.updated',
  'mandate.status_changed',
  'mission.updated',
  'incident.opened',
  'incident.updated',
  'paypal.event.verified',
] as const;

/**
 * The wire form of an event: `id`, `event` and a single `data` line, ended by a blank line. The
 * JSON has no raw newlines, so it always fits on one `data` line.
 */
export function sseFrame(sseEvent: SseEvent): string {
  return `id: ${sseEvent.id}\nevent: ${sseEvent.type}\ndata: ${JSON.stringify(sseEvent)}\n\n`;
}

/** Reads a `Last-Event-ID` header: the id to resume after, or undefined if there is none or it is junk. */
export function parseLastEventId(header: string | null | undefined): EventId | undefined {
  const parsed = idSchemas.event.safeParse(header);
  return parsed.success ? parsed.data : undefined;
}
