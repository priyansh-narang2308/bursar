import { describe, expect, it } from 'vitest';
import * as crypto from '../src';

describe('@bursar/crypto public API', () => {
  it('exposes exactly the documented runtime exports, so any change shows up in review', async () => {
    await expect(`${Object.keys(crypto).sort().join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/public-api.txt',
    );
  });
});
