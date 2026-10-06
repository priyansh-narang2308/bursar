import { describe, expect, it } from 'vitest';
import { createCatalog, createLiveApi } from '../src';

const key = process.env['CHANNEL3_API_KEY'];
const live = process.env['CHANNEL3_LIVE_TESTS'] === '1' && key;

/** Spends a few Channel3 credits. Skipped unless `CHANNEL3_LIVE_TESTS=1` and a key are in the environment. */
describe.skipIf(!live)('Channel3 live (needs CHANNEL3_LIVE_TESTS=1 and a key)', () => {
  it('searches the real catalog, normalises offers to exact money, and re-quotes one', async () => {
    const catalog = createCatalog({
      api: createLiveApi({ apiKey: key ?? '' }),
      budget: { perMission: 5, total: 5 },
    });
    const quotes = await catalog.search('standing desk', { missionId: null, limit: 5 });
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) {
      expect(q.price.minor).toBeGreaterThan(0n);
      expect(q.domain).toMatch(/\./);
    }
    const first = quotes[0];
    if (first === undefined) throw new Error('no quotes');
    const again = await catalog.requote(first.productId, first.price, null);
    expect(again.quote?.productId).toBe(first.productId);
  });
});
