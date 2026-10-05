import { createCipheriv, createDecipheriv } from 'node:crypto';
import { assertKey, decodeKey, fromBase64Url, toBase64Url, utf8 } from './bytes';
import { DOMAINS } from './domains';
import { CryptoError } from './errors';
import { type RandomBytes, systemRandomBytes } from './random';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Sealed secrets are identifiers and tokens, not documents. */
const MAX_SECRET_BYTES = 4096;

const SEALED_PREFIX = 'bursar:secret:v1';
const BASE64URL = '[A-Za-z0-9_-]';
const MAX_CIPHERTEXT_CHARS = Math.ceil((MAX_SECRET_BYTES * 4) / 3);

/** `bursar:secret:v1:<key version>:<iv>:<ciphertext>:<tag>`, each part unpadded base64url. */
const SEALED_PATTERN = new RegExp(
  [
    `^${SEALED_PREFIX}`,
    '(?<version>[1-9][0-9]{0,8})',
    `(?<iv>${BASE64URL}{16})`,
    `(?<ciphertext>${BASE64URL}{1,${MAX_CIPHERTEXT_CHARS}})`,
    `(?<tag>${BASE64URL}{22})$`,
  ].join(':'),
);

const VERSION_PATTERN = /^[1-9][0-9]{0,8}$/;

// ---------------------------------------------------------------------------------------
// AES-256-GCM
// ---------------------------------------------------------------------------------------

/** AES-256-GCM with a 96-bit IV and a 128-bit tag, as tested against the published vectors. */
export function aesGcmEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): { readonly ciphertext: Uint8Array; readonly tag: Uint8Array } {
  assertKey(key);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: Uint8Array.from(ciphertext), tag: Uint8Array.from(cipher.getAuthTag()) };
}

/**
 * The plaintext, if and only if the tag authenticates the ciphertext and the additional data under
 * this key. Every failure is the same error, so it reveals nothing about why.
 */
export function aesGcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  assertKey(key);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Uint8Array.from(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  } catch {
    throw new CryptoError(
      'decryption-failed',
      'The secret could not be decrypted: wrong key or context, or it was altered.',
    );
  }
}

// ---------------------------------------------------------------------------------------
// Keys and versions
// ---------------------------------------------------------------------------------------

/**
 * The keys that protect secrets at rest. New secrets are sealed with the newest key and carry its
 * version, and old ones stay readable for as long as their key is kept, so a key can be rotated
 * without downtime: add the new one, re-seal in the background, then retire the old one.
 */
export interface Keyring {
  readonly current: { readonly version: number; readonly key: Uint8Array };
  /** Every key that can still open a secret, the current one included, by version. */
  readonly keys: ReadonlyMap<number, Uint8Array>;
}

function parseEntry(entry: string, alone: boolean): readonly [number, Uint8Array] {
  const separator = entry.indexOf(':');
  if (separator === -1) {
    if (!alone) {
      throw new CryptoError('invalid-key', 'Each key in a keyring of several is version:key.');
    }
    return [1, decodeKey(entry)];
  }
  const version = entry.slice(0, separator).trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new CryptoError('invalid-key', 'A key version is a whole number from 1 to 999999999.');
  }
  return [Number(version), decodeKey(entry.slice(separator + 1))];
}

/**
 * Reads a keyring from configuration: `version:key` entries separated by commas, for example
 * `2:<key>,1:<key>`, where the highest version seals and every version opens. A single bare key,
 * the output of `openssl rand -hex 32`, is version 1. Errors never repeat the key text.
 */
export function parseKeyring(spec: string): Keyring {
  const entries = spec.split(',');
  const parsed = entries.map((entry) => parseEntry(entry.trim(), entries.length === 1));
  const keys = new Map(parsed);
  if (keys.size !== parsed.length) {
    throw new CryptoError('invalid-key', 'A key version appears more than once.');
  }
  const [version, key] = parsed.reduce((newest, entry) => (entry[0] > newest[0] ? entry : newest));
  return { current: { version, key }, keys };
}

