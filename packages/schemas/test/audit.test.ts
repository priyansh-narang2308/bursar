import { describe, expect, it } from 'vitest';
import {
  ACTOR_KINDS,
  AUDIT_EVENT_TYPE_PATTERN,
  auditActorSchema,
  auditEventSchema,
  MAX_AUDIT_TYPE_LENGTH,
} from '../src';
import { auditEvent, HASH_A, id } from './fixtures';
import { describeEntityContract, problemsOf } from './support';

describeEntityContract('AuditEvent', auditEventSchema, auditEvent);

describe('AuditEvent rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(auditEventSchema, auditEvent(overrides));

  it('starts a chain at 1 and counts in whole numbers', () => {
    expect(problems({ seq: 1 })).toEqual([]);
    for (const seq of [0, -1, 1.5, '7', null]) {
      expect(problems({ seq })).toEqual([expect.stringContaining('seq:')]);
    }
  });

  it('cannot be its own predecessor', () => {
    expect(problems({ prevHash: HASH_A, hash: HASH_A })).toEqual([
      'hash: An entry cannot be its own predecessor',
    ]);
  });

  it('takes a hash that is 64 lower-case hex characters, for both links', () => {
    expect(problems({ hash: 'nope' })).toEqual([expect.stringContaining('hash:')]);
    expect(problems({ prevHash: HASH_A.toUpperCase() })).toEqual([
      expect.stringContaining('prevHash:'),
    ]);
  });

  it.each([
    'approval.granted',
    'mandate.frozen',
    'action_state_changed',
    'a',
    'paypal.event.verified',
  ])('accepts the type %j', (type) => {
    expect(problems({ type })).toEqual([]);
    expect(AUDIT_EVENT_TYPE_PATTERN.test(type)).toBe(true);
  });

  it.each([
    '',
    'Approval.Granted',
    '.granted',
    'approval.',
    'approval..granted',
    'approval granted',
    '1approval',
    'x'.repeat(MAX_AUDIT_TYPE_LENGTH + 1),
  ])('rejects the type %j', (type) => {
    expect(problems({ type })).toEqual([expect.stringContaining('type:')]);
  });

  it('keeps what happened as a JSON object', () => {
    expect(problems({ payload: {} })).toEqual([]);
    expect(problems({ payload: 'approved' })).toEqual([expect.stringContaining('payload:')]);
    expect(problems({ payload: [1] })).toEqual([expect.stringContaining('payload:')]);
  });

  it.each(ACTOR_KINDS)('accepts an actor of kind %s, with or without an id', (kind) => {
    expect(problemsOf(auditActorSchema, { kind, id: id('user') })).toEqual([]);
    expect(problemsOf(auditActorSchema, { kind, id: null })).toEqual([]);
  });

  it('refuses an actor of an unknown kind, an empty id, or an extra key', () => {
    expect(problemsOf(auditActorSchema, { kind: 'ROBOT', id: null })).toEqual([
      expect.stringContaining('kind:'),
    ]);
    expect(problemsOf(auditActorSchema, { kind: 'USER', id: '' })).toEqual([
      expect.stringContaining('id:'),
    ]);
    expect(problemsOf(auditActorSchema, { kind: 'USER', id: null, name: 'x' })).toEqual([
      ': Unrecognized key: "name"',
    ]);
  });
});
