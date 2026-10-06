import { describe, expect, it } from 'vitest';
import { formatMoney, humanize, minorFromInput, relative, shortId } from '../src/lib/format';

describe('formatMoney', () => {
  it('writes exact amounts with grouping, from minor units', () => {
    expect(formatMoney('123456', 'USD')).toBe('$1,234.56');
    expect(formatMoney('5', 'USD')).toBe('$0.05');
    expect(formatMoney(100_000_000_000_000_001n, 'USD')).toBe('$1,000,000,000,000,000.01'); // beyond a float's precision
    expect(formatMoney('-500', 'USD')).toBe('−$5.00');
    expect(formatMoney('1999', 'JPY')).toBe('¥1,999');
    expect(formatMoney('1000', 'CAD')).toBe('10.00 CAD');
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney('1', undefined)).toBe('—');
  });
});

describe('minorFromInput', () => {
  it('reads dollars and cents, and nothing else', () => {
    expect(minorFromInput('2,000')).toBe('200000');
    expect(minorFromInput('19.9')).toBe('1990');
    expect(minorFromInput('0.05')).toBe('5');
    for (const bad of ['', 'abc', '1.234', '-5', '1e3', '$5'])
      expect(minorFromInput(bad)).toBeNull();
  });
});

describe('small helpers', () => {
  it('humanises states and shortens ids', () => {
    expect(humanize('AWAITING_APPROVAL')).toBe('Awaiting approval');
    expect(shortId('act_01M47YN5EGCTWCXBJNJFGA7263')).toBe('act_01M4…7263');
    expect(shortId('short')).toBe('short');
  });

  it('says how long ago, and how long until', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    expect(relative('2026-10-06T12:00:02Z', now)).toBe('just now');
    expect(relative('2026-10-06T11:59:30Z', now)).toBe('30s ago');
    expect(relative('2026-10-06T11:55:00Z', now)).toBe('5m ago');
    expect(relative('2026-10-06T09:00:00Z', now)).toBe('3h ago');
    expect(relative('2026-10-08T12:00:00Z', now)).toBe('in 2d');
  });
});
