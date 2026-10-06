import { Money } from '@bursar/money';
import { Channel3Error } from '@channel3/sdk';
import { describe, expect, it } from 'vitest';
import {
  type CallRecord,
  CatalogError,
  type Channel3Product,
  type Channel3SdkClient,
  createCatalog,
  createFixtureApi,
  fromSdk,
  normalize,
  type ProductApi,
  RateLimitError,
} from '../src';

const product = (
  id: string,
  title: string,
  price: number,
  over: Partial<
    Channel3Product['offers'] extends readonly (infer O)[] | undefined ? O : never
  > = {},
): Channel3Product => ({
  id,
  title,
  brands: [{ name: 'Acme' }],
  images: [{ url: 'https://img.example/1.png' }],
  category: { name: 'Office' },
  offers: [
    {
      url: `https://shop.example/${id}`,
      domain: 'Shop.Example',
      price: { price, currency: 'USD' },
      availability: 'InStock',
      ...over,
    },
  ],
});
const FIXTURES = [
  product('p1', 'Standing desk', 399.99),
  product('p2', 'Desk lamp', 25),
  product('p3', 'Office chair', 189.5),
];
const usd = (cents: number) => Money.of(BigInt(cents), 'USD');

describe('normalize', () => {
  it('reads a product into our terms, with the price as exact minor units', () => {
    expect(normalize(FIXTURES[0] as Channel3Product)).toMatchObject({
      productId: 'p1',
      title: 'Standing desk',
      brand: 'Acme',
      category: 'Office',
      domain: 'shop.example',
      availability: 'IN_STOCK',
    });
    expect(normalize(FIXTURES[0] as Channel3Product)?.price.minor).toBe(39_999n);
    expect(normalize(product('x', 'Odd', 19.99))?.price.minor).toBe(1_999n); // not 1998.9999999
  });

  it('prefers the cheapest offer that is in stock, and skips what it cannot use', () => {
    const many: Channel3Product = {
      ...product('m', 'Mouse', 10),
      offers: [
        {
          url: 'https://a.example',
          domain: 'a.example',
          price: { price: 5, currency: 'USD' },
          availability: 'OutOfStock',
        },
        {
          url: 'https://b.example',
          domain: 'b.example',
          price: { price: 12, currency: 'USD' },
          availability: 'LimitedAvailability',
        },
        {
          url: 'https://c.example',
          domain: 'c.example',
          price: { price: 9, currency: 'USD' },
          availability: 'in_stock',
        },
        {
          url: 'https://d.example',
          domain: 'd.example',
          price: { price: 1, currency: 'XXX' },
          availability: 'InStock',
        },
      ],
    };
    expect(normalize(many)).toMatchObject({ domain: 'c.example', availability: 'IN_STOCK' });
    expect(normalize({ ...many, offers: [many.offers?.[0] as never] })).toMatchObject({
      availability: 'OUT_OF_STOCK',
    });
    expect(normalize({ ...product('n', 'None', 1), offers: [] })).toBeUndefined();
    expect(
      normalize({
        ...product('u', 'Odd', 1),
        offers: [
          {
            url: 'x',
            domain: 'x',
            price: { price: 1, currency: 'USD' },
            availability: 'Backordered',
          },
        ],
      })?.availability,
    ).toBe('UNKNOWN');
    expect(normalize(product('neg', 'Neg', -1))).toBeUndefined();
  });
});

