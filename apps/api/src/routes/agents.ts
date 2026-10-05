import { randomBytes } from 'node:crypto';
import { agents, apiKeys, type Db } from '@bursar/db';
import { type AgentId, idSchemas, newId, type OrganizationId } from '@bursar/schemas';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { API_KEY_PREFIX, can, hashApiKey, requirePrincipal } from '../auth';
import { ApiError } from '../http/problem';
import type { AppEnv } from '../types';
import { asTenant, readBody } from './support';

/** An agent key can only be scoped to what the AGENT role may do at all. */
const keyBody = z.object({
  scopes: z
    .array(z.enum(['missions:read', 'actions:propose']))
    .min(1)
    .default(['missions:read', 'actions:propose']),
});

/** A new key: shown once, here, and stored only as its hash. */
const newKey = () => `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;

export function agentRoutes(db: Db) {
  const owned = (agentId: string) => async (tx: Parameters<Parameters<typeof asTenant>[2]>[0]) => {
    const [agent] = await tx
      .select()
      .from(agents)
      .where(eq(agents.id, idSchemas.agent.parse(agentId)));
    if (agent === undefined) throw new ApiError('NOT_FOUND');
    return agent;
  };
  const issue = async (
    tx: Parameters<Parameters<typeof asTenant>[2]>[0],
    orgId: OrganizationId,
    agentId: AgentId,
    scopes: string[],
  ) => {
    const key = newKey();
    const [row] = await tx
      .insert(apiKeys)
      .values({ orgId, agentId, keyHash: hashApiKey(key), scopes })
      .returning({ id: apiKeys.id });
    return { id: row?.id, key, scopes };
  };

  return new Hono<AppEnv>()
    .get('/agents', can('workspace:read'), async (c) => {
      const items = await asTenant(db, c, async (tx) => ({
        agents: await tx.select().from(agents),
        keys: await tx
          .select({
            id: apiKeys.id,
            agentId: apiKeys.agentId,
            scopes: apiKeys.scopes,
            createdAt: apiKeys.createdAt,
            revokedAt: apiKeys.revokedAt,
          })
          .from(apiKeys),
      }));
      return c.json({
        items: items.agents.map((agent) => ({
          ...agent,
          keys: items.keys.filter((k) => k.agentId === agent.id),
        })),
      });
    })
    .post('/agents', can('agents:manage'), async (c) => {
      const { name } = await readBody(c, z.object({ name: z.string().min(1).max(80) }));
      const { orgId } = requirePrincipal(c);
      const [agent] = await asTenant(db, c, (tx) =>
        tx
          .insert(agents)
          .values({ id: newId('agent'), orgId, name })
          .returning(),
      );
      return c.json(agent, 201);
    })
    .post('/agents/:id/keys', can('agents:manage'), async (c) => {
      const { scopes } = await readBody(c, keyBody);
      const { orgId } = requirePrincipal(c);
      const created = await asTenant(db, c, async (tx) => {
        const agent = await owned(c.req.param('id'))(tx);
        return issue(tx, orgId, agent.id, scopes);
      });
      return c.json(created, 201);
    })
    .post('/agents/:id/keys/:keyId/rotate', can('agents:manage'), async (c) => {
      const { orgId } = requirePrincipal(c);
      const keyId = z.uuid().parse(c.req.param('keyId'));
      const created = await asTenant(db, c, async (tx) => {
        const agent = await owned(c.req.param('id'))(tx);
        const [old] = await tx
          .update(apiKeys)
          .set({ revokedAt: new Date() })
          .where(
            and(eq(apiKeys.id, keyId), eq(apiKeys.agentId, agent.id), isNull(apiKeys.revokedAt)),
          )
          .returning();
        if (old === undefined) throw new ApiError('NOT_FOUND');
        return issue(tx, orgId, agent.id, old.scopes);
      });
      return c.json(created, 201);
    })
    .delete('/agents/:id/keys/:keyId', can('agents:manage'), async (c) => {
      const keyId = z.uuid().parse(c.req.param('keyId'));
      const revoked = await asTenant(db, c, async (tx) => {
        const agent = await owned(c.req.param('id'))(tx);
        return tx
          .update(apiKeys)
          .set({ revokedAt: new Date() })
          .where(
            and(eq(apiKeys.id, keyId), eq(apiKeys.agentId, agent.id), isNull(apiKeys.revokedAt)),
          )
          .returning({ id: apiKeys.id });
      });
      if (revoked.length === 0) throw new ApiError('NOT_FOUND');
      return c.body(null, 204);
    });
}
