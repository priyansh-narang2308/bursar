# ADR-0001: Technology stack and repository conventions

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Bursar handles money, so the codebase has to make correctness cheap and mistakes loud. The constraints that shaped the stack:

- Several components we depend on are TypeScript-first or browser-only: the PayPal Server SDK and Agent Toolkit, the Channel3 SDK, the Render Workflows SDK, the MCP SDK, AG Studio (its data engine runs in the browser) and Bryntum Gantt.
- Money safety relies on database features: row locks, row-level security, `CHECK` constraints and triggers.
- The project is reviewed in small steps, so tooling must be fast, strict and boring.

## Decision

| Concern | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Language | TypeScript 7 (native compiler), strict, erasable syntax only | One language across API, workflows, policy engine and UI; the policy package can run in the browser for what-if simulation | JavaScript; a Python service next to a TypeScript UI |
| Runtime | Node.js 24 LTS, with `^24 \|\| ^26` supported | 24 is Active LTS until 2028-04-30 and is Render's default for new services; 26 becomes LTS on 2026-10-28 and is what some developers run locally | 22 (maintenance only), 25 (end of life) |
| Monorepo | pnpm 11 workspaces with a dependency catalog; internal packages export TypeScript source | One version per dependency, strict dependency isolation, no per-package build step | npm or yarn workspaces; Turborepo or Nx, which are unnecessary at this size |
| Frontend | React 19 and Vite (single-page app) | AG Studio and Bryntum are client-side; nothing needs server rendering; avoids framework churn | Next.js 16, whose own starter warns of breaking changes |
| Backend | Hono on Node.js | Web-standard APIs, first-class Zod and OpenAPI support, straightforward MCP, SSE and webhook handling | Express, Fastify, NestJS, framework route handlers |
| Database | PostgreSQL with Drizzle | SQL-first, so row locks, RLS, triggers and `CHECK` constraints are visible and testable | Prisma (a release candidate at the time of writing) |
| Orchestration and hosting | Render: web service, Postgres, cron and Workflows | Durable fan-out and retries on the platform that already hosts the app | A self-managed queue such as BullMQ with Redis |
| Lint and format | Biome | One fast tool instead of two | ESLint with Prettier |
| Tests | Vitest 5 and fast-check; Playwright for end-to-end | Property tests for invariants, one runner for unit and integration | Jest |
| Git hooks | lefthook | Single binary, parallel jobs | husky with lint-staged |
| Commits | Conventional Commits, validated by `@bursar/tooling` in a `commit-msg` hook | Readable history; one commit per reviewed task | Unvalidated free-form messages |
| Supply chain | pnpm `allowBuilds` allow-list, GitHub Actions pinned to commit SHAs, Dependabot, gitleaks in CI | Install scripts and moving tags are the usual entry points for compromised dependencies | Floating action tags; permissive install scripts |

Quality gates are encoded as tests where possible. `packages/tooling` checks that runtimes are pinned consistently, dependency specifiers are safe, `.env.example` contains no credentials and defaults to the sandbox, and every workspace package follows the same conventions.

## Consequences

- **Positive:** a single `pnpm check` gate; types and conventions are enforced mechanically; the same language and the same pure packages are shared by the API, workflows and UI.
- **Coverage thresholds are per package.** Vitest supports coverage thresholds only at the process level, so each package runs its own Vitest process instead of one root-level run.
- **TypeScript 7 is new.** Tools that rely on the TypeScript JavaScript API may lag. If one is needed, pin TypeScript 6.0.x for that package and record it here.
- **Local and CI runtimes differ.** CI and Render run Node 24, the oldest supported line, while developers may run 26. Revisit after 26 enters LTS.
- **pnpm 11 is pinned** in `packageManager`. Moving to a newer major is a deliberate change.

## Verification (2026-10-05)

- Node.js release schedule (`nodejs/Release`): 24 is Active LTS, 26 enters LTS on 2026-10-28.
- Render documentation: the default Node.js version for services created after 2026-09-17 is 24.21.0, pinnable through `NODE_VERSION`, `.node-version`, `.nvmrc` or `engines`, in that order of precedence.
- npm registry: TypeScript 7.0.2, Biome 2.5.15, Vitest 5.0.3, fast-check 4.10.2, lefthook 2.1.x.
- pnpm 11 documentation: `allowBuilds` replaces the removed `onlyBuiltDependencies`, and unapproved build scripts are an error by default.
