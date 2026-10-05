import { describe, expect, it } from 'vitest';
import {
  assertKey,
  constantTimeEqual,
  decodeKey,
  fromBase64Url,
  fromHex,
  toBase64Url,
  toHex,
  utf8,
} from '../src/bytes';
import { CryptoError } from '../src/errors';
import { testKey } from './support';

describe('hex', () => {
  it('writes lower-case and reads either case', () => {
    expect(toHex(Uint8Array.of(0, 15, 16, 255))).toBe('000f10ff');
    expect(fromHex('000F10Ff')).toEqual(Uint8Array.of(0, 15, 16, 255));
    expect(fromHex('')).toEqual(new Uint8Array());
  });

  it.each(['0', 'abc', 'zz', '0x00', ' 00', '00 ', '0g', '00\n'])('refuses %j', (text) => {
    expect(() => fromHex(text)).toThrow(CryptoError);
  });
});

describe('base64url', () => {
  // The test vectors of RFC 4648 section 10, without padding.
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %j as %j and back', (plain, encoded) => {
    expect(toBase64Url(utf8(plain))).toBe(encoded);
    expect(fromBase64Url(encoded)).toEqual(utf8(plain));
  });

  it('uses the URL-safe alphabet', () => {
    expect(toBase64Url(Uint8Array.of(0xfb, 0xff, 0xfe))).toBe('-__-');
    expect(fromBase64Url('-__-')).toEqual(Uint8Array.of(0xfb, 0xff, 0xfe));
  });

  it.each([
    ['padding', 'Zg=='],
    ['spare bits that are not zero', 'Zh'],
    ['a lone character', 'Z'],
    ['the standard alphabet', 'Zm9v+A'],
    ['a space', 'Zm 9v'],
    ['a newline', 'Zm9v\n'],
    ['non-ASCII text', 'Zm9é'],
  ])('refuses %s, so one value has one spelling', (_reason, text) => {
    expect(() => fromBase64Url(text)).toThrow(CryptoError);
  });
});

describe('constantTimeEqual', () => {
  it('compares bytes', () => {
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it('is false, not an error, for different lengths', () => {
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2))).toBe(false);
  });
});

describe('keys', () => {
  const key = testKey(7);

  it('reads 64 hex characters in either case, or 43 base64url characters', () => {
    expect(decodeKey(toHex(key))).toEqual(key);
    expect(decodeKey(toHex(key).toUpperCase())).toEqual(key);
    expect(decodeKey(toBase64Url(key))).toEqual(key);
  });

  it('ignores whitespace around the key, as an env file or a pasted line may add', () => {
    expect(decodeKey(`  ${toHex(key)}\n`)).toEqual(key);
  });

  it.each([
    ['empty', ''],
    ['too short in hex', toHex(testKey(1)).slice(0, 62)],
    ['too long in hex', `${toHex(testKey(1))}00`],
    ['too short in base64url', toBase64Url(testKey(1)).slice(0, 42)],
    ['too long in base64url', `${toBase64Url(testKey(1))}A`],
    ['64 characters that are not hex', 'g'.repeat(64)],
    ['standard base64 with padding', `${Buffer.from(testKey(1)).toString('base64')}`],
    ['sixteen bytes', toHex(testKey(1).subarray(0, 16))],
  ])('refuses a key that is %s', (_reason, text) => {
    expect(() => decodeKey(text)).toThrow(expect.objectContaining({ code: 'invalid-key' }));
  });

  it('never repeats the text it refuses, which may be a real secret', () => {
    const almost = `${toHex(key).slice(0, 63)}!`;
    expect(() => decodeKey(almost)).toThrow(CryptoError);
    expect(() => decodeKey(almost)).not.toThrow(almost);
  });

  it('refuses to use a key of the wrong size', () => {
    expect(() => assertKey(key)).not.toThrow();
    for (const size of [0, 16, 31, 33, 64]) {
      expect(() => assertKey(new Uint8Array(size))).toThrow(
        expect.objectContaining({ code: 'invalid-key' }),
      );
    }
  });
});
