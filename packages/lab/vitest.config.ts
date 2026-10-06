import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'lab',
  coverageThreshold: 80,
  overrides: { test: { testTimeout: 120_000 } },
});
