# AGENTS.md

Guidance for AI coding agents and human contributors. `CLAUDE.md` imports this file, so there is one source of truth.

## What this project is

Bursar is a policy-enforced, PayPal-verified control plane for AI agents that spend money. An agent proposes; a deterministic policy engine decides; an executor acts; independent verification confirms every movement of money. See `README.md` and `docs/decisions/`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install dependencies (build scripts are allow-listed) and install git hooks |
| `pnpm check` | The full gate: lint, typecheck, test |
| `pnpm lint` / `pnpm lint:fix` | Biome lint and format |
| `pnpm typecheck` | `tsc --noEmit` in every package (TypeScript 7) |
| `pnpm test` | Vitest with enforced coverage thresholds, per package |
| `pnpm --filter @bursar/<name> test:watch` | Watch one package |

## Non-negotiables

### Money
- Amounts are integers in minor units (`bigint`) plus a currency code. Never use `number` or floating point for money, and never `parseFloat` an amount.
- Never trust an amount from a client or an LLM. Totals are recomputed server-side from stored snapshots.
- Tools exposed to LLMs contain no amount, payee or currency fields.

### PayPal
- Sandbox only. The base URL is asserted at startup, and `ALLOW_LIVE` must stay `false`.
- Use the Server SDK for money paths; use thin typed REST only where the SDK lacks the API (Payouts, webhook verification).
- Every POST carries a `PayPal-Request-Id` derived from the action's idempotency key. Log PayPal's `debug_id` on every error.
- Verify webhook signatures before trusting an event, and de-duplicate on the event id.

### Safety
- The policy engine is pure, fail-closed, versioned and replayable. No I/O inside rules.
- Execution is claim, call, record; policy is re-evaluated at execution time.

### Hygiene
- No secrets in git. `.env` is local only; `.env.example` holds placeholders (a test enforces this).
- PayPal credentials exist only in the executor and workflow service.
- Before using a PayPal, AG Studio, Bryntum or Render API, read the installed package documentation or the matching skill. Do not guess APIs.
- Add a dependency only with a stated reason. Versions live in the `pnpm-workspace.yaml` catalog.

## Conventions

- TypeScript strict, ESM, erasable syntax only (no enums, namespaces or parameter properties).
- Internal packages export TypeScript source (`exports` point at `./src/*.ts`); there is no per-package build step.
- Tests live in each package's `test/` directory. Invariants get property tests (fast-check). Coverage thresholds are set per package, at 95% or higher for critical packages.
- Conventional Commits, enforced by a git hook: `<type>(<scope>)!: <subject>`.
- Decisions that shape the architecture are recorded in `docs/decisions/` as ADRs.
