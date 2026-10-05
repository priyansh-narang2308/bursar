import type { Core } from '@bursar/core';
import { Hono } from 'hono';
import { ApiError } from '../http/problem';
import type { AppEnv } from '../types';

/**
 * PayPal's webhook door. It reads the raw body (the signature covers exact bytes), hands it to the core,
 * and answers 200 whatever the core decided about it: a forged or repeated delivery should not be sent
 * again. Only when PayPal could not be asked to verify does it answer 503, so PayPal delivers it again.
 */
export function webhookRoutes(core: Core) {
  return new Hono<AppEnv>().post('/webhooks/paypal', async (c) => {
    const headers = Object.fromEntries(
      [...c.req.raw.headers].map(([name, value]) => [name.toLowerCase(), value]),
    );
    try {
      return c.json({ status: await core.webhooks.ingest(await c.req.text(), headers) });
    } catch (error) {
      c.get('log').error(
        { err: error instanceof Error ? error.message : 'unknown' },
        'webhook could not be processed',
      );
      throw new ApiError('SERVICE_UNAVAILABLE', {
        detail: 'The webhook could not be verified yet; deliver it again.',
      });
    }
  });
}
