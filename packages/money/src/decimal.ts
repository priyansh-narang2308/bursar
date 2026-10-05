import { describeValue, MoneyError } from './errors';

/** PayPal's documented maximum length of an amount string (`maxLength` in its OpenAPI spec). */
export const MAX_DECIMAL_LENGTH = 32;

/**
 * Writes `minor` as a decimal string with exactly `exponent` fractional digits ("10.50",
 * "-0.05"), or as a bare integer when `exponent` is 0 ("1050"). The result is the one canonical
 * spelling of the amount, and `parseDecimal` is its exact inverse.
 */
export function formatDecimal(minor: bigint, exponent: number): string {
  const sign = minor < 0n ? '-' : '';
  const digits = (minor < 0n ? -minor : minor).toString();
  if (exponent === 0) {
    return sign + digits;
  }
  const padded = digits.padStart(exponent + 1, '0');
  return `${sign}${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}

/**
 * Reads a decimal string into minor units. Only the canonical spelling is accepted: an optional
 * minus sign, no leading zeros, and exactly `exponent` fractional digits (none when `exponent`
 * is 0). Everything PayPal's own, looser pattern would let through is rejected here ("1e3",
 * "+1.00", ".5", "05.00", "10.5", "1,000.00", "-0.00", padding, non-ASCII digits), so one amount
 * has one spelling and nothing is ever guessed.
 */
export function parseDecimal(text: unknown, exponent: number): bigint {
  const fraction = exponent === 0 ? '' : `\\.[0-9]{${exponent}}`;
  const canonical = new RegExp(`^-?(?:0|[1-9][0-9]*)${fraction}$`);

  if (typeof text !== 'string' || text.length > MAX_DECIMAL_LENGTH || !canonical.test(text)) {
    const expected =
      exponent === 0 ? 'a whole number' : `a decimal with exactly ${exponent} fractional digits`;
    throw new MoneyError(
      'invalid-amount',
      `Expected ${expected}, received ${describeValue(text)}.`,
    );
  }

  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const dot = unsigned.indexOf('.');
  const digits = dot === -1 ? unsigned : unsigned.slice(0, dot) + unsigned.slice(dot + 1);
  const magnitude = BigInt(digits);

  if (negative && magnitude === 0n) {
    throw new MoneyError('invalid-amount', 'Negative zero is not a canonical amount.');
  }
  return negative ? -magnitude : magnitude;
}
