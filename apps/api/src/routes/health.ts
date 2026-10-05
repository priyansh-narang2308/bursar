import type { Db } from '@bursar/db';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ApiError } from '../http/problem';
import type { AppEnv } from '../types';

export function healthRoutes(db: Db) {
  return new Hono<AppEnv>()
    .get('/healthz', (c) => c.json({ status: 'ok' }))
    .get('/readyz', async (c) => {
      try {
        await db.execute(sql`select 1`);
      } catch {
        throw new ApiError('SERVICE_UNAVAILABLE', { detail: 'The database is not reachable.' });
      }
      return c.json({ status: 'ready' });
    });
}
