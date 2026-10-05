import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocateMinor } from '../src/allocate';
import { codeOf, untyped } from './support';

const abs = (value: bigint): bigint => (value < 0n ? -value : value);
const sum = (values: readonly bigint[]): bigint =>
  values.reduce((total, value) => total + value, 0n);

const totals = fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n });
const weightLists = fc
  .array(fc.bigInt({ min: 0n, max: 10n ** 9n }), { minLength: 1, maxLength: 12 })
  .filter((weights) => sum(weights) > 0n);

describe('allocateMinor', () => {
  it.each([
    // total, weights, parts
    [100n, [1n, 1n, 1n], [34n, 33n, 33n]], // the leftover unit goes to the first of equals
    [10n, [1n, 1n, 1n], [4n, 3n, 3n]],
    [100n, [1n, 2n, 3n], [17n, 33n, 50n]], // remainders 4, 2, 0 of 6: the largest wins the unit
    [5n, [3n, 1n, 1n], [3n, 1n, 1n]], // an exact split needs no leftovers
    [100n, [70n, 30n], [70n, 30n]],
    [1n, [1n, 1n, 1n], [1n, 0n, 0n]], // fewer units than parts
    [0n, [1n, 2n], [0n, 0n]],
    [100n, [0n, 1n, 0n], [0n, 100n, 0n]], // a zero weight earns nothing
    [100n, [5n], [100n]],
    [-100n, [1n, 1n, 1n], [-34n, -33n, -33n]], // a negative total mirrors the positive one
    [-100n, [1n, 2n, 3n], [-17n, -33n, -50n]],
  ])('splits %s by %s into %s', (total, weights, parts) => {
    expect(allocateMinor(total, weights)).toEqual(parts);
  });

  it('gives leftover units to the largest remainders, not to the first parts or the biggest weights', () => {
    // 100 by [3, 1, 2]: exact shares 50, 16.67, 33.33. Floors are 50, 16, 33, so one unit is
    // left, and it goes to the part with the largest remainder (the second, 4 of 6).
    expect(allocateMinor(100n, [3n, 1n, 2n])).toEqual([50n, 17n, 33n]);
    // 10 by [1, 2, 4]: shares 1.43, 2.86, 5.71. Floors 1, 2, 5 leave two units, for the two
    // largest remainders (the second, 6 of 7, then the third, 5 of 7), not the first.
    expect(allocateMinor(10n, [1n, 2n, 4n])).toEqual([1n, 3n, 6n]);
    // 10 by [2, 2, 3]: shares 2.86, 2.86, 4.29. Floors 2, 2, 4 leave two units, and the first
    // two parts hold the largest remainders (6 of 7 each) while the biggest weight holds 2.
    expect(allocateMinor(10n, [2n, 2n, 3n])).toEqual([3n, 3n, 4n]);
  });

  it('rejects an empty list, a negative weight, a non-bigint weight, and all-zero weights', () => {
    expect(codeOf(() => allocateMinor(10n, []))).toBe('invalid-argument');
    expect(codeOf(() => allocateMinor(10n, [1n, -1n]))).toBe('invalid-argument');
    expect(codeOf(() => allocateMinor(10n, [0n, 0n]))).toBe('invalid-argument');
    expect(codeOf(() => allocateMinor(10n, untyped<bigint[]>([1, 2])))).toBe('invalid-argument');
  });

  describe('properties', () => {
    it('conserves the total: no unit is created or lost', () => {
      fc.assert(
        fc.property(totals, weightLists, (total, weights) => {
          expect(sum(allocateMinor(total, weights))).toBe(total);
        }),
      );
    });

    it('returns one part per weight, never opposite in sign to the total', () => {
      fc.assert(
        fc.property(totals, weightLists, (total, weights) => {
          const parts = allocateMinor(total, weights);
          expect(parts).toHaveLength(weights.length);
          for (const part of parts) {
            expect(total >= 0n ? part >= 0n : part <= 0n).toBe(true);
          }
        }),
      );
    });

    it('keeps every part within one unit of its exact proportional share', () => {
      fc.assert(
        fc.property(totals, weightLists, (total, weights) => {
          const weightSum = sum(weights);
          const parts = allocateMinor(total, weights);
          weights.forEach((weight, index) => {
            // |part - total * weight / weightSum| < 1, multiplied through by weightSum
            expect(abs((parts[index] ?? 0n) * weightSum - total * weight)).toBeLessThan(weightSum);
          });
        }),
      );
    });

    it('gives a zero weight nothing, and a larger weight at least as much as a smaller one', () => {
      fc.assert(
        fc.property(totals, weightLists, (total, weights) => {
          const parts = allocateMinor(total, weights).map(abs);
          weights.forEach((weight, i) => {
            if (weight === 0n) {
              expect(parts[i]).toBe(0n);
            }
            weights.forEach((other, j) => {
              if (weight > other) {
                expect(parts[i] ?? 0n).toBeGreaterThanOrEqual(parts[j] ?? 0n);
              }
            });
          });
        }),
      );
    });

    it('splits equal weights as evenly as whole units allow, extras to the earliest', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 0n, max: 10n ** 18n }),
          fc.integer({ min: 1, max: 20 }),
          (total, count) => {
            const parts = allocateMinor(
              total,
              Array.from({ length: count }, () => 1n),
            );
            const floor = total / BigInt(count);
            const extras = total % BigInt(count);
            expect(parts).toEqual(
              Array.from({ length: count }, (_, i) => (BigInt(i) < extras ? floor + 1n : floor)),
            );
          },
        ),
      );
    });

    it('mirrors around zero: allocating -total is allocating total, negated', () => {
      fc.assert(
        fc.property(totals, weightLists, (total, weights) => {
          expect(allocateMinor(-total, weights)).toEqual(
            allocateMinor(total, weights).map((part) => -part),
          );
        }),
      );
    });
  });
});
