import { standardPolicy } from '@bursar/policy';
import { CircuitBreaker } from './breaker';
import { buildCart, createMission, createSupplier, recordOffer } from './catalog';
import { recordDelivery } from './deliveries';
import { execute } from './executor';
import { changeMandate, completeMandate, expireMandates, startMandate } from './mandates';
import { decide, expireApprovals, propose } from './pipeline';
import { receipt, replayDecision, verifyAudit } from './receipts';
import { reconcile } from './reconcile';
import type { CoreDeps } from './types';
import { contain, resolveIncident } from './verifier';
import { ingest, pollSubmitted, WEBHOOK_EVENT_TYPES } from './webhooks';

export { emit as emitEvent, record as recordAudit } from './audit';
export { CircuitBreaker } from './breaker';
export type { ExecuteResult } from './executor';
export { MANDATE_TRANSITIONS } from './mandates';
export type { Proposal, ProposeInput } from './pipeline';
export { type Actor, type CoreDeps, CoreError } from './types';
export type { IngestStatus } from './webhooks';
export { WEBHOOK_EVENT_TYPES };

export type CoreOptions = Omit<CoreDeps, 'now' | 'breaker' | 'policyFor'> &
  Partial<Pick<CoreDeps, 'now' | 'breaker' | 'policyFor'>>;

/** The money loop, wired to its dependencies. Every method works on one organisation at a time. */
export function createCore(options: CoreOptions) {
  const deps: CoreDeps = {
    now: () => new Date(),
    breaker: new CircuitBreaker(),
    policyFor: () => standardPolicy(),
    ...options,
  };
  return {
    mandates: {
      start: startMandate.bind(null, deps),
      complete: completeMandate.bind(null, deps),
      change: changeMandate.bind(null, deps),
      expire: expireMandates.bind(null, deps),
    },
    catalog: {
      createSupplier: createSupplier.bind(null, deps),
      recordOffer: recordOffer.bind(null, deps),
      createMission: createMission.bind(null, deps),
      buildCart: buildCart.bind(null, deps),
    },
    actions: {
      propose: propose.bind(null, deps),
      decide: decide.bind(null, deps),
      expireApprovals: expireApprovals.bind(null, deps),
      execute: execute.bind(null, deps),
    },
    deliveries: { record: recordDelivery.bind(null, deps) },
    incidents: {
      contain: contain.bind(null, deps),
      resolve: resolveIncident.bind(null, deps),
      reconcile: reconcile.bind(null, deps),
    },
    receipts: {
      get: receipt.bind(null, deps),
      replay: replayDecision.bind(null, deps),
      verifyAudit: verifyAudit.bind(null, deps),
    },
    webhooks: { ingest: ingest.bind(null, deps), pollSubmitted: pollSubmitted.bind(null, deps) },
  };
}

export type Core = ReturnType<typeof createCore>;
