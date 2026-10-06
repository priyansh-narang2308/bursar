# Threat model

What can go wrong when an AI agent can spend money, what Bursar does about it, and where a test proves it. Each row names a test by file and title, so a change that weakens a control fails a build that someone has to read. If a row has no test, it does not belong here.

The assumptions are plain: the model can be fooled, text from the web is hostile, a network request can be forged or repeated, and a person with a cookie can be tricked into visiting another site. Everything runs on PayPal's sandbox.

## Money

| Threat | Control | Proven by |
| --- | --- | --- |
| A model names a price, an amount or a payee | Tools carry no amount, payee or currency field, and a guard fails the build if one gains such a field, however deep | `packages/schemas/test/guards.test.ts`: "is caught when it asks for an amount, a price, a currency or a payee", "is caught however deep it hides" |
| A caller slips an amount into a request | Every request body is strict; the amount comes from the cart and the payee from the supplier registry | `apps/api/test/money.test.ts`: "refuses any field that would let a caller name an amount, a price or a payee" |
| A catalog price is stale or poisoned | Offers are snapshotted, totals are recomputed on the server, and the price is re-quoted before buying | `packages/core/test/loop.test.ts`: "prices every line from the offer snapshot, totals them, and hashes the result" |
| Spending beyond the envelope | A ceiling enforced by the policy and by a database constraint | `loop.test.ts`: "denies what the envelope cannot hold, and records why"; `packages/db/test/db.test.ts`: "never lets an envelope hold or capture more than its ceiling" |
| The same action runs twice | An idempotency key is unique, execution is claim, call, record, and every PayPal request id derives from the action | `loop.test.ts`: "moves money once however many times it is told to", "answers the same proposal made many times at once with one action and one reservation"; `db.test.ts`: "refuses two actions with one idempotency key" |
| A decision is stale when the money moves | Policy is evaluated again at execution | `loop.test.ts`: "asks the policy again when the money is about to move: a frozen mandate stops an approved action" |
| A person approves their own proposal | The proposer can never be the approver | `loop.test.ts`: "asks a person for a first-time supplier, and wants someone other than the proposer"; `apps/api/test/hardening.test.ts`: "are different people, so one cannot approve what another proposed" |
| An approval is altered or replayed | Approvals are signed over the cart hash and policy, and expire | `loop.test.ts`: "refuses an approval that was altered after it was given"; `packages/crypto/test/approval.test.ts`: "does not let a signature for one approval be replayed on another" |

## Agents

| Threat | Control | Proven by |
| --- | --- | --- |
| Prompt injection from a product title or page | Outside text reaches a model only through `untrusted()`, tools hold no money fields, and a pick must name an id a tool returned | `packages/agents/test/injection.test.ts`: "compromises the naive agent on most payloads, so the test is real", "makes no PayPal call and moves no money on any payload when the tools are guarded" |
| An agent reaches PayPal's own money tools over MCP | Deny by default: PayPal's toolkit is classified, money tools are redirected, and nothing unclassified is reachable | `packages/mcp-gateway/test/gateway.test.ts`: "classifies every tool of the toolkit, denying by default", "blocks PayPal's money tools and says where to go" |
| An agent key does more than its scopes | A key shows and allows only what its scopes grant | `gateway.test.ts`: "hides what the key's scopes do not allow"; `apps/api/test/money.test.ts`: "keeps auditors and scoped agents from proposing" |
| The Studio assistant is given a way to move money | Its tools are one shared list of read-only tools, with no amount, payee or money verb | `apps/api/test/studioAi.test.ts`: "holds no tool that could move money"; `apps/web/test/treasurer.test.tsx`: "holds exactly the read-only tools in the shared list, and nothing that moves money" |
| A policy hole nobody has found | A Lab attacks the policy, shrinks what breaks and freezes the fix as a regression | `packages/lab/test/lab.test.ts` and `packages/lab/regressions/` |

