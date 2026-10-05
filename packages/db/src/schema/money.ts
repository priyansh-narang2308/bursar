import { CURRENCY_CODES } from '@bursar/money';
import {
  ACTION_STATES,
  ACTION_TYPES,
  ACTOR_KINDS,
  APPROVAL_STATUSES,
  AUDIT_EVENT_TYPE_PATTERN,
  DECISION_PHASES,
  ENVELOPE_STATUSES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  MATCH_STATUSES,
  POLICY_OUTCOMES,
  VERIFICATION_STATUSES,
} from '@bursar/schemas';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idCol, idShape, isSha256, list, minor, oneOf, timestamptz } from './columns';
import {
  carts,
  mandates,
  missions,
  organizations,
  orgId,
  policyVersions,
  suppliers,
  users,
} from './core';

const MONEY_REQUIRED = ['AUTHORIZE', 'CAPTURE', 'REFUND', 'PAYOUT'];
const NO_MONEY = ['FREEZE', 'REVOKE'];
/** The Verifier only ever protects: it can freeze, void, refund and revoke, and can never spend. */
const VERIFIER_MAY_RAISE = ['FREEZE', 'VOID', 'REFUND', 'REVOKE'];

// ---------------------------------------------------------------------------------------
// Actions: what Bursar does with money, and the rules the database holds it to
// ---------------------------------------------------------------------------------------

export const actions = pgTable(
  'actions',
  {
    id: idCol('action').primaryKey(),
    orgId: orgId(),
    missionId: idCol('mission').references(() => missions.id),
    mandateId: idCol('mandate').references(() => mandates.id),
    type: text().notNull(),
    currency: text(),
    amountMinor: minor(),
    supplierId: idCol('supplier').references(() => suppliers.id),
    cartId: idCol('cart').references(() => carts.id),
    cartHash: text(),
    proposedBy: text().notNull(),
    /** Who proposed it: the person or agent. A maker is never their own checker. */
    proposerId: text(),
    /** Unique, so a retry finds the action it already made instead of making another. */
    idempotencyKey: text().notNull().unique('actions_idempotency_key_unique'),
    state: text().notNull().default('PROPOSED'),
    compensatesActionId: idCol('action').references((): AnyPgColumn => actions.id),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    check('actions_id_shape', idShape(t.id, 'action')),
    check('actions_type', oneOf(t.type, ACTION_TYPES)),
    check('actions_state', oneOf(t.state, ACTION_STATES)),
    check('actions_proposed_by', oneOf(t.proposedBy, ACTOR_KINDS)),
    check('actions_key', isSha256(t.idempotencyKey)),
    check('actions_amount', sql`(${t.amountMinor} is null) = (${t.currency} is null)`),
    check(
      'actions_currency',
      sql`${t.currency} is null or ${t.currency} in (${list(CURRENCY_CODES)})`,
    ),
    check('actions_non_negative', sql`${t.amountMinor} is null or ${t.amountMinor} >= 0`),
    check(
      'actions_moves_money',
      sql`${t.type} not in (${list(MONEY_REQUIRED)}) or ${t.amountMinor} is not null`,
    ),
    check(
      'actions_moves_none',
      sql`${t.type} not in (${list(NO_MONEY)}) or ${t.amountMinor} is null`,
    ),
    check('actions_payout_supplier', sql`(${t.type} = 'PAYOUT') = (${t.supplierId} is not null)`),
    check('actions_cart_hash', sql`(${t.cartId} is null) = (${t.cartHash} is null)`),
    check(
      'actions_mandate',
      sql`${t.type} not in (${list(NO_MONEY)}) or ${t.mandateId} is not null`,
    ),
    check(
      'actions_undoes',
      sql`${t.compensatesActionId} is null or ${t.type} in ('VOID', 'REFUND')`,
    ),
    check(
      'actions_verifier_never_spends',
      sql`${t.proposedBy} <> 'VERIFIER' or ${t.type} in (${list(VERIFIER_MAY_RAISE)})`,
    ),
    check('actions_times', sql`${t.updatedAt} >= ${t.createdAt}`),
  ],
);

/** The legal moves of `actions.state`, seeded from `ACTION_TRANSITIONS` and enforced by a trigger. */
export const actionTransitions = pgTable(
  'action_transitions',
  {
    fromState: text().notNull(),
    toState: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromState, t.toState] }),
    check('action_transitions_from', oneOf(t.fromState, ACTION_STATES)),
    check('action_transitions_to', oneOf(t.toState, ACTION_STATES)),
  ],
);

