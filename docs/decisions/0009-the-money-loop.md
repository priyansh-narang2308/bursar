# ADR-0009: The money loop

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

The loop that moves money has to hold even when its parts fail: PayPal is slow or down, a request is repeated, a webhook is forged, late or lost, two callers race. Each stage is easy to get subtly wrong, so the rules are written down once and tested against the fake PayPal.

## Decision

- **A caller names what, never how much.** An action's amount is the cart's total, the authorization's, or the capture's, read from the database. Request bodies are strict, so an extra `amount`, `price` or `payee` is an error. Only a person may name a refund amount, and an agent's is ignored.
- **The money is reserved when the action is approved**, under a row lock on the envelope, not when PayPal is called. Concurrent proposals therefore cannot together exceed the ceiling, and the reservation is released if the action is denied at execution or fails.
- **Claim, call, record.** An atomic `UPDATE ... WHERE state = 'APPROVED'` is the claim. The claim commits before PayPal is called, so a crash leaves a visible SUBMITTING action rather than a hidden one. The request id derives from the action's idempotency key and the step.
- **Three kinds of failure get three treatments.** A decline is final and releases the money. No answer is UNKNOWN: it opens an incident, and repeating the call with the same request id is safe. Repeated failures open a circuit breaker so PayPal's outage does not become a pile of claimed actions.
- **A hold and a void are confirmed by PayPal's own response; a capture and a refund wait for the signed webhook.** Moving money needs independent confirmation, and `pollSubmitted` is the fallback when it never comes.
- **Provenance decides whether a webhook is ours.** The tag in `custom_id` is made at authorization, so capture and refund events trace to the authorizing action, and then to the capture or refund action that should explain them. No matching action, a wrong tag or a wrong amount is an incident.
- **Execution re-evaluates policy.** Approvals are re-checked from the stored records (signature, cart hash, policy hash, expiry), so a tampered approval or a frozen mandate stops an action that was approved earlier.
- **Webhook verification uses PayPal's endpoint.** If PayPal cannot be asked, the delivery is answered 503 so PayPal sends it again; everything else is 200.

## Consequences

- Ruling and execution run in the API process for now (an approved action is carried out at once). Moving execution to a worker changes where `execute` is called, not what it does.
- The amount, supplier and prices the policy sees come from our own snapshots; a live re-quote before ordering is not built, so price drift is always zero today.
- The Verifier's response to an incident and nightly reconciliation are the next task. Until then incidents are recorded and visible but do not freeze anything.
- Events with no tag at all cannot be attributed to an organisation and are recorded without one.
