import { timingSafeEqual } from 'node:crypto';
import { CryptoError } from './errors';

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/** Reads hex in either case. Anything that is not whole bytes of hex is an error, not truncated. */
export function fromHex(text: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(text)) {
    throw new CryptoError('invalid-input', 'Not a hex string of whole bytes.');
  }
  return Uint8Array.from(Buffer.from(text, 'hex'));
}

/** Unpadded base64url, the alphabet that is safe in URLs, headers and file names. */
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Reads unpadded base64url strictly. Node's decoder quietly skips characters it does not know and
 * accepts padding and the other alphabet, so the text must re-encode to exactly what was given:
 * one value has one spelling.
 */
export function fromBase64Url(text: string): Uint8Array {
  const bytes = Uint8Array.from(Buffer.from(text, 'base64url'));
  if (toBase64Url(bytes) !== text) {
    throw new CryptoError('invalid-input', 'Not canonical unpadded base64url.');
  }
  return bytes;
}

/** Whether two byte strings are equal, in time that does not depend on where they first differ. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every key in Bursar is 256 bits: HMAC-SHA-256 keys and AES-256 keys alike. */
export const KEY_BYTES = 32;

/** Refuses a key of the wrong size, so a short or empty secret can never be used by accident. */
export function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) {
    throw new CryptoError('invalid-key', `A key must be ${KEY_BYTES} bytes, not ${key.length}.`);
  }
}

/**
 * Reads a 256-bit key from configuration: 64 hex characters (`openssl rand -hex 32`) or 43
 * base64url characters. The error never repeats the text, which may be a real secret.
 */
export function decodeKey(text: string): Uint8Array {
  const trimmed = text.trim();
  let bytes: Uint8Array | undefined;
  try {
    bytes = trimmed.length === KEY_BYTES * 2 ? fromHex(trimmed) : fromBase64Url(trimmed);
  } catch {
    bytes = undefined;
  }
  if (bytes?.length !== KEY_BYTES) {
    throw new CryptoError(
      'invalid-key',
      `A key is ${KEY_BYTES} bytes: ${KEY_BYTES * 2} hex characters or 43 base64url characters.`,
    );
  }
  return bytes;
}