export const decisions = pgTable(
  'decisions',
  {
    id: idCol('decision').primaryKey(),
    orgId: orgId(),
    actionId: idCol('action')
      .notNull()
      .references(() => actions.id),
    policyVersionId: idCol('policyVersion')
      .notNull()
      .references(() => policyVersions.id),
    policyHash: text().notNull(),
    phase: text().notNull(),
    outcome: text().notNull(),
    requiredApprovals: integer().notNull(),
    trace: jsonb().notNull(),
    inputsHash: text().notNull(),
    evaluatedAt: timestamptz().notNull(),
  },
  (t) => [
    check('decisions_id_shape', idShape(t.id, 'decision')),
    check('decisions_phase', oneOf(t.phase, DECISION_PHASES)),
    check('decisions_outcome', oneOf(t.outcome, POLICY_OUTCOMES)),
    check('decisions_hashes', sql`${isSha256(t.policyHash)} and ${isSha256(t.inputsHash)}`),
    check(
      'decisions_approvals',
      sql`(${t.outcome} = 'REQUIRE_APPROVAL') = (${t.requiredApprovals} > 0) and ${t.requiredApprovals} <= 2`,
    ),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: idCol('approval').primaryKey(),
    orgId: orgId(),
    decisionId: idCol('decision')
      .notNull()
      .references(() => decisions.id),
    approverId: idCol('user').references(() => users.id),
    status: text().notNull().default('PENDING'),
    cartHash: text().notNull(),
    policyHash: text().notNull(),
    signature: text(),
    expiresAt: timestamptz().notNull(),
    decidedAt: timestamptz(),
  },
  (t) => [
    check('approvals_id_shape', idShape(t.id, 'approval')),
    check('approvals_status', oneOf(t.status, APPROVAL_STATUSES)),
    check('approvals_hashes', sql`${isSha256(t.cartHash)} and ${isSha256(t.policyHash)}`),
    check('approvals_signed', sql`(${t.status} = 'APPROVED') = (${t.signature} is not null)`),
    check(
      'approvals_decided',
      sql`(${t.status} in ('APPROVED', 'REJECTED')) = (${t.decidedAt} is not null)`,
    ),
    check('approvals_who', sql`${t.decidedAt} is null or ${t.approverId} is not null`),
  ],
);

// ---------------------------------------------------------------------------------------
// Envelopes: the PayPal authorization that caps a mission's spend
// ---------------------------------------------------------------------------------------

export const envelopes = pgTable(
  'envelopes',
  {
    id: idCol('envelope').primaryKey(),
    orgId: orgId(),
    missionId: idCol('mission')
      .notNull()
      .references(() => missions.id),
    mandateId: idCol('mandate')
      .notNull()
      .references(() => mandates.id),
    status: text().notNull().default('PENDING'),
    currency: text().notNull(),
    ceilingMinor: minor().notNull(),
    heldMinor: minor().notNull().default(sql`0`),
    capturedMinor: minor().notNull().default(sql`0`),
    refundedMinor: minor().notNull().default(sql`0`),
    settledMinor: minor().notNull().default(sql`0`),
    paypalAuthorizationId: text(),
    authorizationExpiresAt: timestamptz(),
    reauthorizedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [
    check('envelopes_id_shape', idShape(t.id, 'envelope')),
    check('envelopes_status', oneOf(t.status, ENVELOPE_STATUSES)),
    check('envelopes_currency', oneOf(t.currency, CURRENCY_CODES)),
    check(
      'envelopes_non_negative',
      sql`least(${t.ceilingMinor}, ${t.heldMinor}, ${t.capturedMinor}, ${t.refundedMinor}, ${t.settledMinor}) >= 0`,
    ),
    check(
      'envelopes_never_overspent',
      sql`${t.capturedMinor} + ${t.heldMinor} <= ${t.ceilingMinor}`,
    ),
  ],
);

/** One PayPal call made for an action. Claim, call, record: the row is the claim. */
export const executions = pgTable(
  'executions',
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: orgId(),
    actionId: idCol('action')
      .notNull()
      .references(() => actions.id),
    step: text().notNull(),
    requestId: text().notNull(),
    status: text().notNull().default('CLAIMED'),
    paypalResourceId: text(),
    debugId: text(),
    response: jsonb(),
    createdAt: createdAt(),
    finishedAt: timestamptz(),
  },
  (t) => [
    unique('executions_step_unique').on(t.actionId, t.step),
    check(
      'executions_status',
      oneOf(t.status, ['CLAIMED', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN']),
    ),
  ],
);

// ---------------------------------------------------------------------------------------
// PayPal's side: webhooks and the events they carry
// ---------------------------------------------------------------------------------------

/** The raw webhook, kept before anything is trusted. System-only: tenants have no access. */
export const webhookInbox = pgTable(
  'webhook_inbox',
  {
    id: uuid().primaryKey().defaultRandom(),
    eventId: text().notNull().unique('webhook_inbox_event_id_unique'),
    receivedAt: createdAt(),
    headers: jsonb().notNull(),
    rawBody: text().notNull(),
    verificationStatus: text().notNull().default('PENDING'),
    processedAt: timestamptz(),
  },
  (t) => [check('webhook_inbox_verification', oneOf(t.verificationStatus, VERIFICATION_STATUSES))],
);

/** A verified event. `orgId` stays null until it is matched to an action, so no tenant sees it early. */
export const paypalEvents = pgTable(
  'paypal_events',
  {
    id: idCol('paypalEvent').primaryKey(),
    orgId: idCol('organization').references(() => organizations.id),
    eventId: text().notNull().unique('paypal_events_event_id_unique'),
    eventType: text().notNull(),
    resourceType: text().notNull(),
    resourceId: text().notNull(),
    customId: text(),
    invoiceId: text(),
    verificationStatus: text().notNull().default('PENDING'),
    matchStatus: text().notNull().default('PENDING'),
    matchedActionId: idCol('action').references(() => actions.id),
    latencyMs: integer(),
    payload: jsonb().notNull(),
    receivedAt: createdAt(),
  },
  (t) => [
    check('paypal_events_id_shape', idShape(t.id, 'paypalEvent')),
    check('paypal_events_verification', oneOf(t.verificationStatus, VERIFICATION_STATUSES)),
    check('paypal_events_match', oneOf(t.matchStatus, MATCH_STATUSES)),
    index('paypal_events_resource').on(t.resourceId),
  ],
);

// ---------------------------------------------------------------------------------------
// Ledger, audit, incidents, outbox
// ---------------------------------------------------------------------------------------

/** Double entry. A transaction's debits must equal its credits, checked when it commits. */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    orgId: orgId(),
    txnId: uuid().notNull(),
    actionId: idCol('action').references(() => actions.id),
    account: text().notNull(),
    side: text().notNull(),
    currency: text().notNull(),
    amountMinor: minor().notNull(),
    postedAt: createdAt(),
  },
  (t) => [
    check('ledger_entries_side', oneOf(t.side, ['DEBIT', 'CREDIT'])),
    check('ledger_entries_currency', oneOf(t.currency, CURRENCY_CODES)),
    check('ledger_entries_positive', sql`${t.amountMinor} > 0`),
    index('ledger_entries_txn').on(t.txnId),
  ],
);

