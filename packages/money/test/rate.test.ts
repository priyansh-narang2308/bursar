import { describe, expect, it } from 'vitest';
import { basisPoints, percent, rate } from '../src/rate';
import { codeOf, untyped } from './support';

describe('rate', () => {
  it('holds an exact fraction, and a negative numerator is a discount', () => {
    expect(rate(29n, 1000n)).toEqual({ numerator: 29n, denominator: 1000n });
    expect(rate(-1n, 4n)).toEqual({ numerator: -1n, denominator: 4n });
    expect(rate(0n, 1n)).toEqual({ numerator: 0n, denominator: 1n });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(rate(1n, 2n))).toBe(true);
  });

  it.each([0n, -1n])('rejects the denominator %s', (denominator) => {
    expect(codeOf(() => rate(1n, denominator))).toBe('invalid-argument');
  });

  it('rejects anything that is not a bigint, as an untyped caller might pass it', () => {
    expect(codeOf(() => rate(untyped<bigint>(0.029), 1n))).toBe('invalid-argument');
    expect(codeOf(() => rate(1n, untyped<bigint>(100)))).toBe('invalid-argument');
    expect(codeOf(() => rate(untyped<bigint>('1'), untyped<bigint>('2')))).toBe('invalid-argument');
  });
});

describe('percent and basisPoints', () => {
  it('spell the same fraction in whole percent and in hundredths of a percent', () => {
    expect(percent(5n)).toEqual({ numerator: 5n, denominator: 100n });
    expect(basisPoints(290n)).toEqual({ numerator: 290n, denominator: 10_000n });
  });

  it('pass a negative value through, for a discount', () => {
    expect(percent(-10n)).toEqual({ numerator: -10n, denominator: 100n });
    expect(basisPoints(-1n)).toEqual({ numerator: -1n, denominator: 10_000n });
  });

  it('reject a number', () => {
    expect(codeOf(() => percent(untyped<bigint>(5)))).toBe('invalid-argument');
    expect(codeOf(() => basisPoints(untyped<bigint>(2.9)))).toBe('invalid-argument');
  });
});
