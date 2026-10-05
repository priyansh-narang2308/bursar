import { describe, expect, it } from 'vitest';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  incidentSchema,
  paypalEventSchema,
  SUBSCRIBED_PAYPAL_EVENTS,
  VERIFIER_STEPS,
} from '../src';
import { id, incident, paypalEvent, T0, T1 } from './fixtures';
import { describeEntityContract, problemsOf } from './support';

describeEntityContract('Incident', incidentSchema, incident);
describeEntityContract('PayPalEvent', paypalEventSchema, paypalEvent);

describe('Incident rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(incidentSchema, incident(overrides));
  const resolved = {
    status: 'RESOLVED',
    closedAt: T1,
    resolution: { by: id('user'), reason: 'A test capture; confirmed with the payer.' },
  };
  const lifecycle =
    'status: An incident has a closing time and a resolution exactly when it is resolved';

  it.each(INCIDENT_TYPES)('accepts the type %s', (type) => {
    expect(problems({ type })).toEqual([]);
  });

  it.each(INCIDENT_SEVERITIES)('accepts the severity %s', (severity) => {
    expect(problems({ severity })).toEqual([]);
  });

  it.each(INCIDENT_STATUSES.filter((status) => status !== 'RESOLVED'))(
    'accepts an unresolved %s incident',
    (status) => {
      expect(problems({ status })).toEqual([]);
    },
  );

  it('is closed, with a reason and a person, exactly when it is resolved', () => {
    expect(problems(resolved)).toEqual([]);
    expect(problems({ ...resolved, closedAt: null })).toEqual([lifecycle]);
    expect(problems({ ...resolved, resolution: null })).toEqual([lifecycle]);
    expect(problems({ status: 'OPEN', closedAt: T1 })).toEqual([lifecycle]);
    expect(problems({ status: 'OPEN', resolution: resolved.resolution })).toEqual([lifecycle]);
  });

  it('cannot close before it opened', () => {
    expect(problems({ ...resolved, openedAt: T1, closedAt: T0 })).toEqual([
      'closedAt: An incident cannot close before it opened',
    ]);
  });

  it('needs a real reason to resolve', () => {
    expect(problems({ ...resolved, resolution: { by: id('user'), reason: '  ' } })).toEqual([
      expect.stringContaining('resolution.reason:'),
    ]);
  });

  it.each(VERIFIER_STEPS)('records the response step %s', (step) => {
    expect(problems({ autoResponse: [{ step, actionId: null, at: T0 }] })).toEqual([]);
  });

  it('allows at most ten response steps, and no unknown one', () => {
    const step = { step: 'FREEZE_MANDATE', actionId: null, at: T0 };

    expect(problems({ autoResponse: Array.from({ length: 10 }, () => step) })).toEqual([]);
    expect(problems({ autoResponse: Array.from({ length: 11 }, () => step) })).toEqual([
      expect.stringContaining('autoResponse:'),
    ]);
    expect(problems({ autoResponse: [{ ...step, step: 'REBOOT' }] })).toEqual([
      expect.stringContaining('autoResponse.0.step:'),
    ]);
  });

  it('keeps its evidence as a JSON object', () => {
    expect(problems({ evidence: {} })).toEqual([]);
    expect(problems({ evidence: 'a capture' })).toEqual([expect.stringContaining('evidence:')]);
  });
});

describe('PayPalEvent rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(paypalEventSchema, paypalEvent(overrides));
  const unmatched = { matchStatus: 'UNMATCHED', matchedActionId: null };
  const verified =
    'matchStatus: Only an event that passed verification can be matched to an action';
  const named = 'matchedActionId: An action is named exactly when the event was matched to one';

  it('accepts every event Bursar subscribes to, and a name PayPal might add later', () => {
    for (const eventType of [
      ...SUBSCRIBED_PAYPAL_EVENTS,
      'BILLING.SUBSCRIPTION.RENEWED',
      'NEW.THING-V2.CREATED',
    ]) {
      expect(problems({ eventType })).toEqual([]);
    }
  });

  it.each([
    'payment.capture.completed',
    'PAYMENT',
    'PAYMENT.',
    '.COMPLETED',
    'PAYMENT CAPTURE',
    '',
    `A.${'B'.repeat(100)}`,
  ])('rejects the event name %j', (eventType) => {
    expect(problems({ eventType })).toEqual([expect.stringContaining('eventType:')]);
  });

  it('names the matched action exactly when the event was matched or mismatched', () => {
    expect(problems({ matchStatus: 'MISMATCH' })).toEqual([]);
    expect(problems({ ...unmatched, matchedActionId: id('action') })).toEqual([named]);
    expect(problems({ matchStatus: 'MATCHED', matchedActionId: null })).toEqual([named]);
    for (const matchStatus of ['PENDING', 'UNMATCHED', 'EARLY']) {
      expect(problems({ matchStatus, matchedActionId: null })).toEqual([]);
    }
  });

  it('never matches an event that did not pass verification', () => {
    for (const verificationStatus of ['PENDING', 'FAILURE']) {
      expect(problems({ verificationStatus })).toEqual([verified]);
      expect(problems({ verificationStatus, matchStatus: 'MISMATCH' })).toEqual([verified]);
      expect(problems({ verificationStatus, ...unmatched })).toEqual([]);
    }
  });

  it('measures latency in whole milliseconds, up to a day, or not at all', () => {
    expect(problems({ latencyMs: null })).toEqual([]);
    expect(problems({ latencyMs: 0 })).toEqual([]);
    for (const latencyMs of [-1, 1.5, 86_400_001, '3800']) {
      expect(problems({ latencyMs })).toEqual([expect.stringContaining('latencyMs:')]);
    }
  });

  it('bounds the ids PayPal sends, and the provenance tag', () => {
    expect(problems({ eventId: '' })).toEqual([expect.stringContaining('eventId:')]);
    expect(problems({ resourceId: 'x'.repeat(101) })).toEqual([
      expect.stringContaining('resourceId:'),
    ]);
    expect(problems({ customId: 'x'.repeat(256) })).toEqual([expect.stringContaining('customId:')]);
    expect(problems({ customId: null, invoiceId: 'INV-1' })).toEqual([]);
  });
});