// ---------------------------------------------------------------------------------------
// Sealed secrets
// ---------------------------------------------------------------------------------------

interface Sealed {
  readonly version: number;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly tag: Uint8Array;
}

function parseSealed(text: string): Sealed {
  const groups: Record<string, string | undefined> = SEALED_PATTERN.exec(text)?.groups ?? {};
  const { version, iv, ciphertext, tag } = groups;
  if (version === undefined || iv === undefined || ciphertext === undefined || tag === undefined) {
    throw new CryptoError('invalid-input', 'Not a sealed secret.');
  }
  return {
    version: Number(version),
    iv: fromBase64Url(iv),
    ciphertext: fromBase64Url(ciphertext),
    tag: fromBase64Url(tag),
  };
}

/**
 * What the ciphertext is bound to besides the key: the format, the key version and the caller's
 * context. Moving a sealed value to another row, or editing its version, fails to decrypt.
 */
function additionalData(version: number, context: string): Uint8Array {
  if (context === '' || !context.isWellFormed()) {
    throw new CryptoError('invalid-input', 'A context is non-empty text, such as a row key.');
  }
  return utf8(`${DOMAINS.secret}\n${version}\n${context}`);
}

function secretBytes(plaintext: string): Uint8Array {
  const bytes = utf8(plaintext);
  if (bytes.length === 0 || bytes.length > MAX_SECRET_BYTES || !plaintext.isWellFormed()) {
    throw new CryptoError('invalid-input', `A secret is 1 to ${MAX_SECRET_BYTES} bytes of text.`);
  }
  return bytes;
}

/**
 * Seals a secret such as a PayPal Vault token id for storage: AES-256-GCM under the current key
 * with a fresh random IV, bound to `context` (use something unique to where it is stored, such as
 * the mandate's id, so a value copied into another row will not open). With random 96-bit IVs a
 * key should seal fewer than 2^32 secrets, which is far beyond what a vault holds; rotate before.
 */
export function encryptSecret(
  keyring: Keyring,
  plaintext: string,
  context: string,
  random: RandomBytes = systemRandomBytes,
): string {
  const data = secretBytes(plaintext);
  const { version, key } = keyring.current;
  const aad = additionalData(version, context);
  const iv = random(IV_BYTES);
  if (iv.length !== IV_BYTES) {
    throw new CryptoError('invalid-input', `The random source must give ${IV_BYTES} bytes.`);
  }
  const { ciphertext, tag } = aesGcmEncrypt(key, iv, data, aad);
  return [SEALED_PREFIX, version, toBase64Url(iv), toBase64Url(ciphertext), toBase64Url(tag)].join(
    ':',
  );
}

/**
 * Opens a sealed secret. It fails, with the same error whatever the reason, if the key or the
 * context is wrong or any part of it was altered; and with a different one if the keyring no
 * longer holds the key it was sealed with.
 */
export function decryptSecret(keyring: Keyring, sealed: string, context: string): string {
  const parsed = parseSealed(sealed);
  const key = keyring.keys.get(parsed.version);
  if (key === undefined) {
    throw new CryptoError(
      'unknown-key-version',
      `No key is held for version ${parsed.version}: retired too early, or the config is wrong.`,
    );
  }
  const aad = additionalData(parsed.version, context);
  return Buffer.from(aesGcmDecrypt(key, parsed.iv, parsed.ciphertext, parsed.tag, aad)).toString(
    'utf8',
  );
}

/** Whether a sealed secret was made with an older key than the current one. */
export function needsRotation(keyring: Keyring, sealed: string): boolean {
  return parseSealed(sealed).version !== keyring.current.version;
}

/** The same secret sealed again under the current key, for a background rotation job. */
export function resealSecret(
  keyring: Keyring,
  sealed: string,
  context: string,
  random: RandomBytes = systemRandomBytes,
): string {
  return encryptSecret(keyring, decryptSecret(keyring, sealed, context), context, random);
}
