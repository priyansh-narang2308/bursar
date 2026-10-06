# PayPal sandbox validation

Run on 2026-10-06 with `apps/api/src/dev-tools/validate.ts`: one pooled sandbox buyer, three $1.00 holds, and a handful of calls built to be refused. Each row is what the fake PayPal assumed, what the sandbox did, and PayPal's `debug_id` for the refusals. Raw results are in [paypal-sandbox.json](paypal-sandbox.json).

| Check | The fake assumed | PayPal's sandbox did | Verdict |
| --- | --- | --- | --- |
| A vaulted `AUTHORIZE` order returns its authorization inline | Unknown: flagged for a spike | Yes. Status `COMPLETED`, with the authorization in the answer | Confirmed |
| `PayPal-Request-Id` replays the first answer | The same order comes back | The same order id came back | Confirmed |
| A partial capture leaves the authorization open | Yes | Yes | Confirmed |
| Capturing more than is left | `AUTHORIZATION_AMOUNT_EXCEEDED` (a guess) | 422 `MAX_CAPTURE_AMOUNT_EXCEEDED` | **Corrected in the fake** |
| `final_capture` closes the authorization | Yes | Yes | Confirmed |
| Capturing after the final capture | `AUTHORIZATION_ALREADY_CAPTURED` | 422 `AUTHORIZATION_ALREADY_CAPTURED` | Confirmed |
| A partial refund within the capture | Yes | Yes | Confirmed |
| Refunding more than the capture | `REFUND_AMOUNT_EXCEEDED` | 422 `REFUND_AMOUNT_EXCEEDED` | Confirmed |
| Refunding the rest of a capture | Yes | Yes | Confirmed |
| Refunding a fully refunded capture | `CAPTURE_FULLY_REFUNDED` | 422 `CAPTURE_FULLY_REFUNDED` | Confirmed |
| Void releases the hold | Yes, with 204 | Yes | Confirmed |
| Voiding twice | `AUTHORIZATION_VOIDED` | 422 `PREVIOUSLY_VOIDED` | **Corrected in the fake** |
| Capturing a voided authorization | `AUTHORIZATION_VOIDED` | 422 `AUTHORIZATION_VOIDED` | Confirmed |
| Reauthorizing inside the honor period | `REAUTHORIZATION_TOO_SOON` | 422 `REAUTHORIZATION_TOO_SOON` | Confirmed |
| `PayPal-Mock-Response` forces a decline | A 422 the client reads as a decline | 422 `INSTRUMENT_DECLINED` | Confirmed |
| The capture webhook carries `custom_id` | Unknown: the provenance tag depends on it | Yes: capture, refund and void events all carried the `custom_id` sent | Confirmed |
| A payout to a registered supplier | Pending, then success | 403 `PAYOUT_NOT_AVAILABLE` | **Blocked**: Payouts is not enabled on this sandbox app |
| Transaction Search lists a capture | Yes, after a lag | 403 `NOT_AUTHORIZED` | **Blocked**: the app lacks Transaction Search |

## Notes

- **Webhook delivery** was fast: events for the captures, refunds and voids were listed by PayPal within about 20 seconds of the calls, and the registered webhook points at the deployed demo. By the code path in `packages/core/src/webhooks.ts`, an event whose tag names no action in the demo's database is recorded as unmatched and opens no incident.
- **The fake still does not model** PayPal's request-id retention window, retry timing and ordering of webhook deliveries, 429 with `Retry-After`, payout limits, or `PERMISSION_DENIED` for a payee other than the merchant. They remain marked unverified in the fidelity table.
- **What it cost:** three holds of $1.00 captured, refunded or voided on a sandbox buyer. Nothing real.
