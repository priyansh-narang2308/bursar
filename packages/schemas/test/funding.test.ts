import { MAX_MINOR } from '@bursar/money';
import { describe, expect, it } from 'vitest';
import { envelopeSchema, mandateSchema } from '../src';
import { envelope, eur, mandate, T0, T3, usd } from './fixtures';
import { describeEntityContract, problemsOf } from './support';

describeEntityContract('Mandate', mandateSchema, mandate);
describeEntityContract('Envelope', envelopeSchema, envelope);

describe('Mandate rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(mandateSchema, mandate(overrides));

  it('accepts every status in the shape that status should have', () => {
    expect(problems({ status: 'PENDING', signedAt: null })).toEqual([]);
    expect(problems({ status: 'FROZEN' })).toEqual([]);
    expect(problems({ status: 'EXPIRED', signedAt: null })).toEqual([]);
    expect(problems({ status: 'REVOKED', revokedAt: T3 })).toEqual([]);
  });

  it('keeps both caps in one currency, and the per-mission cap within the total', () => {
    expect(problems({ perMissionCap: eur('100000') })).toEqual([
      'perMissionCap: The two caps must be in the same currency',
    ]);
    expect(problems({ perMissionCap: usd('300001') })).toEqual([
      'perMissionCap: The per-mission cap cannot exceed the total cap',
    ]);
    expect(problems({ perMissionCap: usd('300000') })).toEqual([]);
  });

  it('requires the mandate to end after it starts, comparing real instants rather than text', () => {
    expect(problems({ validTo: T0 })).toEqual(['validTo: The mandate must end after it starts']);
    expect(
      problems({ validFrom: '2026-10-05T10:00:00.5Z', validTo: '2026-10-05T10:00:00Z' }),
    ).toEqual(['validTo: The mandate must end after it starts']);
  });

  it('requires a signature on an active or frozen mandate', () => {
    expect(problems({ status: 'ACTIVE', signedAt: null })).toEqual([
      'signedAt: An active or frozen mandate has been signed',
    ]);
    expect(problems({ status: 'FROZEN', signedAt: null })).toEqual([
      'signedAt: An active or frozen mandate has been signed',
    ]);
  });

  it('records a revocation time exactly when the mandate is revoked', () => {
    const message = 'revokedAt: A mandate has a revocation time exactly when it is revoked';

    expect(problems({ status: 'REVOKED', revokedAt: null })).toEqual([message]);
    expect(problems({ status: 'ACTIVE', revokedAt: T3 })).toEqual([message]);
  });

  it('refuses a negative cap, and reports a bad amount once without throwing', () => {
    expect(problems({ cap: usd('-1') })).toEqual([expect.stringContaining('cap.minor')]);
    expect(problems({ cap: usd('abc') })).toEqual([expect.stringContaining('cap.minor')]);
  });
});

describe('Envelope rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(envelopeSchema, envelope(overrides));

  it('lets captured plus held reach the ceiling, but not pass it', () => {
    expect(problems({ ceiling: usd('90000') })).toEqual([]);
    expect(problems({ ceiling: usd('89999') })).toEqual([
      'held: Captured plus held cannot exceed the ceiling',
    ]);
  });

  it('keeps every figure in one currency', () => {
    expect(problems({ settled: eur('0') })).toEqual([
      'ceiling: Every figure must be in the same currency',
    ]);
  });

  it('rejects a sum that does not even fit in 64 bits, without throwing', () => {
    const huge = usd(MAX_MINOR.toString());

    expect(problems({ ceiling: huge, held: huge, captured: huge })).toEqual([
      'held: Captured plus held cannot exceed the ceiling',
    ]);
  });

  it('accepts every status', () => {
    for (const status of ['PENDING', 'ACTIVE', 'CLOSED', 'VOIDED', 'EXPIRED']) {
      expect(problems({ status })).toEqual([]);
    }
  });
});
