import { describe, expect, it } from 'vitest';
import {
  CURRENCY_CODES,
  currencyExponent,
  isCurrencyCode,
  parseCurrencyCode,
} from '../src/currencies';
import { codeOf } from './support';

describe('the currency registry', () => {
  it("lists the 25 currencies on PayPal's currency-codes page, upper-case, sorted and unique", () => {
    expect(CURRENCY_CODES).toHaveLength(25);
    expect([...CURRENCY_CODES]).toEqual([...CURRENCY_CODES].sort());
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
    for (const code of CURRENCY_CODES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('gives HUF, JPY and TWD no decimals and every other currency two', () => {
    // ISO 4217 gives HUF and TWD two digits. PayPal's wire format does not, and it decides.
    expect(CURRENCY_CODES.filter((code) => currencyExponent(code) === 0)).toEqual([
      'HUF',
      'JPY',
      'TWD',
    ]);
    expect(CURRENCY_CODES.filter((code) => currencyExponent(code) === 2)).toHaveLength(22);
  });
});

describe('isCurrencyCode and parseCurrencyCode', () => {
  it.each(CURRENCY_CODES)('accept %s', (code) => {
    expect(isCurrencyCode(code)).toBe(true);
    expect(parseCurrencyCode(code)).toBe(code);
  });

  it.each([
    'usd', // codes are upper-case, never normalised
    'Usd',
    ' USD',
    'USD ',
    'US',
    'USDD',
    '',
    'XXX',
    'BAD', // well-formed, but not a currency
    'BHD', // a real ISO currency that PayPal does not accept
    'KWD',
  ])('reject the string %j instead of defaulting to two decimals', (value) => {
    expect(isCurrencyCode(value)).toBe(false);
    expect(codeOf(() => parseCurrencyCode(value))).toBe('invalid-currency');
  });

  it.each([null, undefined, 840, 1n, {}, ['USD'], true])('reject the non-string %s', (value) => {
    expect(isCurrencyCode(value)).toBe(false);
    expect(codeOf(() => parseCurrencyCode(value))).toBe('invalid-currency');
  });
});
