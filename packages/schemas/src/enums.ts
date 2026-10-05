import { z } from 'zod';

/*
 * Every closed vocabulary in Bursar. Each is a `const` tuple (for iteration and docs), a Zod enum
 * (for validation and JSON Schema) and a union type, so the three can never disagree.
 */

// ---------------------------------------------------------------------------------------
// Actions: what Bursar can do with money, and where each one is in its life
// ---------------------------------------------------------------------------------------

/**
 * What an action does. AUTHORIZE, CAPTURE and PAYOUT move money forward along the reversibility
 * ladder; VOID, REFUND and REAUTHORIZE adjust or undo it; FREEZE and REVOKE move no money at all.
 */
export const ACTION_TYPES = [
  'AUTHORIZE',
  'CAPTURE',
  'VOID',
  'REFUND',
  'REAUTHORIZE',
  'PAYOUT',
  'FREEZE',
  'REVOKE',
] as const;
export const actionTypeSchema = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof actionTypeSchema>;

/** Where an action is in its life. The legal moves between states are in `ACTION_TRANSITIONS`. */
export const ACTION_STATES = [
  'PROPOSED', // an agent or person asked; the policy engine has not ruled yet
  'DENIED', // the policy engine said no
  'AWAITING_APPROVAL', // the policy engine wants a human to look first
  'APPROVED', // allowed, or a human approved; not yet claimed by the executor
  'REJECTED', // a human said no
  'EXPIRED', // an approval was not given in time
  'SUBMITTING', // claimed by the executor, which is calling PayPal
  'SUBMITTED', // PayPal accepted it; waiting for the signed webhook that confirms it
  'FAILED', // PayPal refused it
  'UNKNOWN', // sent, but no answer: the outcome is not known
  'CONFIRMED', // a verified webhook matched the action
  'INCIDENT', // what PayPal says does not match what was approved, or never arrived
] as const;
export const actionStateSchema = z.enum(ACTION_STATES);
export type ActionState = z.infer<typeof actionStateSchema>;

/** Who or what raised an action. The Verifier raises its own, when it finds money it cannot explain. */
export const ACTOR_KINDS = ['USER', 'AGENT', 'VERIFIER', 'SYSTEM'] as const;
export const actorKindSchema = z.enum(ACTOR_KINDS);
export type ActorKind = z.infer<typeof actorKindSchema>;

/** The three rungs of the reversibility ladder: the further along, the harder to undo. */
export const REVERSIBILITY_RUNGS = ['HELD', 'CAPTURED', 'SETTLED'] as const;
export const reversibilityRungSchema = z.enum(REVERSIBILITY_RUNGS);
export type ReversibilityRung = z.infer<typeof reversibilityRungSchema>;

// ---------------------------------------------------------------------------------------
// Policy: how decisions are made
// ---------------------------------------------------------------------------------------

/** What the policy engine rules. When rules disagree the strictest wins: DENY, then approval, then ALLOW. */
export const POLICY_OUTCOMES = ['ALLOW', 'REQUIRE_APPROVAL', 'DENY'] as const;
export const policyOutcomeSchema = z.enum(POLICY_OUTCOMES);
export type PolicyOutcome = z.infer<typeof policyOutcomeSchema>;

/** Policy is evaluated twice: when an action is proposed, and again when the executor is about to act. */
export const DECISION_PHASES = ['PROPOSE', 'EXECUTE'] as const;
export const decisionPhaseSchema = z.enum(DECISION_PHASES);
export type DecisionPhase = z.infer<typeof decisionPhaseSchema>;

