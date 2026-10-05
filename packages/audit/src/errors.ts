/** Why an entry could not be appended. */
export type AuditErrorCode =
  /** The head to append to is not a valid head. */
  | 'invalid-head'
  /** The entry, or the options of a verification, are not valid. */
  | 'invalid-event'
  /** The payload is larger than the log accepts. */
  | 'payload-too-large';

/**
 * Thrown when the caller gives the log something it must not accept. Verifying the entries never
 * throws: whatever is wrong with them is the verdict.
 */
export class AuditError extends Error {
  readonly code: AuditErrorCode;

  constructor(code: AuditErrorCode, message: string) {
    super(message);
    this.name = 'AuditError';
    this.code = code;
  }
}
