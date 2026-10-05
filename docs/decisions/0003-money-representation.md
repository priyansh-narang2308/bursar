# ADR-0003: Money representation

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Every other part of Bursar (the policy engine, the ledger, the executor, the PayPal client, the UI) handles amounts, and a rounding or precision mistake in any of them is a money bug. The representation is hard to change later, so it is decided once, in `@bursar/money`, and nothing else does arithmetic on amounts.

Facts that shaped it, all checked on 2026-10-05:

- PayPal sends and expects amounts as decimal strings (`{ "currency_code": "USD", "value": "10.50" }`). Its OpenAPI spec allows up to 32 characters and a loose pattern that accepts `010.50`, `.5` and `10.5`.
- PayPal's currency page lists 25 currencies and says HUF, JPY and TWD "do not support decimals". ISO 4217 gives HUF and TWD two decimals, so a table copied from ISO would send PayPal amounts it rejects.
- Amounts end up in Postgres, in JSON audit records and in a hash chain, so there must be exactly one canonical spelling of an amount.
- The policy engine is fail-closed, so anything unexpected has to be an error, never a default.

## Decision

| Concern | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Representation | An immutable `Money` class: whole minor units in a `bigint` plus a currency code | Integer arithmetic is exact; a class with a private constructor makes an invalid `Money` unrepresentable | `number` (floats); a decimal library (a dependency that still allows lossy conversion); a plain `{ minor, currency }` object that anyone can forge |
| Range | ±(2⁶³ − 1), enforced on every construction | Always fits a Postgres `bigint`; symmetric, so negating never overflows; overflow throws instead of wrapping | Unbounded `bigint`, which could not be stored |
| Currencies | A closed list of PayPal's 25, with PayPal's exponents (HUF, JPY and TWD have none) | Bursar only moves money through PayPal; an unknown code is an error, never "two decimals by default" | An open ISO table with a default exponent of 2 |
| Decimal strings | One canonical spelling, strictly parsed and exactly the currency's decimals, at most 32 characters | One amount, one string, which keeps hashes, idempotency keys and audit records stable; ambiguity is rejected rather than guessed | Accepting everything PayPal's pattern allows; leniency about missing decimals |
| Rounding | Seven explicit modes (Java's names); no default | A fee is rarely a whole number of cents, and the mode is a policy choice that has to be visible in code | A default mode; fewer modes |
| Rates | An exact fraction (`rate`, `percent`, `basisPoints`) | No float ever represents a percentage | `number` percentages |
| Splitting | Largest remainder (Hamilton), ties to the earliest part, negatives mirrored | Conserves every unit, stays within one unit of each exact share, and is deterministic | Giving the remainder to the first or last part, which is biased |
| Errors | One `MoneyError` with a stable `code` | The policy engine and API can map codes without parsing messages | Several error classes; `TypeError` and `RangeError` |
| JSON | `{ currency, minor: "1550" }`, with the amount as a string; PayPal's wire shape handled separately | JSON numbers cannot hold a `bigint`, and `JSON.stringify` would otherwise throw | A decimal string in the internal form, which would tie it to PayPal's spelling |

## Consequences

- **Currencies change by editing one list.** If PayPal adds a currency or changes its decimals, `CURRENCY_CODES` and one test change, and nothing else.
- **No conversion.** Mixing currencies is an error. Bursar never converts, so conversion stays PayPal's job.
- **Strictness has a cost.** If PayPal ever sent `10.5` for a dollar amount, parsing would fail rather than guess. That is intended: PayPal sends the full precision today, and a change would be news worth stopping for.
- **The limit is 64 bits.** A sum above about 9.2 × 10¹⁸ minor units is an error. No realistic amount comes close; the bound exists so storage can never disagree with the code.
- **Other packages must use it.** `AGENTS.md` states the rule: no arithmetic on raw `bigint` amounts or decimal strings outside this package.

## Verification (2026-10-05)

- PayPal's currency-codes page: 25 currencies; HUF, JPY and TWD "do not support decimals"; BRL is in-country only, and CNY and MYR are domestic only.
- PayPal's Orders v2 OpenAPI spec: `Money.value` is a string with `maxLength` 32 and pattern `^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$`.
- 341 tests with 100% coverage, including properties for the decimal codec, rounding, allocation and arithmetic. Twelve deliberate bugs were each caught by the suite.
