# @bursar/api

Bursar's HTTP API: Hono, validated config, structured logs with redaction, RFC 9457 errors from the catalog, request ids, security headers and CORS, rate limiting, health checks, and an OpenAPI document.

```bash
pnpm db:up && pnpm db:migrate      # a local Postgres, then the schema
pnpm --filter @bursar/api dev      # http://localhost:8787
```

It needs `DATABASE_URL` and `SESSION_SECRET` (`openssl rand -hex 32`) in `.env`. `DEMO_MODE=true` (the default) lets anyone open a workspace; set it to `false` outside a demo.

## How callers are known

- **A person**: `POST /v1/demo/workspace` opens a workspace and sets an HttpOnly, SameSite session cookie (signed by `@bursar/crypto`, twelve hours). `POST /v1/demo/role` switches role to show what each can do.
- **An agent**: `Authorization: Bearer bk_…`. A key is shown once when created and only its SHA-256 is stored; keys can be scoped, rotated and revoked.

Every handler that touches tenant data goes through `asTenant`, which runs it with `withOrg` (row-level security). Permissions are one table, `ROLE_PERMISSIONS`, and a test walks each role over the permission-protected routes. A test also keeps `/openapi.json` and the routes the app serves in step.

Not here yet: expiring demo workspaces (sessions expire; the rows stay until cleanup is decided), the money routes (the next tasks), and a shared rate-limit store (the limiter is per instance).
