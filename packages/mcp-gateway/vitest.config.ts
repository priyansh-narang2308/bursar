import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'mcp-gateway',
  coverageThreshold: 80,
  overrides: { test: { testTimeout: 60_000 } },
});
