import { auditEvents, type Db, organizations } from '@bursar/db';
import { Hono } from 'hono';
import { can, requirePrincipal } from '../auth';
import { ApiError } from '../http/problem';
import type { AppEnv } from '../types';
import { asTenant } from './support';

export function workspaceRoutes(db: Db) {
  return new Hono<AppEnv>()
    .get('/me', (c) => {
      const { kind, orgId, role, userId, agentId, scopes } = requirePrincipal(c);
      return c.json({ kind, orgId, role, userId, agentId, scopes });
    })
    .get('/workspace', can('workspace:read'), async (c) => {
      const [org] = await asTenant(db, c, (tx) => tx.select().from(organizations));
      if (org === undefined) throw new ApiError('NOT_FOUND');
      return c.json(org);
    })
    .get('/audit-events', can('audit:read'), async (c) => {
      const rows = await asTenant(db, c, (tx) =>
        tx.select().from(auditEvents).orderBy(auditEvents.seq).limit(100),
      );
      return c.json({ items: rows });
    });
}
