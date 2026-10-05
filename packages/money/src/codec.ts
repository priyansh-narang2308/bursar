import { parseCurrencyCode } from './currencies';
import { describeValue, MoneyError } from './errors';
import { MAX_MINOR, Money } from './money';

/** A JSON-looking object that is not an array or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The canonical integer string: no plus sign, no leading zeros, and no "-0". */
const MINOR_PATTERN = /^(?:0|-?[1-9][0-9]*)$/;

/** Room for the largest amount plus its minus sign. */
const MAX_MINOR_LENGTH = MAX_MINOR.toString().length + 1;

/**
 * Reads the output of `Money#toJSON`, such as `{ "currency": "USD", "minor": "1050" }`. Strict:
 * exactly those two keys, the amount as a canonical integer string, a supported currency.
 */
export function moneyFromJSON(input: unknown): Money {
  if (!isRecord(input) || Object.keys(input).sort().join() !== 'currency,minor') {
    throw new MoneyError(
      'invalid-amount',
      `Expected an object with exactly "currency" and "minor", received ${describeValue(input)}.`,
    );
  }

  const { currency, minor } = input;
  if (typeof minor !== 'string' || minor.length > MAX_MINOR_LENGTH || !MINOR_PATTERN.test(minor)) {
    throw new MoneyError(
      'invalid-amount',
      `"minor" must be a canonical integer string, received ${describeValue(minor)}.`,
    );
  }
  return Money.of(BigInt(minor), parseCurrencyCode(currency));
}

/** The shape of a PayPal `Money` object on the wire (REST responses and webhooks). */
export interface PayPalAmount {
  readonly currency_code: string;
  readonly value: string;
}

/** The PayPal wire form of an amount: `{ currency_code: "USD", value: "10.50" }`. */
export function toPayPalAmount(money: Money): PayPalAmount {
  return { currency_code: money.currency, value: money.toDecimal() };
}

/**
 * Reads a PayPal `Money` object from untrusted JSON, such as a webhook body. Other keys are
 * ignored, because PayPal adds fields (an order's `amount` also carries a `breakdown`), but the
 * currency must be supported and `value` must be the canonical decimal for it.
 */
export function fromPayPalAmount(input: unknown): Money {
  if (!isRecord(input)) {
    throw new MoneyError(
      'invalid-amount',
      `Expected a PayPal amount object, received ${describeValue(input)}.`,
    );
  }

  const { currency_code: currency, value } = input;
  if (typeof value !== 'string') {
    throw new MoneyError(
      'invalid-amount',
      `A PayPal amount's value must be a string, received ${describeValue(value)}.`,
    );
  }
  return Money.parse(value, parseCurrencyCode(currency));
}
