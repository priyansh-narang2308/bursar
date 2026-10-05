# @bursar/money

Exact money for Bursar: whole minor units in a `bigint`, PayPal's currencies, rounding that is always your choice, and a split that never loses a cent. Zero runtime dependencies.

```ts
import { Money, basisPoints } from '@bursar/money';

const price = Money.parse('15.50', 'USD'); // a PayPal decimal string, strictly read
const fee = price.applyRate(basisPoints(299n), 'half-even'); // 2.99%, rounding stated: USD 0.46
const net = price.subtract(fee); // USD 15.04

// A $1,000.01 budget shared across a 10-seat office, with not one cent lost
const seats = Money.parse('1000.01', 'USD').allocate(Array.from({ length: 10 }, () => 1n));
seats.map(String); // ['USD 100.01', 'USD 100.00', ... nine times in all]
Money.sum(seats, 'USD').toString(); // 'USD 1000.01'
```

## What it guarantees

| Guarantee | How it is enforced |
| --- | --- |
| **No floating point, ever** | An amount is whole minor units in a `bigint`. The constructor rejects anything else, `multiply` takes a `bigint`, and a rate is an exact fraction. |
| **Every `Money` is valid** | The constructor is private and every instance comes through `Money.of`, which checks the currency and the range. Instances are frozen. |
| **It always fits the database** | Amounts are bounded to ±(2⁶³ − 1), the range of a Postgres `bigint`. Overflow throws `out-of-range`; it never wraps and never loses precision. |
| **One spelling per amount** | `Money.parse` accepts only the canonical decimal: an optional minus, no leading zeros, exactly the currency's number of decimals, at most 32 characters. `"1e3"`, `"+1.00"`, `".5"`, `"10.5"`, `"05.00"`, `"-0.00"` and padded or non-ASCII input are all rejected. |
| **PayPal's currencies, PayPal's decimals** | A closed list of the 25 currencies on [PayPal's currency page](https://developer.paypal.com/api/rest/reference/currency-codes/). HUF, JPY and TWD have no decimals there (ISO 4217 gives HUF and TWD two, so PayPal's rule decides). Anything else is `invalid-currency`, never guessed. |
| **Currencies never mix** | `add`, `subtract`, `compare` and `sum` throw `currency-mismatch`. `equals` just says no. |
| **Rounding is a decision** | `applyRate` requires one of seven modes. There is no default to forget about. |
| **A split loses nothing** | `allocate` uses the largest remainder method: the parts add up to the total, and each is within one unit of its exact share. |
| **One error type** | `MoneyError`, with a stable `code` to branch on. |

## Usage

```ts
import { Money, fromPayPalAmount, moneyFromJSON, percent, toPayPalAmount } from '@bursar/money';

// Build: from minor units, or from a PayPal decimal string
Money.of(1550n, 'USD'); // USD 15.50
Money.parse('1050', 'JPY'); // JPY 1050 (no decimals in yen)
Money.parse('10.5', 'USD'); // throws MoneyError 'invalid-amount': PayPal always sends two decimals

// Combine: same currency only, exact, bounded
price.add(fee).subtract(fee).multiply(3n).negate();
price.add(Money.parse('1.00', 'EUR')); // throws 'currency-mismatch'
Money.sum([price, fee], 'USD'); // the currency is always stated, so an empty list is still well defined

// Compare
price.compare(fee); // -1 | 0 | 1
price.greaterThan(fee); // also lessThan, lessThanOrEqual, greaterThanOrEqual
price.isZero(); // also isPositive, isNegative

// Rates are exact fractions: percent(5n) is 5%, basisPoints(299n) is 2.99%, rate(1n, 3n) is a third
Money.parse('19.99', 'USD').applyRate(percent(8n), 'half-up'); // USD 1.60

// Exchange: JSON.stringify works (an amount travels as a string), and PayPal's wire shape
JSON.stringify({ total: price }); // {"total":{"currency":"USD","minor":"1550"}}
moneyFromJSON(JSON.parse(text)); // strict: exactly those two keys, a canonical integer string
toPayPalAmount(price); // { currency_code: 'USD', value: '15.50' }
fromPayPalAmount(webhook.resource.amount); // ignores extra fields such as `breakdown`
```

### Rounding modes

The names and meanings follow Java's `RoundingMode`. For 2.5 and -2.5:

| Mode | Meaning | 2.5 | -2.5 |
| --- | --- | --- | --- |
| `down` | toward zero | 2 | -2 |
| `up` | away from zero | 3 | -3 |
| `floor` | toward negative infinity | 2 | -3 |
| `ceiling` | toward positive infinity | 3 | -2 |
| `half-up` | nearest; a tie goes away from zero | 3 | -3 |
| `half-down` | nearest; a tie goes toward zero | 2 | -2 |
| `half-even` | nearest; a tie goes to the even one | 2 | -2 |

### Errors

Every failure is a `MoneyError`; branch on `error.code`, never on the message.

| Code | Meaning |
| --- | --- |
| `invalid-currency` | The currency is not one PayPal accepts. |
| `currency-mismatch` | An operation mixed two currencies. |
| `invalid-amount` | An amount is malformed: not a bigint, or not a canonical decimal or integer string. |
| `out-of-range` | A result would leave the signed 64-bit range. |
| `invalid-argument` | Anything else: a negative weight, a zero denominator, an unknown rounding mode. |

## What is deliberately not here

- **Currency conversion.** Bursar never converts; mixing currencies is an error. Conversion belongs to PayPal.
- **Formatting for people.** `toString` is for logs. Use `Intl.NumberFormat` in the UI, which accepts the decimal string.
- **Any `number` input.** Not for amounts, factors, weights or rates.

## How it is tested

`pnpm --filter @bursar/money test` runs 341 tests and enforces 100% statement, branch, function and line coverage.

- **Properties** (fast-check): the decimal codec round-trips every amount, and anything it accepts formats back to itself; rounding stays within one unit, moves the way its name says, breaks ties as documented and mirrors around zero; allocation conserves the total, stays within one unit of each exact share, gives a zero weight nothing and a larger weight at least as much; addition is commutative, associative and invertible, and multiplication distributes; JSON and PayPal shapes round-trip.
- **Mutation check** (a manual run, not part of CI): breaking the implementation in 12 deliberate ways, such as reversing the allocation tie-break, accepting leading zeros or giving TWD decimals, failed the suite every time.

## PayPal facts this relies on (checked 2026-10-05)

- PayPal's currency page lists 25 currencies, and marks HUF, JPY and TWD "does not support decimals".
- PayPal's Orders v2 OpenAPI spec defines `Money.value` as a string of at most 32 characters matching `^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$`. That pattern also allows leading zeros and a missing integer part; this package accepts only the canonical subset of it.
