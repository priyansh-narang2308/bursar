# ADR-0007: Ledger and policy engine as pure functions

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

The two places a money bug would hurt most are the ledger (do the books balance?) and the policy engine (should this be allowed?). Both must be easy to test exhaustively, so neither may touch a database, a clock or the network.

## Decision

- **Ledger:** `post` turns a PayPal event into balanced entries and `figures` replays events into envelope figures, refusing overdraws. The database stores the entries and refuses an unbalanced transaction at commit (ADR-0006). A property test shows the two derivations, entries and figures, always agree.
- **Policy:** `evaluate(policy, context)` runs every rule, merges to the strictest outcome, and is fail-closed: a throwing or nonsensical rule denies, and so does an empty policy. The policy version hash covers rule ids, rule versions and parameters, so a decision names exactly what decided it, and `replay` can reproduce it.
- **Rejected:** a rules DSL or a rules engine library (more to learn and audit than a function per rule); letting rules read the clock or the database (they would no longer be replayable).

## Consequences

- The caller assembles the context, including the time and any history a rule needs, and is responsible for it being complete and honest. The engine's guarantees start where the context does.
- The context must be JSON; anything else throws, and a caller must treat that as a denial.
- Rule logic changes only with a `version` bump, or two decisions made by different logic would share a hash.
