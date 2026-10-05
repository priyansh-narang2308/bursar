import { z } from 'zod';
import { jsonObjectSchema, sha256HexSchema, timestampSchema } from '../common';
import { actorKindSchema } from '../enums';
import { idSchemas } from '../ids';
import { rule } from '../rule';

/** What audit event types look like: lower-case words joined by dots or underscores. */
export const AUDIT_EVENT_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/;

/** The longest event type. */
export const MAX_AUDIT_TYPE_LENGTH = 100;

/** Who did it. A person or an agent has an id; the system and the Verifier may not. */
export const auditActorSchema = z.strictObject({
  kind: actorKindSchema,
  id: z.string().min(1).max(100).nullable(),
});
export type AuditActor = z.infer<typeof auditActorSchema>;

/**
 * One entry in an organisation's tamper-evident log. Each entry carries the hash of the one before
 * it and its own hash over everything it says, so changing, removing, reordering or inserting any
 * entry breaks the chain from that point on. `@bursar/audit` builds and verifies the chain.
 */
export const auditEventSchema = z
  .strictObject({
    id: idSchemas.auditEvent,
    orgId: idSchemas.organization,
    /** Position in the organisation's chain, starting at 1 with no gaps. */
    seq: z.int().min(1),
    ts: timestampSchema,
    actor: auditActorSchema,
    type: z.string().max(MAX_AUDIT_TYPE_LENGTH).regex(AUDIT_EVENT_TYPE_PATTERN),
    /** What happened, as JSON. Never secrets: the log is read by auditors. */
    payload: jsonObjectSchema,
    /** The hash of the previous entry, or the organisation's genesis hash for the first. */
    prevHash: sha256HexSchema,
    hash: sha256HexSchema,
  })
  .refine(
    ({ prevHash, hash }) => prevHash !== hash,
    rule('An entry cannot be its own predecessor', 'hash'),
  )
  .meta({
    id: 'AuditEvent',
    description: "One entry in an organisation's hash-chained audit log.",
  });
export type AuditEvent = z.infer<typeof auditEventSchema>;
