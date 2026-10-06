import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'workflows',
  coverageThreshold: 75,
  overrides: { test: { testTimeout: 60_000 } },
});
