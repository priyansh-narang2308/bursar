import { MoneyError } from './errors';

interface Share {
  readonly index: number;
  readonly base: bigint;
  readonly remainder: bigint;
}

/** Largest remainder first; equal remainders go to the earlier weight, so the result is stable. */
function byLargestRemainder(a: Share, b: Share): number {
  if (a.remainder !== b.remainder) {
    return a.remainder > b.remainder ? -1 : 1;
  }
  return a.index - b.index;
}

/**
 * Splits `total` in proportion to `weights` with the largest remainder (Hamilton) method:
 * every part first gets the whole minor units its weight earns, and the few units left over go,
 * one each, to the parts with the biggest fractional remainders.
 *
 * - The parts always add up to `total`, so no unit is created or lost.
 * - Each part is within one unit of its exact proportional share.
 * - A zero weight gets exactly zero.
 * - A negative total is split as its magnitude and negated, so the result mirrors the positive case.
 */
export function allocateMinor(total: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) {
    throw new MoneyError('invalid-argument', 'Allocation needs at least one weight.');
  }

  let weightSum = 0n;
  for (const weight of weights) {
    if (typeof weight !== 'bigint' || weight < 0n) {
      throw new MoneyError('invalid-argument', 'Every weight must be a non-negative bigint.');
    }
    weightSum += weight;
  }
  if (weightSum === 0n) {
    throw new MoneyError('invalid-argument', 'At least one weight must be positive.');
  }

  const magnitude = total < 0n ? -total : total;
  const shares: Share[] = weights.map((weight, index) => {
    const exact = magnitude * weight;
    return { index, base: exact / weightSum, remainder: exact % weightSum };
  });

  // Fewer units are left over than there are parts, so every one can go to a different part.
  const leftover = magnitude - shares.reduce((sum, share) => sum + share.base, 0n);
  const bumped = new Set(
    [...shares]
      .sort(byLargestRemainder)
      .slice(0, Number(leftover))
      .map((share) => share.index),
  );

  return shares.map((share) => {
    const part = share.base + (bumped.has(share.index) ? 1n : 0n);
    return total < 0n ? -part : part;
  });
}
