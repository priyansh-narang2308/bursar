import { describe, expect, it } from 'vitest';
import { toBase64Url, utf8 } from '../src/bytes';
import { domainMac } from '../src/mac';
import { signSession, verifySession } from '../src/session';
import { flipBit, testKey } from './support';

const key = testKey(0x20);
const claims = { userId: 'usr_1', role: 'OWNER', exp: 1_800_000_000 };

describe('sessions', () => {
  it('round-trips claims', () => {
    expect(verifySession(key, signSession(key, claims))).toEqual(claims);
  });

  it('is the same token for the same claims, whatever the key order', () => {
    expect(signSession(key, { b: 1, a: 2 })).toBe(signSession(key, { a: 2, b: 1 }));
  });

  it('refuses another key and any altered part', () => {
    const token = signSession(key, claims);
    expect(verifySession(flipBit(key, 0), token)).toBeUndefined();
    const [payload = '', mac = ''] = token.split('.');
    const swap = (text: string) =>
      `${text.slice(0, 2)}${text[2] === 'A' ? 'B' : 'A'}${text.slice(3)}`;
    expect(verifySession(key, `${swap(payload)}.${mac}`)).toBeUndefined();
    expect(verifySession(key, `${payload}.${swap(mac)}`)).toBeUndefined();
  });

  it.each(['', 'x', 'a.b.c', '.', 'abc.'])('refuses the malformed token %j', (token) => {
    expect(verifySession(key, token)).toBeUndefined();
  });

  it('refuses a validly signed payload that is not an object', () => {
    for (const body of ['[1]', '"text"', 'null', 'not json']) {
      const payload = toBase64Url(utf8(body));
      const mac = toBase64Url(domainMac(key, 'session', payload));
      expect(verifySession(key, `${payload}.${mac}`)).toBeUndefined();
    }
  });
});
