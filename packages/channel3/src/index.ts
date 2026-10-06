import { type CurrencyCode, currencyExponent, isCurrencyCode, Money } from '@bursar/money';

// ---------------------------------------------------------------------------------------
// What the catalog returns, and what Bursar keeps of it
// ---------------------------------------------------------------------------------------

/** The part of a Channel3 product Bursar reads (the shape is the one in `@channel3/sdk`'s typings). */
export interface Channel3Product {
  readonly id: string;
  readonly title: string;
  readonly brands?: readonly { readonly name: string }[];
  readonly images?: readonly { readonly url: string }[];
  readonly category?: { readonly name?: string } | null;
  readonly offers?: readonly {
    readonly url: string;
    readonly domain: string;
    readonly price: { readonly price: number; readonly currency: string };
    readonly availability: string;
  }[];
}

export interface ProductApi {
  search(request: { query: string; limit: number }): Promise<readonly Channel3Product[]>;
  retrieve(productId: string): Promise<Channel3Product | undefined>;
}

export type Availability = 'IN_STOCK' | 'LIMITED' | 'OUT_OF_STOCK' | 'UNKNOWN';

/** One product at one retailer at one price, in our terms. */
export interface Quote {
  readonly productId: string;
  readonly title: string;
  readonly brand: string | null;
  readonly category: string;
  readonly imageUrl: string | null;
  readonly url: string;
  readonly domain: string;
  readonly price: Money;
  readonly availability: Availability;
}

function availabilityOf(raw: string): Availability {
  const text = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (text.includes('outofstock')) return 'OUT_OF_STOCK';
  if (text.includes('limited')) return 'LIMITED';
  return text.includes('instock') ? 'IN_STOCK' : 'UNKNOWN';
}

/**
 * A product's best offer as a Quote: the cheapest one in stock, else the cheapest. The catalog reports a
 * price as a float; it is read as a decimal in the currency's own precision, never as arithmetic on floats.
 * A product with no usable offer, or in a currency PayPal does not accept, is skipped.
 */
export function normalize(product: Channel3Product): Quote | undefined {
  const usable = (product.offers ?? []).flatMap((offer) => {
    const currency = offer.price.currency.toUpperCase();
    if (!isCurrencyCode(currency) || !Number.isFinite(offer.price.price) || offer.price.price < 0)
      return [];
    const price = Money.parse(
      offer.price.price.toFixed(currencyExponent(currency as CurrencyCode)),
      currency as CurrencyCode,
    );
    return [{ offer, price, availability: availabilityOf(offer.availability) }];
  });
  const stocked = usable.filter(
    (u) => u.availability === 'IN_STOCK' || u.availability === 'LIMITED',
  );
  const [best] = (stocked.length > 0 ? stocked : usable).sort((a, b) =>
    Number(a.price.minor - b.price.minor),
  );
  if (best === undefined) return undefined;
  return {
    productId: product.id,
    title: product.title,
    brand: product.brands?.[0]?.name ?? null,
    category: product.category?.name ?? 'general',
    imageUrl: product.images?.[0]?.url ?? null,
    url: best.offer.url,
    domain: best.offer.domain.toLowerCase(),
    price: best.price,
    availability: best.availability,
  };
}

// ---------------------------------------------------------------------------------------
// The catalog: budget, cache, rate limits and re-quotes
// ---------------------------------------------------------------------------------------

/** Throw this from a `ProductApi` for HTTP 429. */
export class RateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs = 1000) {
    super('The catalog is rate limiting us.');
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class CatalogError extends Error {
  readonly code: 'budget' | 'rate-limited' | 'unavailable';
  constructor(code: CatalogError['code'], message: string) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
  }
}

export interface CallRecord {
  readonly endpoint: 'search' | 'retrieve';
  readonly credits: number;
  readonly latencyMs: number;
  readonly status: 'ok' | 'cached' | 'rate-limited' | 'error';
  readonly missionId: string | null;
}

export interface CatalogOptions {
  readonly api: ProductApi;
  /** Credits one mission may spend, and all missions together. */
  readonly budget?: { readonly perMission: number; readonly total: number };
  readonly costs?: { readonly search: number; readonly retrieve: number };
  readonly cacheMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Called for every call, cached or not, so spending is visible. */
  readonly onCall?: (call: CallRecord) => void | Promise<void>;
}

export interface Requote {
  readonly quote: Quote | undefined;
  /** How far the price moved since `previous`, in basis points (positive is dearer). */
  readonly driftBasisPoints: number;
  readonly changed: boolean;
}

