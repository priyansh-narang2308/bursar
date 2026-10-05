import { z } from 'zod';
import { rule } from './rule';

/*
 * The error catalog: every failure the API can report, with a stable code. Clients branch on
 * `code`, never on the message, so wording can improve without breaking anyone. The shape on the
 * wire is RFC 9457 "problem details" (which obsoletes RFC 7807) plus a few extension members.
 */

/** Statuses for which a client may retry the same request: throttling, and failures that may pass. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

export interface ErrorSpec {
  readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 502 | 503 | 504;
  /** Short and stable; the same for every occurrence of the code. */
  readonly title: string;
  /** What it means and what to do about it. */
  readonly description: string;
}

export const ERROR_CATALOG = {
  // Requests and callers
  VALIDATION_FAILED: {
    status: 400,
    title: 'The request is invalid',
    description: 'A field is missing, malformed or out of range. The `errors` list says which.',
  },
  UNAUTHENTICATED: {
    status: 401,
    title: 'Authentication is required',
    description: 'Send a valid session or API key.',
  },
  FORBIDDEN: {
    status: 403,
    title: 'You are not allowed to do this',
    description: "The caller's role or API key scope does not permit this action.",
  },
  NOT_FOUND: {
    status: 404,
    title: 'Not found',
    description:
      'It does not exist, or it belongs to another organisation. The two are deliberately not told apart.',
  },
  CONFLICT: {
    status: 409,
    title: 'The resource changed',
    description: 'Someone else changed it first. Load the current version and try again.',
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    title: 'Idempotency key reused',
    description: 'That idempotency key was already used for a different request.',
  },
  RATE_LIMITED: {
    status: 429,
    title: 'Too many requests',
    description: 'Slow down and retry after the delay in `retryAfterSeconds`.',
  },
  INTERNAL_ERROR: {
    status: 500,
    title: 'Something went wrong on our side',
    description: 'Not caused by the request. Quote the `requestId` when asking for help.',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    title: 'The service is unavailable',
    description: 'A dependency is down or the service is shutting down. Retry shortly.',
  },

  // Policy, approval and funding
  POLICY_DENIED: {
    status: 422,
    title: 'The policy engine denied this action',
    description: 'A rule said no. The decision lists which rule and why, in plain language.',
  },
  APPROVAL_REQUIRED: {
    status: 409,
    title: 'A person must approve this first',
    description: 'The action is waiting for an approval that has not been given.',
  },
  APPROVAL_EXPIRED: {
    status: 410,
    title: 'The approval has expired',
    description: 'Approvals expire. Ask for a new one.',
  },
  APPROVAL_MISMATCH: {
    status: 409,
    title: 'The approval is for something else',
    description:
      'The cart or the policy changed since it was approved, so the approval no longer applies.',
  },
  SEPARATION_OF_DUTIES: {
    status: 403,
    title: 'A different person must approve this',
    description:
      'The person who proposed an action, or who approved it already, cannot approve it again.',
  },
  ENVELOPE_EXCEEDED: {
    status: 422,
    title: 'This would exceed the envelope',
    description: "Captured plus held plus this action would be more than the mission's ceiling.",
  },
  MANDATE_INACTIVE: {
    status: 409,
    title: 'The mandate is not active',
    description:
      'The mandate is pending, frozen, revoked or expired, so nothing can be spent under it.',
  },
  ILLEGAL_STATE_TRANSITION: {
    status: 409,
    title: 'That move is not allowed from the current state',
    description: 'The action cannot go from its current state to the requested one.',
  },
  CURRENCY_MISMATCH: {
    status: 422,
    title: 'The currencies do not match',
    description: 'Amounts in different currencies cannot be combined or compared.',
  },
  PRICE_CHANGED: {
    status: 409,
    title: 'The price changed',
    description: 'The re-quoted price differs from the one proposed. Review and propose again.',
  },
  OFFER_UNAVAILABLE: {
    status: 409,
    title: 'The offer is no longer available',
    description: 'The supplier no longer offers it at that price, or it is out of stock.',
  },

  // PayPal
  PAYPAL_DECLINED: {
    status: 422,
    title: 'PayPal declined the payment',
    description:
      "PayPal refused the payer's funding source. Nothing was captured, and it is never retried automatically.",
  },
  PAYPAL_UNAVAILABLE: {
    status: 502,
    title: 'PayPal is unavailable',
    description:
      'PayPal returned an error or could not be reached. Retry with the same idempotency key.',
  },
  PAYPAL_OUTCOME_UNKNOWN: {
    status: 504,
    title: 'PayPal did not answer in time',
    description:
      'The request may or may not have been applied. Retry with the same idempotency key; never create a new one.',
  },

  // Agents and tools
  TOOL_NOT_ALLOWED: {
    status: 403,
    title: 'This agent may not use that tool',
    description: "The tool is not on the agent's allow-list.",
  },
  UNKNOWN_REFERENCE: {
    status: 422,
    title: 'A referenced id does not exist',
    description:
      'An offer, mission, task or other id in the request is unknown, or belongs to someone else.',
  },
} as const satisfies Readonly<Record<string, ErrorSpec>>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES: readonly ErrorCode[] = Object.keys(ERROR_CATALOG).filter(isErrorCode);

