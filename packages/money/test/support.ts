import fc from 'fast-check';
import { CURRENCY_CODES, MAX_MINOR, MIN_MINOR, Money, MoneyError } from '../src';

/** Any supported currency. */
export const currencies = fc.constantFrom(...CURRENCY_CODES);

/** Any amount a `Money` can hold, edges included. */
export const anyMinor = fc.bigInt({ min: MIN_MINOR, max: MAX_MINOR });

/** Amounts small enough that a few of them can be added or scaled without overflowing. */
export const smallMinor = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });

export const anyMoney = fc
  .tuple(anyMinor, currencies)
  .map(([minor, currency]) => Money.of(minor, currency));

export const smallUsd = smallMinor.map((minor) => Money.of(minor, 'USD'));

/** Hands a value to typed code as an untyped (JavaScript) caller could, to test runtime guards. */
export function untyped<T>(value: unknown): T {
  return value as T;
}

/**
 * The `code` of the `MoneyError` that `run` throws; `undefined` when it does not throw, and a
 * description when it throws something else. Lets a test state the expected code in one line.
 */
export function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof MoneyError ? error.code : `unexpected: ${String(error)}`;
  }
}
