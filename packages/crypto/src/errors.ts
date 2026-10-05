/** Why a cryptographic operation was refused. */
export type CryptoErrorCode =
  /** A value is malformed, or cannot be written as canonical JSON. */
  | 'invalid-input'
  /** A key has the wrong size or encoding. */
  | 'invalid-key'
  /** A sealed secret names a key version the keyring does not hold. */
  | 'unknown-key-version'
  /** Wrong key, wrong context, or the data was altered. Deliberately says no more than that. */
  | 'decryption-failed';

/**
 * The only error this package throws. Messages name what is wrong with the input but never contain
 * a key, a plaintext or a signature, so an error can be logged without leaking a secret.
 */
export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}
