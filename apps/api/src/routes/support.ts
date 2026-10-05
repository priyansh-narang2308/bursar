import type { Db, Tx } from '@bursar/db';
import { withOrg } from '@bursar/db';
import type { Context } from 'hono';
import type { z } from 'zod';
import { requirePrincipal } from '../auth';
import { ApiError, fieldErrors } from '../http/problem';
import type { AppEnv } from '../types';

/** The JSON body, checked against a schema. Anything else is a 400 that says which fields. */
export async function readBody<S extends z.ZodType>(
  c: Context<AppEnv>,
  schema: S,
): Promise<z.output<S>> {
  const raw: unknown = await c.req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new ApiError('VALIDATION_FAILED', { errors: fieldErrors(parsed.error) });
  return parsed.data;
}

/** Runs `work` as the caller's organisation: the only way a handler reaches tenant data. */
export function asTenant<T>(db: Db, c: Context<AppEnv>, work: (tx: Tx) => Promise<T>): Promise<T> {
  return withOrg(db, requirePrincipal(c).orgId, work);
}