function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_CATALOG, value);
}

// `z.enum` wants a non-empty tuple; the catalog is a constant object, so it always has codes.
export const errorCodeSchema = z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]);

/** The stable problem `type` URI for a code. A URN, so it is a name and not a promise to serve a page. */
export function errorType(code: ErrorCode): string {
  return `urn:bursar:error:${code.toLowerCase().replaceAll('_', '-')}`;
}

/** Whether a client may retry the same request after this failure. */
export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE_STATUSES.has(ERROR_CATALOG[code].status);
}

/** One field of a request that failed validation. */
export const fieldErrorSchema = z.strictObject({
  path: z.string().max(200),
  message: z.string().min(1).max(300),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

/**
 * The body of every error response, as `application/problem+json`. The standard members come from
 * the catalog and are checked against it, so a response can never say `POLICY_DENIED` with a 500.
 */
export const problemDetailsSchema = z
  .strictObject({
    type: z.string().regex(/^urn:bursar:error:[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1).max(200),
    status: z.int().min(400).max(599),
    /** What happened, in a sentence, for this occurrence. */
    detail: z.string().min(1).max(1000).optional(),
    /** The request this occurred on. */
    instance: z.string().min(1).max(500).optional(),
    code: errorCodeSchema,
    retryable: z.boolean(),
    requestId: z.string().min(1).max(100).optional(),
    retryAfterSeconds: z.int().min(0).max(86_400).optional(),
    /** PayPal's `debug_id`, which PayPal support needs, when PayPal was involved. */
    paypalDebugId: z.string().min(1).max(100).optional(),
    errors: z.array(fieldErrorSchema).max(100).optional(),
  })
  .refine(
    (problem) =>
      problem.type === errorType(problem.code) &&
      problem.title === ERROR_CATALOG[problem.code].title &&
      problem.status === ERROR_CATALOG[problem.code].status &&
      problem.retryable === isRetryable(problem.code),
    rule(
      'The type, title, status and retryable flag must be the catalog values for the code',
      'code',
    ),
  )
  .meta({
    id: 'ProblemDetails',
    description: 'An error response: RFC 9457 problem details with a stable code.',
  });
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export type ProblemExtras = Partial<
  Pick<
    ProblemDetails,
    'detail' | 'instance' | 'requestId' | 'retryAfterSeconds' | 'paypalDebugId' | 'errors'
  >
>;

/** A valid problem for `code`, with the standard members filled in from the catalog. */
export function problem(code: ErrorCode, extras: ProblemExtras = {}): ProblemDetails {
  const spec = ERROR_CATALOG[code];
  return problemDetailsSchema.parse({
    type: errorType(code),
    title: spec.title,
    status: spec.status,
    code,
    retryable: isRetryable(code),
    ...extras,
  });
}
