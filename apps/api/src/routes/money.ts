import type { Actor, Core } from '@bursar/core';
import {
  actions,
  approvals,
  carts,
  type Db,
  decisions,
  mandates,
  missions,
  offers,
  suppliers,
} from '@bursar/db';
import { amountSchema, idSchemas } from '@bursar/schemas';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { can, requirePrincipal } from '../auth';
import type { AppEnv } from '../types';
import { asTenant, readBody } from './support';

const actorOf = (c: Parameters<typeof requirePrincipal>[0]): Actor => {
  const principal = requirePrincipal(c);
  return principal.kind === 'agent'
    ? { kind: 'AGENT', id: principal.agentId }
    : { kind: 'USER', id: principal.userId };
};

// Bodies are strict: a field that is not listed is an error, so nobody can slip an amount or a payee in.
const mandateBody = z.strictObject({
  payerName: z.string().min(1).max(80),
  cap: amountSchema,
  perMissionCap: amountSchema,
  validFrom: z.coerce.date(),
  validTo: z.coerce.date(),
  returnUrl: z.url(),
  cancelUrl: z.url(),
});
const supplierBody = z.strictObject({ name: z.string().min(1).max(100), payoutEmail: z.email() });
const offerBody = z.strictObject({
  supplierId: idSchemas.supplier,
  title: z.string().min(1).max(300),
  category: z.string().min(1).max(100),
  url: z.url(),
  price: amountSchema,
  availability: z.enum(['IN_STOCK', 'LIMITED', 'OUT_OF_STOCK', 'UNKNOWN']).optional(),
});
const missionBody = z.strictObject({
  goal: z.string().min(1).max(1000),
  budget: amountSchema,
  deadline: z.coerce.date().optional(),
  mandateId: idSchemas.mandate,
});
/** A cart line names an offer and a quantity. Prices and totals are the server's to work out. */
const cartBody = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        offerId: idSchemas.offer,
        quantity: z.int().min(1).max(99),
        rationale: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(50),
});
const actionBody = z.strictObject({
  type: z.enum(['AUTHORIZE', 'CAPTURE', 'VOID', 'REFUND']),
  missionId: idSchemas.mission,
  cartId: idSchemas.cart,
  refundAmount: amountSchema.optional(),
  ordinal: z.int().min(1).max(100).optional(),
});
const reason = z.strictObject({
  reason: z.string().min(1).max(300).default('Requested by an owner'),
});

