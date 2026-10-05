import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { divideRounded, isRoundingMode, ROUNDING_MODES, type RoundingMode } from '../src/rounding';
import { codeOf, untyped } from './support';

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

const numerators = fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n });
const denominators = fc.bigInt({ min: 1n, max: 10n ** 12n });
const modes = fc.constantFrom(...ROUNDING_MODES);

/** Every mode's answer for `numerator / denominator`, written out by hand from the definitions. */
const truthTable: ReadonlyArray<readonly [bigint, bigint, Record<RoundingMode, bigint>]> = [
  // 2.5 and -2.5: the tie that tells the half modes apart
  [
    5n,
    2n,
    { down: 2n, up: 3n, floor: 2n, ceiling: 3n, 'half-up': 3n, 'half-down': 2n, 'half-even': 2n },
  ],
  [
    -5n,
    2n,
    {
      down: -2n,
      up: -3n,
      floor: -3n,
      ceiling: -2n,
      'half-up': -3n,
      'half-down': -2n,
      'half-even': -2n,
    },
  ],
  // 3.5 and -3.5: half-even rounds up here, because 4 is the even neighbour
  [
    7n,
    2n,
    { down: 3n, up: 4n, floor: 3n, ceiling: 4n, 'half-up': 4n, 'half-down': 3n, 'half-even': 4n },
  ],
  [
    -7n,
    2n,
    {
      down: -3n,
      up: -4n,
      floor: -4n,
      ceiling: -3n,
      'half-up': -4n,
      'half-down': -3n,
      'half-even': -4n,
    },
  ],
  // a third and two thirds, on both sides of zero
  [
    1n,
    3n,
    { down: 0n, up: 1n, floor: 0n, ceiling: 1n, 'half-up': 0n, 'half-down': 0n, 'half-even': 0n },
  ],
  [
    2n,
    3n,
    { down: 0n, up: 1n, floor: 0n, ceiling: 1n, 'half-up': 1n, 'half-down': 1n, 'half-even': 1n },
  ],
  [
    -1n,
    3n,
    { down: 0n, up: -1n, floor: -1n, ceiling: 0n, 'half-up': 0n, 'half-down': 0n, 'half-even': 0n },
  ],
  [
    -2n,
    3n,
    {
      down: 0n,
      up: -1n,
      floor: -1n,
      ceiling: 0n,
      'half-up': -1n,
      'half-down': -1n,
      'half-even': -1n,
    },
  ],
  // exact quotients are the same in every mode
  [
    6n,
    3n,
    { down: 2n, up: 2n, floor: 2n, ceiling: 2n, 'half-up': 2n, 'half-down': 2n, 'half-even': 2n },
  ],
  [
    -6n,
    3n,
    {
      down: -2n,
      up: -2n,
      floor: -2n,
      ceiling: -2n,
      'half-up': -2n,
      'half-down': -2n,
      'half-even': -2n,
    },
  ],
  [
    0n,
    5n,
    { down: 0n, up: 0n, floor: 0n, ceiling: 0n, 'half-up': 0n, 'half-down': 0n, 'half-even': 0n },
  ],
];

describe('ROUNDING_MODES', () => {
  it('lists the seven modes, and isRoundingMode recognises exactly those', () => {
    expect(ROUNDING_MODES).toEqual([
      'down',
      'up',
      'floor',
      'ceiling',
      'half-up',
      'half-down',
      'half-even',
    ]);
    for (const mode of ROUNDING_MODES) {
      expect(isRoundingMode(mode)).toBe(true);
    }
    for (const value of ['HALF_UP', 'half_up', 'round', '', null, undefined, 1, {}]) {
      expect(isRoundingMode(value)).toBe(false);
    }
  });
});

describe('divideRounded', () => {
  describe.each(truthTable)('%s / %s', (numerator, denominator, expected) => {
    it.each(ROUNDING_MODES)('rounds %s as the definition says', (mode) => {
      expect(divideRounded(numerator, denominator, mode)).toBe(expected[mode]);
    });
  });

  it.each([0n, -1n, -10n])('rejects the denominator %s', (denominator) => {
    expect(codeOf(() => divideRounded(1n, denominator, 'down'))).toBe('invalid-argument');
  });

  it('rejects an unknown mode, whether or not the division is exact', () => {
    const unknownMode = untyped<RoundingMode>('round');
    expect(codeOf(() => divideRounded(4n, 2n, unknownMode))).toBe('invalid-argument');
    expect(codeOf(() => divideRounded(5n, 2n, unknownMode))).toBe('invalid-argument');
    expect(codeOf(() => divideRounded(5n, 2n, untyped<RoundingMode>(undefined)))).toBe(
      'invalid-argument',
    );
  });

  describe('properties', () => {
    it('lands within one unit of the exact quotient, in every mode', () => {
      fc.assert(
        fc.property(numerators, denominators, modes, (n, d, mode) => {
          expect(abs(divideRounded(n, d, mode) * d - n)).toBeLessThan(d);
        }),
      );
    });

    it('moves in the direction its name gives', () => {
      fc.assert(
        fc.property(numerators, denominators, (n, d) => {
          expect(abs(divideRounded(n, d, 'down')) * d).toBeLessThanOrEqual(abs(n));
          expect(abs(divideRounded(n, d, 'up')) * d).toBeGreaterThanOrEqual(abs(n));
          expect(divideRounded(n, d, 'floor') * d).toBeLessThanOrEqual(n);
          expect(divideRounded(n, d, 'ceiling') * d).toBeGreaterThanOrEqual(n);
        }),
      );
    });

    it('picks the nearest whole number in the half modes', () => {
      fc.assert(
        fc.property(
          numerators,
          denominators,
          fc.constantFrom('half-up', 'half-down', 'half-even'),
          (n, d, mode) => {
            expect(abs(divideRounded(n, d, mode) * d - n) * 2n).toBeLessThanOrEqual(d);
          },
        ),
      );
    });

    it('breaks an exact tie the way each half mode promises', () => {
      // n / d = k + 1/2 exactly, for any whole k and any scale m
      const ties = fc
        .tuple(
          fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
          fc.bigInt({ min: 1n, max: 10n ** 6n }),
        )
        .map(([k, m]) => ({ k, n: (2n * k + 1n) * m, d: 2n * m }));

      fc.assert(
        fc.property(ties, ({ k, n, d }) => {
          const awayFromZero = k >= 0n ? k + 1n : k;
          const towardZero = k >= 0n ? k : k + 1n;
          expect(divideRounded(n, d, 'half-up')).toBe(awayFromZero);
          expect(divideRounded(n, d, 'half-down')).toBe(towardZero);
          expect(divideRounded(n, d, 'half-even') % 2n).toBe(0n);
        }),
      );
    });

    it('ignores the mode when the division is exact', () => {
      fc.assert(
        fc.property(numerators, denominators, modes, (q, d, mode) => {
          expect(divideRounded(q * d, d, mode)).toBe(q);
        }),
      );
    });

    it('mirrors around zero in every mode except floor and ceiling, which swap', () => {
      fc.assert(
        fc.property(numerators, denominators, modes, (n, d, mode) => {
          const mirror: Record<RoundingMode, RoundingMode> = {
            down: 'down',
            up: 'up',
            floor: 'ceiling',
            ceiling: 'floor',
            'half-up': 'half-up',
            'half-down': 'half-down',
            'half-even': 'half-even',
          };
          expect(divideRounded(-n, d, mode)).toBe(-divideRounded(n, d, mirror[mode]));
        }),
      );
    });
  });
});
