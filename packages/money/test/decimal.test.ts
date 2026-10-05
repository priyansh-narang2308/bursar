import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatDecimal, MAX_DECIMAL_LENGTH, parseDecimal } from '../src/decimal';
import { anyMinor, codeOf } from './support';

const exponents = fc.constantFrom(0, 2, 3, 4);

describe('formatDecimal', () => {
  it.each([
    [1050n, 2, '10.50'],
    [5n, 2, '0.05'],
    [0n, 2, '0.00'],
    [100n, 2, '1.00'],
    [-5n, 2, '-0.05'],
    [-1050n, 2, '-10.50'],
    [1050n, 0, '1050'],
    [0n, 0, '0'],
    [-7n, 0, '-7'],
    [1234n, 3, '1.234'],
    [5n, 3, '0.005'],
    [-1n, 4, '-0.0001'],
  ])('writes %s with %s fractional digits as %j', (minor, exponent, expected) => {
    expect(formatDecimal(minor, exponent)).toBe(expected);
  });
});

describe('parseDecimal', () => {
  it.each([
    ['10.50', 2, 1050n],
    ['0.05', 2, 5n],
    ['0.00', 2, 0n],
    ['-0.05', 2, -5n],
    ['-10.50', 2, -1050n],
    ['1050', 0, 1050n],
    ['0', 0, 0n],
    ['-7', 0, -7n],
    ['1.234', 3, 1234n],
    ['-0.0001', 4, -1n],
  ])('reads %j with %s fractional digits as %s', (text, exponent, expected) => {
    expect(parseDecimal(text, exponent)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    '10', // too few digits: PayPal always sends the full precision
    '10.',
    '10.5',
    '10.500', // too many
    '.50',
    '+10.50',
    '010.50', // leading zero
    '00.00',
    '-0.00', // negative zero has no canonical spelling
    '--10.50',
    '1.0.0',
    '1e3', // exponent notation
    '1E3',
    '1.5e1',
    '1,000.00', // separators
    '1_000.00',
    '10,50',
    ' 10.50', // padding
    '10.50 ',
    '10.50\n',
    '0x10',
    'NaN',
    'Infinity',
    '٣.٠٠', // Arabic-Indic digits
    '１０.５０', // full-width digits
  ])('rejects %j when two fractional digits are expected', (text) => {
    expect(codeOf(() => parseDecimal(text, 2))).toBe('invalid-amount');
  });

  it.each(['1.0', '1.', '10.00', '+1', '01', '-0', '1e3', ''])(
    'rejects %j when no fractional digits are expected',
    (text) => {
      expect(codeOf(() => parseDecimal(text, 0))).toBe('invalid-amount');
    },
  );

  it('explains what it expected, and names negative zero', () => {
    expect(() => parseDecimal('10.5', 2)).toThrow('a decimal with exactly 2 fractional digits');
    expect(() => parseDecimal('10.5', 0)).toThrow('a whole number');
    expect(() => parseDecimal('-0.00', 2)).toThrow('Negative zero');
  });

  it.each([null, undefined, 10.5, 1050n, {}, ['10.50']])('rejects the non-string %s', (value) => {
    expect(codeOf(() => parseDecimal(value, 2))).toBe('invalid-amount');
  });

  it(`rejects anything longer than PayPal's ${MAX_DECIMAL_LENGTH}-character limit`, () => {
    const longest = `${'1'.repeat(MAX_DECIMAL_LENGTH - 3)}.00`;
    expect(longest).toHaveLength(MAX_DECIMAL_LENGTH);
    expect(parseDecimal(longest, 2)).toBe(BigInt(`${'1'.repeat(MAX_DECIMAL_LENGTH - 3)}00`));
    expect(codeOf(() => parseDecimal(`1${longest}`, 2))).toBe('invalid-amount');
  });
});

describe('the decimal codec', () => {
  it('round-trips every amount at every precision', () => {
    fc.assert(
      fc.property(anyMinor, exponents, (minor, exponent) => {
        expect(parseDecimal(formatDecimal(minor, exponent), exponent)).toBe(minor);
      }),
    );
  });

  it('accepts only the canonical spelling: whatever parses must format back to itself', () => {
    const noisy = fc.string({
      unit: fc.constantFrom(...'0123456789.-+eE, '),
      maxLength: 12,
    });

    fc.assert(
      fc.property(noisy, exponents, (text, exponent) => {
        const minor = tryParse(text, exponent);
        if (minor !== undefined) {
          expect(formatDecimal(minor, exponent)).toBe(text);
        }
      }),
    );
  });

  it('does accept some of the noisy strings, so the property above is not vacuous', () => {
    expect(tryParse('0', 0)).toBe(0n);
    expect(tryParse('-12.30', 2)).toBe(-1230n);
  });
});

function tryParse(text: string, exponent: number): bigint | undefined {
  try {
    return parseDecimal(text, exponent);
  } catch {
    return undefined;
  }
}
