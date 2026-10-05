/** Stable, machine-readable reasons a money operation can fail. */
export type MoneyErrorCode =
  /** The currency is not one PayPal accepts. */
  | 'invalid-currency'
  /** An operation mixed two currencies. */
  | 'currency-mismatch'
  /** An amount is malformed: wrong type, or not a canonical decimal string. */
  | 'invalid-amount'
  /** A result would leave the signed 64-bit range. */
  | 'out-of-range'
  /** Any other bad argument: a negative weight, a zero denominator, an unknown rounding mode. */
  | 'invalid-argument';

/**
 * The only error this package throws on bad input. Callers branch on `code`, never on the
 * message, so the wording can improve without breaking them.
 */
export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

const MAX_DESCRIBED_LENGTH = 32;

/**
 * Describes an untrusted value for an error message without echoing a huge payload or throwing
 * on exotic values: strings are quoted and truncated, everything else shows its type.
 */
export function describeValue(value: unknown): string {
  if (typeof value !== 'string') {
    return value === null ? 'null' : typeof value;
  }
  const shown =
    value.length > MAX_DESCRIBED_LENGTH ? `${value.slice(0, MAX_DESCRIBED_LENGTH)}…` : value;
  return JSON.stringify(shown);
}
