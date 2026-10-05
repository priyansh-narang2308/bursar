import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  basisPoints,
  type CurrencyCode,
  MAX_MINOR,
  MIN_MINOR,
  Money,
  percent,
  type Rate,
  ROUNDING_MODES,
  type RoundingMode,
  rate,
} from '../src';
import { anyMoney, codeOf, smallUsd, untyped } from './support';

const usd = (decimal: string): Money => Money.parse(decimal, 'USD');
const decimals = (parts: readonly Money[]): string[] => parts.map((part) => part.toDecimal());

function signOf(value: bigint): -1 | 0 | 1 {
  if (value === 0n) {
    return 0;
  }
  return value < 0n ? -1 : 1;
}

describe('construction', () => {
  it('holds minor units and a currency', () => {
    const price = Money.of(1050n, 'USD');

    expect(price.minor).toBe(1050n);
    expect(price.currency).toBe('USD');
    expect(Money.zero('EUR').minor).toBe(0n);
    expect(Money.zero('EUR').currency).toBe('EUR');
  });

  it('is immutable', () => {
    const price = Money.of(1050n, 'USD');

    expect(Object.isFrozen(price)).toBe(true);
    expect(() => {
      (price as { minor: bigint }).minor = 1n;
    }).toThrow(TypeError);
  });

  it('is bounded to the signed 64-bit range, symmetrically, so it always fits a bigint column', () => {
    expect(MAX_MINOR).toBe(2n ** 63n - 1n);
    expect(MIN_MINOR).toBe(-MAX_MINOR);
    expect(Money.of(MAX_MINOR, 'USD').minor).toBe(MAX_MINOR);
    expect(Money.of(MIN_MINOR, 'USD').minor).toBe(MIN_MINOR);
    expect(codeOf(() => Money.of(MAX_MINOR + 1n, 'USD'))).toBe('out-of-range');
    expect(codeOf(() => Money.of(MIN_MINOR - 1n, 'USD'))).toBe('out-of-range');
  });

  it('refuses anything but a bigint amount, so a float can never get in', () => {
    for (const minor of [10, 10.5, '10', null, undefined, Number.NaN]) {
      expect(codeOf(() => Money.of(untyped<bigint>(minor), 'USD'))).toBe('invalid-amount');
    }
  });

  it('refuses an unsupported currency, however it is spelled', () => {
    for (const currency of ['usd', 'XXX', 'BAD', '', undefined, 840]) {
      expect(codeOf(() => Money.of(1n, untyped<CurrencyCode>(currency)))).toBe('invalid-currency');
    }
  });
});

