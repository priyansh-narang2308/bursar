import { actionIdFromTag } from '@bursar/crypto';
import { actions, executions } from '@bursar/db';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { openIncident } from './incidents';
import type { CoreDeps } from './types';
import { amountJson } from './util';

const HOUR = 3_600_000;
const MONEY_CODES = new Set(['T0006', 'T1107']); // a capture, a refund

export interface Gap {
  readonly kind: 'unknown-to-bursar' | 'unknown-to-paypal';
  readonly id: string;
  readonly detail: string;
}

/**
 * The nightly sweep. It asks PayPal's Transaction Search what moved in a window (24 hours, ending a few
 * hours ago because PayPal's reporting lags) and compares it with what Bursar recorded, both ways: money PayPal
 * moved that Bursar has no record of, and money Bursar recorded that PayPal does not know. Each gap that can
 * be tied to an organisation becomes an incident.
 */
export async function reconcile(
  deps: CoreDeps,
  options: { windowHours?: number; lagHours?: number } = {},
) {
  const end = new Date(deps.now().getTime() - (options.lagHours ?? 3) * HOUR);
  const start = new Date(end.getTime() - (options.windowHours ?? 24) * HOUR);
  const transactions = (await deps.paypal.transactions.search({ start, end })).filter((t) =>
    MONEY_CODES.has(t.code),
  );
  const known = new Map(
    (await deps.db.select().from(executions).where(eq(executions.status, 'SUCCEEDED'))).map((e) => [
      e.paypalResourceId,
      e,
    ]),
  );
  const gaps: Gap[] = [];

  for (const tx of transactions.filter((t) => !known.has(t.id))) {
    gaps.push({
      kind: 'unknown-to-bursar',
      id: tx.id,
      detail: `${tx.code} for ${tx.amount.toDecimal()} ${tx.amount.currency}`,
    });
    const tagged = tx.customId === undefined ? undefined : actionIdFromTag(tx.customId);
    const [origin] =
      tagged === undefined
        ? []
        : await deps.db.select().from(actions).where(eq(actions.id, tagged));
    if (origin !== undefined) {
      await deps.db.transaction((dbTx) =>
        openIncident(dbTx, deps, origin.orgId, 'RECONCILIATION_GAP', 'HIGH', {
          actionId: origin.id,
          why: 'PayPal moved money that Bursar has no record of.',
          transactionId: tx.id,
          amount: amountJson(tx.amount.minor, tx.amount.currency),
        }),
      );
    }
  }

  const seen = new Set(transactions.map((t) => t.id));
  const recorded = await deps.db
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.state, 'CONFIRMED'),
        inArray(actions.type, ['CAPTURE', 'REFUND']),
        gte(actions.updatedAt, start),
        lte(actions.updatedAt, end),
      ),
    );
  for (const action of recorded) {
    const [execution] = await deps.db
      .select()
      .from(executions)
      .where(and(eq(executions.actionId, action.id), eq(executions.status, 'SUCCEEDED')));
    if (execution?.paypalResourceId != null && !seen.has(execution.paypalResourceId)) {
      gaps.push({
        kind: 'unknown-to-paypal',
        id: execution.paypalResourceId,
        detail: `${action.type} ${action.id} is confirmed here but not in PayPal's report`,
      });
      await deps.db.transaction((dbTx) =>
        openIncident(dbTx, deps, action.orgId, 'RECONCILIATION_GAP', 'MEDIUM', {
          actionId: action.id,
          why: 'Bursar recorded money that PayPal does not report.',
          transactionId: execution.paypalResourceId,
        }),
      );
    }
  }
  return {
    window: { start: start.toISOString(), end: end.toISOString() },
    checked: transactions.length,
    gaps,
  };
}
