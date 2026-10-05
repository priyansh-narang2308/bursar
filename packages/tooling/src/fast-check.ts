import { type Parameters as FastCheckParameters, VerbosityLevel } from 'fast-check';

/** Environment shape accepted by the helpers; `process.env` satisfies it. */
export type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_RUNS_LOCAL = 200;
const DEFAULT_RUNS_CI = 500;

function readInteger(
  env: Env,
  key: string,
  pattern: RegExp,
  description: string,
): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw === '') {
    return undefined;
  }
  if (!pattern.test(raw)) {
    throw new RangeError(`${key} must be ${description}, received "${raw}".`);
  }
  return Number(raw);
}

/**
 * Global fast-check settings shared by every package.
 *
 * - `FC_NUM_RUNS`: number of generated cases per property (default 200 locally, 500 in CI).
 * - `FC_SEED`: replay a failing run; fast-check prints the seed of any failure.
 */
export function fastCheckParameters(env: Env): FastCheckParameters<unknown> {
  const inCi = env['CI'] === 'true';
  const numRuns =
    readInteger(env, 'FC_NUM_RUNS', /^[1-9]\d*$/, 'a positive integer') ??
    (inCi ? DEFAULT_RUNS_CI : DEFAULT_RUNS_LOCAL);
  const seed = readInteger(env, 'FC_SEED', /^-?\d+$/, 'an integer');

  return {
    numRuns,
    verbose: inCi ? VerbosityLevel.Verbose : VerbosityLevel.None,
    ...(seed === undefined ? {} : { seed }),
  };
}
