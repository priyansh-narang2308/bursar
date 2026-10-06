import { type CallRecord, createCatalog, createLiveApi, type Quote } from '@bursar/channel3';

/*
 * Checks Channel3's live catalog against what Bursar assumes of it: that a search returns offers with an exact
 * price and a domain, that a re-quote of the same product finds its price again, and what it costs and how long it
 * takes. Hard-capped at 10 credits by the catalog's own budget, so it cannot spend more. Prints a JSON report and
 * never the key. Run from the repository root:
 *
 *   node --env-file=.env --import tsx apps/api/src/dev-tools/validate-catalog.ts
 */

const key = process.env['CHANNEL3_API_KEY'];
if (!key) throw new Error('CHANNEL3_API_KEY is not set. It belongs in .env.');

const CAP = 10;
const calls: CallRecord[] = [];
const catalog = createCatalog({
  api: createLiveApi({ apiKey: key }),
  budget: { perMission: CAP, total: CAP },
  onCall: (call) => {
    calls.push(call);
  },
});

const QUERIES = [
  'standing desk',
  'ergonomic office chair',
  'usb-c monitor',
  'mechanical keyboard',
  'laptop stand',
  'desk lamp',
];

const rows: {
  query: string;
  results: number;
  withPrice: number;
  withDomain: number;
  availability: Record<string, number>;
  cheapest: string;
  priciest: string;
  requote?: { found: boolean; changed: boolean; driftBasisPoints: number };
}[] = [];

for (const [i, query] of QUERIES.entries()) {
  const quotes: Quote[] = await catalog.search(query, { missionId: null, limit: 5 });
  const prices = quotes.map((q) => q.price).sort((a, b) => a.compare(b));
  const availability: Record<string, number> = {};
  for (const q of quotes) availability[q.availability] = (availability[q.availability] ?? 0) + 1;
  const row: (typeof rows)[number] = {
    query,
    results: quotes.length,
    withPrice: quotes.filter((q) => q.price.isPositive()).length,
    withDomain: quotes.filter((q) => /\./.test(q.domain)).length,
    availability,
    cheapest: prices[0]?.toString() ?? 'none',
    priciest: prices.at(-1)?.toString() ?? 'none',
  };
  // Re-quote the first result of four of the searches: does the same product come back at the same price?
  const first = quotes[0];
  if (first !== undefined && i < 4) {
    const again = await catalog.requote(first.productId, first.price, null);
    row.requote = {
      found: again.quote !== undefined,
      changed: again.changed,
      driftBasisPoints: again.driftBasisPoints,
    };
  }
  rows.push(row);
}

const credits = calls.reduce((sum, c) => sum + c.credits, 0);
const latencies = calls
  .filter((c) => c.credits > 0)
  .map((c) => c.latencyMs)
  .sort((a, b) => a - b);
process.stdout.write(
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      creditsSpent: credits,
      calls: calls.length,
      medianLatencyMs: latencies[Math.floor(latencies.length / 2)],
      slowestMs: latencies.at(-1),
      statuses: Object.fromEntries(
        [...new Set(calls.map((c) => c.status))].map((s) => [
          s,
          calls.filter((c) => c.status === s).length,
        ]),
      ),
      rows,
    },
    null,
    2,
  )}\n`,
);
process.exit(0);
