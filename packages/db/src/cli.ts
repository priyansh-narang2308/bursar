import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { MIGRATIONS_FOLDER } from './testing';

/** `pnpm db:migrate`: applies the migrations to the database at DATABASE_URL. */
const url = process.env['DATABASE_URL'];
if (url === undefined || url === '') {
  process.stderr.write('DATABASE_URL is not set. Copy .env.example to .env, or export it.\n');
  process.exit(1);
}
const pool = new Pool({ connectionString: url });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
  process.stdout.write('Migrations applied.\n');
} finally {
  await pool.end();
}