/** The rules in the policy catalog. Their behaviour lives in the policy package; their names are shared. */
export const RULE_IDS = [
  'R-MANDATE', // the mandate is active, unexpired and not frozen
  'R-ENVELOPE', // captured + held + proposed stays within the ceiling
  'R-ITEM-CAP', // a single line stays within its cap
  'R-ORDER-CAP', // a single order stays within its cap
  'R-CATEGORY', // category caps and shares
  'R-VENDOR', // the payee is on the allow-list and not the block-list
  'R-NEW-VENDOR', // a first-time vendor needs a human
  'R-QTY', // quantity is plausible for the need
  'R-PRICE-DRIFT', // the re-quoted price is close to the proposed one
  'R-DUPLICATE', // the same item from the same vendor is not bought twice in a window
  'R-VELOCITY', // rolling count and amount, aggregated by vendor and payee
  'R-DELIVERY', // the estimated arrival meets the deadline
  'R-DUAL', // above a threshold two different people must approve
  'R-REFUND-AUTH', // how large a refund an agent may make alone
  'R-PAYOUT-GATE', // a payout needs inspection, a cooling-off window and a matched capture
  'R-PROVENANCE', // the action traces to an agent run, and any approval is valid and unexpired
  'R-TENANT', // the resource belongs to the actor's organisation
] as const;
export const ruleIdSchema = z.enum(RULE_IDS);
export type RuleId = z.infer<typeof ruleIdSchema>;

/** How a human decision on an approval request stands. */
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'] as const;
export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

