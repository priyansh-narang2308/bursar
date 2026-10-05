import { createHash } from 'node:crypto';
import { utf8 } from './bytes';
import { canonicalize } from './canonical';
import { DOMAINS, type Domain, type HashDomain } from './domains';

/** SHA-256 as 64 lower-case hex characters. Text is hashed as UTF-8. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * What is actually hashed or signed for a value: the purpose's label, a newline, then the
 * value as canonical JSON. A label never contains a newline and canonical JSON never starts
 * mid-label, so two different (purpose, value) pairs can never give the same bytes.
 */
export function domainInput(domain: Domain, value: unknown): Uint8Array {
  return utf8(`${DOMAINS[domain]}\n${canonicalize(value)}`);
}

/**
 * The SHA-256 of a value in the context of one purpose. Hashing a cart and hashing a policy that
 * happen to serialise identically still give different digests, so a digest made for one purpose
 * cannot be presented as another.
 */
export function domainHash(domain: HashDomain, value: unknown): string {
  return sha256Hex(domainInput(domain, value));
}
