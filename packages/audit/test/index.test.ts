import { describe, expect, it } from 'vitest';
import * as audit from '../src';

describe('@bursar/audit public API', () => {
  it('exposes exactly the documented runtime exports, so any change shows up in review', async () => {
    await expect(`${Object.keys(audit).sort().join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/public-api.txt',
    );
  });
});