describe('the catalog', () => {
  const setup = (
    api: ProductApi = createFixtureApi(FIXTURES),
    over: Partial<Parameters<typeof createCatalog>[0]> = {},
  ) => {
    const calls: CallRecord[] = [];
    let clock = 0;
    const catalog = createCatalog({
      api,
      now: () => clock,
      sleep: async () => undefined,
      onCall: (c) => void calls.push(c),
      ...over,
    });
    return {
      catalog,
      calls,
      tick: (ms: number) => {
        clock += ms;
      },
    };
  };

  it('searches by words and records the call', async () => {
    const { catalog, calls } = setup();
    expect((await catalog.search('desk', { missionId: 'm1' })).map((q) => q.title)).toEqual([
      'Standing desk',
      'Desk lamp',
    ]);
    expect(calls).toEqual([
      { endpoint: 'search', credits: 1, latencyMs: 0, status: 'ok', missionId: 'm1' },
    ]);
  });

  it('serves a repeated search from its cache for free, until the cache expires', async () => {
    const { catalog, calls, tick } = setup();
    await catalog.search('desk', { missionId: 'm1' });
    await catalog.search(' DESK ', { missionId: 'm1' });
    expect(calls.map((c) => c.status)).toEqual(['ok', 'cached']);
    expect(catalog.spent().total).toBe(1);
    tick(11 * 60_000);
    await catalog.search('desk', { missionId: 'm1' });
    expect(catalog.spent().total).toBe(2);
  });

  it('stops at the budget, per mission and in total', async () => {
    const { catalog } = setup(undefined, { budget: { perMission: 2, total: 3 } });
    await catalog.search('desk', { missionId: 'm1' });
    await catalog.search('chair', { missionId: 'm1' });
    await expect(catalog.search('lamp', { missionId: 'm1' })).rejects.toMatchObject({
      code: 'budget',
    });
    await catalog.search('lamp', { missionId: 'm2' });
    await expect(catalog.search('mouse', { missionId: 'm3' })).rejects.toBeInstanceOf(CatalogError);
    expect(catalog.spent()).toEqual({ total: 3, byMission: { m1: 2, m2: 1 } });
  });

  it('waits out one 429 and tries again, but not forever', async () => {
    let failures = 1;
    const flaky: ProductApi = {
      ...createFixtureApi(FIXTURES),
      search: async (r) => {
        if (failures-- > 0) throw new RateLimitError(250);
        return createFixtureApi(FIXTURES).search(r);
      },
    };
    const slept: number[] = [];
    const { catalog } = setup(flaky, { sleep: async (ms) => void slept.push(ms) });
    expect(await catalog.search('desk', { missionId: null })).toHaveLength(2);
    expect(slept).toEqual([250]);
    const down: ProductApi = {
      search: async () => {
        throw new RateLimitError();
      },
      retrieve: async () => undefined,
    };
    const limited = setup(down);
    await expect(limited.catalog.search('desk', { missionId: null })).rejects.toMatchObject({
      code: 'rate-limited',
    });
    expect(limited.calls.at(-1)?.status).toBe('rate-limited');
    const broken: ProductApi = {
      search: async () => {
        throw new Error('boom');
      },
      retrieve: async () => undefined,
    };
    await expect(setup(broken).catalog.search('desk', { missionId: null })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('notices when the price at detail is not the price from search', async () => {
    const { catalog } = setup(createFixtureApi(FIXTURES, { p1: 449.99, p2: 25, p3: 150 }));
    const dear = await catalog.requote('p1', usd(39_999), 'm1');
    expect(dear).toMatchObject({ changed: true, driftBasisPoints: 1250 }); // $50 on $399.99
    expect((await catalog.requote('p2', usd(2_500), 'm1')).changed).toBe(false);
    expect((await catalog.requote('p3', usd(18_950), 'm1')).driftBasisPoints).toBeLessThan(0);
    expect(await catalog.requote('gone', usd(100), 'm1')).toMatchObject({
      quote: undefined,
      changed: true,
    });
    expect((await catalog.requote('p2', Money.of(0n, 'USD'), 'm1')).driftBasisPoints).toBe(0);
  });

  it('adapts the SDK’s pages, turns a 429 into the catalog’s own signal, and a 404 into "gone"', async () => {
    const client = (over: Partial<Channel3SdkClient['products']> = {}): Channel3SdkClient => ({
      products: {
        search: async () => ({ data: FIXTURES }),
        retrieve: async () => FIXTURES[1] as Channel3Product,
        ...over,
      },
    });
    expect(await fromSdk(client()).search({ query: 'x', limit: 3 })).toHaveLength(3);
    expect((await fromSdk(client()).retrieve('p2'))?.id).toBe('p2');
    const limited = client({
      search: async () => {
        throw new Channel3Error({ statusCode: 429, message: 'slow' });
      },
    });
    await expect(fromSdk(limited).search({ query: 'x', limit: 1 })).rejects.toBeInstanceOf(
      RateLimitError,
    );
    const gone = client({
      retrieve: async () => {
        throw new Channel3Error({ statusCode: 404, message: 'no' });
      },
    });
    expect(await fromSdk(gone).retrieve('nope')).toBeUndefined();
    const broken = client({
      retrieve: async () => {
        throw new Channel3Error({ statusCode: 500, message: 'boom' });
      },
    });
    await expect(fromSdk(broken).retrieve('p')).rejects.toBeInstanceOf(Channel3Error);
  });
});
