import { Channel3, Channel3Error } from '@channel3/sdk';
import { type Channel3Product, type ProductApi, RateLimitError } from './index';

/** The part of `@channel3/sdk`'s client this uses, so a test can stand in for it. */
export interface Channel3SdkClient {
  products: {
    search(request: {
      query?: string | null;
      limit?: number | null;
    }): Promise<{ data: readonly Channel3Product[] }>;
    retrieve(request: { product_id: string }): PromiseLike<Channel3Product>;
  };
}

/** A 404 is "gone"; a 429 becomes the catalog's own rate-limit signal; anything else is left to fail. */
async function guard<T>(work: () => PromiseLike<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Channel3Error && error.statusCode === 429) throw new RateLimitError(1_000);
    throw error;
  }
}

export function fromSdk(client: Channel3SdkClient): ProductApi {
  return {
    async search({ query, limit }) {
      const page = await guard(() => client.products.search({ query, limit }));
      return page.data;
    },
    async retrieve(productId) {
      try {
        return await guard(() => client.products.retrieve({ product_id: productId }));
      } catch (error) {
        if (error instanceof Channel3Error && error.statusCode === 404) return undefined;
        throw error;
      }
    },
  };
}

/** The live catalog. The key is read by the caller and never logged here. */
export function createLiveApi(options: { apiKey: string; timeoutInSeconds?: number }): ProductApi {
  const client = new Channel3({
    apiKey: options.apiKey,
    timeoutInSeconds: options.timeoutInSeconds ?? 20,
    maxRetries: 0,
  });
  return fromSdk(client);
}
