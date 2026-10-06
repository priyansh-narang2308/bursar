# ADR-0012: The web app and the demo server

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

A judge will see Bursar for a few minutes, with no keys and no account. The product has to be understood at once, and what they click has to be the real backend, not a recording.

## Decision

- **One dark design, one set of tokens.** Near-black surfaces separated by hairlines, a single typeface, and colour only for meaning (green healthy, amber waiting, red dangerous). The landing page and the dashboard use the same CSS and components, so they are one product. There is no component library: the surface is small and the look is the point.
- **A demo server that is the real API.** `pnpm dev:demo` runs the production routes over an in-memory Postgres (PGlite), the fake PayPal, an offline catalog and a scripted model. Three hooks (`DemoHooks`) fill the gaps a demo has: seeding a workspace, standing in for the buyer's approval on PayPal's page, and running the agents with a trace. Outside demo mode those routes answer 404.
- **The first click does the work.** "Open demo workspace" creates an organisation with an active mandate, a registered supplier and a sample mission, and signs the visitor in as owner. A three-step tour on the overview ticks itself off as they run the agents, approve, and read a receipt.
- **Safety is always on screen.** The top bar shows the mandate's state, whether the audit chain verifies, and a Freeze button for owners, which asks for a reason first.
- **Simulation is labelled.** Anything faked (the scripted model, the fake PayPal, the buyer's approval) carries a `sim` mark.
- **Screens that are not built say so.** Unbuilt areas are in the sidebar marked *soon* and open a page that says it is not built, rather than showing invented data.
- **No arithmetic on money in the browser.** Amounts are formatted from minor units, and typed amounts are parsed to exact cents or refused.

## Consequences

- Building this found a real bug in the money loop: an approved hold was counted twice against the envelope when it ran, so any cart over half the envelope was denied at execution. It is fixed and has a regression test.
- The agent run is scripted, not Claude. The Claude provider is written but unverified against the live service.
- The trace of a run is kept in the browser's cache, so it is gone after a reload; the receipts and the audit trail are permanent.
- Real sign-in is out of scope for the hackathon; demo sessions, roles and agent keys are the whole of authentication.