export function createCatalog(options: CatalogOptions) {
  const { api, onCall } = options;
  const budget = options.budget ?? { perMission: 400, total: 20_000 };
  const costs = options.costs ?? { search: 1, retrieve: 1 };
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const cacheMs = options.cacheMs ?? 10 * 60_000;
  const spent = { total: 0, byMission: new Map<string, number>() };
  const cache = new Map<string, { at: number; quotes: Quote[] }>();

  function charge(endpoint: 'search' | 'retrieve', missionId: string | null): number {
    const credits = costs[endpoint];
    const used = missionId === null ? 0 : (spent.byMission.get(missionId) ?? 0);
    if (
      spent.total + credits > budget.total ||
      (missionId !== null && used + credits > budget.perMission)
    ) {
      throw new CatalogError('budget', 'The catalog credit budget is used up.');
    }
    spent.total += credits;
    if (missionId !== null) spent.byMission.set(missionId, used + credits);
    return credits;
  }

  /** One call with the budget charged, a single retry after a 429, and the call recorded. */
  async function call<T>(
    endpoint: 'search' | 'retrieve',
    missionId: string | null,
    work: () => Promise<T>,
  ): Promise<T> {
    const credits = charge(endpoint, missionId);
    const started = now();
    const record = (status: CallRecord['status']) =>
      onCall?.({ endpoint, credits, latencyMs: now() - started, status, missionId });
    try {
      const result = await work().catch(async (error: unknown) => {
        if (!(error instanceof RateLimitError)) throw error;
        await sleep(error.retryAfterMs);
        return work();
      });
      await record('ok');
      return result;
    } catch (error) {
      await record(error instanceof RateLimitError ? 'rate-limited' : 'error');
      if (error instanceof RateLimitError)
        throw new CatalogError('rate-limited', 'The catalog is rate limiting us.');
      throw new CatalogError('unavailable', 'The catalog could not be reached.');
    }
  }

  return {
    /** Searches. A repeated search inside the cache window costs nothing. Prices here can be stale: re-quote before deciding. */
    async search(
      query: string,
      input: { missionId: string | null; limit?: number },
    ): Promise<Quote[]> {
      const limit = input.limit ?? 10;
      const key = `${query.trim().toLowerCase()}|${limit}`;
      const hit = cache.get(key);
      if (hit !== undefined && now() - hit.at < cacheMs) {
        await onCall?.({
          endpoint: 'search',
          credits: 0,
          latencyMs: 0,
          status: 'cached',
          missionId: input.missionId,
        });
        return hit.quotes;
      }
      const products = await call('search', input.missionId, () => api.search({ query, limit }));
      const quotes = products.flatMap((p) => normalize(p) ?? []);
      cache.set(key, { at: now(), quotes });
      return quotes;
    },

    /** The current price of a product, never cached, compared with the price it had when it was shortlisted. */
    async requote(productId: string, previous: Money, missionId: string | null): Promise<Requote> {
      const product = await call('retrieve', missionId, () => api.retrieve(productId));
      const quote = product === undefined ? undefined : normalize(product);
      if (
        quote === undefined ||
        quote.price.currency !== previous.currency ||
        previous.minor === 0n
      ) {
        return { quote, driftBasisPoints: 0, changed: quote === undefined };
      }
      const drift = Number(((quote.price.minor - previous.minor) * 10_000n) / previous.minor);
      return { quote, driftBasisPoints: drift, changed: drift !== 0 };
    },

    /** What has been spent, for the sourcing page. */
    spent: () => ({ total: spent.total, byMission: Object.fromEntries(spent.byMission) }),
  };
}

export type Catalog = ReturnType<typeof createCatalog>;

// ---------------------------------------------------------------------------------------
// Sources: fixtures for tests and demos, and the live SDK
// ---------------------------------------------------------------------------------------

/**
 * An offline catalog. `requoted` gives a different price for a product when it is retrieved than when it
 * was searched, which is how a search price differs from a detail price in real life.
 */
export function createFixtureApi(
  products: readonly Channel3Product[],
  requoted: Readonly<Record<string, number>> = {},
): ProductApi {
  return {
    async search({ query, limit }) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      return products
        .filter((p) => words.every((w) => p.title.toLowerCase().includes(w)))
        .slice(0, limit);
    },
    async retrieve(productId) {
      const found = products.find((p) => p.id === productId);
      const price = requoted[productId];
      if (found === undefined || price === undefined) return found;
      return {
        ...found,
        offers: (found.offers ?? []).map((o) => ({ ...o, price: { ...o.price, price } })),
      };
    },
  };
}

/** The shape of `@channel3/sdk`'s client that this uses. Not run against the live API yet: it needs a key. */
export interface Channel3SdkClient {
  products: {
    search(request: {
      query: string;
      limit?: number;
    }): Promise<{ products?: readonly Channel3Product[]; data?: readonly Channel3Product[] }>;
    retrieve(request: { product_id: string }): Promise<Channel3Product>;
  };
}

export function fromSdk(client: Channel3SdkClient): ProductApi {
  return {
    async search(request) {
      const page = await client.products.search(request);
      return page.products ?? page.data ?? [];
    },
    retrieve: (productId) => client.products.retrieve({ product_id: productId }),
  };
}
