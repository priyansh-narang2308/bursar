import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'llm',
  coverageThreshold: 85,
  // The run-logging test builds a database; a slow CI runner needs more than the default 5 seconds.
  overrides: { test: { testTimeout: 30_000 } },
});
