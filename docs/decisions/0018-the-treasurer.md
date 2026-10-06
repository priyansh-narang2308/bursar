# ADR-0018: The Treasurer, Studio's assistant

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

AG Studio ships an AI assistant: a harness of agents (lead, data, page, widget, planning) that build a dashboard from a conversation. We want a person to be able to ask the cockpit a question in words ("how much is left?", "why was that held?") and to ask it to build a chart. We also hold a rule that no model gets a way to move money.

## Decision

- **A custom lead agent, the Treasurer,** runs on Studio's harness and hands charting work to Studio's own data, page, widget and planning agents. Every agent talks to its model through one adapter.
- **Its tools are read-only and listed once.** `TREASURER_TOOLS` in `@bursar/schemas` names five: the envelope, incidents, the latest ruling, a what-if on a rule, and adding a chart. None names an amount, a payee or an account, and none can order, capture, refund or pay. A test on each side of the wire holds the list to that, and the browser and server tests both read the same constant.
- **The model sits behind the server.** `POST /v1/studio/ai/turn` takes one turn of the conversation and returns what the model says next. It is behind `audit:read`, has its own rate limit, and its request is strict: an unknown field is a 400.
- **The brain is scripted today.** A deterministic function reads the last thing said, picks a tool, and once the tool has answered it says what the answer was. The same conversation always gets the same reply, so the demo is repeatable and free. A model replaces it behind the same request and response.
- **Tool answers are sentences.** Each tool works its answer out from the cockpit the server sent, so the assistant never states an amount it did not get from a tool.

## Consequences

- The demo's assistant is a script, not Claude. It handles a fixed set of questions and says what it can do when it cannot help. This is stated on the limits page and in the README.
- The Treasurer's tools are not in `LLM_TOOLS`, because they belong to a person's analyst, not to a buying agent. The same constraint holds on them: no amount, payee or currency, and no money moves.
- Studio only shows the assistant panel in edit mode.
