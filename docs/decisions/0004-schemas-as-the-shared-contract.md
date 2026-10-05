# ADR-0004: Schemas as the shared contract

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Bursar's parts talk to each other constantly: the policy engine, the API, the executor, the browser, the webhook ingest, the live event stream, and an LLM that is shown a set of tools. Each boundary is a place where a wrong type, a missing check or a widened input becomes a money bug, and the LLM boundary is also an attack surface: anything the model can write, an attacker who can write into its context can write too.

So the shapes that cross those boundaries are decided once, in `@bursar/schemas`, and everything else derives from them. What shaped the decisions below:

- Zod 4.6.5 can validate, infer TypeScript types and emit JSON Schema from one definition. Refinements and transforms are not representable in JSON Schema; the first are runtime-only and the second throw.
- Identifiers end up in logs, URLs, the database and LLM tool calls, where a mission id pasted where an action id belongs is an easy and costly mistake.
- The planned API layer generates OpenAPI from Zod, and LLM providers take JSON Schema for tool input, so both need an exact, transform-free export.

## Decision

| Concern | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Source of truth | Zod schemas in `@bursar/schemas`; types, validation and JSON Schema all derive from them | One definition, so they cannot disagree | A hand-written OpenAPI or JSON Schema with generated types; per-package type copies |
| Wire shapes | Schemas describe what is sent, with no transforms or codecs. An amount is `{ currency, minor }` with `minor` a string, read with `@bursar/money`'s `moneyFromJSON` | The JSON Schema is exact and works with OpenAPI generators and LLM providers; what parses is what was sent | `z.codec` or transforms that parse straight into `Money` objects, which JSON Schema cannot express |
| Identifiers | Prefixed, branded ULIDs (`act_01…`), generated in-house with an injectable clock and entropy, and checked against the ULID specification's vectors | Self-describing, so a wrong kind fails at the boundary; sortable by creation time, which `Last-Event-ID` resumption needs; no dependency | Bare UUIDs or ULIDs; a ULID library |
| Strictness | Every object is strict. Rules between fields are refinements that run only when every field is valid on its own, and overlapping checks abort early | An unknown field is an error, never ignored; one mistake gives one message | `z.object`'s default of silently stripping unknown keys; refinements that run on invalid data and report derived noise |
| Illegal states | Entity schemas carry the architecture's invariants (the Verifier can never spend, a cart's total is its lines' sum, a decision is as strict as its strictest rule, an approval is signed exactly when approved) | Corrupt data is caught where it enters, with a message that says what is wrong | Leaving invariants to the code that happens to use the entity |
| State machine | One transition table, `ACTION_TRANSITIONS`, with no cycles; the stream may only report a move the table allows | The database, executor, verifier and UI share one definition of "legal" | Transitions encoded separately in each place |
| Errors | A catalog of stable codes, each with a status, a title and a description, sent as RFC 9457 problem details with a `urn:bursar:error:` type. Retryable is derived from the status | Clients branch on a code; a response is checked against the catalog, so a code can never carry the wrong status | Free-form messages; per-route error shapes |
| LLM tools | A registry of tools whose inputs are ids, bounded counts and short text, with effects of `read` or `propose` only, guarded by a test that applies a deny-list of money words, an allow-list of fields and bounds to each tool's JSON Schema | Defence in depth: a new field must be allow-listed in the same change, so it is a reviewed decision | Relying on the prompt; a deny-list alone, which a rename defeats |
| JSON Schema | Generated, committed under `json-schema/` and compared in tests, so a shape change is a reviewable diff; checked against Ajv over thousands of mutated documents | Reviewers see exactly what a change does to the wire; the export is proven faithful | Trusting the generator; hand-maintained schema files |
| PayPal event names | A verified list of the events Bursar registers for, and an open pattern for stored events | New PayPal events are stored, not rejected | An enum for stored events |

## Consequences

- **Refinements are not in the JSON Schema.** They are enforced by Zod only. The differential test allows exactly that gap and nothing else, but a consumer using only the JSON Schema does not get the cross-field rules.
- **Ids are text.** A prefixed ULID is a 30-character string, so primary keys are `text` with a check constraint, not a native `uuid`.
- **Adding a field is a three-step change.** The schema, the regenerated snapshot, and (for an LLM tool) the allow-list. That friction is the point.
- **Some vocabularies are provisional.** Mission and cart statuses, envelope statuses and the set of incident types are not fully specified in the plan, so they are the smallest sets that cover the documented flows, and later tasks can extend them. A mandate's autonomy level, the ledger and the audit log are not defined here yet.
- **Two things were added to the original design.** Its state diagram omits `SUBMITTING` to `DENIED`, but its description says the executor re-checks policy after claiming an action and may deny, so the transition is in the table. And an action has a nullable `mandateId`, so a `FREEZE` or `REVOKE` can name the mandate it acts on; the data-model sketch had no column for it.
- **Two dev-time dependencies.** Ajv and ajv-formats, to run the differential test; neither ships.

## Verification (2026-10-05)

- Zod 4.6.5: `toJSONSchema` output for strict objects, brands, enums, unions and `$defs`; refinements are omitted and transforms throw; `when` and `abort` behave as used.
- PayPal's webhook event-names page: every subscribed event is documented. `PAYMENT.PAYOUTS-ITEM.DENIED`, which the plan listed, is not, so it is absent; `PAYMENT.CAPTURE.DENIED`, the payout `CANCELED` and `REFUNDED` events and `VAULT.PAYMENT-TOKEN.DELETION-INITIATED` are documented and included.
- ULID vectors were produced by a separate Python implementation: the specification's example `01ARZ3NDEKTSV4RRFFQ69G5FAV` decodes to 1469922850259 ms.
- The differential test compares Zod and Ajv on 4,433 mutated documents across 32 schemas, with no disagreement.
- Adding an `amount` to the `propose_cart` tool made the guard test fail with `propose_cart: $.lines[].amount`, as intended.
