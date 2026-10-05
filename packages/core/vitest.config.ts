import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'core',
  coverageThreshold: 70,
  overrides: { test: { testTimeout: 30_000 } },
});
