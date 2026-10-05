import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'api',
  coverageThreshold: 75,
  overrides: { test: { coverage: { exclude: ['src/server.ts'] }, testTimeout: 30_000 } },
});
