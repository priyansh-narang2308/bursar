import { MAX_MINOR } from '@bursar/money';
import { describe, expect, it } from 'vitest';
import {
  after,
  atMost,
  isProductOf,
  isSumOf,
  notBefore,
  sameCurrency,
  sumAtMost,
} from '../src/invariants';
import { rule } from '../src/rule';
import { eur, usd } from './fixtures';

const huge = usd(MAX_MINOR.toString());
const unreadable = { currency: 'USD', minor: 'abc' };

describe('sameCurrency', () => {
  it('is true when every amount shares a currency, and for none or one', () => {
    expect(sameCurrency(usd('1'), usd('2'), usd('3'))).toBe(true);
    expect(sameCurrency(usd('1'))).toBe(true);
    expect(sameCurrency()).toBe(true);
  });

  it('is false as soon as one differs', () => {
    expect(sameCurrency(usd('1'), eur('1'))).toBe(false);
    expect(sameCurrency(usd('1'), usd('2'), eur('3'))).toBe(false);
  });
});

describe('atMost', () => {
  it('compares amounts of the same currency', () => {
    expect(atMost(usd('5'), usd('5'))).toBe(true);
    expect(atMost(usd('4'), usd('5'))).toBe(true);
    expect(atMost(usd('6'), usd('5'))).toBe(false);
  });

  it('leaves what it cannot compare to the rule that reports it', () => {
    expect(atMost(usd('6'), eur('5'))).toBe(true); // a currency mismatch is reported elsewhere
    expect(atMost(unreadable, usd('5'))).toBe(true); // a bad amount is reported by its own field
    expect(atMost(usd('6'), unreadable)).toBe(true);
  });
});

describe('sumAtMost', () => {
  it('checks that two amounts together fit within a limit', () => {
    expect(sumAtMost(usd('2'), usd('3'), usd('5'))).toBe(true);
    expect(sumAtMost(usd('3'), usd('3'), usd('5'))).toBe(false);
  });

  it('says no to a sum that does not even fit in 64 bits', () => {
    expect(sumAtMost(huge, huge, huge)).toBe(false);
  });

  it('leaves what it cannot compare to the rule that reports it', () => {
    expect(sumAtMost(usd('9'), eur('9'), usd('5'))).toBe(true);
    expect(sumAtMost(unreadable, usd('9'), usd('5'))).toBe(true);
    expect(sumAtMost(usd('9'), unreadable, usd('5'))).toBe(true);
    expect(sumAtMost(usd('9'), usd('9'), unreadable)).toBe(true);
  });
});

describe('isSumOf', () => {
  it('checks that a total is exactly the sum of its parts', () => {
    expect(isSumOf(usd('6'), [usd('1'), usd('2'), usd('3')])).toBe(true);
    expect(isSumOf(usd('7'), [usd('1'), usd('2'), usd('3')])).toBe(false);
    expect(isSumOf(usd('0'), [])).toBe(true);
  });

  it('says no to parts whose sum does not fit in 64 bits', () => {
    expect(isSumOf(huge, [huge, huge])).toBe(false);
  });

  it('leaves what it cannot compare to the rule that reports it', () => {
    expect(isSumOf(unreadable, [usd('1')])).toBe(true);
    expect(isSumOf(usd('6'), [usd('1'), eur('5')])).toBe(true);
  });

  it('adds up only the parts it can read', () => {
    expect(isSumOf(usd('3'), [usd('1'), unreadable, usd('2')])).toBe(true);
  });
});

describe('isProductOf', () => {
  it('checks that a total is a unit price times a whole quantity', () => {
    expect(isProductOf(usd('30'), usd('10'), 3)).toBe(true);
    expect(isProductOf(usd('31'), usd('10'), 3)).toBe(false);
  });

  it('says no to a product that does not fit in 64 bits', () => {
    expect(isProductOf(huge, huge, 2)).toBe(false);
  });

  it('leaves what it cannot compare to the rule that reports it', () => {
    expect(isProductOf(unreadable, usd('10'), 3)).toBe(true);
    expect(isProductOf(usd('30'), unreadable, 3)).toBe(true);
    expect(isProductOf(usd('30'), eur('10'), 3)).toBe(true);
  });
});

describe('notBefore and after', () => {
  it('compare real instants, not text', () => {
    const [whole, half] = ['2026-10-05T10:00:00Z', '2026-10-05T10:00:00.5Z'];

    expect(notBefore(half, whole)).toBe(true);
    expect(notBefore(whole, half)).toBe(false); // as text, "…00Z" sorts after "…00.5Z"
    expect(after(half, whole)).toBe(true);
    expect(after(whole, half)).toBe(false);
  });

  it('differ at the instant itself', () => {
    const instant = '2026-10-05T10:00:00Z';

    expect(notBefore(instant, instant)).toBe(true);
    expect(after(instant, instant)).toBe(false);
  });
});

describe('rule', () => {
  it('gives a refine its message, the field to report on, and a condition to run only on clean data', () => {
    const params = rule('Must match', 'a', 'b');

    expect(params).toMatchObject({ message: 'Must match', path: ['a', 'b'] });
    expect(params.when({ issues: [] })).toBe(true);
    expect(params.when({ issues: [{}] })).toBe(false);
  });

  it('reports on the whole value when no field is named', () => {
    expect(rule('Whole value').path).toEqual([]);
  });
});
