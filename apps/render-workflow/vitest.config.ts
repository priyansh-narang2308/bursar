import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'render-workflow',
  coverageThreshold: 70,
  overrides: {
    test: { testTimeout: 60_000, coverage: { exclude: ['src/main.ts', 'src/wiring.ts'] } },
  },
});
