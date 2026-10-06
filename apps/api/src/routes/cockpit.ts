import { actions, type Db, decisions, envelopes, incidents } from '@bursar/db';
import { type CurrencyCode, Money } from '@bursar/money';
import type { Cockpit } from '@bursar/schemas';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { can } from '../auth';
import type { AppEnv } from '../types';
import { asTenant } from './support';

const DECISIONS = 100;
const WAITING = new Set(['SUBMITTING', 'SUBMITTED', 'UNKNOWN']);

/** A whole percent, rounded down and capped, for drawing a gauge. It is never read as an amount. */
const percentOf = (part: Money, whole: Money): number =>
  whole.isZero()
    ? 0
    : Math.min(100, Math.floor((Number(part.toJSON().minor) * 100) / Number(whole.toJSON().minor)));

/** The relative width of a band in the money-flow diagram. Geometry only, at least 1. */
const weightOf = (amount: Money): number =>
  Math.max(1, Math.min(Number(amount.toJSON().minor), 2 ** 31));

type TraceEntry = { rule: string; outcome: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY'; message: string };

/**
 * The cockpit's data: envelopes, rulings, which rules fired, where the money went, and whether PayPal's
 * record explains it. Every sum is worked out here, so the web app draws figures and adds nothing up.
 */
export function cockpitRoutes(db: Db) {
  return new Hono<AppEnv>().get('/cockpit', can('audit:read'), async (c) => {
    const data = await asTenant(db, c, async (tx) => ({
      envelopes: await tx.select().from(envelopes).orderBy(desc(envelopes.createdAt)).limit(200),
      decisions: await tx
        .select({
          id: decisions.id,
          actionId: decisions.actionId,
          outcome: decisions.outcome,
          requiredApprovals: decisions.requiredApprovals,
          trace: decisions.trace,
          evaluatedAt: decisions.evaluatedAt,
          type: actions.type,
          state: actions.state,
          currency: actions.currency,
          amountMinor: actions.amountMinor,
        })
        .from(decisions)
        .innerJoin(actions, eq(actions.id, decisions.actionId))
        .orderBy(desc(decisions.evaluatedAt))
        .limit(DECISIONS),
      states: await tx.select({ state: actions.state }).from(actions),
      incidents: await tx.select().from(incidents).orderBy(desc(incidents.openedAt)).limit(100),
    }));

    const currency = (data.envelopes[0]?.currency ?? 'USD') as CurrencyCode;
    const money = (minor: bigint, code = currency) => Money.of(minor, code);
    const sum = (pick: (e: (typeof data.envelopes)[number]) => bigint) =>
      Money.sum(
        data.envelopes.filter((e) => e.currency === currency).map((e) => money(pick(e))),
        currency,
      );

    const hits = new Map<string, number>();
    const rulings = data.decisions.map((d) => {
      const rules = (
        d.trace as Array<{ rule: string; outcome: TraceEntry['outcome']; message: string }>
      ).map(({ rule, outcome, message }) => ({ rule, outcome, message }));
      for (const r of rules)
        hits.set(`${r.rule}|${r.outcome}`, (hits.get(`${r.rule}|${r.outcome}`) ?? 0) + 1);
      return {
        id: d.id,
        actionId: d.actionId,
        type: d.type,
        state: d.state,
        outcome: d.outcome,
        requiredApprovals: d.requiredApprovals,
        amount:
          d.amountMinor === null || d.currency === null
            ? null
            : money(d.amountMinor, d.currency as CurrencyCode).toJSON(),
        evaluatedAt: d.evaluatedAt.toISOString(),
        rules,
      };
    });

    const flowOf = (from: string, to: string, amount: Money) =>
      amount.isPositive() ? [{ from, to, amount: amount.toJSON(), weight: weightOf(amount) }] : [];
    const held = sum((e) => e.heldMinor);
    const captured = sum((e) => e.capturedMinor);
    const refunded = sum((e) => e.refundedMinor);
    const settled = sum((e) => e.settledMinor);

    const snapshot: Cockpit = {
      generatedAt: new Date().toISOString(),
      envelopes: data.envelopes.map((e) => {
        const ceiling = money(e.ceilingMinor, e.currency as CurrencyCode);
        const used = money(e.heldMinor, e.currency as CurrencyCode).add(
          money(e.capturedMinor, e.currency as CurrencyCode),
        );
        return {
          missionId: e.missionId,
          status: e.status as Cockpit['envelopes'][number]['status'],
          ceiling: ceiling.toJSON(),
          held: money(e.heldMinor, e.currency as CurrencyCode).toJSON(),
          captured: money(e.capturedMinor, e.currency as CurrencyCode).toJSON(),
          refunded: money(e.refundedMinor, e.currency as CurrencyCode).toJSON(),
          settled: money(e.settledMinor, e.currency as CurrencyCode).toJSON(),
          usedPercent: percentOf(used, ceiling),
        };
      }),
      decisions: rulings as Cockpit['decisions'],
      ruleHits: [...hits].map(([key, count]) => {
        const [rule = '', outcome = 'ALLOW'] = key.split('|');
        return { rule, outcome: outcome as TraceEntry['outcome'], count };
      }),
      flows: [
        ...flowOf('Mandate', 'Held', held),
        ...flowOf('Mandate', 'Captured', captured),
        ...flowOf('Captured', 'Refunded', refunded),
        ...flowOf('Captured', 'Settled', settled),
      ],
      verification: {
        confirmed: data.states.filter((s) => s.state === 'CONFIRMED').length,
        waiting: data.states.filter((s) => WAITING.has(s.state)).length,
        unexplained: data.incidents.filter((i) => i.status !== 'RESOLVED').length,
      },
      incidents: data.incidents.map((i) => ({
        id: i.id,
        type: i.type,
        severity: i.severity,
        status: i.status,
        openedAt: i.openedAt.toISOString(),
      })) as Cockpit['incidents'],
    };
    return c.json(snapshot);
  });
}
