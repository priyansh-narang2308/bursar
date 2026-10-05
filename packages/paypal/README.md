# @bursar/paypal

A typed client for the PayPal APIs Bursar uses: Vault v3, Orders v2, Payments v2, Payouts and webhooks. Sandbox only: the base URL is checked when the client is made, and only `api-m.sandbox.paypal.com`, local hosts and `.test` hosts (the fake) are accepted.

- **Idempotent.** Every POST carries the `PayPal-Request-Id` the caller passes (derive it with `payPalRequestId` from `@bursar/crypto`). A retry reuses the same id.
- **Classified errors.** `PayPalError.kind` says what to do: `declined` and `rejected` are terminal; `retryable` (429 and 5xx, after the client's own retries) is safe to retry with the same id; `unknown` (no answer) means look the call up before doing anything; `auth` and `invalid` are bugs or outages. Every error keeps PayPal's `debugId`.
- **Retries and timeouts** are explicit, because the official SDK defaults to none: 429 and 5xx back off (honouring `Retry-After`), a refused token is refreshed once, and a call times out after 15 seconds.
- **One token** is shared by concurrent calls and refreshed a minute before it expires.
- **Responses are validated** with Zod; anything unreadable is `invalid`.
- Amounts are `Money` from `@bursar/money`, written as decimal strings with the currency's exponent.

It is a thin REST client rather than the official Server SDK, so one client covers Payouts and webhook verification (which the SDK lacks) and can be tested against `@bursar/paypal-fake`; see ADR-0008.
