# ADR-0010: Oversight, the catalog and the agents

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

The money loop (ADR-0009) can be wrong in ways no single request shows: money moves outside it, a webhook is lost, a log is edited, an LLM is steered by a product title. This ADR records how those are caught, and how the LLM agents are kept from ever holding a decision.

## Decision

- **The Verifier contains, and each step stands alone.** Money that moves with no approved action opens an incident and runs freeze, void, refund, revoke and notify. A failing step is recorded and does not stop the next. Only an owner resolves an incident, and a frozen mandate cannot be unfrozen while one is open.
- **Reconciliation is cross-tenant and not an API route.** It compares PayPal's transaction search with our records and opens incidents for gaps either way. It runs from a job, because exposing it to a tenant would show them other tenants' gaps.
- **A payout's payee comes from the supplier registry**, after inspection, a cooling-off period and a settled capture. A person inspects goods; nothing else can.
- **A decision stores its inputs**, so a ruling can be replayed: same policy version, same inputs, same outcome, trace and hashes. A receipt joins every stage of an action from the records themselves. The event stream is the outbox, read as the caller's tenant, resumable by row id.
- **The catalog is never trusted for a price.** Search prices are cached and may be stale; a product is re-quoted before it is shown for buying, and a moved price makes a new snapshot. Prices become exact minor units from the catalog's decimal, and only offers from a registered supplier are kept: the registry, not the catalog or the model, decides who can be paid.
- **Agents hold tools, not decisions.** Tools are the amount-free contracts in `@bursar/schemas`; each role has an allow-list (planner reads, researcher searches, buyer proposes); text from outside is fenced as untrusted; the policy summary names rules and hides thresholds so a model cannot aim under a limit. The Buyer is deterministic code over the researcher's picks, because assembling a cart needs no judgement and every judgement it would add is one more thing to steer. A pick must name an offer the search really returned.
- **The LLM runtime is a thin REST client** (as the PayPal client is): structured answers are forced tool calls checked with Zod and retried with the error; every run has step, token and time budgets; identical requests are served from a cache; a run's cost is written to `agent_runs`. Mock, record and replay providers let all downstream tests run offline.
- **Agents are scored.** `@bursar/agents/eval` runs ten goals with a scripted model and reports constraints met, cost against budget, in-stock rate, valid citations, steps and tokens. The scripted model checks the harness and the guards; it says nothing about Claude's quality.

## Consequences

- The Channel3 SDK adapter and the Claude provider are written to the documented shapes but have not run against the live services, which need keys. A live eval run and its saved report are still to do.
- `get_shortlist`, `request_swap` and `reschedule_task` are defined but not built, so an agent is not offered them.
- Supplier matching by name equal to the seller's domain is a stand-in until suppliers carry a domain.
- Reconciliation has no schedule yet, and a payout the receiver never claims is not handled.
