import { allocateMinor } from './allocate';
import { type CurrencyCode, currencyExponent, parseCurrencyCode } from './currencies';
import { formatDecimal, parseDecimal } from './decimal';
import { describeValue, MoneyError } from './errors';
import { rate as checkRate, type Rate } from './rate';
import { divideRounded, type RoundingMode } from './rounding';

/** The largest amount in minor units, 2^63 - 1, so every `Money` fits a Postgres `bigint` column. */
export const MAX_MINOR = 9_223_372_036_854_775_807n;

/** The smallest amount in minor units. Symmetric with `MAX_MINOR`, so negating never overflows. */
export const MIN_MINOR = -MAX_MINOR;

/** The JSON form of a `Money`. The amount is a string because JSON numbers cannot hold a bigint. */
export interface MoneyJSON {
  readonly currency: CurrencyCode;
  readonly minor: string;
}

function currencyMismatch(expected: CurrencyCode, actual: CurrencyCode): MoneyError {
  return new MoneyError(
    'currency-mismatch',
    `Cannot combine ${expected} with ${actual}; convert one of them first.`,
  );
}

/**
 * An immutable amount of money: a whole number of minor units (cents for USD, yen for JPY) in one
 * of PayPal's currencies. There is no way to build an invalid one: every instance comes through
 * {@link Money.of}, so the currency is supported and the amount fits a signed 64-bit integer.
 * Arithmetic never mixes currencies, never loses a unit, and never touches floating point.
 */
export class Money {
  /** Whole minor units. Negative for debits and refunds. */
  readonly minor: bigint;
  readonly currency: CurrencyCode;

  private constructor(minor: bigint, currency: CurrencyCode) {
    this.minor = minor;
    this.currency = currency;
    Object.freeze(this);
  }

  /** The one gate every amount passes through. */
  static of(minor: bigint, currency: CurrencyCode): Money {
    if (typeof minor !== 'bigint') {
      throw new MoneyError(
        'invalid-amount',
        `Minor units must be a bigint, received ${describeValue(minor)}.`,
      );
    }
    const code = parseCurrencyCode(currency);
    if (minor > MAX_MINOR || minor < MIN_MINOR) {
      throw new MoneyError('out-of-range', 'The amount does not fit in a signed 64-bit integer.');
    }
    return new Money(minor, code);
  }

  static zero(currency: CurrencyCode): Money {
    return Money.of(0n, currency);
  }

  /**
   * Reads a PayPal decimal string such as "10.50" (or "1050" for JPY). Only the canonical
   * spelling is accepted; see `parseDecimal` for exactly what that means.
   */
  static parse(decimal: string, currency: CurrencyCode): Money {
    const code = parseCurrencyCode(currency);
    return Money.of(parseDecimal(decimal, currencyExponent(code)), code);
  }

  /** The total of `items`. The currency is always explicit, so an empty list still has one. */
  static sum(items: Iterable<Money>, currency: CurrencyCode): Money {
    const code = parseCurrencyCode(currency);
    let total = 0n;
    for (const item of items) {
      if (item.currency !== code) {
        throw currencyMismatch(code, item.currency);
      }
      total += item.minor;
    }
    return Money.of(total, code);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.minor - other.minor, this.currency);
  }

  negate(): Money {
    return Money.of(-this.minor, this.currency);
  }

  abs(): Money {
    return this.minor < 0n ? this.negate() : this;
  }

  /** Scales by a whole number, such as a quantity. Exact, so no rounding is involved. */
  multiply(factor: bigint): Money {
    if (typeof factor !== 'bigint') {
      throw new MoneyError(
        'invalid-argument',
        `The factor must be a bigint, received ${describeValue(factor)}.`,
      );
    }
    return Money.of(this.minor * factor, this.currency);
  }

  /**
   * Scales by an exact fraction such as 2.9%. A fraction rarely lands on a whole minor unit, so
   * the rounding mode is required: there is no default to forget about.
   *
   * @example money.applyRate(basisPoints(290n), 'half-even')
   */
  applyRate(by: Rate, mode: RoundingMode): Money {
    const { numerator, denominator } = checkRate(by.numerator, by.denominator);
    return Money.of(divideRounded(this.minor * numerator, denominator, mode), this.currency);
  }

  /**
   * Splits this amount in proportion to `weights` with the largest remainder method. The parts
   * always add up to this amount exactly; see `allocateMinor` for the guarantees.
   *
   * @example Money.parse('100.00', 'USD').allocate([1n, 1n, 1n]) // 33.34, 33.33, 33.33
   */
  allocate(weights: readonly bigint[]): Money[] {
    return allocateMinor(this.minor, weights).map((part) => Money.of(part, this.currency));
  }

  /** Orders two amounts of the same currency. Comparing across currencies is an error. */
  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minor === other.minor) {
      return 0;
    }
    return this.minor < other.minor ? -1 : 1;
  }

  /** Whether both currency and amount match. Different currencies are simply not equal. */
  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isPositive(): boolean {
    return this.minor > 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  /** PayPal's decimal string: "10.50" for USD, "1050" for JPY. Never has an exponent or rounding. */
  toDecimal(): string {
    return formatDecimal(this.minor, currencyExponent(this.currency));
  }

  /** Called by `JSON.stringify`, which would otherwise throw on the bigint. */
  toJSON(): MoneyJSON {
    return { currency: this.currency, minor: this.minor.toString() };
  }

  /** For logs and debugging, such as "USD 10.50". Use `toDecimal` or `toJSON` to exchange data. */
  toString(): string {
    return `${this.currency} ${this.toDecimal()}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw currencyMismatch(this.currency, other.currency);
    }
  }
}
