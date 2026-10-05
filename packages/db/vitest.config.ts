import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'db',
  coverageThreshold: 90,
  // The schema is declarative, and its behaviour is what the database tests check; the CLI needs a server.
  overrides: {
    test: { coverage: { exclude: ['src/cli.ts', 'src/schema/**'] }, testTimeout: 30_000 },
  },
});
