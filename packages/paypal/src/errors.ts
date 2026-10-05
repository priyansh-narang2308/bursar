/**
 * How the executor should treat a failure:
 * - `declined`: PayPal said no for a business reason (a declined instrument). Terminal; never retry.
 * - `rejected`: the request was wrong or not allowed. Terminal.
 * - `retryable`: 429 or 5xx that outlasted the client's own retries. Safe to retry with the same id.
 * - `unknown`: no answer. The call may or may not have happened, so look it up before doing anything.
 * - `auth`: the credentials were refused.
 * - `invalid`: PayPal answered with something this client cannot read.
 */
export type PayPalErrorKind =
  | 'declined'
  | 'rejected'
  | 'retryable'
  | 'unknown'
  | 'auth'
  | 'invalid';

export class PayPalError extends Error {
  readonly kind: PayPalErrorKind;
  readonly status: number | undefined;
  /** PayPal's `debug_id`, which PayPal support needs. Always log it. */
  readonly debugId: string | undefined;
  readonly issue: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: PayPalErrorKind,
    message: string,
    details: { status?: number; debugId?: string; issue?: string; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'PayPalError';
    this.kind = kind;
    this.status = details.status;
    this.debugId = details.debugId;
    this.issue = details.issue;
    this.retryAfterMs = details.retryAfterMs;
  }
}

const DECLINES = new Set([
  'INSTRUMENT_DECLINED',
  'TRANSACTION_REFUSED',
  'PAYER_ACCOUNT_RESTRICTED',
]);

export function classify(status: number, issue: string | undefined): PayPalErrorKind {
  if (status === 401) return 'auth';
  if (status === 429 || status >= 500) return 'retryable';
  if (status === 422 && issue !== undefined && DECLINES.has(issue)) return 'declined';
  return 'rejected';
}
