import { idSchemas, type OrganizationId } from '@bursar/schemas';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Both drivers (node-postgres here, PGlite in tests) must name columns the way the migrations do. */
export const DRIZZLE_OPTIONS = { schema, casing: 'snake_case' } as const;

/** A pooled connection for the API and workers. Call `close` on shutdown. */
export function createDb(connectionString: string): { db: Db; close: () => Promise<void> } {
  const pool = new Pool({ connectionString });
  return { db: drizzle({ client: pool, ...DRIZZLE_OPTIONS }), close: () => pool.end() };
}

/**
 * Runs `work` as one organisation. Tenant code gets its database access only through here: the
 * transaction drops to a role that row-level security applies to and pins `app.org_id` to the
 * organisation, so a query that forgets its `WHERE org_id` still sees one tenant's rows, and a
 * write for another tenant is refused. The role and the setting last for this transaction only.
 */
export async function withOrg<T>(
  db: Db,
  orgId: OrganizationId,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  idSchemas.organization.parse(orgId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role bursar_app`);
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return work(tx);
  });
}
