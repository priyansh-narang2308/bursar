import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'api',
  coverageThreshold: 70,
  overrides: {
    test: { coverage: { exclude: ['src/server.ts', 'src/dev.ts'] }, testTimeout: 30_000 },
  },
});
