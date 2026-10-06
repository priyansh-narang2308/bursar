import { decryptSecret, encryptSecret } from '@bursar/crypto';
import { incidents, mandates, payers, policySets, type Tx, withOrg } from '@bursar/db';
import { moneyFromJSON } from '@bursar/money';
import {
  type AmountJSON,
  type MandateId,
  type MandateStatus,
  mandateStatusSchema,
  newId,
  type OrganizationId,
} from '@bursar/schemas';
import { eq, inArray } from 'drizzle-orm';
import { emit, record } from './audit';
import { type Actor, type CoreDeps, CoreError } from './types';
import { requestIdFor } from './util';

/** Where a mandate may go. FROZEN is reversible; REVOKED and EXPIRED are not. */
export const MANDATE_TRANSITIONS: Readonly<Record<MandateStatus, readonly MandateStatus[]>> = {
  PENDING: ['ACTIVE', 'REVOKED'],
  ACTIVE: ['FROZEN', 'REVOKED', 'EXPIRED'],
  FROZEN: ['ACTIVE', 'REVOKED'],
  REVOKED: [],
  EXPIRED: [],
};

export interface StartMandateInput {
  readonly payerName: string;
  readonly cap: AmountJSON;
  readonly perMissionCap: AmountJSON;
  readonly validFrom: Date;
  readonly validTo: Date;
  readonly returnUrl: string;
  readonly cancelUrl: string;
}

/**
 * Begins a mandate: the payer's permission for Bursar to spend. It makes the payer, a policy set and a
 * PENDING mandate, and asks PayPal for a Vault setup token; the payer approves at `approveUrl`.
 */
export async function startMandate(
  deps: CoreDeps,
  orgId: OrganizationId,
  actor: Actor,
  input: StartMandateInput,
) {
  const [cap, perMission] = [moneyFromJSON(input.cap), moneyFromJSON(input.perMissionCap)];
  const mandateId = newId('mandate');
  return withOrg(deps.db, orgId, async (tx) => {
    const [payer] = await tx
      .insert(payers)
      .values({
        id: newId('payer'),
        orgId,
        paypalPayerId: `pending-${mandateId}`,
        displayName: input.payerName,
      })
      .returning();
    const [policySet] = await tx
      .insert(policySets)
      .values({ id: newId('policySet'), orgId, name: 'Default policy' })
      .returning();
    if (payer === undefined || policySet === undefined) throw new Error('insert returned nothing');
    const setup = await deps.paypal.vault.createSetupToken({
      requestId: requestIdFor(mandateId, 'setup'),
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
    });
    await tx.insert(mandates).values({
      id: mandateId,
      orgId,
      payerId: payer.id,
      policySetId: policySet.id,
      currency: cap.currency,
      capMinor: cap.minor,
      perMissionCapMinor: perMission.minor,
      validFrom: input.validFrom,
      validTo: input.validTo,
      setupTokenId: setup.id,
    });
    await record(tx, orgId, actor, 'mandate.started', { mandateId }, deps.now());
    return { mandateId, setupTokenId: setup.id, approveUrl: setup.approveUrl };
  });
}

async function load(tx: Tx, mandateId: MandateId) {
  const [mandate] = await tx.select().from(mandates).where(eq(mandates.id, mandateId));
  if (mandate === undefined) throw new CoreError('NOT_FOUND', 'No such mandate.');
  return mandate;
}

/** A mandate frozen by an incident stays frozen until an owner has resolved the incident. */
async function assertNoOpenIncident(tx: Tx): Promise<void> {
  const open = await tx
    .select()
    .from(incidents)
    .where(inArray(incidents.status, ['OPEN', 'CONTAINED']));
  if (open.length > 0)
    throw new CoreError('CONFLICT', 'There is an open incident. Resolve it before unfreezing.');
}

function assertMove(from: MandateStatus, to: MandateStatus): void {
  if (!MANDATE_TRANSITIONS[from].includes(to)) {
    throw new CoreError('ILLEGAL_STATE_TRANSITION', `A mandate cannot go from ${from} to ${to}.`);
  }
}

