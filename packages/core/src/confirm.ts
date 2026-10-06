import { envelopes, ledgerEntries, type Tx } from '@bursar/db';
import { type Entry, post } from '@bursar/ledger';
import type { CurrencyCode } from '@bursar/money';
import type { OrganizationId } from '@bursar/schemas';
import { eq } from 'drizzle-orm';
import type { ActionRow } from './context';
import { lockEnvelope, setState } from './pipeline';
import { type Actor, type CoreDeps, CoreError } from './types';
import { money } from './util';

export type ConfirmedBy = 'response' | 'webhook' | 'poll';

/** What a confirmed action does to the envelope's figures. */
async function applyToEnvelope(tx: Tx, action: ActionRow, amount: bigint): Promise<void> {
  if (action.missionId === null) return;
  const envelope = await lockEnvelope(tx, action.missionId);
  if (envelope === undefined) throw new CoreError('NOT_FOUND', 'No envelope for this mission.');
  const change = {
    AUTHORIZE: { status: 'ACTIVE' },
    VOID: { status: 'VOIDED', heldMinor: envelope.heldMinor - amount },
    CAPTURE: {
      heldMinor: envelope.heldMinor - amount,
      capturedMinor: envelope.capturedMinor + amount,
    },
    REFUND: { refundedMinor: envelope.refundedMinor + amount },
    PAYOUT: { settledMinor: envelope.settledMinor + amount },
  }[action.type];
  if (change !== undefined)
    await tx.update(envelopes).set(change).where(eq(envelopes.id, envelope.id));
}

/**
 * The money has moved (or the hold is in place), as PayPal itself says: moves the action to CONFIRMED,
 * updates the envelope, and posts the ledger entries. Doing it twice does nothing, which is what makes a
 * duplicate webhook harmless. Returns whether this call did the work.
 */
export async function confirm(
  tx: Tx,
  deps: CoreDeps,
  orgId: OrganizationId,
  action: ActionRow,
  by: ConfirmedBy,
): Promise<boolean> {
  if (action.state === 'CONFIRMED') return false;
  const system: Actor = { kind: 'SYSTEM', id: null };
  if (action.state === 'SUBMITTING' || action.state === 'UNKNOWN')
    await setState(tx, deps, orgId, action, 'SUBMITTED', system);
  await setState(tx, deps, orgId, action, 'CONFIRMED', system, { by });
  if (action.amountMinor === null || action.currency === null) return true;
  await applyToEnvelope(tx, action, action.amountMinor);
  const amount = money(action.amountMinor, action.currency);
  const type = action.type as 'AUTHORIZE' | 'VOID' | 'CAPTURE' | 'REFUND' | 'PAYOUT';
  const entries: Entry[] = post(
    type === 'CAPTURE' ? { type, amount, fee: money(0n, action.currency) } : { type, amount },
  );
  const txnId = crypto.randomUUID();
  await tx.insert(ledgerEntries).values(
    entries.map((e) => ({
      orgId,
      txnId,
      actionId: action.id,
      account: e.account,
      side: e.side,
      currency: action.currency as CurrencyCode,
      amountMinor: e.amount.minor,
    })),
  );
  return true;
}
