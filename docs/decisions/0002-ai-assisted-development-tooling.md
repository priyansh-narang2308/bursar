# ADR-0002: AI-assisted development tooling

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Bursar is built with Claude Code, and the hackathon sponsors ship AI tooling for their products: the APIMatic Context Plugin and PayPal's AI Toolkit for PayPal, and skills for AG Grid, Bryntum and Render. What shaped the setup:

- Plugins, hooks and MCP servers run on a developer's machine, and skills are instructions an assistant will follow. Whatever the repository ships becomes part of every contributor's trust boundary.
- The tools cost context and money: always-on skill descriptions, and a prompt hook that makes a model call on every edit.
- The Bryntum skills repository declares no licence, so its files cannot be redistributed.
- Claims about what the tools did should be checkable, so judges and teammates can see where they helped and where they did not.

## Decision

| Concern | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Plugin setup | The marketplace and the enabled plugin are declared in the committed project settings; personal choices stay in the git-ignored `settings.local.json`. A test limits the committed file to those two keys | One reviewable file reproduces the setup for everyone, and cloning cannot add hooks, environment values or MCP servers to a machine | Installing at user scope (invisible to review, not reproducible); committing hooks or environment values |
| APIMatic Context Plugin | Enabled for the project | Sponsor tooling for the PayPal SDK. Measured cost is about 3.5k tokens, with no hooks or MCP servers, under the MIT licence | Installing its SDK from git: `pay-pal-server-sdk` is unpublished and unversioned, and is not the SDK PayPal documents (see Evidence #1) |
| PayPal AI Toolkit | Installed at local scope and disabled by default | Its hook is a model call before every file write and its MCP server needs a sandbox token, so it is enabled per developer for PayPal-heavy work | Enabling it for everyone; leaving it out |
| AG Grid, Bryntum and Render skills | Restored into the git-ignored `.claude/skills/` by `pnpm dev:skills` and recorded in `skills-lock.json` | Nothing unlicensed is redistributed, and one mechanism covers all three sources | Committing the files; committing only the licensed ones, which needs two mechanisms |
| Skill integrity | Content hashes in the lock are verified after every install and by `pnpm dev:doctor` | The installer fetches whatever upstream holds today, and a silent change to agent instructions is a supply-chain risk | Trusting upstream content on restore |
| Verification | `pnpm dev:doctor`, with the rules as pure, tested functions in `@bursar/tooling` | The same standard as the rest of the code, and it runs without the tools installed | An untested shell script |
| Evidence | `docs/development-with-ai.md`: one entry per finding with before, after and the defect avoided | Claims about the tools are checkable and reproducible | Unrecorded anecdotes |

## Consequences

- **Plugin skills load at session start,** so a session that installs a plugin cannot invoke its skills. Evidence #1 read the skill files directly; later sessions have them as slash skills.
- **The marketplace is declared by repository, not pinned to a commit.** The doctor prints the installed plugin version so an unexpected change is visible. When it changes, re-read `claude plugin details paypal@context-plugins`: the committed settings test cannot see hooks or MCP servers that a plugin brings with it.
- **Restoring skills needs the network and can fail on purpose.** If upstream changes a skill, `pnpm dev:skills` exits non-zero and the diff of `skills-lock.json` is the review; commit the new lock once it has been read.
- **The hash scheme is the installer's.** It is SHA-256 over each file's path and bytes, ordered with `localeCompare`. `hashSkillFiles` mirrors it and a known-digest test pins it. If the installer changes the scheme, the doctor reports every skill as changed until the function is updated.
- **The toolkit's MCP server is a development aid only.** Bursar's own MCP gateway is a separate component.

## Verification (2026-10-05)

- `claude plugin details`: the APIMatic plugin has 27 skills, 0 hooks, 0 MCP servers and about 3,471 always-on tokens; the PayPal toolkit has 7 skills, 1 hook, 1 MCP server and about 546 tokens.
- The toolkit's hook is `type: "prompt"` on `PreToolUse`, matching `Write|Edit`. Its MCP server is `https://mcp.sandbox.paypal.com/sse`, authenticated with `PAYPAL_SANDBOX_ACCESS_TOKEN`.
- Licences from the GitHub API: ag-grid/skills MIT, render-oss/skills MIT, context-plugins/plugin-marketplace MIT, bryntum/skills none.
- The installer's folder hash was reproduced for all 11 installed skills.
- A restore round trip: with a skill deleted the doctor fails, `pnpm dev:skills` reinstalls it and the doctor passes with byte-identical files. Editing an installed skill fails both the doctor and the installer.
