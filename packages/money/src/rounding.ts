import { describeValue, MoneyError } from './errors';

/**
 * How to turn a fraction into a whole number of minor units. The names and meanings follow
 * Java's `RoundingMode`, so they are familiar and unambiguous. For 2.5 and -2.5:
 *
 * | mode        | meaning                              | 2.5 | -2.5 |
 * | ----------- | ------------------------------------ | --- | ---- |
 * | `down`      | toward zero                          | 2   | -2   |
 * | `up`        | away from zero                       | 3   | -3   |
 * | `floor`     | toward negative infinity             | 2   | -3   |
 * | `ceiling`   | toward positive infinity             | 3   | -2   |
 * | `half-up`   | nearest; a tie goes away from zero   | 3   | -3   |
 * | `half-down` | nearest; a tie goes toward zero      | 2   | -2   |
 * | `half-even` | nearest; a tie goes to the even one  | 2   | -2   |
 */
export const ROUNDING_MODES = [
  'down',
  'up',
  'floor',
  'ceiling',
  'half-up',
  'half-down',
  'half-even',
] as const;

export type RoundingMode = (typeof ROUNDING_MODES)[number];

export function isRoundingMode(value: unknown): value is RoundingMode {
  return ROUNDING_MODES.some((mode) => mode === value);
}

/** A division that does not come out even, described without any fractions. */
interface InexactDivision {
  readonly negative: boolean;
  /** The quotient truncated toward zero. */
  readonly quotient: bigint;
  /** Twice the size of the remainder, to compare against the denominator (the half-way mark). */
  readonly twiceRemainder: bigint;
  readonly denominator: bigint;
}

/**
 * Each mode answers one question about an inexact division: step one unit away from zero from the
 * truncated quotient, or stay on it? Typing this as a record makes handling every mode a
 * compile-time guarantee.
 */
const stepsAwayFromZero: Record<RoundingMode, (division: InexactDivision) => boolean> = {
  down: () => false,
  up: () => true,
  floor: ({ negative }) => negative,
  ceiling: ({ negative }) => !negative,
  'half-up': ({ twiceRemainder, denominator }) => twiceRemainder >= denominator,
  'half-down': ({ twiceRemainder, denominator }) => twiceRemainder > denominator,
  'half-even': ({ twiceRemainder, denominator, quotient }) =>
    twiceRemainder > denominator || (twiceRemainder === denominator && quotient % 2n !== 0n),
};

/**
 * `numerator / denominator` as a whole number, rounded as `mode` says. The mode is required and
 * checked even when the division is exact, so a bad mode can never hide behind a lucky input.
 */
export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= 0n) {
    throw new MoneyError('invalid-argument', 'The denominator must be positive.');
  }
  if (!isRoundingMode(mode)) {
    throw new MoneyError('invalid-argument', `Unknown rounding mode ${describeValue(mode)}.`);
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator; // carries the sign of the numerator
  if (remainder === 0n) {
    return quotient;
  }

  const negative = numerator < 0n;
  const twiceRemainder = (negative ? -remainder : remainder) * 2n;
  if (!stepsAwayFromZero[mode]({ negative, quotient, twiceRemainder, denominator })) {
    return quotient;
  }
  return negative ? quotient - 1n : quotient + 1n;
}
