# ADR-0017: The AG Studio cockpit

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

The dashboard shows one thing at a time. A reviewer also needs to see the whole workspace at once: how much of an envelope is used, which rules fire, where the money went, and whether PayPal's record explains it. AG Studio is a dashboard builder that does this and lets a person rearrange it. It runs charts and tables over data it holds in the browser, and its data engine adds numbers up.

## Decision

- **Studio is the cockpit** at `/dashboard/studio`, themed with Bursar's tokens, in view mode by default and editable on request. The layout is read and written with `getState`, kept in this browser per workspace, and reset on demand.
- **The server works out every figure.** `GET /v1/cockpit` returns envelopes, rulings, rule hits, money flows and verification counts, defined once in `@bursar/schemas`. The web app adds nothing up. The few numbers that only shape a picture (`usedPercent`, `weight`) are named as geometry.
- **Studio's own tables carry no amounts to sum.** Money reaches its charts and grids as formatted labels. Its data engine therefore never aggregates money, and counts are the only thing it adds.
- **Six custom widgets** (envelope gauge, decision stream, rule heatmap, money flow, verification status, lab scorecard) are Studio widget definitions. They read the cockpit and a shared rule filter from a small store rather than React context, because Studio mounts a widget in its own tree. Picking a rule in one narrows the others.
- **Fields are declared**, not inferred, so a table with no rows yet (no incidents) is still valid.
- **Live updates** come from the existing event stream. New rows reach Studio through its `data` property without a remount, so the layout and the picked rule survive.

## Consequences

- Studio runs without a licence key and shows a trial notice and watermark. A key goes in `VITE_AG_STUDIO_LICENSE_KEY` when there is one.
- Cross-filtering between Studio's built-in charts and the custom widgets is not linked: they filter among themselves.
- Studio's registry typing needs an explicit `BursarRegistry` so custom widget ids are checked.
