import { createVitestConfig } from '@bursar/tooling/vitest';

export default createVitestConfig({
  name: 'web',
  coverageThreshold: 70,
  overrides: {
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.{ts,tsx}'],
      setupFiles: ['./test/setup.ts'],
      css: false,
      coverage: { include: ['src/**/*.{ts,tsx}'], exclude: ['src/main.tsx'] },
    },
  },
});
