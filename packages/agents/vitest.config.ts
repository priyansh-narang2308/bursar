import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'agents',
  coverageThreshold: 70,
  overrides: { test: { testTimeout: 60_000 } },
});
