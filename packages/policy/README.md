# @bursar/policy

The policy engine: **pure, fail-closed, versioned and replayable**. A model proposes, this decides.

- `evaluate(policy, context)` runs every rule (no short-circuit, so the trace is complete) and merges the outcomes: DENY beats REQUIRE_APPROVAL beats ALLOW. It also gives the number of approvers (1 or 2), the policy hash and the inputs hash.
- **Fail-closed:** a rule that throws or answers nonsense denies, with a generic message (the error text never reaches the trace). A policy with no rules denies.
- **Pure:** a rule is a function of the context and its parameters. The time and any other fact arrive in the context, which must be JSON.
- `hashPolicy` is the version: rule ids, rule versions and parameters. Bump a rule's `version` when its logic changes.
- `replay(policy, context, recorded)` evaluates again and says whether the result is exactly what was recorded.
- `explain(evaluation)` writes the ruling in plain words from a template. No LLM is involved.

## The rules

A rule is written with `defineRule({ id, version, summary, params, check })`: its parameters are a Zod schema, checked when a policy is written (`RULES['R-QTY'].use({ ... })`), and the context is parsed before `check` runs, so a missing or malformed field becomes a denial. `standardPolicy(overrides)` assembles all of them with the defaults in `DEFAULT_PARAMS` (US dollars; override per organisation).

| Rule | What it checks |
| --- | --- |
| `R-MANDATE` | The mandate is active, inside its window and not frozen. |
| `R-ENVELOPE` | Captured plus held plus this authorization stays within the ceiling; a capture stays within what is held. |
| `R-ITEM-CAP` | No single cart line costs more than its cap. |
| `R-ORDER-CAP` | The order total stays within its cap and equals the amount being authorized. |
| `R-CATEGORY` | Spend in a category stays within that category’s cap. |
| `R-VENDOR` | Every supplier is active, on the allow-list if there is one, and not on the block-list. |
| `R-NEW-VENDOR` | A supplier paid for the first time needs a person to look. |
| `R-QTY` | A line with an unusually large quantity needs a person to look. |
| `R-PRICE-DRIFT` | The price re-quoted now is not more than a set number of basis points above the cart’s. |
| `R-DUPLICATE` | The same item from the same supplier is not bought twice within a window. |
| `R-VELOCITY` | Orders and spend in a rolling window, counted by supplier and by payee, stay within limits. Splitting an order across suppliers that share a payee does not escape it. |
| `R-DELIVERY` | Every item is expected before the mission’s deadline. |
| `R-DUAL` | Above a threshold, two different people must approve, and nobody approves their own action. |
| `R-REFUND-AUTH` | An agent may refund only small amounts alone; larger refunds need a person. |
| `R-PAYOUT-GATE` | A payout needs the goods inspected, the cooling-off window over and the capture settled. |
| `R-PROVENANCE` | An agent’s action traces to a run, and every approval is genuine, matches the cart and policy, and has not expired. |
| `R-TENANT` | Everything the action touches belongs to the actor’s organisation. |

How approval works: a rule that wants a person returns REQUIRE_APPROVAL, and the engine asks for 1 or 2 approvers. When the action is evaluated again at execution time with approvals in the context, `ask` allows once enough *different, valid* people have approved: the signature must verify, the cart and policy hashes must still match, it must not have expired, and the proposer never counts as their own checker (`R-DUAL` denies it outright). Spend rules skip actions that only protect or undo (freeze, revoke, void, refund), so a frozen mandate never blocks the freeze.

**Structuring.** `R-VELOCITY` counts orders and spend in a rolling window by supplier *and* by payee, so splitting a purchase across suppliers that share a payee is caught; a test shows it.

The tests cover each rule at its boundary (one cent either side, currency mismatch, expired or frozen mandate) and keep four reviewed scenarios as a golden file (`test/__snapshots__/scenarios.json`), which shows up as a diff if a ruling changes. Coverage is 93% of branches; the rest is currency-mismatch guards that share one helper.
