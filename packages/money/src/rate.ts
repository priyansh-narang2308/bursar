import { MoneyError } from './errors';

/**
 * An exact fraction such as 2.9%, held as two integers so floating point never gets near an
 * amount. Build one with `rate`, `percent` or `basisPoints`.
 */
export interface Rate {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** `numerator / denominator`. The numerator may be negative (a discount); the denominator may not. */
export function rate(numerator: bigint, denominator: bigint): Rate {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint' || denominator <= 0n) {
    throw new MoneyError(
      'invalid-argument',
      'A rate needs a bigint numerator and a positive bigint denominator.',
    );
  }
  return Object.freeze({ numerator, denominator });
}

/** A whole number of percent: `percent(5n)` is 5%. For a fraction of a percent use `basisPoints`. */
export function percent(value: bigint): Rate {
  return rate(value, 100n);
}

/** Hundredths of a percent, how fees are usually quoted: `basisPoints(290n)` is 2.9%. */
export function basisPoints(value: bigint): Rate {
  return rate(value, 10_000n);
}
