import { randomBytes } from 'node:crypto';

/** A source of random bytes, injectable so tests are deterministic. */
export type RandomBytes = (length: number) => Uint8Array;

/** The operating system's cryptographically secure source. */
export const systemRandomBytes: RandomBytes = (length) => Uint8Array.from(randomBytes(length));