/** What a person may do, from the permissions model. AGENT and VERIFIER are machine roles. */
export const ROLES = ['OWNER', 'APPROVER', 'OPERATOR', 'AUDITOR', 'AGENT', 'VERIFIER'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

// ---------------------------------------------------------------------------------------
// Funding and work
// ---------------------------------------------------------------------------------------

/** A mandate is the payer's signed permission. FROZEN is reversible; REVOKED and EXPIRED are not. */
export const MANDATE_STATUSES = ['PENDING', 'ACTIVE', 'FROZEN', 'REVOKED', 'EXPIRED'] as const;
export const mandateStatusSchema = z.enum(MANDATE_STATUSES);
export type MandateStatus = z.infer<typeof mandateStatusSchema>;

/** An envelope is the PayPal authorization that caps a mission's spend. */
export const ENVELOPE_STATUSES = ['PENDING', 'ACTIVE', 'CLOSED', 'VOIDED', 'EXPIRED'] as const;
export const envelopeStatusSchema = z.enum(ENVELOPE_STATUSES);
export type EnvelopeStatus = z.infer<typeof envelopeStatusSchema>;

export const MISSION_STATUSES = [
  'DRAFT',
  'PLANNING',
  'AWAITING_APPROVAL',
  'ACTIVE',
  'PARTIALLY_COMPLETED', // some lines delivered, others not: not a failure
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;
export const missionStatusSchema = z.enum(MISSION_STATUSES);
export type MissionStatus = z.infer<typeof missionStatusSchema>;

export const CART_STATUSES = ['DRAFT', 'PROPOSED', 'APPROVED', 'SUPERSEDED', 'REJECTED'] as const;
export const cartStatusSchema = z.enum(CART_STATUSES);
export type CartStatus = z.infer<typeof cartStatusSchema>;

/** Whether an offer can be bought now, as Bursar normalises what the catalog reports. */
export const AVAILABILITIES = ['IN_STOCK', 'LIMITED', 'OUT_OF_STOCK', 'UNKNOWN'] as const;
export const availabilitySchema = z.enum(AVAILABILITIES);
export type Availability = z.infer<typeof availabilitySchema>;

/** Where an offer's price was read: a search result can be stale, so decisions use a DETAIL re-quote. */
export const OFFER_SOURCES = ['SEARCH', 'DETAIL'] as const;
export const offerSourceSchema = z.enum(OFFER_SOURCES);
export type OfferSource = z.infer<typeof offerSourceSchema>;

// ---------------------------------------------------------------------------------------
// Verification: what PayPal says, and what to do when it does not add up
// ---------------------------------------------------------------------------------------

export const INCIDENT_TYPES = [
  'UNEXPLAINED_MOVEMENT', // money moved at PayPal that no approved action explains
  'AMOUNT_MISMATCH', // a movement matched an action but not its amount or currency
  'RECONCILIATION_GAP', // the nightly sweep found a difference between PayPal and the ledger
  'WEBHOOK_VERIFICATION_FAILED', // a delivery did not pass signature verification
  'DISPUTE_OPENED', // a customer dispute was filed
  'UNKNOWN_OUTCOME', // an action's outcome could not be determined
  'HASH_CHAIN_BROKEN', // the audit log no longer verifies
] as const;
export const incidentTypeSchema = z.enum(INCIDENT_TYPES);
export type IncidentType = z.infer<typeof incidentTypeSchema>;

export const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const incidentSeveritySchema = z.enum(INCIDENT_SEVERITIES);
export type IncidentSeverity = z.infer<typeof incidentSeveritySchema>;

/** OPEN: found. CONTAINED: the automatic response ran. RESOLVED: an owner reviewed it and gave a reason. */
export const INCIDENT_STATUSES = ['OPEN', 'CONTAINED', 'RESOLVED'] as const;
export const incidentStatusSchema = z.enum(INCIDENT_STATUSES);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

/** The Verifier's response to unexplained money, in the order it runs. */
export const VERIFIER_STEPS = [
  'FREEZE_MANDATE',
  'VOID_AUTHORIZATIONS',
  'REFUND_CAPTURE',
  'REVOKE_VAULT_TOKEN',
  'NOTIFY_OWNER',
] as const;
export const verifierStepSchema = z.enum(VERIFIER_STEPS);
export type VerifierStep = z.infer<typeof verifierStepSchema>;

/**
 * The PayPal webhook events Bursar subscribes to, one by one and never by wildcard. Every name was
 * checked against PayPal's event-names page on 2026-10-05. (`PAYMENT.PAYOUTS-ITEM.DENIED`, which an
 * early plan listed, is not a documented event and is deliberately absent.)
 */
export const SUBSCRIBED_PAYPAL_EVENTS = [
  'CHECKOUT.ORDER.APPROVED',
  'PAYMENT.AUTHORIZATION.CREATED',
  'PAYMENT.AUTHORIZATION.VOIDED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DECLINED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.PENDING',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED',
  'PAYMENT.PAYOUTSBATCH.SUCCESS',
  'PAYMENT.PAYOUTSBATCH.PROCESSING',
  'PAYMENT.PAYOUTSBATCH.DENIED',
  'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
  'PAYMENT.PAYOUTS-ITEM.FAILED',
  'PAYMENT.PAYOUTS-ITEM.BLOCKED',
  'PAYMENT.PAYOUTS-ITEM.HELD',
  'PAYMENT.PAYOUTS-ITEM.RETURNED',
  'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
  'PAYMENT.PAYOUTS-ITEM.CANCELED',
  'PAYMENT.PAYOUTS-ITEM.REFUNDED',
  'VAULT.PAYMENT-TOKEN.CREATED',
  'VAULT.PAYMENT-TOKEN.DELETION-INITIATED',
  'VAULT.PAYMENT-TOKEN.DELETED',
  'CUSTOMER.DISPUTE.CREATED',
] as const;
export const subscribedPayPalEventSchema = z.enum(SUBSCRIBED_PAYPAL_EVENTS);
export type SubscribedPayPalEvent = z.infer<typeof subscribedPayPalEventSchema>;

/** Whether PayPal's own endpoint has confirmed a webhook delivery is genuine. */
export const VERIFICATION_STATUSES = ['PENDING', 'SUCCESS', 'FAILURE'] as const;
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

/** Whether a verified event could be tied to an approved action. EARLY means it arrived before our record. */
export const MATCH_STATUSES = ['PENDING', 'MATCHED', 'UNMATCHED', 'EARLY', 'MISMATCH'] as const;
export const matchStatusSchema = z.enum(MATCH_STATUSES);
export type MatchStatus = z.infer<typeof matchStatusSchema>;
