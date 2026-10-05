import { describe, expect, it } from 'vitest';
import * as schemas from '../src';

describe('@bursar/schemas public API', () => {
  it('exposes exactly the documented runtime exports, so any change shows up in review', async () => {
    await expect(`${Object.keys(schemas).sort().join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/public-api.txt',
    );
  });
});
