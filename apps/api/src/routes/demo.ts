import { type Db, memberships, organizations, users } from '@bursar/db';
import { newId, roleSchema } from '@bursar/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePrincipal, startSession } from '../auth';
import type { Config } from '../config';
import { ApiError } from '../http/problem';
import type { AppEnv } from '../types';
import { readBody } from './support';

/**
 * The demo front door: anyone can open a workspace and try the roles, with no sign-up. It exists only
 * while `DEMO_MODE` is on, and creating a workspace is system code, because there is no tenant yet.
 */
export function demoRoutes(deps: { db: Db; config: Config; now: () => Date }) {
  const demoOnly = () => {
    if (!deps.config.demoMode) throw new ApiError('NOT_FOUND');
  };
  return new Hono<AppEnv>()
    .post('/demo/workspace', async (c) => {
      demoOnly();
      const { name } = await readBody(
        c,
        z.object({ name: z.string().min(1).max(80).default('Demo workspace') }),
      );
      const [orgId, userId] = [newId('organization'), newId('user')];
      await deps.db.transaction(async (tx) => {
        await tx.insert(organizations).values({ id: orgId, name });
        await tx.insert(users).values({
          id: userId,
          email: `${userId.toLowerCase()}@demo.bursar.dev`,
          displayName: 'Demo owner',
        });
        await tx.insert(memberships).values({ orgId, userId, role: 'OWNER' });
      });
      startSession(c, deps.config, { userId, orgId, role: 'OWNER' }, deps.now());
      return c.json({ orgId, userId, role: 'OWNER' }, 201);
    })
    .post('/demo/role', async (c) => {
      demoOnly();
      const principal = requirePrincipal(c);
      if (principal.kind !== 'session' || principal.userId === null)
        throw new ApiError('FORBIDDEN');
      const { role } = await readBody(c, z.object({ role: roleSchema }));
      startSession(
        c,
        deps.config,
        { userId: principal.userId, orgId: principal.orgId, role },
        deps.now(),
      );
      return c.json({ role });
    });
}
