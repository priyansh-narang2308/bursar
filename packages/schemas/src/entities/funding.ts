import { z } from 'zod';
import { amountSchema, timestampSchema } from '../common';
import { envelopeStatusSchema, mandateStatusSchema } from '../enums';
import { idSchemas } from '../ids';
import { after, atMost, sameCurrency, sumAtMost } from '../invariants';
import { rule } from '../rule';

/**
 * A mandate is the payer's signed permission for Bursar to spend on their behalf: a vaulted PayPal
 * payment token, a total cap, a cap per mission and a validity window. Revoking it deletes the token.
 */
export const mandateSchema = z
  .strictObject({
    id: idSchemas.mandate,
    orgId: idSchemas.organization,
    payerId: idSchemas.payer,
    policySetId: idSchemas.policySet,
    status: mandateStatusSchema,
    /** The most Bursar may hold and spend under this mandate, in total. */
    cap: amountSchema,
    /** The most a single mission may use. */
    perMissionCap: amountSchema,
    validFrom: timestampSchema,
    validTo: timestampSchema,
    /** When the payer approved it at PayPal; null until then. */
    signedAt: timestampSchema.nullable(),
    revokedAt: timestampSchema.nullable(),
  })
  .refine(
    ({ cap, perMissionCap }) => sameCurrency(cap, perMissionCap),
    rule('The two caps must be in the same currency', 'perMissionCap'),
  )
  .refine(
    ({ cap, perMissionCap }) => atMost(perMissionCap, cap),
    rule('The per-mission cap cannot exceed the total cap', 'perMissionCap'),
  )
  .refine(
    ({ validFrom, validTo }) => after(validTo, validFrom),
    rule('The mandate must end after it starts', 'validTo'),
  )
  .refine(
    ({ status, signedAt }) => !['ACTIVE', 'FROZEN'].includes(status) || signedAt !== null,
    rule('An active or frozen mandate has been signed', 'signedAt'),
  )
  .refine(
    ({ status, revokedAt }) => (status === 'REVOKED') === (revokedAt !== null),
    rule('A mandate has a revocation time exactly when it is revoked', 'revokedAt'),
  )
  .meta({
    id: 'Mandate',
    description: "A payer's signed permission for Bursar to spend, within caps and a window.",
  });
export type Mandate = z.infer<typeof mandateSchema>;

/**
 * An envelope is the PayPal authorization that caps one mission's spend, so PayPal itself enforces
 * the ceiling. The row is the lock target: a decision updates it under `SELECT … FOR UPDATE`, which
 * is why two concurrent proposals cannot both fit.
 */
export const envelopeSchema = z
  .strictObject({
    id: idSchemas.envelope,
    orgId: idSchemas.organization,
    missionId: idSchemas.mission,
    mandateId: idSchemas.mandate,
    status: envelopeStatusSchema,
    /** The approved ceiling: what the PayPal authorization was created for. */
    ceiling: amountSchema,
    /** Authorized and not yet captured. */
    held: amountSchema,
    captured: amountSchema,
    refunded: amountSchema,
    /** Paid out to suppliers: the irreversible rung. */
    settled: amountSchema,
    authorizationExpiresAt: timestampSchema.nullable(),
    reauthorizedAt: timestampSchema.nullable(),
  })
  .refine(
    ({ ceiling, held, captured, refunded, settled }) =>
      sameCurrency(ceiling, held, captured, refunded, settled),
    rule('Every figure must be in the same currency', 'ceiling'),
  )
  .refine(
    ({ ceiling, held, captured }) => sumAtMost(captured, held, ceiling),
    rule('Captured plus held cannot exceed the ceiling', 'held'),
  )
  .meta({
    id: 'Envelope',
    description:
      "The PayPal authorization that caps a mission's spend, and how much of it is used.",
  });
export type Envelope = z.infer<typeof envelopeSchema>;
