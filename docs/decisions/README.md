# Architecture decision records

Short records of decisions that shape the architecture: the context, the choice, what was rejected, and what it costs. Add a new record when a decision changes; never rewrite history, supersede it instead.

| ADR                                             | Title                                       | Status   |
| ----------------------------------------------- | ------------------------------------------- | -------- |
| [0001](0001-stack-and-conventions.md)           | Technology stack and repository conventions | Accepted |
| [0002](0002-ai-assisted-development-tooling.md) | AI-assisted development tooling             | Accepted |
| [0003](0003-money-representation.md)            | Money representation                        | Accepted |
| [0004](0004-schemas-as-the-shared-contract.md)  | Schemas as the shared contract              | Accepted |
| [0005](0005-cryptography-and-the-audit-log.md)  | Cryptography and the audit log              | Accepted |
| [0006](0006-database.md)                        | Database                                    | Accepted |
| [0007](0007-ledger-and-policy-engine.md)        | Ledger and policy engine as pure functions  | Accepted |
| [0008](0008-api-and-paypal-client.md)           | API, sessions and the PayPal client         | Accepted |
| [0009](0009-the-money-loop.md)                  | The money loop                              | Accepted |
| [0010](0010-oversight-catalog-and-agents.md)    | Oversight, the catalog and the agents       | Accepted |
| [0011](0011-schedules-workflows-lab-and-the-mcp-gateway.md) | Schedules, workflows, the lab and the MCP gateway | Accepted |
| [0012](0012-web-app-and-demo-server.md) | The web app and the demo server | Accepted |
| [0013](0013-live-services-and-the-payer-pool.md) | Live services and the payer pool | Accepted |

## Template

```markdown
# ADR-NNNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD

## Context

## Decision

## Consequences
```
