import { ID_PREFIXES, type IdKind } from '../src/ids';

/*
 * Plain, valid example objects for the entity schemas, as they would arrive over the wire. Tests
 * start from one of these and break exactly one thing, so each failure points at one rule.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A fixed, valid id of the given kind. `n` (0 to 1023) picks one of 1,024 distinct ones. */
export function id(kind: IdKind, n = 0): string {
  const last = ALPHABET.charAt(n % 32);
  const beforeLast = ALPHABET.charAt(Math.floor(n / 32));
  return `${ID_PREFIXES[kind]}_01ARZ3NDEKTSV4RRFFQ69G5F${beforeLast}${last}`;
}

export const T0 = '2026-10-05T10:00:00Z';
export const T1 = '2026-10-05T11:00:00Z';
export const T2 = '2026-10-05T12:00:00Z';
export const T3 = '2026-10-12T10:00:00Z';

export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);
export const HASH_C = 'c'.repeat(64);

export const usd = (minor: string) => ({ currency: 'USD', minor });
export const eur = (minor: string) => ({ currency: 'EUR', minor });

type Fixture = Record<string, unknown>;

export const mandate = (overrides: Fixture = {}): Fixture => ({
  id: id('mandate'),
  orgId: id('organization'),
  payerId: id('payer'),
  policySetId: id('policySet'),
  status: 'ACTIVE',
  cap: usd('300000'),
  perMissionCap: usd('100000'),
  validFrom: T0,
  validTo: T3,
  signedAt: T0,
  revokedAt: null,
  ...overrides,
});

export const envelope = (overrides: Fixture = {}): Fixture => ({
  id: id('envelope'),
  orgId: id('organization'),
  missionId: id('mission'),
  mandateId: id('mandate'),
  status: 'ACTIVE',
  ceiling: usd('100000'),
  held: usd('40000'),
  captured: usd('50000'),
  refunded: usd('0'),
  settled: usd('0'),
  authorizationExpiresAt: T3,
  reauthorizedAt: null,
  ...overrides,
});

export const mission = (overrides: Fixture = {}): Fixture => ({
  id: id('mission'),
  orgId: id('organization'),
  mandateId: id('mandate'),
  envelopeId: id('envelope'),
  goal: 'Equip our new 10-seat office by Friday.',
  deadline: T3,
  budget: usd('100000'),
  status: 'ACTIVE',
  createdAt: T0,
  updatedAt: T1,
  ...overrides,
});

export const offer = (overrides: Fixture = {}): Fixture => ({
  id: id('offer'),
  supplierId: id('supplier'),
  title: 'Standing desk, 140 cm, walnut',
  brand: 'Oakline',
  category: 'furniture',
  imageUrl: 'https://cdn.example.com/desk.jpg',
  url: 'https://shop.example.com/desks/walnut-140',
  price: usd('12500'),
  availability: 'IN_STOCK',
  source: 'DETAIL',
  quoteId: 'q-123',
  observedAt: T0,
  ...overrides,
});

export const cartLine = (overrides: Fixture = {}): Fixture => ({
  id: id('cartLine'),
  offerId: id('offer'),
  quantity: 10,
  unitPrice: usd('12500'),
  lineTotal: usd('125000'),
  rationale: 'Best price among in-stock desks.',
  ...overrides,
});

export const cart = (overrides: Fixture = {}): Fixture => ({
  id: id('cart'),
  orgId: id('organization'),
  missionId: id('mission'),
  version: 1,
  lines: [
    cartLine(),
    cartLine({
      id: id('cartLine', 1),
      offerId: id('offer', 1),
      quantity: 2,
      unitPrice: usd('4999'),
      lineTotal: usd('9998'),
    }),
  ],
  total: usd('134998'),
  cartHash: HASH_A,
  status: 'PROPOSED',
  createdAt: T0,
  ...overrides,
});

export const action = (overrides: Fixture = {}): Fixture => ({
  id: id('action'),
  orgId: id('organization'),
  missionId: id('mission'),
  mandateId: null,
  type: 'AUTHORIZE',
  amount: usd('100000'),
  supplierId: null,
  cartId: id('cart'),
  cartHash: HASH_A,
  proposedBy: 'AGENT',
  idempotencyKey: HASH_B,
  state: 'PROPOSED',
  compensatesActionId: null,
  createdAt: T0,
  updatedAt: T1,
  ...overrides,
});

export const ruleResult = (overrides: Fixture = {}): Fixture => ({
  rule: 'R-ENVELOPE',
  outcome: 'ALLOW',
  message: 'The order fits within the remaining envelope.',
  inputs: { requested: usd('9998'), headroom: usd('10000') },
  threshold: usd('10000'),
  ...overrides,
});

export const decision = (overrides: Fixture = {}): Fixture => ({
  id: id('decision'),
  actionId: id('action'),
  policyVersionId: id('policyVersion'),
  policyHash: HASH_C,
  phase: 'PROPOSE',
  outcome: 'ALLOW',
  requiredApprovals: 0,
  trace: [ruleResult(), ruleResult({ rule: 'R-MANDATE', message: 'The mandate is active.' })],
  inputsHash: HASH_B,
  evaluatedAt: T1,
  ...overrides,
});

export const approval = (overrides: Fixture = {}): Fixture => ({
  id: id('approval'),
  decisionId: id('decision'),
  approverId: id('user'),
  status: 'APPROVED',
  cartHash: HASH_A,
  policyHash: HASH_C,
  signature: 'q3bXZpV0nM2kP9aLw-eR7tYhU_oIsD4f',
  expiresAt: T2,
  decidedAt: T1,
  ...overrides,
});

