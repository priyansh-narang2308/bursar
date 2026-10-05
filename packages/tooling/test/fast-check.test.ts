import fc, { VerbosityLevel } from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fastCheckParameters } from '../src/fast-check';

describe('fastCheckParameters', () => {
  it('uses 200 runs and quiet output locally', () => {
    expect(fastCheckParameters({})).toEqual({ numRuns: 200, verbose: VerbosityLevel.None });
  });

  it('uses 500 runs and verbose output in CI', () => {
    expect(fastCheckParameters({ CI: 'true' })).toEqual({
      numRuns: 500,
      verbose: VerbosityLevel.Verbose,
    });
  });

  it('lets FC_NUM_RUNS override the default', () => {
    expect(fastCheckParameters({ FC_NUM_RUNS: '1000' }).numRuns).toBe(1000);
  });

  it('treats empty overrides as unset', () => {
    expect(fastCheckParameters({ FC_NUM_RUNS: '', FC_SEED: '' })).toEqual({
      numRuns: 200,
      verbose: VerbosityLevel.None,
    });
  });

  it.each(['0', '42', '-7'])('accepts FC_SEED=%s', (seed) => {
    expect(fastCheckParameters({ FC_SEED: seed }).seed).toBe(Number(seed));
  });

  it.each([
    ['FC_NUM_RUNS', '0'],
    ['FC_NUM_RUNS', 'abc'],
    ['FC_NUM_RUNS', '1.5'],
    ['FC_NUM_RUNS', '-3'],
    ['FC_SEED', 'x'],
    ['FC_SEED', '1.5'],
  ])('rejects %s=%s', (key, value) => {
    expect(() => fastCheckParameters({ [key]: value })).toThrow(RangeError);
  });

  it('is applied to every test run by the shared setup file', () => {
    expect(fc.readConfigureGlobal()).toMatchObject(fastCheckParameters(process.env));
  });
});
