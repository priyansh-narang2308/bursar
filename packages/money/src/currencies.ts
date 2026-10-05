import { describeValue, MoneyError } from './errors';

/**
 * The currencies PayPal accepts in its REST APIs, as listed on PayPal's "Currency codes"
 * reference page (checked 2026-10-05). Bursar only moves money through PayPal, so the registry
 * is closed: any other code is rejected, never guessed at. Alphabetical, to keep diffs honest.
 */
export const CURRENCY_CODES = [
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'ILS',
  'JPY',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RUB',
  'SEK',
  'SGD',
  'THB',
  'TWD',
  'USD',
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/**
 * PayPal rejects any decimal amount in these currencies. ISO 4217 gives HUF and TWD two minor
 * digits, so for the PayPal wire format it is PayPal's rule, not ISO's, that decides.
 */
const WHOLE_UNIT_CURRENCIES: ReadonlySet<CurrencyCode> = new Set(['HUF', 'JPY', 'TWD']);

/** Whether `value` is exactly one of the supported, upper-case currency codes. */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return CURRENCY_CODES.some((code) => code === value);
}

/** Returns `value` as a `CurrencyCode`, or throws `invalid-currency`. */
export function parseCurrencyCode(value: unknown): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new MoneyError('invalid-currency', `Unsupported currency ${describeValue(value)}.`);
  }
  return value;
}

/** Digits after the decimal point in PayPal's wire format: 0 for HUF, JPY and TWD, else 2. */
export function currencyExponent(currency: CurrencyCode): 0 | 2 {
  return WHOLE_UNIT_CURRENCIES.has(currency) ? 0 : 2;
}