## Verification and recovery

| Threat | Control | Proven by |
| --- | --- | --- |
| A forged webhook | The signature is verified with PayPal before the event is trusted | `loop.test.ts`: "rejects a forged webhook and changes nothing"; `money.test.ts`: "answers 200 to forged and malformed deliveries, and does nothing with them" |
| A repeated or burst of webhooks | De-duplication on the event id, safe under concurrency | `loop.test.ts`: "ignores a repeated webhook"; `money.test.ts`: "survives a burst: one hundred copies of a webhook arriving at once change the books exactly once" |
| Money moves with no approved action | The Verifier opens an incident, freezes the mandate, voids, refunds and revokes | `packages/core/test/verifier.test.ts`: "freezes, refunds and revokes a rogue capture made outside the gateway, end to end" |
| Bursar and PayPal disagree | Reconciliation finds money on one side only | `verifier.test.ts`: "finds money PayPal moved that Bursar has no record of, and opens an incident" |
| The audit log is edited | A per-organisation hash chain, append-only by trigger | `verifier.test.ts`: "shows every stage of an action, replays its ruling, and detects a tampered audit log" |
| A payout to the wrong place | Payouts wait for inspection and pay only registered suppliers | `verifier.test.ts`: "blocks a payout until goods are inspected and the cooling-off has passed, then pays the registered address" |

## The web edge

| Threat | Control | Proven by |
| --- | --- | --- |
| A write forged from another site | Same-origin check on every write | `hardening.test.ts`: "are refused, because a cookie rides along with a request from any page" |
| Injected script, framing or data exfiltration from the page | A Content-Security-Policy with its own scripts only, no eval, no framing, and connections to the same origin only | `hardening.test.ts`: "holds the web app to its own scripts, with no eval and no framing"; the browser tests run the whole app under it and fail on any refusal |
| The API used as a page | The API's policy loads nothing and refuses frames | `hardening.test.ts`: "lets the API load nothing and keeps it out of frames" |
| An oversized or abusive request | A body size limit, a global rate limit, and a tighter one on the assistant | `hardening.test.ts`: "refuses a body far larger than anything a person or an agent sends"; `apps/api/test/api.test.ts` (rate limit answers `RATE_LIMITED`) |
| A forged or expired session cookie | Cookies are signed and expire | `api.test.ts`: "rejects a forged or expired cookie" |
| The scheduled-job door is opened by a stranger | It does not exist without a secret token, and the token is compared in constant time | `hardening.test.ts`: "does not exist unless a job token is configured", "runs the job for the right token, and for no one else" |

## Data and secrets

| Threat | Control | Proven by |
| --- | --- | --- |
| One tenant reads another's rows | Row-level security on every table with an organisation id | `packages/db/test/db.test.ts`: "shows a tenant only its own rows, even from a query with no WHERE", "holds every table that has an org_id to the same rule"; `money.test.ts`: "shows nothing of another workspace" |
| A payment token is stored in the clear | Vault tokens are sealed with a key held outside the database | `db.test.ts`: "stores a Vault token only sealed" |
| A secret reaches a log | Requests are logged without headers, cookies or keys, and stray secrets are redacted | `api.test.ts`: "logs each request without headers, cookies or keys", "redacts secrets that a caller logs by mistake" |
| A secret is committed | `.env.example` holds placeholders only, and a scan runs on every push | `packages/tooling/test/repo-conventions.test.ts`, and the gitleaks job in CI |
| A known-vulnerable dependency | An audit before release | `pnpm audit --prod` reported no known vulnerabilities on 2026-10-06 |

## Not covered

- **A real PayPal outage or a change in PayPal's API.** The fake is checked against the same contract suite as the real client, and the live smoke test runs only on request.
- **Denial of service at scale.** Rate limits are in memory and per instance: a guard, not a quota system.
- **The Studio and Bryntum libraries themselves.** They run on trial licences under the same policy, and their code is not audited here.
