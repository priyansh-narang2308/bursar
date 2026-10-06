# @bursar/channel3

The product catalog behind search. `createCatalog` wraps any `ProductApi` (a fixture offline, `fromSdk(client)` for Channel3 itself) and adds what a spending system needs:

- **Exact prices.** The catalog reports floats; `normalize` reads them as decimals in the currency's own precision into `Money`, picks the cheapest offer in stock, and skips currencies PayPal does not accept.
- **A credit budget** per mission and in total, so a loop cannot spend the plan.
- **A cache** for repeated searches, and one retry after a 429.
- **Re-quotes.** `requote` is never cached and reports how far a price moved, in basis points, since it was shortlisted.
- **Every call is reported** (`onCall`), cached or not, for the `channel3_calls` table.

The SDK adapter is written to the SDK's typings and has not run against the live API (it needs a key).
