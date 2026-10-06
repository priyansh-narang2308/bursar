# Devpost text

Paste each section into the matching Devpost field. Every number below was measured: on the live take recorded 2026-10-07 ([measured-live.json](measured-live.json)), in the test suites, or in the validation reports.

## Title

Bursar: spend authority for AI agents

## Tagline

A control plane that lets an AI agent research and pay, but never overspend, be talked into it, or move money unnoticed. Built on PayPal.

## Elevator pitch

AI agents can pay now. Nothing stops them paying wrongly. Bursar sits between an agent and PayPal: the agent proposes, a deterministic policy engine decides, an executor acts, and every movement of money is confirmed against PayPal's signed webhooks. If money ever moves with no approved decision behind it, Bursar freezes the mandate. On PayPal's sandbox that took between 16 and 26 seconds across four takes.

## The problem

Agents can already move money. PayPal ships an MCP server and an Agent Toolkit for exactly that, and its own documentation leaves verifying the agent's output to the developer. That leaves three failures no prompt can close: overspending, being talked into a payment by text on a web page, and money that moves with no decision to explain it.

## What it does

A person gives Bursar a spending mandate: a cap, a per-mission cap and a window, tied to a PayPal Vault token. They then state a mission with a budget. A Planner splits it into needs, a researcher per need searches real products through tools that cannot name an amount, and Bursar re-quotes every offer and proposes one cart, priced by the server. Seventeen pure rules rule on it. One wants a person, so the owner approves that exact cart; the approval is signed over the cart's hash. PayPal places a hold. Everything after that is checked, and every action ends in a receipt that can be replayed.

## The four locks

1. **Govern.** The model proposes; a pure, versioned, fail-closed policy decides. No tool a model holds can name an amount, a payee or a currency, and a test fails the build if one gains such a field.
2. **Bind.** A mandate is a PayPal Vault token and a mission is a PayPal authorization, so PayPal itself caps the spend and revoking a mandate really revokes it.
3. **Verify.** Every movement of money must match an approved action through a signature-verified webhook. Anything unexplained opens an incident, and the Verifier freezes the mandate, voids holds, refunds and revokes the token.
4. **Prove.** A Policy Lab attacks the policy before an agent runs, shrinks what breaks, and freezes each fix as a regression test. Twenty-seven prompt-injection payloads compromise a naive agent 24 times; through Bursar they cause 0 PayPal calls.

## How we built it

TypeScript throughout: React and Vite on the front, Hono and Postgres on the back, in a pnpm workspace of 4 apps and 18 packages. Money is exact: integers in minor units, never floating point. Tenant data sits behind Postgres row-level security. The audit log is a per-organisation hash chain. More than 2,250 automated tests, 16 browser tests with accessibility checks, 18 architecture decision records, and a threat model that ties every threat to a control and a test that proves it.

## How we used PayPal

- **Vault**: the mandate is a payment token; revoking deletes it.
- **Orders and Payments**: an `AUTHORIZE` order from the vaulted token places the hold, then partial captures, voids, reauthorization and refunds. Every POST carries a `PayPal-Request-Id` derived from the action, so a retry cannot pay twice.
- **Webhooks**: verified with PayPal before they are trusted, de-duplicated by event id, and matched to an approved action through a provenance tag carried in `custom_id`. We confirmed on the sandbox that capture, refund and void events carry it.
- **Negative testing**: `PayPal-Mock-Response` forces declines in the checks.
- **Agent Toolkit and MCP**: Bursar's own MCP gateway exposes guarded tools to agents and blocks PayPal's money-moving toolkit tools by default.
- **Live validation**: eighteen behaviours the tests assumed were checked on the sandbox. Fourteen matched, two error codes we had guessed were wrong and were fixed, and two (Payouts, Transaction Search) could not be checked because the sandbox app does not have them enabled. That is stated in the README and in `docs/validation`.

We wrote a thin, typed client rather than use the generated SDK, because it needed explicit timeouts and retries; the reasoning is in ADR-0008.

## How we used AI

An AI agent plans and buys through amount-free tools, and a replanner proposes recoveries. A Treasurer assistant inside AG Studio reads the workspace and builds charts. A deterministic engine, never a model, makes every money decision. **In the public demo the agents run on a deterministic scripted model**, so every visit behaves the same and costs nothing; the tools, the policy path and the receipts are the real ones. The Claude client, with budgets and record and replay, is built and tested but not called by the demo server yet. The project was built with Claude Code, and `docs/development-with-ai.md` records what the sponsor tooling got right and wrong.

## Sponsors

- **AG Grid (AG Studio):** the cockpit, with six custom widgets (envelope gauge, decision stream, rule heatmap, money flow, verification status, lab scorecard) themed to the product, a layout a person can rearrange, and the Treasurer, a custom lead agent that hands charting to Studio's own agents. `apps/web/src/studio/`.
- **Bryntum:** a Gantt of deliveries with the critical path and a replanner whose recovery is only ever a proposal. `apps/web/src/components/ScheduleGantt.tsx`.
- **Channel3:** live product search, normalised to exact money and re-quoted before every purchase. Ten live credits spent in validation: six searches and four re-quotes, with no price drift. `packages/channel3`.
- **Render:** the web service and Postgres, a cron job every 15 minutes for reconciliation, and a Workflow that fans a mission out into parallel tasks. `render.yaml`, `apps/render-workflow`.

## What is real, and what is simulated

Real: PayPal's sandbox (Vault, authorization, capture, refund, signed webhooks), the policy engine, the receipts and audit chain, the kill switch, the catalog data and its re-quotes. Simulated and badged: the buyer's approval (given in advance from a small pool of sandbox buyers), the model (a script), and carrier delays. Payouts and reconciliation against PayPal's own record are tested against the fake only.

## Challenges

Making the model's trustworthiness irrelevant rather than trying to improve it. Keeping the web app from ever doing arithmetic on money, including inside a dashboard library whose job is to add numbers up. Learning where our assumptions about PayPal were wrong: the error codes, and the fact that the sandbox app needs features switched on before Payouts or Transaction Search answer.

## What we learned

A guard test that fails the build is worth more than a paragraph of prompt. A fake is only as good as its last comparison with the real service. And honesty about what is simulated is a feature.

## What is next

Connect the Claude client to the demo, enable Payouts and Transaction Search on the sandbox app and close the last two validation gaps, and publish the policy and money packages on their own.

## Try it

<https://bursar-demo.onrender.com>, then "Open demo workspace". No login. A one-minute path is in [judge-instructions.md](judge-instructions.md).

## Built with

TypeScript, React, Vite, Hono, Postgres, Drizzle, Zod, PayPal (Vault, Orders, Payments, Webhooks), AG Studio, Bryntum Gantt, Channel3, Render, Playwright, Vitest.

## Links

- Live demo: https://bursar-demo.onrender.com
- Source: https://github.com/priyansh-narang2308/bursar
- Video: *(add the YouTube link after upload)*
