# ADR-0015: Bryntum Gantt for the delivery schedule

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

The schedule is drawn from data the server already computes (earliest dates, slack, the critical path, the deadline). It deserves a real Gantt chart, and Bryntum is one of the hackathon's tools.

## Decision

- **The public trial build, by alias.** `@bryntum/gantt` is `npm:@bryntum/gantt-trial@7.3.7` in the pnpm catalog, with `@bryntum/gantt-react` beside it. No account token is needed. With a licence, the catalog entry becomes the licensed package and nothing else changes. The chart shows Bryntum's trial notice.
- **Its install script is not run.** Both Bryntum packages carry an obfuscated post-install step. The library files ship inside the package, so `allowBuilds` records `false` for them, in line with the repository's rule that lifecycle scripts are denied unless justified.
- **It draws; the server decides.** Tasks are fixed to the dates the scheduler computed and the chart is read-only, so what is on screen is what the scheduler said. Each delivery is followed by its inspection and every inspection feeds the handover. Late tasks are red, the critical path is brighter, and the deadline is a marked line.
- **One chart, three views.** Tabs switch between the plan, the plan after a carrier delay, and the recovery, rather than mounting three heavy components.
- **Loaded when needed.** The library is several megabytes, so the page is code-split and the chart is fetched only when the Schedule page opens.

## Consequences

- Tests replace the chart with a stand-in, because Bryntum needs a real browser layout; what it is given is asserted instead. The real chart was checked in a browser.
- The trial licence is for evaluation. A deployed product would use a licensed package.
- The hand-drawn Gantt it replaces is removed.
