import { describe, expect, it } from 'vitest';
import { toHex, utf8 } from '../src/bytes';
import { domainInput } from '../src/hash';
import { domainMac, hmacSha256 } from '../src/mac';
import { flipBit, testKey } from './support';

const repeat = (byte: string, count: number) => byte.repeat(count);

/** HMAC-SHA-256 test cases 1 to 7 of RFC 4231; `k` is the key, `d` the data, both in hex. */
const RFC_4231 = [
  {
    name: 'case 1',
    k: repeat('0b', 20),
    d: toHex(utf8('Hi There')),
    mac: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
  },
  {
    name: 'case 2: a key shorter than the output',
    k: toHex(utf8('Jefe')),
    d: toHex(utf8('what do ya want for nothing?')),
    mac: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  },
  {
    name: 'case 3: key and data longer than a block together',
    k: repeat('aa', 20),
    d: repeat('dd', 50),
    mac: '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
  },
  {
    name: 'case 4',
    k: '0102030405060708090a0b0c0d0e0f10111213141516171819',
    d: repeat('cd', 50),
    mac: '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
  },
  {
    name: 'case 6: a key larger than a block',
    k: repeat('aa', 131),
    d: toHex(utf8('Test Using Larger Than Block-Size Key - Hash Key First')),
    mac: '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
  },
  {
    name: 'case 7: a key and data larger than a block',
    k: repeat('aa', 131),
    d: toHex(
      utf8(
        'This is a test using a larger than block-size key and a larger than block-size data. ' +
          'The key needs to be hashed before being used by the HMAC algorithm.',
      ),
    ),
    mac: '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
  },
];

describe('hmacSha256: RFC 4231', () => {
  it.each(RFC_4231)('matches $name', ({ k, d, mac }) => {
    const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
    expect(toHex(hmacSha256(bytes(k), bytes(d)))).toBe(mac);
  });

  it('matches case 5, which the RFC truncates to 128 bits', () => {
    const mac = hmacSha256(Uint8Array.from(Buffer.alloc(20, 0x0c)), utf8('Test With Truncation'));
    expect(toHex(mac).slice(0, 32)).toBe('a3b6167473100ee06e0c796c2955552b');
  });
});

describe('domainMac', () => {
  const key = testKey(3);

  it('is the HMAC of the domain input', () => {
    expect(domainMac(key, 'approval', { a: 1 })).toEqual(
      hmacSha256(key, domainInput('approval', { a: 1 })),
    );
  });

  it('depends on the purpose, the value and every bit of the key', () => {
    const base = toHex(domainMac(key, 'approval', { a: 1 }));
    expect(toHex(domainMac(key, 'provenance', { a: 1 }))).not.toBe(base);
    expect(toHex(domainMac(key, 'approval', { a: 2 }))).not.toBe(base);
    for (let byte = 0; byte < key.length; byte++) {
      expect(toHex(domainMac(flipBit(key, byte, byte % 8), 'approval', { a: 1 }))).not.toBe(base);
    }
  });

  it.each([0, 16, 31, 33])('refuses a key of %s bytes', (size) => {
    expect(() => domainMac(new Uint8Array(size), 'approval', {})).toThrow(
      expect.objectContaining({ code: 'invalid-key' }),
    );
  });
});