/**
 * One entry of an organisation's hash chain (`@bursar/audit`). `ts` is text because the hash covers
 * its exact spelling. Append-only by trigger, and `(org, prev_hash)` is unique so a chain cannot fork.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: idCol('auditEvent').primaryKey(),
    orgId: orgId(),
    seq: integer().notNull(),
    ts: text().notNull(),
    actorKind: text().notNull(),
    actorId: text(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    prevHash: text().notNull(),
    hash: text().notNull(),
  },
  (t) => [
    check('audit_events_id_shape', idShape(t.id, 'auditEvent')),
    check('audit_events_seq', sql`${t.seq} >= 1`),
    check('audit_events_ts', sql`${t.ts} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'`),
    check('audit_events_actor', oneOf(t.actorKind, ACTOR_KINDS)),
    check('audit_events_type', sql`${t.type} ~ ${sql.raw(`'${AUDIT_EVENT_TYPE_PATTERN.source}'`)}`),
    check(
      'audit_events_hashes',
      sql`${isSha256(t.prevHash)} and ${isSha256(t.hash)} and ${t.prevHash} <> ${t.hash}`,
    ),
    unique('audit_events_seq_unique').on(t.orgId, t.seq),
    unique('audit_events_no_fork').on(t.orgId, t.prevHash),
  ],
);

export const incidents = pgTable(
  'incidents',
  {
    id: idCol('incident').primaryKey(),
    orgId: orgId(),
    type: text().notNull(),
    severity: text().notNull(),
    status: text().notNull().default('OPEN'),
    openedAt: createdAt(),
    closedAt: timestamptz(),
    evidence: jsonb().notNull().default(sql`'{}'`),
    autoResponse: jsonb().notNull().default(sql`'[]'`),
    resolution: jsonb(),
  },
  (t) => [
    check('incidents_id_shape', idShape(t.id, 'incident')),
    check('incidents_type', oneOf(t.type, INCIDENT_TYPES)),
    check('incidents_severity', oneOf(t.severity, INCIDENT_SEVERITIES)),
    check('incidents_status', oneOf(t.status, INCIDENT_STATUSES)),
  ],
);

/** Written in the same transaction as the change it announces, then relayed to streams and workers. */
export const outbox = pgTable('outbox', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  orgId: orgId(),
  topic: text().notNull(),
  payload: jsonb().notNull(),
  createdAt: createdAt(),
  deliveredAt: timestamptz(),
});
