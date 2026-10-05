# @bursar/ledger

A double-entry ledger as pure functions: the entries each PayPal action posts, and the envelope figures they imply. Storing entries is the database's job (`ledger_entries` in `@bursar/db`, which refuses an unbalanced transaction at commit).

| Event | Entries |
| --- | --- |
| `AUTHORIZE` | debit `hold`, credit `payer_funds` |
| `VOID` | debit `payer_funds`, credit `hold` |
| `CAPTURE` (amount, fee) | release the hold, then debit `escrow` for the amount less the fee, debit `fees` for the fee, credit `payer_funds` |
| `REFUND` | debit `payer_funds`, credit `escrow` |
| `PAYOUT` | debit `supplier_paid`, credit `escrow` |

`post` builds the entries (they always balance), `balance` and `isBalanced` read them, and `figures` replays events into `held`, `captured`, `fees`, `refunded`, `settled` and what is left in `escrow`, refusing any event that takes more than is there (`LedgerError`).

**Worked example.** Authorize $100, capture $60 with a $2 fee, refund $10, pay a supplier $30: held $40, captured $60, fees $2, refunded $10, settled $30, escrow $18. A property test checks, for any valid sequence, that the ledger balances and its accounts reconcile with these figures.

Amounts are `Money` from `@bursar/money`. Not here yet: the idempotent `post()` into the database, which comes with the executor.
