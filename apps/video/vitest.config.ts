import { createVitestConfig } from '@bursar/tooling/vitest';

// The composition and the render script need a browser and a screen recording, so only the timeline logic is
// measured here; the rendered video itself is checked by looking at it.
export default createVitestConfig({
  name: 'video',
  coverageThreshold: 90,
  overrides: {
    test: { coverage: { include: ['src/timeline.ts'] } },
  },
});
