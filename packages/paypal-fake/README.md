# @bursar/paypal-fake

A fake PayPal for tests: the sandbox behaviours Bursar depends on, in memory, with a fidelity table so nobody mistakes it for the real thing. It is a `fetch`-compatible function, so a `@bursar/paypal` client with a base URL ending in `.test` talks to it with no network.

```ts
const fake = createFakePayPal({ now: () => clock });
const client = createPayPalClient({ clientId: fake.config.clientId, clientSecret: fake.config.clientSecret, baseUrl: 'https://fake.paypal.test', fetch: fake.fetch });
fake.approveSetupToken(id); // the payer approves on PayPal's page
await fake.settlePayouts(); // PayPal finishes pending payouts and fires a webhook
```

Hooks: `approveSetupToken`, `settlePayouts`, `events` (every webhook it signed and delivered), `balance()`, an injectable clock for honor periods and expiry, `deliver` to receive webhooks, and the `PayPal-Mock-Response` header to force a failure (`{"mock_application_codes":"INSTRUMENT_DECLINED"}`).

## The contract

`test/contract.ts` is what Bursar relies on PayPal doing: hold from a vaulted token, idempotent retries, partial then final capture, void once, refunds within the capture, payouts within the balance, revocation that really stops charging, and no saving of an unapproved payment method. It passes against the fake on every run. `test/live.test.ts` is the live sandbox smoke test (no money moves), run with `PAYPAL_LIVE_TESTS=1` and sandbox keys; it is skipped otherwise. The checks that need a real sandbox were run on 2026-10-06 with `apps/api/src/dev-tools/validate.ts`; the results and what changed are in [docs/validation](../../docs/validation/README.md).

## Fidelity

✅ matches PayPal's documented behaviour · 🔶 approximated · ❓ unverified or not modelled (confirm against the sandbox before relying on it)

| Behaviour | | Notes |
| --- | --- | --- |
| OAuth client credentials, bearer token | ✅ | |
| `PayPal-Request-Id` replays the first answer | ✅ | Confirmed on the sandbox, 2026-10-06. Only successes are cached. PayPal's retention window (hours to days) is not modelled ❓ |
| Vault: setup token, payer approval, payment token, delete | ✅ | Approval is a hook (`approveSetupToken`) 🔶 |
| A deleted token cannot be charged | 🔶 | The fake answers `BILLING_AGREEMENT_NOT_FOUND`, 422; the real status and code need a sandbox check |
| An AUTHORIZE order from a vaulted token returns its authorization inline | ✅ | Confirmed on the sandbox, 2026-10-06. The fallback `/authorize` call always says `ORDER_ALREADY_AUTHORIZED` here |
| Partial captures, `final_capture` closes the authorization | ✅ | |
| `AUTHORIZATION_VOIDED`, `AUTHORIZATION_ALREADY_CAPTURED` | ✅ | |
| Capturing more than is left: `MAX_CAPTURE_AMOUNT_EXCEEDED` | ✅ | The sandbox's own code, 2026-10-06. The fake had guessed another name |
| Void releases the remainder, once, with 204 | ✅ | A second void is `PREVIOUSLY_VOIDED`, and capturing a voided authorization is `AUTHORIZATION_VOIDED`: both confirmed on the sandbox |
| Reauthorize only after the 3-day honor period: `REAUTHORIZATION_TOO_SOON` | ✅ | |
| Reauthorize only once: `REAUTHORIZATION_NOT_ALLOWED` | ❓ | The rule is documented; the code name is a guess |
| An authorization lasts 29 days, then reads `EXPIRED` | 🔶 | |
| Only the payee can void (`PERMISSION_DENIED` for others) | ❓ | Not modelled: the fake has one merchant |
| Refunds up to the amount captured | ✅ | Codes `CAPTURE_FULLY_REFUNDED` and `REFUND_AMOUNT_EXCEEDED` confirmed on the sandbox, 2026-10-06 |
| PayPal's fee is 2.9% plus 30 cents | 🔶 | The published US rate; the sandbox may differ |
| Payouts: PENDING then SUCCESS, `INSUFFICIENT_FUNDS` | ❓ | Not checked on the sandbox: the app answered 403 `PAYOUT_NOT_AVAILABLE` (Payouts is not enabled on it). Real settlement is said to take about 30 seconds; here it is `settlePayouts()` |
| Reusing a `sender_batch_id` is refused | ❓ | The error code is a guess |
| Payout limits (per item, per minute) | ❓ | Not modelled |
| Webhook event names | ✅ | From PayPal's list: capture completed and refunded, authorization voided, payouts batch success |
| Webhook signature and the verify endpoint | ❓ | The request and response shapes match; the signature is a SHA-256, not PayPal's certificate chain and CRC32 |
| The capture webhook carries `custom_id` | ✅ | Confirmed on the sandbox, 2026-10-06: capture, refund and void events all carried it |
| Delivery retries, ordering and delay | ❓ | Not modelled. Events arrive at once, in order |
| `PayPal-Mock-Response` | 🔶 | `INSTRUMENT_DECLINED` confirmed as a 422 on the sandbox. Any other code becomes a 422 here (a few map to 403, 404, 500); real accepted codes depend on the endpoint |
| `debug_id` on every error, in the body and the `paypal-debug-id` header | ✅ | |
| 429 and `Retry-After` | ❓ | Not produced by the fake; the client's tests cover the handling |
| Amounts as decimal strings with the currency's exponent | ✅ | Through `@bursar/money`, including the whole-unit currencies |
