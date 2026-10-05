import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type ViteUserConfig } from 'vitest/config';

export interface BursarVitestOptions {
  /** Project name shown in reporter output. */
  readonly name: string;
  /** Minimum percentage (0-100) required for statements, branches, functions and lines. */
  readonly coverageThreshold?: number;
  /** Extra Vitest configuration merged on top of the shared defaults. */
  readonly overrides?: ViteUserConfig;
}

const DEFAULT_COVERAGE_THRESHOLD = 90;

const FAST_CHECK_SETUP = fileURLToPath(new URL('./fast-check.setup.ts', import.meta.url));

/**
 * Shared Vitest configuration for every workspace package: Node environment, strict mock
 * hygiene, global fast-check settings, and enforced V8 coverage thresholds.
 *
 * Coverage is configured per package (not at the repository root) because Vitest only
 * supports coverage thresholds at the process level.
 */
export function createVitestConfig(options: BursarVitestOptions): ViteUserConfig {
  const threshold = options.coverageThreshold ?? DEFAULT_COVERAGE_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError(`coverageThreshold must be between 0 and 100, received ${threshold}.`);
  }

  const base = defineConfig({
    test: {
      name: options.name,
      environment: 'node',
      include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
      setupFiles: [FAST_CHECK_SETUP],
      passWithNoTests: false,
      restoreMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
        reporter: ['text', 'lcov'],
        thresholds: {
          statements: threshold,
          branches: threshold,
          functions: threshold,
          lines: threshold,
        },
      },
    },
  });

  return options.overrides === undefined ? base : mergeConfig(base, options.overrides);
}
