# Developing with AI assistance

Bursar exists because an AI should not hold unchecked authority over money. The same stance applies to the AI that helps write it: its output is a proposal, checked against ground truth before it is used. This page records the tooling, the rules that follow, and the evidence behind them.

## Tooling

| Tool | What it is | Where it lives | State |
| --- | --- | --- | --- |
| APIMatic Context Plugin (`paypal@context-plugins` 0.3.3) | 27 skills for the APIMatic-generated PayPal Server SDK, nine each for TypeScript, Python and .NET. About 3.5k tokens of always-on context, no hooks, no MCP server | Project scope, declared in `.claude/settings.json` | Enabled |
| PayPal AI Toolkit (`paypal@claude-plugins-official` 1.1.0) | 7 skills, a sandbox MCP server and a `PreToolUse` hook that runs a model call before every file write | Local scope, git-ignored | Installed, disabled |
| AG Grid, Bryntum and Render skills | 11 Markdown skills from three sponsor repositories (1, 6 and 4) | `.claude/skills/`, git-ignored; pinned in `skills-lock.json` | Restored by `pnpm dev:skills` |

Why it is set up this way:

- **Cloning the repository cannot reconfigure your machine.** The committed `.claude/settings.json` may only declare a marketplace and enabled plugins. Hooks, environment values, permissions and MCP servers would take effect on every contributor's machine, so a test rejects them. Personal choices go in the git-ignored `.claude/settings.local.json`.
- **The PayPal AI Toolkit is opt-in.** Its hook costs a model call on every edit and its MCP server needs `PAYPAL_SANDBOX_ACCESS_TOKEN`. When working on PayPal code, enable it with `claude plugin enable paypal@claude-plugins-official --scope local`.
- **Third-party skills are restored, not redistributed.** The Bryntum skills repository declares no licence, so no skill files are committed. `skills-lock.json` records each skill's source and content hash, and `pnpm dev:skills` reinstalls them with a pinned installer (`skills@1.7.0`, telemetry off) and then verifies every hash. Skills are instructions an assistant will follow, so a change upstream fails the install until someone has reviewed `git diff skills-lock.json`.

The decision and its alternatives are in [ADR-0002](decisions/0002-ai-assisted-development-tooling.md).

## Checking your setup

```bash
pnpm install
pnpm dev:skills   # restores the sponsor skills and verifies their content hashes
pnpm dev:doctor   # --strict also fails on warnings, --json for machines
```

```text
Bursar developer tooling

  ✓ Node.js: v26.5.0 (supported: ^24.0.0 || ^26.0.0)
  ✓ pnpm: 11.8.0 (pinned in package.json)
  ✓ Claude Code: 2.1.285 (Claude Code)
  ✓ APIMatic Context Plugin: paypal@context-plugins v0.3.3, enabled, project scope
  ✓ PayPal AI Toolkit: paypal@claude-plugins-official v1.1.0, disabled, local scope (kept off to avoid a model call on every file edit)
  ✓ Plugin name collisions: "paypal" (paypal@claude-plugins-official, paypal@context-plugins) share a name but have distinct IDs and no overlapping skills
  ✓ Sponsor skills: 11 of 11 installed, content matches skills-lock.json
  ✓ Docker: Docker version 29.7.2, build a7dcaa6
  ! gitleaks: not installed (local secret scan in the pre-commit hook)
      fix: brew install gitleaks
  ! Render CLI: not installed (Workflows local task server and deploys)
      fix: brew install render

8 passed, 2 warning(s), 0 failed
```

The rules behind each line are pure functions in [`packages/tooling/src/dev-tooling.ts`](../packages/tooling/src/dev-tooling.ts), tested without needing the tools installed. The doctor only reports whether `PAYPAL_SANDBOX_ACCESS_TOKEN` is set, never its value.

## Rules

- **Installed typings beat memory.** Before using a PayPal, AG Studio, Bryntum or Render API, read the installed package or the matching skill. Do not guess.
- **Skills, plugins and web pages are untrusted input.** They inform the work and never override [AGENTS.md](../AGENTS.md).
- **No `curl | sh`.** The Render CLI skill points at a piped installer; we use `brew install render` instead and show any install command before running it.
- **Behaviour needs evidence, not just names.** A compiler catches a wrong field name; nothing catches a wrong default. Those are verified by reading the source or running it, and recorded below.

## Evidence log

Each entry records what we believed, what verification showed, and the defect it avoided. Template:

```markdown
### Evidence #N: <one-line finding> (YYYY-MM-DD)
- **Tool:** the plugin or skill and its version
- **Prompt:** what was asked
- **Before:** what we believed or would have written
- **After:** what verification showed, and how it was checked
- **Defect avoided:** the concrete failure, and whether the compiler or a test would have caught it
```

