# @bursar/db

Bursar's Postgres schema, its migrations, tenant isolation, and the rules the database enforces itself, so a bug in application code cannot break them. Tests run on PGlite (real Postgres compiled to WebAssembly), so they need no Docker and no server.

## Using it

```ts
const { db, close } = createDb(process.env.DATABASE_URL);

// Tenant code (request handlers, agent tools): only through withOrg.
const missions = await withOrg(db, orgId, (tx) => tx.select().from(missionsTable));
```

`withOrg` runs the work in a transaction that drops to the `bursar_app` role and pins `app.org_id` to the organisation. Row-level security does the rest: a query that forgets its `WHERE org_id` still sees one tenant's rows, and a write for another tenant is refused. No organisation set means no rows. System code (migrations, the Verifier, webhook ingest, cron jobs) uses `db` directly, which is cross-tenant by nature, and should say so where it does.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm db:up` / `db:down` | Start or stop a local Postgres (`docker-compose.yml`, matching `DATABASE_URL` in `.env.example`) |
| `pnpm db:migrate` | Apply the migrations to `DATABASE_URL` (safe to repeat) |
| `pnpm db:reset` | Wipe the local database and migrate it again |
| `pnpm --filter @bursar/db generate` | After editing `src/schema/`, write the SQL for the change. Review it; never edit a migration that has been applied |

Row-level security, triggers and the other rules a schema file cannot express live in a hand-written migration (`0001_rls_and_invariants.sql`).

## What the database enforces

| Rule | How |
| --- | --- |
| A tenant sees only its own rows | RLS on every table with an `org_id`; a test fails if a later table is missed, and another if a table is not classified as tenant or global |
| One action per idempotency key | unique constraint |
| An action moves only along legal transitions, and starts `PROPOSED` | trigger over `action_transitions`, which a test keeps equal to `ACTION_TRANSITIONS` |
| The Verifier can never spend; a money action has an amount; a payout names a supplier | CHECK constraints mirroring the entity rules |
| An envelope never holds plus captures more than its ceiling | CHECK |
| A cart line's total is its unit price times its quantity | CHECK |
| An approval has a signature exactly when it is approved | CHECK |
| A Vault token is stored only sealed (`@bursar/crypto`) | CHECK |
| The audit log, ledger and policy versions are never edited | triggers; `(org, seq)` and `(org, prev_hash)` are unique, so a chain cannot fork |
| A ledger transaction's debits equal its credits, per currency | deferred constraint trigger, checked at commit |
| Ids have the right prefix and shape; enums and currencies are known values | CHECK, generated from `@bursar/schemas` and `@bursar/money` |

## Not here yet

Plan tasks, dependencies and resources (for the Gantt), studio layouts, payouts, deliveries, reconciliations, agent runs and an ERD land with the features that need them, each as a migration. Mapping rows to the entities in `@bursar/schemas` happens in the API layer.
