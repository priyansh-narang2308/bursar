import { Money } from '@bursar/money';
import { tryMoney } from './common';

/*
 * Small, pure checks that entity schemas use for rules spanning several fields. Each answers "is
 * this consistent?". Schemas run them through `rule()`, which only fires once every field is valid
 * on its own; as a second line of defence the checks also return true for an amount they cannot
 * read, so a mistake in one field is never reported again as a broken rule.
 */

interface Amount {
  readonly currency: string;
  readonly minor: string;
}

/** Whether every amount is in the same currency. */
export function sameCurrency(...amounts: readonly Amount[]): boolean {
  return amounts.every((amount) => amount.currency === amounts[0]?.currency);
}

/** Whether `amount` is at most `limit`. Amounts in different currencies are left to `sameCurrency`. */
export function atMost(amount: Amount, limit: Amount): boolean {
  const [a, b] = [tryMoney(amount), tryMoney(limit)];
  return a === undefined || b === undefined || a.currency !== b.currency || a.lessThanOrEqual(b);
}

/** Whether `first + second` fits within `limit`. */
export function sumAtMost(first: Amount, second: Amount, limit: Amount): boolean {
  const [a, b, c] = [tryMoney(first), tryMoney(second), tryMoney(limit)];
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    !sameCurrency(first, second, limit)
  ) {
    return true;
  }
  try {
    return a.add(b).lessThanOrEqual(c);
  } catch {
    return false; // the sum does not even fit in 64 bits
  }
}

/** Whether `total` is exactly the sum of `parts`, all in `total`'s currency. */
export function isSumOf(total: Amount, parts: readonly Amount[]): boolean {
  const expected = tryMoney(total);
  if (expected === undefined || !sameCurrency(total, ...parts)) {
    return true;
  }
  try {
    return Money.sum(
      parts.flatMap((part) => tryMoney(part) ?? []),
      expected.currency,
    ).equals(expected);
  } catch {
    return false;
  }
}

/** Whether `total` is exactly `unit` times a whole `quantity`. */
export function isProductOf(total: Amount, unit: Amount, quantity: number): boolean {
  const [t, u] = [tryMoney(total), tryMoney(unit)];
  if (t === undefined || u === undefined || t.currency !== u.currency) {
    return true;
  }
  try {
    return u.multiply(BigInt(quantity)).equals(t);
  } catch {
    return false;
  }
}

/** Compares instants by time, not by text: "…00Z" and "…00.5Z" do not sort alphabetically. */
export function notBefore(later: string, earlier: string): boolean {
  return Date.parse(later) >= Date.parse(earlier);
}

export function after(later: string, earlier: string): boolean {
  return Date.parse(later) > Date.parse(earlier);
}
