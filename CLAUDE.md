@AGENTS.md

## Claude Code notes

- Run `pnpm check` before calling work done, and show its output rather than summarising it.
- Keep diffs small and reviewable; prefer editing existing files over adding new ones.
- If a task needs a key that is missing from `.env`, stop and ask. Never print or log `.env` values.
