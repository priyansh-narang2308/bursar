# Channel3 validation

Run on 2026-10-06 with `apps/api/src/dev-tools/validate-catalog.ts`, hard-capped at 10 credits by the catalog's own budget. Six searches (five results each at most), and a re-quote of the first result of the first four. Raw results are in [channel3.json](channel3.json).

| Query | Results | With a price | With a domain | Cheapest | Dearest | Re-quote of the first |
| --- | --- | --- | --- | --- | --- | --- |
| standing desk | 4 | 4 | 4 | $829.00 | $1225.00 | same price |
| ergonomic office chair | 5 | 5 | 5 | $139.99 | $1385.00 | same price |
| usb-c monitor | 5 | 5 | 5 | $154.99 | $514.80 | same price |
| mechanical keyboard | 5 | 5 | 5 | $34.99 | $71.99 | same price |
| laptop stand | 5 | 5 | 5 | $24.52 | $129.00 | not run |
| desk lamp | 5 | 5 | 5 | $320.00 | $625.00 | not run |

**Cost and speed.** 10 credits over 10 calls, one credit each. Median latency 988 ms, slowest 2378 ms. Every call succeeded; none was rate limited.

**What it confirms.** Every offer came back with an exact positive price that normalised to money and a domain, and every one was in stock. A re-quote found the same product again with no drift, which is what the price-drift rule relies on.

**What it does not cover.** Prices that really change between search and checkout (none did in this window), out-of-stock and limited-stock results (none appeared), and rate limiting at volume (the cap prevented it). Those stay covered by the recorded fixtures and the client's tests.
