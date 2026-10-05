import { describe, expect, it } from 'vitest';
import { describeValue, MoneyError } from '../src/errors';

describe('MoneyError', () => {
  it('is an Error that carries a stable code', () => {
    const error = new MoneyError('invalid-amount', 'nope');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('MoneyError');
    expect(error.code).toBe('invalid-amount');
    expect(error.message).toBe('nope');
  });
});

describe('describeValue', () => {
  it('quotes strings so stray whitespace and control characters are visible', () => {
    expect(describeValue('USD')).toBe('"USD"');
    expect(describeValue(' 1.00\n')).toBe('" 1.00\\n"');
  });

  it('truncates long strings instead of echoing a whole payload', () => {
    expect(describeValue('x'.repeat(100))).toBe(`"${'x'.repeat(32)}…"`);
    expect(describeValue('x'.repeat(32))).toBe(`"${'x'.repeat(32)}"`);
  });

  it.each([
    [10n, 'bigint'],
    [1.5, 'number'],
    [true, 'boolean'],
    [undefined, 'undefined'],
    [{}, 'object'],
    [Symbol('s'), 'symbol'],
  ])('shows only the type of a non-string (%s)', (value, type) => {
    expect(describeValue(value)).toBe(type);
  });

  it('names null rather than calling it an object', () => {
    expect(describeValue(null)).toBe('null');
  });
});