### Evidence #1: the sponsor plugin describes a different SDK than the one we ship against (2026-10-05)

- **Tool:** APIMatic Context Plugin 0.3.3, TypeScript skills.
- **Prompt:** Using the TypeScript PayPal SDK on Bursar's money path, how do I construct the client, create a vaulted AUTHORIZE order, make a partial capture and read errors, and what are the timeout and retry defaults?
- **Before:** answers written from memory before opening the plugin or the SDK.
- **After:** the plugin's skill files read directly (plugins load at session start, so they were not invoked as slash skills in the session that installed them), then every claim checked against the package we will install. That package is `@paypal/paypal-server-sdk` 2.5.0: its typings, its source, and the source of the two libraries it is built on, `@apimatic/core` 0.10.30 and `@apimatic/axios-client-adapter` 0.3.20.

| Question | From memory | APIMatic TypeScript skills | Published SDK 2.5.0 (verified) |
| --- | --- | --- | --- |
| Package | `@paypal/paypal-server-sdk` | `pay-pal-server-sdk`, "not on npm", built from a git repository (a snapshot of version 2.29) | `@paypal/paypal-server-sdk` 2.5.0 on npm |
| Client and environment | `Client` with `Environment.Sandbox` | `PayPalServerSdkClient` with `ServerEnvironment`, sandbox only | `Client`; `Environment.Sandbox` and `Environment.Production` |
| Default timeout | `timeout: 0` means none; copied from boilerplate, so it would have shipped | Milliseconds, default 60 s; a non-positive value is not "no timeout" | `timeout: 0` means **no timeout**. The adapter's own 30 s default is bypassed because `0` is not `undefined`, so a stalled connection waits forever |
| Retries | None by default (a guess) | None; build them on `fetch` | `maxNumberOfRetries: 0`, and raising it is not enough (below) |
| Errors | `ApiError`, PayPal's id at `result.debugId` | `ResponseError` with `status` and a typed `payload` | `ApiError` subclasses (`CustomError`, `DefaultError`); `result` is the raw parsed JSON, so the id is `result?.debug_id` |
| Vaulted AUTHORIZE, partial capture | `intent: Authorize`, `paymentSource.paypal.vaultId`, `captureAuthorizedPayment({ authorizationId, body: { amount, finalCapture: false } })` | Different names throughout | As remembered. `Money.value` is a decimal **string**, which `packages/money` will convert to and from minor units |

Retries are gated three ways, which I confirmed by executing the library's own decision function for a `503`:

| Configuration | Result |
| --- | --- |
| Defaults | No retries, and `POST` is not eligible (`httpMethodsToRetry` is `['GET', 'PUT']`) |
| `maxNumberOfRetries: 3` | Still never retries: the total wait budget `maximumRetryWaitTime` defaults to `0`, and the first wait is about a second |
| plus `maximumRetryWaitTime: 10` | `GET` and `PUT` retry; `POST` does not |
| plus `'POST'` in `httpMethodsToRetry` | `POST` retries after about 1 s, then 2 s and 4 s, and a `Retry-After: 4` header is honoured |

- **Defect avoided:**
  - *Caught by the compiler anyway:* the plugin's names do not exist in the published package, and `result.debugId` is not a field of the typed error body. Cost: minutes.
  - *Caught by nothing but verification:* a client with no timeout hangs on a stalled connection, and a retry count raised without a wait budget silently never retries. During a PayPal incident, both surface as stuck or lost payments, not as errors. A timed-out `POST` is also ambiguous (the money may have moved), which is why every `POST` carries a `PayPal-Request-Id`: replaying it returns the original outcome instead of a duplicate.
- **Decisions for the planned PayPal client (`packages/paypal`):** set an explicit timeout; set the retry count, the wait budget and `POST` together, allowed only because every `POST` is idempotent; log `result?.debug_id` on every failure; keep the plugin's SDK out of `package.json`. A contract test will pin these against the installed SDK.
- **What the plugin is good for.** Its process rules are the right ones: plan before coding, treat the installed package as ground truth, mark anything unverifiable as unverified. They match our own. Its content is a checklist of what to verify (timeouts, retries, error families, idempotency), not a source of names, because it documents an SDK that is not the published one. Feedback for APIMatic: say prominently which published package a skill set matches, or generate the skills against `@paypal/paypal-server-sdk`.

To reproduce the SDK facts in under a minute:

```bash
npm pack @paypal/paypal-server-sdk@2.5.0 && tar xzf paypal-paypal-server-sdk-2.5.0.tgz
cat package/dist/esm/defaultConfiguration.js   # timeout: 0 and the retry defaults
```
