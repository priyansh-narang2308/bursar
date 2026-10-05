import { describe, expect, it } from 'vitest';
import * as tooling from '../src';

describe('@bursar/tooling public API', () => {
  it('exposes exactly the documented runtime exports', () => {
    expect(Object.keys(tooling).sort()).toEqual([
      'COMMIT_TYPES',
      'fastCheckParameters',
      'validateCommitMessage',
    ]);
  });
});
