import type { Actor, Core } from '@bursar/core';
import { type Db, deliveries, incidents, outbox } from '@bursar/db';
import { idSchemas } from '@bursar/schemas';
import { asc, desc, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Integrations } from '../app';
import { can, requirePrincipal } from '../auth';
import type { AppEnv } from '../types';
import { asTenant, readBody } from './support';

const POLL_MS = 1_000;
const BATCH = 100;
const resolveBody = z.strictObject({ note: z.string().min(1).max(500) });
const deliveryBody = z.strictObject({
  cartId: idSchemas.cart,
  supplierId: idSchemas.supplier,
  status: z.enum(['DELIVERED', 'INSPECTED', 'REJECTED']),
});

const actorOf = (c: Parameters<typeof requirePrincipal>[0]): Actor => {
  const principal = requirePrincipal(c);
  return principal.kind === 'agent'
    ? { kind: 'AGENT', id: principal.agentId }
    : { kind: 'USER', id: principal.userId };
};

/** Where to resume: the `Last-Event-ID` header, or `?after=`, as a number (the outbox row id). */
function resumeAfter(header: string | undefined, query: string | undefined): number {
  const n = Number(header ?? query ?? 0);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * What a person or an auditor looks at: the live event stream, the receipt for an action, whether the audit
 * chain and a ruling still hold, incidents and deliveries.
 */
export function oversightRoutes(db: Db, core: Core, integrations: Integrations) {
  return new Hono<AppEnv>()
    .get('/events', can('workspace:read'), (c) => {
      const { orgId } = requirePrincipal(c);
      let last = resumeAfter(c.req.header('last-event-id'), c.req.query('after'));
      // `?wait=0` sends what is waiting and ends, which is how a test (or a poller) uses it.
      const live = c.req.query('wait') !== '0';
      return streamSSE(c, async (stream) => {
        let open = true;
        stream.onAbort(() => {
          open = false;
        });
        do {
          // The outbox is read as the caller's organisation, so one tenant never sees another's events.
          const rows = await asTenant(db, c, (tx) =>
            tx
              .select()
              .from(outbox)
              .where(gt(outbox.id, last))
              .orderBy(asc(outbox.id))
              .limit(BATCH),
          );
          for (const row of rows) {
            await stream.writeSSE({
              id: String(row.id),
              event: row.topic,
              data: JSON.stringify({ orgId, at: row.createdAt, ...(row.payload as object) }),
            });
            last = row.id;
          }
          if (rows.length === 0 && live) await stream.sleep(POLL_MS);
        } while (live && open);
      });
    })
    .get('/policy', can('workspace:read'), (c) =>
      c.json(core.policy.describe(requirePrincipal(c).orgId)),
    )
    .get('/integrations', can('workspace:read'), (c) =>
      c.json({ ...integrations, mcp: { path: '/v1/mcp' } }),
    )
    .get('/receipts/:actionId', can('audit:read'), async (c) =>
      c.json(
        await core.receipts.get(
          requirePrincipal(c).orgId,
          idSchemas.action.parse(c.req.param('actionId')),
        ),
      ),
    )
    .get('/audit/verify', can('audit:read'), async (c) =>
      c.json(await core.receipts.verifyAudit(requirePrincipal(c).orgId)),
    )
    .post('/decisions/:id/replay', can('audit:read'), async (c) =>
      c.json(
        await core.receipts.replay(
          requirePrincipal(c).orgId,
          idSchemas.decision.parse(c.req.param('id')),
        ),
      ),
    )
    .get('/incidents', can('audit:read'), async (c) =>
      c.json({
        items: await asTenant(db, c, (tx) =>
          tx.select().from(incidents).orderBy(desc(incidents.openedAt)).limit(100),
        ),
      }),
    )
    .post('/incidents/:id/resolve', can('mandates:write'), async (c) => {
      const { note } = await readBody(c, resolveBody);
      await core.incidents.resolve(
        requirePrincipal(c).orgId,
        actorOf(c),
        idSchemas.incident.parse(c.req.param('id')),
        note,
      );
      return c.json({ resolved: true });
    })
    .get('/deliveries', can('missions:read'), async (c) =>
      c.json({
        items: await asTenant(db, c, (tx) =>
          tx.select().from(deliveries).orderBy(desc(deliveries.createdAt)).limit(100),
        ),
      }),
    )
    .post('/deliveries', can('missions:write'), async (c) =>
      c.json(
        await core.deliveries.record(
          requirePrincipal(c).orgId,
          actorOf(c),
          await readBody(c, deliveryBody),
        ),
        201,
      ),
    );
}
