import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromPayPalAmount, moneyFromJSON, toPayPalAmount } from '../src/codec';
import { MAX_MINOR, MIN_MINOR, Money } from '../src/money';
import { anyMoney, codeOf } from './support';

describe('Money#toJSON', () => {
  it('writes the amount as a string, because a JSON number cannot hold a bigint', () => {
    expect(Money.of(1050n, 'USD').toJSON()).toEqual({ currency: 'USD', minor: '1050' });
    expect(Money.of(MIN_MINOR, 'JPY').toJSON()).toEqual({
      currency: 'JPY',
      minor: '-9223372036854775807',
    });
  });

  it('lets JSON.stringify work, where a bare bigint makes it throw', () => {
    expect(JSON.stringify({ total: Money.of(1050n, 'USD') })).toBe(
      '{"total":{"currency":"USD","minor":"1050"}}',
    );
    expect(() => JSON.stringify({ minor: 1050n })).toThrow(TypeError);
  });
});

describe('moneyFromJSON', () => {
  it('reads what toJSON wrote, at both ends of the range', () => {
    for (const minor of [MIN_MINOR, -1n, 0n, 1n, 1050n, MAX_MINOR]) {
      const amount = Money.of(minor, 'EUR');
      expect(moneyFromJSON(amount.toJSON()).equals(amount)).toBe(true);
    }
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'USD 10.50'],
    ['a number', 1050],
    ['an array', ['USD', '1050']],
    ['an empty object', {}],
    ['a missing currency', { minor: '1050' }],
    ['a missing amount', { currency: 'USD' }],
    ['an extra key', { currency: 'USD', minor: '1050', note: 'x' }],
    ['a number for the amount', { currency: 'USD', minor: 1050 }],
    ['a bigint for the amount', { currency: 'USD', minor: 1050n }],
    ['a null amount', { currency: 'USD', minor: null }],
    ['an empty amount', { currency: 'USD', minor: '' }],
    ['a plus sign', { currency: 'USD', minor: '+1050' }],
    ['a leading zero', { currency: 'USD', minor: '01050' }],
    ['negative zero', { currency: 'USD', minor: '-0' }],
    ['a decimal point', { currency: 'USD', minor: '10.50' }],
    ['an exponent', { currency: 'USD', minor: '1e3' }],
    ['padding', { currency: 'USD', minor: ' 1050' }],
    ['a lone minus', { currency: 'USD', minor: '-' }],
    ['a huge amount', { currency: 'USD', minor: '9'.repeat(40) }],
  ])('rejects %s', (_label, input) => {
    expect(codeOf(() => moneyFromJSON(input))).toBe('invalid-amount');
  });

  it.each([
    ['a lower-case currency', 'usd'],
    ['an unsupported currency', 'XXX'],
    ['a missing currency value', undefined],
    ['a numeric currency', 840],
  ])('rejects %s', (_label, currency) => {
    expect(codeOf(() => moneyFromJSON({ currency, minor: '1050' }))).toBe('invalid-currency');
  });

  it('rejects an amount just outside the 64-bit range', () => {
    expect(codeOf(() => moneyFromJSON({ currency: 'USD', minor: '9223372036854775808' }))).toBe(
      'out-of-range',
    );
    expect(codeOf(() => moneyFromJSON({ currency: 'USD', minor: '-9223372036854775808' }))).toBe(
      'out-of-range',
    );
  });

  it('round-trips any amount through real JSON text', () => {
    fc.assert(
      fc.property(anyMoney, (amount) => {
        const text = JSON.stringify(amount);
        expect(moneyFromJSON(JSON.parse(text)).equals(amount)).toBe(true);
      }),
    );
  });
});

describe('toPayPalAmount', () => {
  it("writes PayPal's wire shape", () => {
    expect(toPayPalAmount(Money.of(1050n, 'USD'))).toEqual({
      currency_code: 'USD',
      value: '10.50',
    });
    expect(toPayPalAmount(Money.of(-5n, 'EUR'))).toEqual({ currency_code: 'EUR', value: '-0.05' });
    expect(toPayPalAmount(Money.of(1050n, 'JPY'))).toEqual({ currency_code: 'JPY', value: '1050' });
  });
});

describe('fromPayPalAmount', () => {
  it('reads the wire shape, negative amounts and whole-unit currencies included', () => {
    expect(fromPayPalAmount({ currency_code: 'USD', value: '10.50' }).minor).toBe(1050n);
    expect(fromPayPalAmount({ currency_code: 'USD', value: '-10.50' }).minor).toBe(-1050n);
    expect(fromPayPalAmount({ currency_code: 'JPY', value: '1050' }).minor).toBe(1050n);
    expect(fromPayPalAmount({ currency_code: 'HUF', value: '1050' }).currency).toBe('HUF');
  });

  it("ignores the other fields PayPal adds, such as an order amount's breakdown", () => {
    const amount = {
      currency_code: 'USD',
      value: '100.00',
      breakdown: { item_total: { currency_code: 'USD', value: '100.00' } },
    };

    expect(fromPayPalAmount(amount).minor).toBe(10000n);
  });

  it.each([
    ['null', null],
    ['a string', '10.50'],
    ['an array', [{ currency_code: 'USD', value: '10.50' }]],
    ['a missing value', { currency_code: 'USD' }],
    ['a number for the value', { currency_code: 'USD', value: 10.5 }],
    ['too few decimals', { currency_code: 'USD', value: '10.5' }],
    ['no decimals', { currency_code: 'USD', value: '10' }],
    ['decimals in a whole-unit currency', { currency_code: 'JPY', value: '10.50' }],
    ['an exponent', { currency_code: 'USD', value: '1e1' }],
    ['a leading zero', { currency_code: 'USD', value: '010.50' }],
  ])('rejects %s', (_label, input) => {
    expect(codeOf(() => fromPayPalAmount(input))).toBe('invalid-amount');
  });

  it.each([
    ['a missing currency', { value: '10.50' }],
    ['a lower-case currency', { currency_code: 'usd', value: '10.50' }],
    ['an unsupported currency', { currency_code: 'XXX', value: '10.50' }],
    ['the SDK spelling of the key', { currencyCode: 'USD', value: '10.50' }],
  ])('rejects %s', (_label, input) => {
    expect(codeOf(() => fromPayPalAmount(input))).toBe('invalid-currency');
  });

  it('round-trips any amount, even through JSON text', () => {
    fc.assert(
      fc.property(anyMoney, (amount) => {
        const text = JSON.stringify(toPayPalAmount(amount));
        expect(fromPayPalAmount(JSON.parse(text)).equals(amount)).toBe(true);
      }),
    );
  });
});
