# @bursar/web

The web app: React 19, Vite, TanStack Query and React Router, with hand-written CSS (no component library) in one dark theme.

```bash
pnpm dev:demo   # the API with an in-memory database, the fake PayPal and a scripted model (port 8787)
pnpm dev:web    # this app (port 5173), proxying /v1 to the API
```

Open http://localhost:5173 and press **Open demo workspace**. No keys, no sign-up.

## What is here

| Route                  | What it does                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                    | The landing page. The main button opens a populated demo workspace.                                                                                   |
| `/dashboard`           | Overview with a three-step tour that ticks itself off, and the always-visible mandate, audit and **Freeze** controls.                                 |
| `/dashboard/missions`  | Missions, a composer, and the agent trace: Planner, Researchers, Buyer, and every tool call.                                                          |
| `/dashboard/approvals` | Proposals that need a person. Approve or reject; the approval is signed server-side.                                                                  |
| `/dashboard/activity`  | Every action with its state ladder. A row opens its **receipt**: rulings (with Replay), approvals, PayPal calls and webhooks, ledger and audit trail. |
| `/dashboard/mandate`   | Limits, freeze, revoke, and a new-mandate flow with the buyer's approval simulated.                                                                   |
| `/dashboard/agents`    | Agents and keys, shown once, with the `claude mcp add` command.                                                                                       |
| `/dashboard/policy` | The rules in force with their parameters and the policy hash, read from the server. |
| `/dashboard/incidents` | What moved money outside an approved action and how the Verifier contained it. Owners resolve with a note. A **Simulate a rogue capture** button makes PayPal move $50 directly so you can watch the kill switch work. |
| `/dashboard/integrations` | Which services are real and which are stand-ins, and the MCP endpoint. |
| `/dashboard/schedule` | The delivery plan as a Gantt chart. **Delay the longest delivery** shows the late plan and a recovery; proposing it goes through the same policy as any purchase. |
| `/dashboard/gauntlet` | 27 prompt-injection payloads against the same gullible agent twice: raw payment tools, then through Bursar. |
| `/dashboard/lab` | Adversarial spending scenarios against the real pipeline. On the standard policy nothing breaks; with the daily limit removed it finds the hole, shrinks it to the fewest orders, and shows the patch holding. |
| `/_ui`                 | The design system in one page.                                                                                                                        |

Studio is in the sidebar marked _soon_.

The role switcher in the top bar changes who you are (`/v1/demo/role`), so an auditor sees the same screens with the buttons that role cannot use taken away.