describe('decimal strings', () => {
  it.each([
    ['10.50', 'USD', 1050n],
    ['0.05', 'EUR', 5n],
    ['-0.05', 'GBP', -5n],
    ['1050', 'JPY', 1050n],
    ['1050', 'HUF', 1050n], // ISO gives HUF two decimals; PayPal does not
    ['1050', 'TWD', 1050n],
  ] as const)(
    'reads %j in %s as %s minor units, and writes it back',
    (decimal, currency, minor) => {
      const amount = Money.parse(decimal, currency);

      expect(amount.minor).toBe(minor);
      expect(amount.toDecimal()).toBe(decimal);
    },
  );

  it('writes every shape: zero, negative, small, and with no decimals', () => {
    expect(Money.zero('USD').toDecimal()).toBe('0.00');
    expect(Money.zero('JPY').toDecimal()).toBe('0');
    expect(Money.of(-5n, 'USD').toDecimal()).toBe('-0.05');
    expect(Money.of(100n, 'USD').toDecimal()).toBe('1.00');
    expect(Money.of(7n, 'HUF').toDecimal()).toBe('7');
  });

  it('rejects a decimal point where the currency has none, and none where it needs two', () => {
    expect(codeOf(() => Money.parse('10.50', 'JPY'))).toBe('invalid-amount');
    expect(codeOf(() => Money.parse('1050', 'USD'))).toBe('invalid-amount');
    expect(codeOf(() => Money.parse('10.5', 'USD'))).toBe('invalid-amount');
    expect(codeOf(() => Money.parse('1e3', 'USD'))).toBe('invalid-amount');
    expect(codeOf(() => Money.parse(untyped<string>(10.5), 'USD'))).toBe('invalid-amount');
  });

  it('checks the currency first, and the range last', () => {
    expect(codeOf(() => Money.parse('not an amount', untyped<CurrencyCode>('XXX')))).toBe(
      'invalid-currency',
    );
    expect(Money.parse('92233720368547758.07', 'USD').minor).toBe(MAX_MINOR);
    expect(codeOf(() => Money.parse('92233720368547758.08', 'USD'))).toBe('out-of-range');
  });

  it('describes itself for logs', () => {
    expect(usd('10.50').toString()).toBe('USD 10.50');
    expect(Money.of(1050n, 'JPY').toString()).toBe('JPY 1050');
  });

  it('round-trips every amount in every currency', () => {
    fc.assert(
      fc.property(anyMoney, (amount) => {
        expect(Money.parse(amount.toDecimal(), amount.currency).equals(amount)).toBe(true);
      }),
    );
  });
});

describe('arithmetic', () => {
  it('adds, subtracts, negates and takes absolute values', () => {
    expect(usd('10.50').add(usd('0.75')).toDecimal()).toBe('11.25');
    expect(usd('10.50').subtract(usd('20.00')).toDecimal()).toBe('-9.50');
    expect(usd('10.50').negate().toDecimal()).toBe('-10.50');
    expect(usd('-10.50').abs().toDecimal()).toBe('10.50');
    expect(Money.zero('USD').negate().isZero()).toBe(true);
  });

  it('returns the same instance for the absolute value of a non-negative amount', () => {
    const price = usd('10.50');
    expect(price.abs()).toBe(price);
  });

  it('multiplies by a whole number, exactly', () => {
    expect(usd('12.99').multiply(3n).toDecimal()).toBe('38.97');
    expect(usd('12.99').multiply(0n).toDecimal()).toBe('0.00');
    expect(usd('12.99').multiply(-2n).toDecimal()).toBe('-25.98');
  });

  it('refuses a factor that is not a bigint, such as a float', () => {
    for (const factor of [2, 2.5, '2', null, undefined]) {
      expect(codeOf(() => usd('1.00').multiply(untyped<bigint>(factor)))).toBe('invalid-argument');
    }
  });

  it('never mixes currencies', () => {
    const euros = Money.parse('1.00', 'EUR');

    expect(codeOf(() => usd('1.00').add(euros))).toBe('currency-mismatch');
    expect(codeOf(() => usd('1.00').subtract(euros))).toBe('currency-mismatch');
    expect(() => usd('1.00').add(euros)).toThrow('Cannot combine USD with EUR');
  });

  it('refuses to leave the 64-bit range instead of wrapping or losing precision', () => {
    const max = Money.of(MAX_MINOR, 'USD');
    const min = Money.of(MIN_MINOR, 'USD');

    expect(codeOf(() => max.add(usd('0.01')))).toBe('out-of-range');
    expect(codeOf(() => min.subtract(usd('0.01')))).toBe('out-of-range');
    expect(codeOf(() => max.multiply(2n))).toBe('out-of-range');
    expect(max.negate().minor).toBe(MIN_MINOR); // the range is symmetric, so this always works
    expect(min.negate().minor).toBe(MAX_MINOR);
  });

  describe('sum', () => {
    it('adds any iterable, and an empty one is zero in the stated currency', () => {
      expect(Money.sum([usd('1.00'), usd('2.50'), usd('0.25')], 'USD').toDecimal()).toBe('3.75');
      expect(Money.sum(new Set([usd('1.00')]), 'USD').toDecimal()).toBe('1.00');
      expect(Money.sum([], 'JPY').toDecimal()).toBe('0');
    });

    it('rejects a different currency in the list, an unsupported one, and an overflow', () => {
      const mixed = [usd('1.00'), Money.parse('1.00', 'EUR')];

      expect(codeOf(() => Money.sum(mixed, 'USD'))).toBe('currency-mismatch');
      expect(codeOf(() => Money.sum([usd('1.00')], 'EUR'))).toBe('currency-mismatch');
      expect(codeOf(() => Money.sum([], untyped<CurrencyCode>('XXX')))).toBe('invalid-currency');
      expect(codeOf(() => Money.sum([Money.of(MAX_MINOR, 'USD'), usd('0.01')], 'USD'))).toBe(
        'out-of-range',
      );
    });
  });
});

