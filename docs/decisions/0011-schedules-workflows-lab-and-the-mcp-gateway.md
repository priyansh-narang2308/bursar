# ADR-0011: Schedules, workflows, the lab and the MCP gateway

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

Buying is half the job: goods have to arrive, a late carrier has to be dealt with, work has to survive a crash, the policy has to be tested harder than a person would, and agents outside our own code (Claude, over MCP) have to meet the same limits as ours.

## Decision

- **Schedules are pure functions.** `@bursar/schedule` takes tasks in whole days with dependencies and lags, and returns earliest and latest times, slack, the critical path and the days to spare against a deadline. The same input gives the same dates, so a golden test pins them and a replan is explained as a diff. The Replanner searches for the fewest swaps to faster offers that bring the plan back inside its deadline, and says `recovered: null` when none do.
- **The Replanner cannot order.** Its recovery is a new cart and a new proposal through `core.actions.propose`, so a replacement goes through the same policy and approval as any purchase.
- **A task runs once per key.** `@bursar/workflows` records each run in `workflow_runs`, unique on (organisation, task, key): a repeat returns the stored result and does nothing, a failed run is taken over by exactly one caller, and only a crash or timeout is retried (a refusal from the core will not change). The tasks run in process now; they are plain functions so a Render Workflow can call the same ones.
- **The lab searches for holes like an adversary.** `@bursar/lab` generates scenarios from eight families (seeded, so reproducible), plays each against the real decision pipeline, and checks four invariants. A failing scenario is shrunk by delta debugging to one where every step is needed, a patch is proposed, and the case is frozen as JSON that must fail under the old policy and hold under the fixed one. Its first real find was in the standard policy: `R-VELOCITY` counted by supplier and payee, so buying split across unrelated suppliers escaped the daily limit. It now has an organisation-wide `orgMax` (rule version 2).
- **Injection is measured, not assumed.** 27 payloads across nine families are planted in product titles. One gullible scripted model runs against raw tools and against the guarded ones: it pays or orders for the attacker on 24 of 27 raw runs (what it cannot decode, such as base64 and look-alike letters, stays inert), and the guarded run makes no PayPal call on any.
- **The MCP gateway is deny by default.** Over Streamable HTTP an agent key sees only Bursar's guarded tools, filtered by its scopes. PayPal's money tools are present only as redirects to `propose_cart`; PayPal's read-only tools pass through only when a bridge to the real toolkit is supplied; every other toolkit tool, and any added later, is unreachable. A proposal's fate is reported as `APPROVED`, `PENDING_APPROVAL` or `BLOCKED`. Inputs are the strict schemas, so an extra `payee` is an error, not silently dropped.

## Consequences

- The Render Workflow adapter and a live check come later; nothing here uses Render's API.
- The toolkit's tool list was read from `@paypal/agent-toolkit` 1.11.0 and is pinned in a test; the toolkit itself is not a dependency. A newer version's new tools stay blocked until classified.
- Money tools are redirected rather than re-implemented on the executor; only `propose_cart` spends.
- The lab covers eight families, not fourteen, and runs against the pipeline, not the race and failure scenarios of the full plan. LLM-written mutations are a hook (`Mutator`) with a deterministic default.
- `@modelcontextprotocol/sdk` is a new dependency, because writing the protocol by hand would be worse. Its release was newer than the repository's release-age gate, so pnpm added it to `minimumReleaseAgeExclude`.
