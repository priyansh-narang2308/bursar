# @bursar/llm

A small LLM runtime with no SDK. `createRuntime({ provider, budget, cache, onRun })`, then `start(meta)` for one run:

- `structured(schema, ...)` forces a tool call, checks it with Zod, and on a bad answer tells the model what was wrong and tries again.
- `converse({ tools, ... })` lets the model call tools until it answers.
- **Budgets** of steps, tokens and time per run; a cache for identical requests; retries with backoff for rate limits and outages, never for refusals.
- `finish()` reports the cost, and `persistRun` writes it to `agent_runs`.
- **Providers:** `claudeProvider` (the Messages API; not yet run against the live service), `mockProvider` for tests, and `recording` / `replaying` to capture a run once and replay it byte for byte.
