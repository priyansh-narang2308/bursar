import {
  actionTypeSchema,
  actorKindSchema,
  amountSchema,
  approvalStatusSchema,
  idSchemas,
  mandateStatusSchema,
  timestampSchema,
} from '@bursar/schemas';
import { z } from 'zod';

const org = idSchemas.organization;

/**
 * Everything the rules may look at, assembled by the caller from server records and never from an
 * LLM or a client. The engine is pure, so the time, the history and the checked state of any
 * approval all arrive here.
 */
export const contextSchema = z.object({
  now: timestampSchema,
  /** The organisation the actor belongs to. */
  orgId: org,
  action: z.object({
    type: actionTypeSchema,
    orgId: org,
    proposedBy: actorKindSchema,
    /** The person (the maker) or agent that proposed it. */
    proposerId: z.string().nullable(),
    agentRunId: z.string().nullable(),
    amount: amountSchema.nullable(),
    supplierId: idSchemas.supplier.nullable(),
  }),
  mandate: z
    .object({
      orgId: org,
      status: mandateStatusSchema,
      validFrom: timestampSchema,
      validTo: timestampSchema,
    })
    .nullable(),
  envelope: z
    .object({ orgId: org, ceiling: amountSchema, held: amountSchema, captured: amountSchema })
    .nullable(),
  cart: z
    .object({
      orgId: org,
      total: amountSchema,
      deadline: timestampSchema.nullable(),
      lines: z.array(
        z.object({
          offerId: idSchemas.offer,
          supplierId: idSchemas.supplier,
          category: z.string(),
          quantity: z.int().min(1),
          unitPrice: amountSchema,
          lineTotal: amountSchema,
          /** The price re-quoted just now, to compare with the one the cart was built on. */
          quotedUnitPrice: amountSchema,
          estimatedArrival: timestampSchema.nullable(),
        }),
      ),
    })
    .nullable(),
  /** Every supplier involved: the cart's, and a payout's payee. */
  suppliers: z.array(
    z.object({
      id: idSchemas.supplier,
      orgId: org,
      status: z.enum(['ACTIVE', 'BLOCKED']),
      /** Where money for this supplier goes. Two suppliers can share one payee. */
      payee: z.string(),
      priorPayouts: z.int().min(0),
    }),
  ),
  /** Recent orders in this organisation, for duplicate and velocity checks. */
  recent: z.array(
    z.object({
      at: timestampSchema,
      supplierId: idSchemas.supplier,
      payee: z.string(),
      offerIds: z.array(idSchemas.offer),
      amount: amountSchema,
    }),
  ),
  /** Approvals given for this action, already checked by the caller against the stored cart and policy. */
  approvals: z.array(
    z.object({
      id: idSchemas.approval,
      approverId: z.string(),
      status: approvalStatusSchema,
      expiresAt: timestampSchema,
      signatureValid: z.boolean(),
      cartHashMatches: z.boolean(),
      policyHashMatches: z.boolean(),
    }),
  ),
  payout: z
    .object({
      inspected: z.boolean(),
      coolingOffEndsAt: timestampSchema,
      captureSettled: z.boolean(),
    })
    .nullable(),
});
export type Context = z.output<typeof contextSchema>;
