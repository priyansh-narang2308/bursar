# ADR-0008: API, sessions and the PayPal client

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

The money loop needs an HTTP API that is multi-tenant by construction, and a PayPal client the executor can trust to retry, classify errors and never charge twice. Both must be testable with no network and no PayPal keys.

## Decision

- **Hono** for the API: small, typed, with a built-in request test client, so tests call `app.request` against a PGlite database.
- **Sessions are signed cookies**, not rows: `HttpOnly`, `SameSite=Lax`, twelve hours, claims `{user, org, role, exp}` signed with `@bursar/crypto`. Nothing to store or clean up, and revocation is by expiry, which is acceptable for a demo workspace. Real sign-in is out of scope.
- **Roles are one table.** `ROLE_PERMISSIONS` maps the six roles to permissions; the Verifier can protect and never spend, an agent can only propose and read. Agent keys add scopes on top, and a request needs both.
- **Agent keys** are `bk_` plus 192 random bits, shown once, stored as a SHA-256. Looking a key up is system code, because the organisation is not yet known.
- **Errors are the catalog.** Handlers throw `ApiError(code)`; one handler turns it, and any stray failure, into `application/problem+json` that reveals nothing.
- **A thin REST client for PayPal instead of the official Server SDK.** The SDK lacks Payouts and webhook verification, defaults to no timeout and no retries, and cannot be pointed at a fake without extra work. One small client covers everything, with explicit retries, request ids and error classes, and runs against `@bursar/paypal-fake` as a plain `fetch`. The cost is that PayPal's request and response shapes are ours to keep right, which the contract suite and the live smoke test are for. **This changes the earlier "use the Server SDK for money paths" rule.**
- **A fake PayPal with a fidelity table** instead of mocking HTTP per test: one place that encodes the rules we depend on (partial captures, honor period, once-only reauthorize, payouts, signed webhooks), tagged ✅ / 🔶 / ❓ so what is unverified is visible.

## Consequences

- The fake is only as good as our reading of PayPal. Several ❓ rows need a sandbox run once keys exist; the live smoke test is written and skipped until then.
- The rate limiter and demo workspaces are per instance and unbounded respectively; both are fine for a demo and listed as not done.
- The API depends on `@bursar/db`'s `withOrg` for every tenant read, so a handler that skips `asTenant` is a review finding, not a silent leak.
