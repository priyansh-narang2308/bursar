import { idempotencyKeySchema } from '@bursar/schemas';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { payPalRequestId, uuidV5 } from '../src/uuid';
import { VECTORS } from './vectors';

const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidV5', () => {
  it('matches the example in RFC 9562 and an independently computed one', () => {
    expect(uuidV5(DNS_NAMESPACE, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(uuidV5(URL_NAMESPACE, 'https://example.com/a')).toBe(
      '6639460f-3425-5329-8097-a58f06127860',
    );
  });

  it.each([
    [
      'a name in mixed case, which is not folded',
      'WWW.Example.COM',
      'eb705280-f36f-5495-a1bd-ad31a8664c1e',
    ],
    ['a name in UTF-8', 'café €', '64dfc276-5035-5d4f-8a88-ee2603e43f4e'],
    ['an empty name', '', '4ebd0208-8328-5d69-8c44-ec50939c0967'],
  ])('matches Python for %s', (_what, name, expected) => {
    expect(uuidV5(DNS_NAMESPACE, name)).toBe(expected);
  });

  it('is deterministic and always version 5 with the RFC variant', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (name) => {
        const id = uuidV5(DNS_NAMESPACE, name);
        expect(id).toMatch(V5);
        expect(uuidV5(DNS_NAMESPACE, name)).toBe(id);
      }),
    );
  });

  it('gives different names and different namespaces different ids', () => {
    expect(uuidV5(DNS_NAMESPACE, 'a')).not.toBe(uuidV5(DNS_NAMESPACE, 'b'));
    expect(uuidV5(DNS_NAMESPACE, 'a')).not.toBe(uuidV5(URL_NAMESPACE, 'a'));
  });

  it.each([
    ['empty', ''],
    ['without dashes', '6ba7b8109dad11d180b400c04fd430c8'],
    ['in upper case', DNS_NAMESPACE.toUpperCase()],
    ['too short', DNS_NAMESPACE.slice(0, -1)],
    ['with other text', `${DNS_NAMESPACE}x`],
  ])('refuses a namespace that is %s', (_what, namespace) => {
    expect(() => uuidV5(namespace, 'x')).toThrow(
      expect.objectContaining({ code: 'invalid-input' }),
    );
  });
});

describe('payPalRequestId', () => {
  // Computed independently with Python's uuid.uuid5 from the written format.
  const idempotency = idempotencyKeySchema.parse(VECTORS.idempotency);

  it('matches the independently computed value', () => {
    expect(payPalRequestId(idempotency, 'capture')).toBe(VECTORS.requestId);
  });

  it('is stable, so a retry of a call reuses its id', () => {
    expect(payPalRequestId(idempotency, 'capture')).toBe(payPalRequestId(idempotency, 'capture'));
  });

  it('differs between the calls made for one action, and between actions', () => {
    const other = idempotencyKeySchema.parse('f'.repeat(64));
    const ids = [
      payPalRequestId(idempotency, 'create-order'),
      payPalRequestId(idempotency, 'authorize'),
      payPalRequestId(idempotency, 'capture'),
      payPalRequestId(other, 'capture'),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(V5);
      expect(id.length).toBeLessThanOrEqual(108); // PayPal's limit on the header
    }
  });

  it.each(['', 'Capture', '1capture', 'cap ture', 'cap_ture', 'a'.repeat(33), 'capture\n'])(
    'refuses the step %j',
    (step) => {
      expect(() => payPalRequestId(idempotency, step)).toThrow(
        expect.objectContaining({ code: 'invalid-input' }),
      );
    },
  );

  it('accepts a step of up to 32 characters', () => {
    expect(payPalRequestId(idempotency, 'a'.repeat(32))).toMatch(V5);
  });
});
