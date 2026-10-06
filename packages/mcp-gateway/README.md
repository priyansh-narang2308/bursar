# @bursar/mcp-gateway

An MCP server (Streamable HTTP, one request one server) that gives an agent Bursar's guarded tools and nothing else.

```bash
claude mcp add --transport http bursar https://<your-api>/v1/mcp --header "Authorization: Bearer <agent key>"
```

- **Scoped.** A key with only `missions:read` is not shown `propose_cart`.
- **Strict.** Inputs are the amount-free schemas from `@bursar/schemas`: an extra `payee` or `amount` is an error.
- **Honest about the outcome.** `propose_cart` reports `APPROVED`, `PENDING_APPROVAL` (a person must approve) or `BLOCKED`.
- **PayPal's toolkit is deny by default.** Money tools (`create_order`, `pay_order`, `create_refund`, ...) exist only as redirects to `propose_cart`. Read-only tools pass through only when a `ToolkitBridge` to the real toolkit is supplied. Everything else, including tools added later, is unreachable. The tool list is `@paypal/agent-toolkit` 1.11.0's, pinned in a test.
