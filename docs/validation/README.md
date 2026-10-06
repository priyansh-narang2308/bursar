# Live validation

The tests run against a fake PayPal and recorded catalog data. This folder records what happened when the same assumptions were checked against the real thing: PayPal's sandbox and Channel3's live catalog, on 2026-10-06.

| | Report | Raw results | Cost |
| --- | --- | --- | --- |
| PayPal sandbox | [paypal-sandbox.md](paypal-sandbox.md) | [paypal-sandbox.json](paypal-sandbox.json) | Three $1.00 holds on a pooled sandbox buyer, captured, refunded or voided. Sandbox money only |
| Channel3 | [channel3.md](channel3.md) | [channel3.json](channel3.json) | 10 credits, hard-capped by the catalog's own budget |

Both are re-runnable from the repository root, and neither prints a key, a token or a secret. PayPal object ids are masked to their last four characters.

```bash
node --env-file=.env --import tsx apps/api/src/dev-tools/validate.ts          # PayPal sandbox
node --env-file=.env --import tsx apps/api/src/dev-tools/validate-catalog.ts   # Channel3, at most 10 credits
```

## What it found

**Confirmed (14 of 18 checks).** A vaulted `AUTHORIZE` order returns its authorization in the same answer, so the fallback authorize call is not needed. `PayPal-Request-Id` replays the first answer. Partial captures, the final capture, refunds, voids, the honor period before reauthorizing, and a forced decline all behave as the fake assumed. The capture webhook carries the `custom_id` we send, which is what the provenance tag depends on.

**Corrected (2).** Two error names the fake had guessed were wrong, and the fake and its contract tests now use PayPal's:

- Capturing more than is left is `MAX_CAPTURE_AMOUNT_EXCEEDED`, not `AUTHORIZATION_AMOUNT_EXCEEDED`.
- Voiding an authorization twice is `PREVIOUSLY_VOIDED`. Capturing a voided one is `AUTHORIZATION_VOIDED`, as assumed.

**Blocked by the sandbox app's permissions (2).** Both returned HTTP 403, so neither behaviour could be checked:

| Check | PayPal answered | What it means | Decision |
| --- | --- | --- | --- |
| A payout to a supplier | `PAYOUT_NOT_AVAILABLE` | The sandbox app or its business account does not have Payouts enabled | The payout path stays tested against the fake only, and the README says so. To close it: enable **Payouts** on the sandbox app and fund the business account, then rerun `validate.ts` |
| Transaction Search | `NOT_AUTHORIZED` | The app lacks the Transaction Search feature, so reconciliation cannot read PayPal's own record with these keys | Reconciliation is tested against the fake only. To close it: enable **Transaction Search** on the app (PayPal says it can take hours to apply) and set `PAYPAL_READER_CLIENT_ID` and `PAYPAL_READER_CLIENT_SECRET` |

**Not run, on purpose.** Deleting a vaulted token, to check PayPal then refuses to charge it, would destroy the pooled buyer's approval, which needs a person to repeat. The fake's answer for that case stays marked as unverified.

## Channel3

All six searches returned priced, in-stock offers with a domain, and a re-quote of the first result in four of them found the same product at the same price (zero drift). A call took about one second (median 988 ms, slowest 2.4 s) and cost one credit. Nothing was rate limited. Details in [channel3.md](channel3.md).

## What changed in the code because of this

- `packages/paypal-fake`: two error codes, and two contract tests that name them.
- The fake's fidelity table: eight rows updated to what the sandbox did, with the date. The payout row is now marked unverified.
- Two new scripts under `apps/api/src/dev-tools/`.
