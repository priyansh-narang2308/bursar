# @bursar/policy

The policy engine: **pure, fail-closed, versioned and replayable**. A model proposes, this decides.

- `evaluate(policy, context)` runs every rule (no short-circuit, so the trace is complete) and merges the outcomes: DENY beats REQUIRE_APPROVAL beats ALLOW. It also gives the number of approvers (1 or 2), the policy hash and the inputs hash.
- **Fail-closed:** a rule that throws or answers nonsense denies, with a generic message (the error text never reaches the trace). A policy with no rules denies.
- **Pure:** a rule is a function of the context and its parameters. The time and any other fact arrive in the context, which must be JSON.
- `hashPolicy` is the version: rule ids, rule versions and parameters. Bump a rule's `version` when its logic changes.
- `replay(policy, context, recorded)` evaluates again and says whether the result is exactly what was recorded.
- `explain(evaluation)` writes the ruling in plain words from a template. No LLM is involved.

A rule is `{ id, version, evaluate(context, params) => { outcome, message, inputs?, threshold?, approvals? } }`, and the ids come from `RULE_IDS` in `@bursar/schemas`. The catalog of real rules lands in the next tasks. The tests use two toy rules and a golden trace (`test/__snapshots__/golden-trace.json`) that shows up as a diff if a ruling changes.
