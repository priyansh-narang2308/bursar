import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'agent-tools',
  coverageThreshold: 70,
  overrides: { test: { testTimeout: 30_000 } },
});
