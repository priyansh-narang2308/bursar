# ADR-0016: Scheduled jobs and the Render Workflow

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

Some work must happen on a clock, not on a click: reconciling PayPal with the ledger, expiring what ran out, confirming what is waiting. And the mission pipeline has real parallelism (one search per need) that a workflow runner is made for.

## Decision

- **A scheduler knocks on one door.** `POST /internal/jobs` runs the scheduled work and reports what each step did. It exists only when `JOB_TOKEN` is set, sits outside `/v1` (it has no session), and compares the token in constant time. A Render cron job calls it every 15 minutes. Each step is reported on its own, so one failing (reconciliation needs PayPal's reporting permission) does not stop the others. Reconciliation is cross-tenant, so it runs here and never behind a tenant route (AGENTS.md).
- **The same call keeps a free service awake.** A request every 15 minutes is inside Render's idle window, so the demo does not sleep.
- **The mission pipeline is a Render Workflow.** `run_mission` plans, then runs one `research_need` per need at the same time, each on its own instance, then `buy_cart`. Each step is retried with backoff by Render. The steps are plain functions of the database, the core and the catalog (`tasks.ts`), registered as Render tasks by a thin `main.ts`, so they test like any other code. Arguments and results are JSON because they cross the network.
- **The demo never depends on it.** The API runs a mission on the workflow only when `BURSAR_WORKFLOWS=render` and the service is configured; on any failure it runs the mission itself and says so (`ranOn`). The trace shows which one ran.
- **Workflows hold the same rules.** A task only proposes: it cannot execute, approve or pay. Its agents get the same amount-free tools, and a pick must name an offer the search returned.

## Consequences

- A Workflow service is created in Render's dashboard (Blueprints do not yet support it); the steps are in `apps/render-workflow/README.md`.
- Tasks need the shared Postgres, so they cannot run against the in-memory demo database.
- Refund and payout confirmation are still webhook-driven; the scheduled run's polling covers captures.