/**
 * After the payer has approved at PayPal: turns the setup token into a payment token, seals its id (bound
 * to this mandate) and makes the mandate ACTIVE.
 */
export async function completeMandate(
  deps: CoreDeps,
  orgId: OrganizationId,
  actor: Actor,
  mandateId: MandateId,
) {
  return withOrg(deps.db, orgId, async (tx) => {
    const mandate = await load(tx, mandateId);
    assertMove(mandateStatusSchema.parse(mandate.status), 'ACTIVE');
    if (mandate.setupTokenId === null)
      throw new CoreError('MANDATE_INACTIVE', 'This mandate has no setup in progress.');
    const token = await deps.paypal.vault.createPaymentToken({
      requestId: requestIdFor(mandateId, 'token'),
      setupTokenId: mandate.setupTokenId,
    });
    const sealed = encryptSecret(deps.vaultKeys, token.id, `mandate:${mandateId}`);
    await tx
      .update(mandates)
      .set({ status: 'ACTIVE', signedAt: deps.now(), vaultTokenSealed: sealed, setupTokenId: null })
      .where(eq(mandates.id, mandateId));
    await record(tx, orgId, actor, 'mandate.activated', { mandateId }, deps.now());
    await emit(tx, orgId, 'mandate.activated', { mandateId });
    return { mandateId, status: 'ACTIVE' as const };
  });
}

/** The PayPal Vault token id, opened. Only the executor needs it. */
export function openVaultToken(deps: CoreDeps, mandateId: MandateId, sealed: string): string {
  return decryptSecret(deps.vaultKeys, sealed, `mandate:${mandateId}`);
}

/**
 * Freezes, unfreezes or revokes. Revoking deletes the PayPal payment token, so PayPal itself will refuse to
 * charge it: it does not rely on Bursar remembering.
 */
export async function changeMandate(
  deps: CoreDeps,
  orgId: OrganizationId,
  actor: Actor,
  mandateId: MandateId,
  to: 'ACTIVE' | 'FROZEN' | 'REVOKED',
  reason: string,
) {
  return withOrg(deps.db, orgId, async (tx) => {
    const mandate = await load(tx, mandateId);
    assertMove(mandateStatusSchema.parse(mandate.status), to);
    if (to === 'ACTIVE') await assertNoOpenIncident(tx);
    if (to === 'REVOKED' && mandate.vaultTokenSealed !== null) {
      await deps.paypal.vault.deletePaymentToken(
        openVaultToken(deps, mandateId, mandate.vaultTokenSealed),
      );
    }
    await tx
      .update(mandates)
      .set({
        status: to,
        ...(to === 'REVOKED' ? { revokedAt: deps.now(), vaultTokenSealed: null } : {}),
      })
      .where(eq(mandates.id, mandateId));
    await record(
      tx,
      orgId,
      actor,
      `mandate.${to.toLowerCase()}`,
      { mandateId, reason },
      deps.now(),
    );
    await emit(tx, orgId, `mandate.${to.toLowerCase()}`, { mandateId });
    return { mandateId, status: to };
  });
}

/** Marks active mandates past their window as EXPIRED. System work; run it on a schedule. */
export async function expireMandates(deps: CoreDeps, orgId: OrganizationId): Promise<number> {
  return withOrg(deps.db, orgId, async (tx) => {
    const now = deps.now();
    const rows = await tx.select().from(mandates).where(eq(mandates.status, 'ACTIVE'));
    const stale = rows.filter((m) => m.validTo <= now);
    for (const m of stale) {
      await tx.update(mandates).set({ status: 'EXPIRED' }).where(eq(mandates.id, m.id));
      await record(
        tx,
        orgId,
        { kind: 'SYSTEM', id: null },
        'mandate.expired',
        { mandateId: m.id },
        now,
      );
    }
    return stale.length;
  });
}
