import { describe, expect, it } from 'vitest';
import { createVitestConfig } from '../src/vitest';

describe('createVitestConfig', () => {
  it('applies the shared defaults', () => {
    const { test } = createVitestConfig({ name: 'demo' });

    expect(test?.name).toBe('demo');
    expect(test?.environment).toBe('node');
    expect(test?.passWithNoTests).toBe(false);
    expect(test?.restoreMocks).toBe(true);
    expect(test?.setupFiles).toEqual([expect.stringMatching(/fast-check\.setup\.ts$/)]);
  });

  it('defaults to a 90% coverage threshold on all four metrics', () => {
    const thresholds = createVitestConfig({ name: 'demo' }).test?.coverage?.thresholds;

    expect(thresholds).toEqual({ statements: 90, branches: 90, functions: 90, lines: 90 });
  });

  it.each([0, 95, 100])('enforces a custom threshold of %s', (coverageThreshold) => {
    const thresholds = createVitestConfig({ name: 'demo', coverageThreshold }).test?.coverage
      ?.thresholds;

    expect(thresholds).toEqual({
      statements: coverageThreshold,
      branches: coverageThreshold,
      functions: coverageThreshold,
      lines: coverageThreshold,
    });
  });

  it.each([-1, 100.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a coverage threshold of %s',
    (coverageThreshold) => {
      expect(() => createVitestConfig({ name: 'demo', coverageThreshold })).toThrow(RangeError);
    },
  );

  it('merges overrides on top of the defaults', () => {
    const { test } = createVitestConfig({
      name: 'demo',
      overrides: { test: { testTimeout: 1234 } },
    });

    expect(test?.testTimeout).toBe(1234);
    expect(test?.environment).toBe('node');
  });
});
