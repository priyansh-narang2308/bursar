import { describe, expect, it } from 'vitest';
import { toHex, utf8 } from '../src/bytes';
import { canonicalize } from '../src/canonical';
import { DOMAINS } from '../src/domains';
import { domainHash, domainInput, sha256Hex } from '../src/hash';
import { cartContent } from './support';

describe('sha256Hex: FIPS 180-4 and NIST example values', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    ['a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ])('hashes %.20j', (text, expected) => {
    expect(sha256Hex(text)).toBe(expected);
    expect(sha256Hex(utf8(text))).toBe(expected);
  });

  it('hashes text as UTF-8', () => {
    expect(sha256Hex('€')).toBe(sha256Hex(Uint8Array.of(0xe2, 0x82, 0xac)));
  });
});

describe('domain separation', () => {
  it('hashes the label, a newline, then the canonical JSON', () => {
    const value = { b: 1, a: [true] };
    expect(domainInput('cart', value)).toEqual(utf8('bursar.cart.v1\n{"a":[true],"b":1}'));
    expect(domainHash('cart', value)).toBe(sha256Hex('bursar.cart.v1\n{"a":[true],"b":1}'));
  });

  it('gives the same value a different digest for every purpose', () => {
    const purposes = [
      'cart',
      'policy',
      'inputs',
      'idempotency',
      'auditGenesis',
      'auditEntry',
    ] as const;
    const digests = purposes.map((purpose) => domainHash(purpose, cartContent));
    expect(new Set(digests).size).toBe(purposes.length);
    expect(digests).not.toContain(sha256Hex(canonicalize(cartContent)));
  });

  it('keeps a label from being read as the start of a value', () => {
    // If the label were not delimited, ("a", "b...") and ("ab", "...") could collide.
    expect(domainInput('cart', 'x')).not.toEqual(domainInput('policy', 'x'));
    expect(toHex(domainInput('cart', 'x'))).not.toBe(
      toHex(utf8(`bursar.cart.v1${canonicalize('x')}`)),
    );
  });

  it('has one distinct, versioned label per purpose', () => {
    const labels = Object.values(DOMAINS);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label).toMatch(/^bursar(?:\.[a-z]+)+\.v1$/);
    }
  });
});
