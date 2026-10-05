import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ERROR_CATALOG,
  ERROR_CODES,
  type ErrorCode,
  errorCodeSchema,
  errorType,
  fieldErrorSchema,
  isRetryable,
  problem,
  problemDetailsSchema,
} from '../src/errors';
import { problemsOf } from './support';

const codes = fc.constantFrom(...ERROR_CODES);

describe('the error catalog', () => {
  it('lists every code once, in SCREAMING_SNAKE_CASE', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(Object.keys(ERROR_CATALOG).sort()).toEqual([...ERROR_CODES].sort());
    for (const code of ERROR_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/);
    }
  });

  it('gives every code a client or server error status, a title and a description', () => {
    for (const code of ERROR_CODES) {
      const { status, title, description } = ERROR_CATALOG[code];

      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
      expect(title.length).toBeGreaterThan(0);
      expect(title.length).toBeLessThanOrEqual(200);
      expect(description.endsWith('.')).toBe(true);
    }
  });

  it('gives every code its own title, so two codes are never confused', () => {
    const titles = ERROR_CODES.map((code) => ERROR_CATALOG[code].title);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it('is retryable exactly for throttling and for failures that may pass', () => {
    const retryable = ERROR_CODES.filter(isRetryable);

    expect(retryable.sort()).toEqual([
      'PAYPAL_OUTCOME_UNKNOWN',
      'PAYPAL_UNAVAILABLE',
      'RATE_LIMITED',
      'SERVICE_UNAVAILABLE',
    ]);
    for (const code of ERROR_CODES) {
      expect(isRetryable(code)).toBe([429, 502, 503, 504].includes(ERROR_CATALOG[code].status));
    }
  });

  it('never retries a declined payment on its own', () => {
    expect(isRetryable('PAYPAL_DECLINED')).toBe(false);
  });

  it('validates its own codes', () => {
    expect(errorCodeSchema.options).toEqual(ERROR_CODES);
    expect(errorCodeSchema.safeParse('POLICY_DENIED').success).toBe(true);
    expect(errorCodeSchema.safeParse('policy_denied').success).toBe(false);
    expect(errorCodeSchema.safeParse('MADE_UP').success).toBe(false);
  });
});

describe('errorType', () => {
  it('writes a code as a stable URN', () => {
    expect(errorType('POLICY_DENIED')).toBe('urn:bursar:error:policy-denied');
    expect(errorType('PAYPAL_OUTCOME_UNKNOWN')).toBe('urn:bursar:error:paypal-outcome-unknown');
  });

  it('gives every code a different type', () => {
    const types = ERROR_CODES.map(errorType);

    expect(new Set(types).size).toBe(types.length);
  });
});

describe('problem', () => {
  it('fills in the standard members from the catalog', () => {
    expect(problem('POLICY_DENIED')).toEqual({
      type: 'urn:bursar:error:policy-denied',
      title: 'The policy engine denied this action',
      status: 422,
      code: 'POLICY_DENIED',
      retryable: false,
    });
  });

  it('carries the details of one occurrence', () => {
    expect(
      problem('RATE_LIMITED', {
        detail: 'Limit of 60 requests a minute reached.',
        requestId: 'req_123',
        retryAfterSeconds: 12,
        instance: '/missions',
      }),
    ).toMatchObject({ retryable: true, retryAfterSeconds: 12, requestId: 'req_123' });
  });

  it('can say which fields failed validation', () => {
    const body = problem('VALIDATION_FAILED', {
      errors: [
        { path: 'budget.minor', message: 'Expected whole minor units as an integer string' },
      ],
    });

    expect(body.errors).toHaveLength(1);
  });

  it('carries the PayPal debug id', () => {
    expect(problem('PAYPAL_DECLINED', { paypalDebugId: 'a1b2c3d4e5f6' }).paypalDebugId).toBe(
      'a1b2c3d4e5f6',
    );
  });

  it('always makes a valid problem, for every code, surviving a trip through JSON', () => {
    fc.assert(
      fc.property(codes, (code) => {
        const made = problem(code);

        expect(problemsOf(problemDetailsSchema, JSON.parse(JSON.stringify(made)))).toEqual([]);
        expect(made.code).toBe(code);
      }),
    );
  });
});

describe('problemDetailsSchema', () => {
  const valid = () => problem('POLICY_DENIED');
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(problemDetailsSchema, { ...valid(), ...overrides });
  const mismatch =
    'code: The type, title, status and retryable flag must be the catalog values for the code';

  it('rejects a response that disagrees with the catalog about its own code', () => {
    expect(problems({ status: 500 })).toEqual([mismatch]);
    expect(problems({ title: 'Oops' })).toEqual([mismatch]);
    expect(problems({ retryable: true })).toEqual([mismatch]);
    expect(problems({ type: errorType('NOT_FOUND') })).toEqual([mismatch]);
  });

  it.each([
    ['an unknown code', { code: 'MADE_UP' }],
    ['a status below 400', { status: 200 }],
    ['a type that is not one of ours', { type: 'https://example.com/problems/x' }],
    ['an unknown key', { stack: 'Error: boom\n at ...' }],
    ['an over-long detail', { detail: 'x'.repeat(1001) }],
    ['a negative delay', { retryAfterSeconds: -1 }],
    ['a fractional delay', { retryAfterSeconds: 1.5 }],
    [
      'too many field errors',
      { errors: Array.from({ length: 101 }, () => ({ path: 'a', message: 'b' })) },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(problems(overrides).length).toBeGreaterThan(0);
  });

  it('describes a field error with a path and a message, and nothing else', () => {
    expect(problemsOf(fieldErrorSchema, { path: 'a.b', message: 'bad' })).toEqual([]);
    expect(problemsOf(fieldErrorSchema, { path: 'a', message: '' })).toEqual([
      expect.stringContaining('message:'),
    ]);
    expect(
      problemsOf(fieldErrorSchema, { path: 'a', message: 'b', extra: 1 }).length,
    ).toBeGreaterThan(0);
  });

  it('covers every code with a status the type allows', () => {
    const statuses = new Set<number>(
      ERROR_CODES.map((code: ErrorCode) => ERROR_CATALOG[code].status),
    );

    expect([...statuses].sort()).toEqual([
      400, 401, 403, 404, 409, 410, 422, 429, 500, 502, 503, 504,
    ]);
  });
});
