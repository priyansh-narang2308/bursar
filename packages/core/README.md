# @bursar/core

The money loop, one organisation at a time: **mandate → mission → cart → proposal → ruling → approval → execution → confirmation**. Everything here runs on the server's own records; a caller names *what* (a cart, an action type), never *how much* or *who is paid*.

| Stage | What it does |
| --- | --- |
| **Mandates** (`mandates.*`) | PENDING → ACTIVE through PayPal's Vault flow (setup token, payer approves, payment token). The token id is stored sealed. Freeze, unfreeze, expire. **Revoking deletes the PayPal token**, so PayPal itself refuses further charges. |
| **Catalog** (`catalog.*`) | Suppliers (the only source of a payee), offer snapshots, missions, and carts. A cart is built from offer ids and quantities; prices, line totals, the total and the cart hash are computed here. |
| **Pipeline** (`actions.propose`, `actions.decide`) | The amount comes from the cart. The mission's envelope is locked while `@bursar/policy` runs on facts read from the database; the ruling and its trace are kept; the action is denied, approved (and the money reserved) or sent to people. Approvals are signed over the cart hash, policy hash and expiry; the proposer can't approve their own action. Proposing the same thing twice returns the first action. |
| **Executor** (`actions.execute`) | Claim, call, record. The claim is one atomic update, so of any number of simultaneous calls one proceeds. The policy is asked again at that moment. The `PayPal-Request-Id` is derived from the action, so repeating a call after an unknown outcome gets PayPal's original answer. A decline is final, no answer is `UNKNOWN` (with an incident), and a circuit breaker stops calling PayPal after repeated failures. |
| **Webhooks** (`webhooks.ingest`) | Raw body in; PayPal's verify endpoint checks the signature; repeats are ignored; then the provenance tag in `custom_id` must trace to an approved action of ours, for the approved amount. A capture with no matching action, a wrong tag or a wrong amount opens an incident. An event that arrives before the executor has recorded its call is parked and settled afterwards. `pollSubmitted` confirms captures whose webhook never came. |

A confirmation (from PayPal's own answer, a webhook or a poll) moves the action to CONFIRMED once, updates the envelope's held, captured and refunded figures, and posts balanced ledger entries. Every change is written to the audit chain and the outbox in the same transaction.

Not here yet: the Verifier's automatic response to an incident (freeze, void, refund, revoke) and nightly reconciliation (next task), payouts to suppliers, partial captures, REAUTHORIZE, a live price re-quote before ordering, and the PayPal fee on a capture (it is posted as zero until the response is read for it). An unmatched event with no tag cannot be given to any organisation, so it is recorded for system review without one.
