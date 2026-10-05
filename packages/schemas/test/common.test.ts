import { CURRENCY_CODES, MAX_MINOR, MIN_MINOR, moneyFromJSON } from '@bursar/money';
import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  amountSchema,
  type CartHash,
  cartHashSchema,
  DEFAULT_PAGE_SIZE,
  idempotencyKeySchema,
  inputsHashSchema,
  jsonObjectSchema,
  jsonValueSchema,
  MAX_PAGE_SIZE,
  moneySchema,
  type PolicyHash,
  pageQuerySchema,
  pageSchema,
  policyHashSchema,
  sha256HexSchema,
  textSchema,
  timestampSchema,
} from '../src/common';

const accepts = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;

describe('timestampSchema', () => {
  it.each([
    '2026-10-05T12:30:00Z',
    '2026-10-05T12:30:00.5Z',
    '2026-10-05T12:30:00.123456Z',
    '2024-02-29T00:00:00Z', // a leap day
  ])('accepts %s', (value) => {
    expect(accepts(timestampSchema, value)).toBe(true);
  });

  it.each([
    ['a UTC offset', '2026-10-05T12:30:00+05:30'],
    ['no zone', '2026-10-05T12:30:00'],
    ['a date only', '2026-10-05'],
    ['an impossible date', '2026-02-30T00:00:00Z'],
    ['a non-leap 29 February', '2026-02-29T00:00:00Z'],
    ['an hour of 24', '2026-10-05T24:00:00Z'],
    ['lower-case t and z', '2026-10-05t12:30:00z'],
    ['padding', ' 2026-10-05T12:30:00Z'],
    ['a long fraction', `2026-10-05T12:30:00.${'1'.repeat(30)}Z`],
    ['a number', 1_790_000_000],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(accepts(timestampSchema, value)).toBe(false);
  });
});

describe('textSchema', () => {
  const text = textSchema(10);

  it('accepts text up to its limit', () => {
    expect(accepts(text, 'a')).toBe(true);
    expect(accepts(text, '0123456789')).toBe(true);
    expect(accepts(text, 'two words')).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['blank', ' \n\t '],
    ['too long', '01234567890'],
    ['not text', 7],
  ])('rejects text that is %s', (_label, value) => {
    expect(accepts(text, value)).toBe(false);
  });
});

describe('money schemas', () => {
  const usd = (minor: string) => ({ currency: 'USD', minor });

  it.each([usd('0'), usd('1550'), usd(MAX_MINOR.toString()), { currency: 'JPY', minor: '1050' }])(
    'accept the amount %j in both forms',
    (value) => {
      expect(accepts(moneySchema, value)).toBe(true);
      expect(accepts(amountSchema, value)).toBe(true);
    },
  );

  it('lets a signed money be negative and an amount not', () => {
    expect(accepts(moneySchema, usd('-5'))).toBe(true);
    expect(accepts(moneySchema, usd(MIN_MINOR.toString()))).toBe(true);
    expect(accepts(amountSchema, usd('-5'))).toBe(false);
  });

  it.each([
    ['an extra key', { ...usd('1'), note: 'x' }],
    ['a missing key', { currency: 'USD' }],
    ['a number for the amount', { currency: 'USD', minor: 1550 }],
    ['a decimal amount', usd('15.50')],
    ['negative zero', usd('-0')],
    ['a leading zero', usd('01')],
    ['a lower-case currency', { currency: 'usd', minor: '1' }],
    ['an unsupported currency', { currency: 'XXX', minor: '1' }],
    ['an amount past the 64-bit range', usd((MAX_MINOR + 1n).toString())],
    ['a huge amount', usd('9'.repeat(40))],
    ['a string', 'USD 15.50'],
    ['null', null],
  ])('reject %s', (_label, value) => {
    expect(accepts(moneySchema, value)).toBe(false);
    expect(accepts(amountSchema, value)).toBe(false);
  });

  it('agree exactly with @bursar/money on what a valid amount is', () => {
    const text = fc.oneof(
      fc.bigInt({ min: MIN_MINOR - 5n, max: MAX_MINOR + 5n }).map(String),
      fc.string({ maxLength: 8 }),
      fc.constantFrom('0', '-0', '007', '+5', '1e3', ''),
    );
    const candidate = fc.record({
      currency: fc.oneof(fc.constantFrom(...CURRENCY_CODES), fc.string({ maxLength: 4 })),
      minor: text,
    });
    const moneyAccepts = (value: unknown): boolean => {
      try {
        moneyFromJSON(value);
        return true;
      } catch {
        return false;
      }
    };

    fc.assert(
      fc.property(candidate, (value) => {
        expect(accepts(moneySchema, value)).toBe(moneyAccepts(value));
        expect(accepts(amountSchema, value)).toBe(
          moneyAccepts(value) && !value.minor.startsWith('-'),
        );
      }),
    );
  });
});

