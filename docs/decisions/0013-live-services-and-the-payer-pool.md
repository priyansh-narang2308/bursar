# ADR-0013: Live services and the payer pool

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

Everything so far ran against stand-ins. A judge should be able to see real products from real retailers, and real PayPal sandbox calls, without anyone having to click through a buyer's PayPal approval for every visit.

## Decision

- **Channel3 is real, and recorded.** `createLiveApi` wraps `@channel3/sdk` (a 429 becomes the catalog's rate-limit signal, a 404 means "gone"). A gated test searches the real catalog, checks offers become exact money, and re-quotes one. `pnpm --filter @bursar/channel3 record` saves real results for the demo's queries to `fixtures/recorded.json`, so the demo shows real products and retailers with no key and no credits. `BURSAR_CATALOG=live` searches live within the catalog's credit budget.
- **A retailer must be approved before it can be paid.** The registry still decides who gets paid: the demo registers the retailers in its recorded set (`name` is the domain), and an offer from any other domain is dropped and counted. Their payout address is a sandbox account, never an address from the catalog.
- **PayPal sandbox is the same code path.** `BURSAR_PAYPAL=sandbox` swaps the fake for the real client with the keys in `.env`. The money loop, the policy and the Verifier do not change. The live smoke test authenticates and creates a vault setup token on the real sandbox.
- **A payer pool stands in for the buyer.** A buyer must approve on PayPal's own page, which a program cannot do. `pnpm dev:payer` does it once: it prints the approval address, receives the redirect, turns the approval into a payment token and seals it with `VAULT_ENC_KEY` into `.bursar/payers.json` (git-ignored). Each demo workspace then `adopt`s a pooled token: the mandate is sealed to that workspace exactly as a fresh one would be.
- **A shared token is never deleted by one workspace.** Revoking an adopted mandate (including the Verifier's containment) would delete a token every workspace uses, so with `keepVaultTokens` it only ends the mandate. PayPal itself still refuses nothing: the mandate, not the token, is what stops spending.
- **No public address, no webhooks; ask instead.** On a laptop PayPal cannot reach the webhook door, so in sandbox mode the loop polls PayPal for captures it is waiting on, the fallback the product already has for lost webhooks. A deployed server uses real webhooks (`PAYPAL_WEBHOOK_ID`).
- **`pnpm dev:spike`** makes one real $12.00 purchase on the sandbox through the money loop (hold, capture, refund) and prints each step and PayPal's debug id, never a token.

## Consequences

- Until a buyer has been approved once with `pnpm dev:payer`, the sandbox demo has no one to charge. The fake demo needs nothing.
- Recorded prices are a snapshot. Real standing desks cost more than the policy's $500 item cap, so a request for one is blocked, which is the policy working.
- Refund and payout confirmation still rely on webhooks; the polling fallback covers captures only.