export function moneyRoutes(db: Db, core: Core) {
  /** An approved action is carried out at once. In production a worker would pick it up; the result is the same. */
  const run = async (
    orgId: Parameters<Core['actions']['execute']>[0],
    proposal: { actionId: string; state: string },
  ) => (proposal.state === 'APPROVED' ? core.actions.execute(orgId, proposal.actionId) : undefined);

  return new Hono<AppEnv>()
    .get('/mandates', can('workspace:read'), async (c) => {
      const rows = await asTenant(db, c, (tx) =>
        tx
          .select({
            id: mandates.id,
            status: mandates.status,
            currency: mandates.currency,
            capMinor: mandates.capMinor,
            perMissionCapMinor: mandates.perMissionCapMinor,
            validFrom: mandates.validFrom,
            validTo: mandates.validTo,
            signedAt: mandates.signedAt,
          })
          .from(mandates),
      );
      return c.json({
        items: rows.map((r) => ({
          ...r,
          capMinor: String(r.capMinor),
          perMissionCapMinor: String(r.perMissionCapMinor),
        })),
      });
    })
    .post('/mandates', can('mandates:write'), async (c) => {
      const input = await readBody(c, mandateBody);
      return c.json(await core.mandates.start(requirePrincipal(c).orgId, actorOf(c), input), 201);
    })
    .post('/mandates/:id/complete', can('mandates:write'), async (c) =>
      c.json(
        await core.mandates.complete(
          requirePrincipal(c).orgId,
          actorOf(c),
          idSchemas.mandate.parse(c.req.param('id')),
        ),
      ),
    )
    .post('/mandates/:id/freeze', can('mandates:write'), async (c) => {
      const { reason: why } = await readBody(c, reason);
      return c.json(
        await core.mandates.change(
          requirePrincipal(c).orgId,
          actorOf(c),
          idSchemas.mandate.parse(c.req.param('id')),
          'FROZEN',
          why,
        ),
      );
    })
    .post('/mandates/:id/unfreeze', can('mandates:write'), async (c) => {
      const { reason: why } = await readBody(c, reason);
      return c.json(
        await core.mandates.change(
          requirePrincipal(c).orgId,
          actorOf(c),
          idSchemas.mandate.parse(c.req.param('id')),
          'ACTIVE',
          why,
        ),
      );
    })
    .post('/mandates/:id/revoke', can('mandates:write'), async (c) => {
      const { reason: why } = await readBody(c, reason);
      return c.json(
        await core.mandates.change(
          requirePrincipal(c).orgId,
          actorOf(c),
          idSchemas.mandate.parse(c.req.param('id')),
          'REVOKED',
          why,
        ),
      );
    })
    .post('/suppliers', can('missions:write'), async (c) =>
      c.json(
        await core.catalog.createSupplier(
          requirePrincipal(c).orgId,
          actorOf(c),
          await readBody(c, supplierBody),
        ),
        201,
      ),
    )
    .get('/suppliers', can('missions:read'), async (c) =>
      c.json({ items: await asTenant(db, c, (tx) => tx.select().from(suppliers)) }),
    )
    .post('/offers', can('missions:write'), async (c) => {
      const offer = await core.catalog.recordOffer(
        requirePrincipal(c).orgId,
        await readBody(c, offerBody),
      );
      return c.json(offer && { ...offer, priceMinor: String(offer.priceMinor) }, 201);
    })
    .get('/offers', can('missions:read'), async (c) =>
      c.json({
        items: (await asTenant(db, c, (tx) => tx.select().from(offers))).map((o) => ({
          ...o,
          priceMinor: String(o.priceMinor),
        })),
      }),
    )
    .post('/missions', can('missions:write'), async (c) =>
      c.json(
        await core.catalog
          .createMission(requirePrincipal(c).orgId, actorOf(c), await readBody(c, missionBody))
          .then((m) => m && { ...m, budgetMinor: String(m.budgetMinor) }),
        201,
      ),
    )
    .get('/missions', can('missions:read'), async (c) =>
      c.json({
        items: (await asTenant(db, c, (tx) => tx.select().from(missions))).map((m) => ({
          ...m,
          budgetMinor: String(m.budgetMinor),
        })),
      }),
    )
    .post('/missions/:id/carts', can('actions:propose'), async (c) => {
      const { lines } = await readBody(c, cartBody);
      return c.json(
        await core.catalog.buildCart(
          requirePrincipal(c).orgId,
          actorOf(c),
          idSchemas.mission.parse(c.req.param('id')),
          lines,
        ),
        201,
      );
    })
    .get('/carts/:id', can('missions:read'), async (c) => {
      const [cart] = await asTenant(db, c, (tx) =>
        tx
          .select()
          .from(carts)
          .where(eq(carts.id, idSchemas.cart.parse(c.req.param('id')))),
      );
      return cart === undefined
        ? c.json({ code: 'NOT_FOUND' }, 404)
        : c.json({ ...cart, totalMinor: String(cart.totalMinor) });
    })
    .post('/actions', can('actions:propose'), async (c) => {
      const { orgId } = requirePrincipal(c);
      const proposal = await core.actions.propose(orgId, actorOf(c), await readBody(c, actionBody));
      return c.json({ proposal, execution: await run(orgId, proposal) }, 201);
    })
    .get('/actions', can('missions:read'), async (c) => {
      const rows = await asTenant(db, c, (tx) =>
        tx.select().from(actions).orderBy(desc(actions.createdAt)).limit(100),
      );
      return c.json({
        items: rows.map((a) => ({
          id: a.id,
          type: a.type,
          state: a.state,
          amountMinor: a.amountMinor === null ? null : String(a.amountMinor),
          currency: a.currency,
          proposedBy: a.proposedBy,
          createdAt: a.createdAt,
        })),
      });
    })
    .post('/actions/:id/execute', can('actions:propose'), async (c) =>
      c.json(
        await core.actions.execute(
          requirePrincipal(c).orgId,
          idSchemas.action.parse(c.req.param('id')),
        ),
      ),
    )
    .get('/approvals', can('approvals:decide'), async (c) => {
      const rows = await asTenant(db, c, (tx) =>
        tx
          .select({ approval: approvals, action: actions })
          .from(approvals)
          .innerJoin(decisions, eq(decisions.id, approvals.decisionId))
          .innerJoin(actions, eq(actions.id, decisions.actionId))
          .where(eq(approvals.status, 'PENDING'))
          .orderBy(desc(approvals.expiresAt)),
      );
      return c.json({
        items: rows.map(({ approval, action }) => ({
          id: approval.id,
          status: approval.status,
          expiresAt: approval.expiresAt,
          decisionId: approval.decisionId,
          actionId: action.id,
          type: action.type,
          amountMinor: action.amountMinor === null ? null : String(action.amountMinor),
          currency: action.currency,
          proposedBy: action.proposedBy,
          missionId: action.missionId,
          createdAt: action.createdAt,
        })),
      });
    })
    .post('/approvals/:id/decide', can('approvals:decide'), async (c) => {
      const { orgId } = requirePrincipal(c);
      const { decision } = await readBody(
        c,
        z.strictObject({ decision: z.enum(['APPROVE', 'REJECT']) }),
      );
      const result = await core.actions.decide(orgId, actorOf(c), c.req.param('id'), decision);
      return c.json({
        ...result,
        execution: await run(orgId, { actionId: result.actionId, state: result.state }),
      });
    });
}
