import { type Db, memberships, organizations, users } from '@bursar/db';
import { newId, roleSchema } from '@bursar/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import type { DemoHooks } from '../app';
import { can, requirePrincipal, startSession } from '../auth';
import type { Config } from '../config';
import { ApiError } from '../http/problem';
import type { AppEnv } from '../types';
import { readBody } from './support';

/**
 * The demo front door: anyone can open a workspace and try the roles, with no sign-up. It exists only
 * while `DEMO_MODE` is on, and creating a workspace is system code, because there is no tenant yet.
 */
const labPolicy = z.enum(['standard', 'no-velocity']);
const labScenario = z.strictObject({
  id: z.string().max(80),
  family: z.string().max(40),
  budgetCents: z.int().min(0).max(100_000_000),
  steps: z
    .array(
      z.strictObject({
        supplier: z.string().min(1).max(40),
        unitCents: z.int().min(1).max(10_000_000),
        quantity: z.int().min(1).max(99),
        afterMinutes: z.int().min(0).max(10_000),
      }),
    )
    .min(1)
    .max(16),
});

export function demoRoutes(deps: {
  db: Db;
  config: Config;
  now: () => Date;
  hooks?: DemoHooks | undefined;
}) {
  const demoOnly = () => {
    if (!deps.config.demoMode) throw new ApiError('NOT_FOUND');
  };
  const hooks = () => {
    if (!deps.config.demoMode || deps.hooks === undefined) throw new ApiError('NOT_FOUND');
    return deps.hooks;
  };
  return (
    new Hono<AppEnv>()
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
        await deps.hooks?.seed(orgId, userId);
        startSession(c, deps.config, { userId, orgId, role: 'OWNER' }, deps.now());
        return c.json({ orgId, userId, role: 'OWNER' }, 201);
      })
      // Stands in for the buyer approving on PayPal's page, which a demo has no one to do.
      .post('/demo/mandates/:id/approve', can('mandates:write'), async (c) => {
        const { orgId, userId } = requirePrincipal(c);
        await hooks().approveMandate(orgId, c.req.param('id'), userId ?? '');
        return c.json({ approved: true });
      })
      // Moves money at PayPal outside the gateway. The Verifier should notice, freeze and refund.
      .post('/demo/rogue-capture', can('mandates:write'), async (c) =>
        c.json(await hooks().rogueCapture(requirePrincipal(c).orgId)),
      )
      .get('/missions/:id/schedule', can('missions:read'), async (c) =>
        c.json(await hooks().schedule(requirePrincipal(c).orgId, c.req.param('id'))),
      )
      .post('/missions/:id/replan', can('actions:propose'), async (c) => {
        const input = await readBody(
          c,
          z.strictObject({
            days: z.int().min(1).max(30).default(4),
            apply: z.boolean().default(false),
          }),
        );
        return c.json(await hooks().replan(requirePrincipal(c).orgId, c.req.param('id'), input));
      })
      // The Policy Lab: adversarial spending scenarios against the real pipeline, and shrinking one that breaks it.
      .post('/demo/lab/run', can('audit:read'), async (c) =>
        c.json(
          await hooks().labRun(
            await readBody(
              c,
              z.strictObject({ policy: labPolicy, count: z.int().min(8).max(48).default(24) }),
            ),
          ),
        ),
      )
      .post('/demo/lab/fix', can('audit:read'), async (c) =>
        c.json(
          await hooks().labFix(
            await readBody(c, z.strictObject({ policy: labPolicy, scenario: labScenario })),
          ),
        ),
      )
      // Attacks a naive agent and the guarded one with the same payloads.
      .post('/demo/gauntlet', can('missions:read'), async (c) => c.json(await hooks().gauntlet()))
      // Runs the agents on a mission (plan, research, one cart) and returns what they did.
      .post('/missions/:id/run', can('actions:propose'), async (c) =>
        c.json(await hooks().runAgents(requirePrincipal(c).orgId, c.req.param('id'))),
      )
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
      })
  );
}
