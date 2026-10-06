# ADR-0014: Hardening, and the Policy Lab on screen

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

The API is open to the internet once deployed, and the product's strongest claim (the policy holds under attack) was something a visitor could only read about.

## Decision

- **A cookie session is not proof of intent.** A browser sends its cookie with a request from any page, so a write whose `Origin` is not ours is refused (`sameOrigin`). Callers that are not browsers (agent keys, PayPal's webhooks, tests) send no `Origin` and are unaffected; reads are never blocked. The cookie is also `HttpOnly` and `SameSite=Lax`.
- **Bodies are small.** `/v1` refuses a body over 64 KB and the webhook door one over 256 KB, before anything is parsed or a signature is checked.
- **Rate limit** is 600 requests a minute per client, because the interface is live (it refreshes on server events). Everything it protects is idempotent or checked again server-side.
- **Nothing known is vulnerable.** `pnpm audit --prod` reports no known vulnerabilities, and a scan of tracked files for key patterns finds none. Secrets stay in `.env`, the sealed payer pool is git-ignored, and logs never carry headers, cookies or keys.
- **The lab runs where a visitor can see it.** The Policy Lab screen runs adversarial spending scenarios through the real decision pipeline (`createCoreLab`: a real organisation, mandate, mission, cart and proposal per scenario, nothing sent to PayPal). On the standard policy nothing breaks. With the daily limit removed it finds the hole, shrinks a failing sequence to the fewest orders that still break it, proposes the patch, and shows the patch holding.
- **The lab cannot be piled up.** One run at a time, a bounded count, a strictly validated scenario, and the demo clock (which the lab moves forward to make a day mean a day) put back afterwards.

## Consequences

- The lab's clock skew is global to the demo server for the few seconds a run takes, so another visitor's new events can be stamped a little in the future. It is a demo server; a deployed one would run the lab in a worker.
- The Origin check trusts the browser to send `Origin` on writes, which every current browser does for cross-site requests.
- Not done: a content-security policy for the web app (it belongs with the static host's headers at deploy), and per-organisation connection caps on the event stream.