describe('comparison', () => {
  it('orders amounts of the same currency', () => {
    expect(usd('1.00').compare(usd('2.00'))).toBe(-1);
    expect(usd('2.00').compare(usd('2.00'))).toBe(0);
    expect(usd('3.00').compare(usd('2.00'))).toBe(1);
  });

  it('refuses to order different currencies, but simply says they are not equal', () => {
    const euros = Money.parse('1.00', 'EUR');

    expect(codeOf(() => usd('1.00').compare(euros))).toBe('currency-mismatch');
    expect(usd('1.00').equals(euros)).toBe(false);
  });

  it('is equal only when both currency and amount match', () => {
    expect(usd('1.00').equals(usd('1.00'))).toBe(true);
    expect(usd('1.00').equals(usd('1.01'))).toBe(false);
  });

  it('answers the four ordering questions', () => {
    const [low, high] = [usd('1.00'), usd('2.00')];

    expect([low.lessThan(high), low.lessThan(low), high.lessThan(low)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([
      low.lessThanOrEqual(high),
      low.lessThanOrEqual(low),
      high.lessThanOrEqual(low),
    ]).toEqual([true, true, false]);
    expect([high.greaterThan(low), high.greaterThan(high), low.greaterThan(high)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([
      high.greaterThanOrEqual(low),
      high.greaterThanOrEqual(high),
      low.greaterThanOrEqual(high),
    ]).toEqual([true, true, false]);
  });

  it('knows its sign', () => {
    expect([usd('-0.01'), usd('0.00'), usd('0.01')].map((amount) => amount.isNegative())).toEqual([
      true,
      false,
      false,
    ]);
    expect([usd('-0.01'), usd('0.00'), usd('0.01')].map((amount) => amount.isZero())).toEqual([
      false,
      true,
      false,
    ]);
    expect([usd('-0.01'), usd('0.00'), usd('0.01')].map((amount) => amount.isPositive())).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe('applyRate', () => {
  it("applies PayPal's 2.99% to an amount, and rounding is a choice you must make", () => {
    const sale = usd('15.50'); // 1550 * 299 / 10000 = 46.345 minor units

    expect(sale.applyRate(basisPoints(299n), 'half-even').toDecimal()).toBe('0.46');
    expect(sale.applyRate(basisPoints(299n), 'down').toDecimal()).toBe('0.46');
    expect(sale.applyRate(basisPoints(299n), 'up').toDecimal()).toBe('0.47');
  });

  it.each([
    ['down', '0.02', '-0.02'],
    ['up', '0.03', '-0.03'],
    ['floor', '0.02', '-0.03'],
    ['ceiling', '0.03', '-0.02'],
    ['half-up', '0.03', '-0.03'],
    ['half-down', '0.02', '-0.02'],
    ['half-even', '0.02', '-0.02'],
  ] as const)('takes 5%% of 0.50 and of -0.50 with %s: %s and %s', (mode, positive, negative) => {
    expect(usd('0.50').applyRate(percent(5n), mode).toDecimal()).toBe(positive);
    expect(usd('-0.50').applyRate(percent(5n), mode).toDecimal()).toBe(negative);
  });

  it('takes a discount with a negative rate, and zero with a zero rate', () => {
    expect(usd('100.00').applyRate(percent(-10n), 'down').toDecimal()).toBe('-10.00');
    expect(usd('100.00').applyRate(percent(0n), 'down').toDecimal()).toBe('0.00');
  });

  it('works in currencies without decimals', () => {
    expect(Money.of(1999n, 'JPY').applyRate(percent(10n), 'half-up').toDecimal()).toBe('200');
  });

  it('rejects a malformed rate, an unknown mode, and an overflow', () => {
    const noDenominator = untyped<Rate>({ numerator: 1n, denominator: 0n });
    const unknownMode = untyped<RoundingMode>('round');

    expect(codeOf(() => usd('1.00').applyRate(noDenominator, 'down'))).toBe('invalid-argument');
    expect(codeOf(() => usd('1.00').applyRate(percent(5n), unknownMode))).toBe('invalid-argument');
    expect(codeOf(() => Money.of(MAX_MINOR, 'USD').applyRate(percent(200n), 'down'))).toBe(
      'out-of-range',
    );
  });

  describe('properties', () => {
    const rates = fc
      .tuple(fc.bigInt({ min: -1000n, max: 1000n }), fc.bigInt({ min: 1n, max: 1000n }))
      .map(([numerator, denominator]) => rate(numerator, denominator));
    const modes = fc.constantFrom(...ROUNDING_MODES);

    it('lands between the floor and the ceiling, which are one unit apart at most', () => {
      fc.assert(
        fc.property(smallUsd, rates, modes, (amount, by, mode) => {
          const floor = amount.applyRate(by, 'floor');
          const ceiling = amount.applyRate(by, 'ceiling');
          const result = amount.applyRate(by, mode);

          expect(floor.lessThanOrEqual(result)).toBe(true);
          expect(result.lessThanOrEqual(ceiling)).toBe(true);
          expect(ceiling.subtract(floor).minor).toBeLessThanOrEqual(1n);
        }),
      );
    });

    it('leaves an amount alone at a rate of one, in every mode', () => {
      fc.assert(
        fc.property(smallUsd, modes, (amount, mode) => {
          expect(amount.applyRate(rate(1n, 1n), mode).equals(amount)).toBe(true);
        }),
      );
    });

    it('is exact when the fraction divides the amount, whatever the mode', () => {
      fc.assert(
        fc.property(smallUsd, fc.bigInt({ min: 1n, max: 1000n }), modes, (amount, k, mode) => {
          expect(amount.multiply(k).applyRate(rate(1n, k), mode).equals(amount)).toBe(true);
        }),
      );
    });
  });
});

describe('allocate', () => {
  it('splits an amount without losing a unit', () => {
    expect(decimals(usd('100.00').allocate([1n, 1n, 1n]))).toEqual(['33.34', '33.33', '33.33']);
    expect(decimals(usd('100.00').allocate([1n, 2n, 3n]))).toEqual(['16.67', '33.33', '50.00']);
  });

  it('shares a budget across a 10-seat office', () => {
    const seats = Array.from({ length: 10 }, () => 1n);

    const each = (decimal: string, count: number): string[] =>
      Array.from({ length: count }, () => decimal);

    expect(decimals(usd('1000.00').allocate(seats))).toEqual(each('100.00', 10));
    expect(decimals(usd('1000.01').allocate(seats))).toEqual(['100.01', ...each('100.00', 9)]);
  });

  it('keeps the currency, including one without decimals', () => {
    const parts = Money.of(100n, 'JPY').allocate([1n, 1n, 1n]);

    expect(parts.map((part) => part.minor)).toEqual([34n, 33n, 33n]);
    expect(parts.every((part) => part.currency === 'JPY')).toBe(true);
  });

  it('rejects bad weights', () => {
    expect(codeOf(() => usd('1.00').allocate([]))).toBe('invalid-argument');
    expect(codeOf(() => usd('1.00').allocate([0n, 0n]))).toBe('invalid-argument');
  });

  it('adds back up to the original amount for any amount, currency and weights', () => {
    const weights = fc
      .array(fc.bigInt({ min: 0n, max: 10n ** 6n }), { minLength: 1, maxLength: 12 })
      .filter((list) => list.some((weight) => weight > 0n));

    fc.assert(
      fc.property(anyMoney, weights, (amount, list) => {
        const parts = amount.allocate(list);
        expect(Money.sum(parts, amount.currency).equals(amount)).toBe(true);
      }),
    );
  });
});

describe('algebraic properties', () => {
  const triple = fc.tuple(smallUsd, smallUsd, smallUsd);

  it('addition is commutative and associative, with zero as its identity', () => {
    fc.assert(
      fc.property(triple, ([a, b, c]) => {
        expect(a.add(b).equals(b.add(a))).toBe(true);
        expect(
          a
            .add(b)
            .add(c)
            .equals(a.add(b.add(c))),
        ).toBe(true);
        expect(a.add(Money.zero('USD')).equals(a)).toBe(true);
      }),
    );
  });

  it('every amount has an inverse, and subtraction is adding it', () => {
    fc.assert(
      fc.property(smallUsd, smallUsd, (a, b) => {
        expect(a.add(a.negate()).isZero()).toBe(true);
        expect(a.subtract(b).equals(a.add(b.negate()))).toBe(true);
        expect(a.negate().negate().equals(a)).toBe(true);
        expect(a.abs().isNegative()).toBe(false);
      }),
    );
  });

  it('multiplication distributes over addition', () => {
    fc.assert(
      fc.property(smallUsd, smallUsd, fc.bigInt({ min: -1000n, max: 1000n }), (a, b, k) => {
        expect(
          a
            .add(b)
            .multiply(k)
            .equals(a.multiply(k).add(b.multiply(k))),
        ).toBe(true);
      }),
    );
  });

  it('compares consistently: antisymmetric, and in agreement with the sign of the difference', () => {
    fc.assert(
      fc.property(smallUsd, smallUsd, (a, b) => {
        expect(a.compare(b) + b.compare(a)).toBe(0);
        expect(a.compare(b)).toBe(signOf(a.subtract(b).minor));
        expect(a.equals(b)).toBe(a.compare(b) === 0);
      }),
    );
  });

  it('sums a list the same way as adding it up one by one', () => {
    fc.assert(
      fc.property(fc.array(smallUsd, { maxLength: 20 }), (amounts) => {
        const folded = amounts.reduce((total, amount) => total.add(amount), Money.zero('USD'));
        expect(Money.sum(amounts, 'USD').equals(folded)).toBe(true);
      }),
    );
  });
});

describe('the README example', () => {
  it('prints what the README says it prints', () => {
    const price = Money.parse('15.50', 'USD');
    const fee = price.applyRate(basisPoints(299n), 'half-even');

    expect(fee.toString()).toBe('USD 0.46');
    expect(price.subtract(fee).toString()).toBe('USD 15.04');

    const seats = Money.parse('1000.01', 'USD').allocate(Array.from({ length: 10 }, () => 1n));
    expect(seats.map(String)).toEqual([
      'USD 100.01',
      ...Array.from({ length: 9 }, () => 'USD 100.00'),
    ]);
    expect(Money.sum(seats, 'USD').toString()).toBe('USD 1000.01');

    expect(Money.parse('19.99', 'USD').applyRate(percent(8n), 'half-up').toString()).toBe(
      'USD 1.60',
    );
    expect(JSON.stringify({ total: price })).toBe('{"total":{"currency":"USD","minor":"1550"}}');
  });
});
