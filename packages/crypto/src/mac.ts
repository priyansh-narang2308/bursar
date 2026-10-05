import { createHmac } from 'node:crypto';
import { assertKey } from './bytes';
import type { MacDomain } from './domains';
import { domainInput } from './hash';

/** HMAC-SHA-256 (RFC 2104) of raw bytes under a key of any length, as tested against RFC 4231. */
export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return Uint8Array.from(createHmac('sha256', key).update(data).digest());
}

/**
 * The MAC of a value in the context of one purpose, under a 256-bit key. The purpose is part of
 * what is authenticated, so a MAC made for an approval cannot be passed off as a provenance tag
 * even if both were somehow made with the same key.
 */
export function domainMac(key: Uint8Array, domain: MacDomain, value: unknown): Uint8Array {
  assertKey(key);
  return hmacSha256(key, domainInput(domain, value));
}
