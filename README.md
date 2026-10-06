# Bursar

**Spend authority for AI agents.**
A policy-enforced, PayPal-verified control plane that lets an AI agent research, plan and pay, without being able to overspend, be talked into it, or move money unnoticed.

> **Status: under construction** for the PayPal AI Hackathon (October to November 2026). The repository foundations are in place; features land in small, reviewed steps. Everything is designed for the PayPal **sandbox** only.

## Why

AI agents can already move money. PayPal ships an MCP server and an Agent Toolkit for exactly that, and its documentation leaves verifying the agent's output to the developer. Bursar is the missing layer between an agent and the money.

## Four locks

| Lock | What it means |
| --- | --- |
| **Govern** | The model proposes; a pure, versioned, fail-closed policy engine decides. Tools exposed to the model never carry amounts, payees or currencies. |
| **Bind** | A mandate is a PayPal Vault token and a mission's envelope is a PayPal authorization, so PayPal itself caps the spend and revocation is real. |
| **Verify** | Every movement of money must match an approved decision through a signature-verified webhook. Anything unexplained freezes the mandate. |
| **Prove** | An AI red team attacks the policy before the agent runs, and every finding becomes a regression test. |

## Quick start

Requirements: Node.js 24 LTS (26 also works) and [pnpm 11](https://pnpm.io/installation).

```bash
pnpm install      # installs dependencies and git hooks
pnpm check        # lint, typecheck and test
pnpm dev:skills   # optional: restore the sponsor skills for Claude Code
pnpm dev:doctor   # optional: verify the AI tooling setup
```

## Repository layout

| Path | Purpose | State |
| --- | --- | --- |
| `apps/api` | Hono API with sessions, roles, agent keys, health checks and OpenAPI; the money routes, webhook receiver and MCP gateway are next | in progress |
| `apps/web` | React and Vite app with the AG Studio cockpit and Bryntum Gantt | planned |
| `apps/workflows` | Render Workflows tasks | planned |
| `packages/money` | Exact money: `bigint` minor units, PayPal's currencies, explicit rounding, lossless splitting | ready |
| `packages/schemas` | The shared contract: branded ids, the action state machine, entities, API and event shapes, error catalog, and the guarded LLM tool contracts | ready |
| `packages/crypto` | Canonical JSON, domain-separated hashes, provenance tags, approval signatures and sealed secrets, tested against published vectors | ready |
| `packages/db` | Postgres schema and migrations, tenant isolation by row-level security, and the rules the database enforces itself | ready |
| `packages/ledger` | Double-entry posting rules for each PayPal action and the envelope figures they imply | ready |
| `packages/policy` | The policy engine: pure, fail-closed, versioned and replayable | ready |
| `packages/paypal` | A typed, retrying, idempotent, sandbox-only PayPal client with classified errors | ready |
| `packages/paypal-fake` | A fake PayPal for tests, with a fidelity table and a contract suite | ready |
| `packages/core` | The money loop: mandates, carts, the decision pipeline, the executor and webhook verification | ready |
| `packages/channel3` | The product catalog: exact-decimal offers, a credit budget, caching, 429 handling and re-quotes that detect price drift | ready |
| `packages/agent-tools` | What an LLM agent may call: amount-free tools behind per-role allow-lists, with web content fenced as untrusted | ready |
| `packages/llm` | The LLM runtime: a thin Claude client, structured answers, budgets, a cache, run logging, mock and record/replay | ready |
| `packages/agents` | The Planner, Researcher and Buyer, and an offline eval harness | ready |
| `packages/audit` | The tamper-evident audit log: a per-organisation hash chain, appended and verified by pure functions | ready |
| `packages/tooling` | Shared test configuration, repository-quality checks and the AI-tooling rules | ready |
| `scripts/dev` | `pnpm dev:doctor` and `pnpm dev:skills` | ready |
| `docs/decisions` | Architecture decision records | ready |
| `docs/development-with-ai.md` | How the AI tooling is set up and verified, with an evidence log | ready |

## Stack

TypeScript 7 · Node.js 24 LTS · React 19 and Vite · Hono · Postgres and Drizzle · Render · PayPal Server SDK and JS SDK v6 · AG Studio · Bryntum Gantt · Channel3. The reasoning is recorded in [ADR-0001](docs/decisions/0001-stack-and-conventions.md).

## Quality gates

`pnpm check` is the single gate, and CI runs the same commands.

- **Lint and format:** [Biome](https://biomejs.dev), with `any`, non-null assertions and unused code treated as errors.
- **Types:** TypeScript 7 in its strictest practical configuration (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, erasable syntax only).
- **Tests:** Vitest with per-package coverage thresholds, and fast-check property tests for invariants.
- **Repository conventions as tests:** pinned runtimes, safe dependency specifiers, a secret-free `.env.example`, sandbox-only defaults, numbered decision records and a locked-down Claude Code configuration are all checked by `packages/tooling`.
- **AI tooling you can verify:** sponsor plugins and skills are configured in git, third-party skill content is pinned by hash, and findings about the tools are logged with evidence in [Developing with AI assistance](docs/development-with-ai.md).
- **Git hooks:** Biome on staged files, a secret scan, and Conventional Commits validation.
- **CI:** GitHub Actions pinned to commit SHAs, plus a gitleaks scan of every commit in a push or pull request.

## License

Apache-2.0. See [LICENSE](LICENSE).
