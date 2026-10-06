import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLiveApi } from '../src';

/*
 * Records real Channel3 results for the queries the demo's agents make, so the demo can show real products
 * and real retailers with no key and no credits. Run it with the key in the environment:
 *   pnpm --filter @bursar/channel3 record
 * It spends one search per query and keeps only the fields Bursar reads.
 */
const QUERIES = [
  'standing desk',
  'office chair',
  'monitor',
  'keyboard',
  'desk lamp',
  'webcam',
  'headset',
  'whiteboard',
  'printer paper',
  'pens',
];
const key = process.env['CHANNEL3_API_KEY'];
if (!key) throw new Error('CHANNEL3_API_KEY is not set.');

const api = createLiveApi({ apiKey: key });
const seen = new Map<string, unknown>();
for (const query of QUERIES) {
  const found = await api.search({ query, limit: 8 });
  for (const p of found) {
    const offers = (p.offers ?? [])
      .slice(0, 3)
      .map((o) => ({ url: o.url, domain: o.domain, price: o.price, availability: o.availability }));
    if (offers.length === 0) continue;
    seen.set(p.id, {
      id: p.id,
      title: p.title,
      brands: (p.brands ?? []).slice(0, 1),
      images: (p.images ?? []).slice(0, 1).map((i) => ({ url: i.url })),
      category: p.category ? { title: p.category.title } : null,
      offers,
    });
  }
}
const out = fileURLToPath(new URL('../fixtures/recorded.json', import.meta.url));
writeFileSync(
  out,
  `${JSON.stringify({ recordedAt: new Date().toISOString(), queries: QUERIES, products: [...seen.values()] }, null, 2)}\n`,
);
process.stdout.write(`Recorded ${seen.size} products to fixtures/recorded.json\n`);