export const incident = (overrides: Fixture = {}): Fixture => ({
  id: id('incident'),
  orgId: id('organization'),
  type: 'UNEXPLAINED_MOVEMENT',
  severity: 'CRITICAL',
  status: 'CONTAINED',
  openedAt: T0,
  closedAt: null,
  evidence: { paypalCaptureId: '5O190127TN364715T', amount: usd('2500') },
  autoResponse: [
    { step: 'FREEZE_MANDATE', actionId: id('action'), at: T0 },
    { step: 'NOTIFY_OWNER', actionId: null, at: T1 },
  ],
  resolution: null,
  ...overrides,
});

export const paypalEvent = (overrides: Fixture = {}): Fixture => ({
  id: id('paypalEvent'),
  eventId: 'WH-2WR32451HC0233532-67976317FL4543714',
  eventType: 'PAYMENT.CAPTURE.COMPLETED',
  resourceType: 'capture',
  resourceId: '5O190127TN364715T',
  customId: 'bursar:v1:act_01ARZ3NDEKTSV4RRFFQ69G5FAV:0123456789abcdef',
  invoiceId: null,
  verificationStatus: 'SUCCESS',
  matchStatus: 'MATCHED',
  matchedActionId: id('action'),
  latencyMs: 3800,
  receivedAt: T1,
  ...overrides,
});

// ---------------------------------------------------------------------------------------
// LLM tool inputs, API bodies and stream events
// ---------------------------------------------------------------------------------------

export const toolExamples: Record<string, Fixture> = {
  get_org_context: {},
  get_policy_summary: {},
  get_mission: { missionId: id('mission') },
  search_offers: { needId: id('need'), query: 'standing desk walnut 140 cm', maxResults: 5 },
  get_offer: { offerId: id('offer') },
  get_shortlist: { needId: id('need') },
  compare_offers: { needId: id('need'), offerIds: [id('offer'), id('offer', 1), id('offer', 2)] },
  propose_cart: {
    missionId: id('mission'),
    lines: [
      { offerId: id('offer'), quantity: 10 },
      { offerId: id('offer', 1), quantity: 2 },
    ],
    rationale: 'Lowest in-stock price that meets the size requirement.',
  },
  request_swap: {
    missionId: id('mission'),
    lineId: id('cartLine'),
    replacementOfferId: id('offer', 3),
    reason: 'DELIVERY_DELAY',
  },
  reschedule_task: {
    missionId: id('mission'),
    taskId: id('task'),
    newStart: T2,
    reason: 'SUPPLIER_DELAY',
  },
};

export const createMissionRequest = (overrides: Fixture = {}): Fixture => ({
  goal: 'Equip our new 10-seat office by Friday.',
  deadline: T3,
  budget: usd('300000'),
  ...overrides,
});

export const proposalResult = (overrides: Fixture = {}): Fixture => ({
  cart: cart(),
  action: action(),
  decision: decision(),
  ...overrides,
});

export const approveActionRequest = (overrides: Fixture = {}): Fixture => ({
  decisionId: id('decision'),
  cartHash: HASH_A,
  policyHash: HASH_C,
  ...overrides,
});

export const rejectActionRequest = (overrides: Fixture = {}): Fixture => ({
  decisionId: id('decision'),
  reason: 'The chairs are not what the team asked for.',
  ...overrides,
});

export const mandateActionRequest = (overrides: Fixture = {}): Fixture => ({
  reason: 'Unexplained capture at PayPal; freezing while the owner reviews.',
  ...overrides,
});

const sseEnvelope = (type: string, data: Fixture): Fixture => ({
  id: id('event'),
  orgId: id('organization'),
  occurredAt: T1,
  type,
  data,
});

export const sseExamples: Record<string, Fixture> = {
  'action.state_changed': sseEnvelope('action.state_changed', {
    actionId: id('action'),
    missionId: id('mission'),
    from: 'SUBMITTED',
    to: 'CONFIRMED',
  }),
  'decision.recorded': sseEnvelope('decision.recorded', {
    decisionId: id('decision'),
    actionId: id('action'),
    phase: 'PROPOSE',
    outcome: 'REQUIRE_APPROVAL',
  }),
  'approval.requested': sseEnvelope('approval.requested', {
    approvalId: id('approval'),
    decisionId: id('decision'),
    actionId: id('action'),
    expiresAt: T2,
  }),
  'approval.decided': sseEnvelope('approval.decided', {
    approvalId: id('approval'),
    decisionId: id('decision'),
    status: 'APPROVED',
  }),
  'envelope.updated': sseEnvelope('envelope.updated', { envelope: envelope() }),
  'mandate.status_changed': sseEnvelope('mandate.status_changed', {
    mandateId: id('mandate'),
    from: 'ACTIVE',
    to: 'FROZEN',
  }),
  'mission.updated': sseEnvelope('mission.updated', {
    missionId: id('mission'),
    status: 'PARTIALLY_COMPLETED',
  }),
  'incident.opened': sseEnvelope('incident.opened', {
    incidentId: id('incident'),
    type: 'UNEXPLAINED_MOVEMENT',
    severity: 'CRITICAL',
  }),
  'incident.updated': sseEnvelope('incident.updated', {
    incidentId: id('incident'),
    status: 'CONTAINED',
  }),
  'paypal.event.verified': sseEnvelope('paypal.event.verified', {
    paypalEventId: id('paypalEvent'),
    eventType: 'PAYMENT.CAPTURE.COMPLETED',
    matchStatus: 'MATCHED',
    latencyMs: 3800,
  }),
};