describe('digest schemas', () => {
  const digest = 'ab'.repeat(32);

  it('accept 64 lower-case hex characters and nothing else', () => {
    for (const schema of [
      sha256HexSchema,
      cartHashSchema,
      policyHashSchema,
      inputsHashSchema,
      idempotencyKeySchema,
    ]) {
      expect(accepts(schema, digest)).toBe(true);
      expect(accepts(schema, digest.toUpperCase())).toBe(false);
      expect(accepts(schema, digest.slice(1))).toBe(false);
      expect(accepts(schema, `${digest}0`)).toBe(false);
      expect(accepts(schema, `${'g'.repeat(64)}`)).toBe(false);
      expect(accepts(schema, 42)).toBe(false);
    }
  });

  it('are distinct types, so a cart hash cannot be passed where a policy hash is wanted', () => {
    expectTypeOf<CartHash>().not.toEqualTypeOf<PolicyHash>();
    expectTypeOf<CartHash>().toExtend<string>();
  });
});

describe('JSON schemas', () => {
  it('accept any JSON value, nested', () => {
    const value = { a: [1, 'two', null, { b: true }], c: { d: [] } };

    expect(accepts(jsonValueSchema, value)).toBe(true);
    expect(accepts(jsonObjectSchema, value)).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a Date', new Date()],
    ['a bigint', 10n],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('reject %s', (_label, value) => {
    expect(accepts(jsonValueSchema, value)).toBe(false);
  });

  it('only treats objects as JSON objects', () => {
    expect(accepts(jsonObjectSchema, [1])).toBe(false);
    expect(accepts(jsonObjectSchema, 'text')).toBe(false);
    expect(accepts(jsonObjectSchema, { ['k'.repeat(101)]: 1 })).toBe(false);
  });
});

describe('pagination', () => {
  it('gives a list query a default page size and coerces the text it arrives as', () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_SIZE });
    expect(pageQuerySchema.parse({ limit: '10', cursor: 'abc' })).toEqual({
      limit: 10,
      cursor: 'abc',
    });
  });

  it.each([
    ['zero', { limit: '0' }],
    ['over the maximum', { limit: String(MAX_PAGE_SIZE + 1) }],
    ['a fraction', { limit: '1.5' }],
    ['text', { limit: 'many' }],
    ['an empty cursor', { cursor: '' }],
    ['a long cursor', { cursor: 'c'.repeat(201) }],
    ['an unknown key', { page: 2 }],
  ])('rejects a query with %s', (_label, query) => {
    expect(accepts(pageQuerySchema, query)).toBe(false);
  });

  const page = pageSchema(z.string());

  it('wraps items and a cursor, with null on the last page', () => {
    expect(accepts(page, { items: ['a', 'b'], nextCursor: 'next' })).toBe(true);
    expect(accepts(page, { items: [], nextCursor: null })).toBe(true);
  });

  it('refuses a page bigger than the maximum, or without a cursor field', () => {
    expect(
      accepts(page, {
        items: Array.from({ length: MAX_PAGE_SIZE + 1 }, () => 'x'),
        nextCursor: null,
      }),
    ).toBe(false);
    expect(accepts(page, { items: [] })).toBe(false);
    expect(accepts(page, { items: [1], nextCursor: null })).toBe(false);
  });
});
