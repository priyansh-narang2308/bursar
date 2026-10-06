import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { Logger } from '../logger';
import type { AppEnv } from '../types';
import { ApiError } from './problem';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Every request has an id: the caller's `X-Request-Id` if it is well formed, else a new one. */
export const requestId = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const given = c.req.header('x-request-id');
  const id = given !== undefined && REQUEST_ID.test(given) ? given : randomUUID();
  c.set('requestId', id);
  await next();
  c.header('x-request-id', id);
};

/** One log line per request. It never records headers, bodies or query strings. */
export const accessLog =
  (logger: Logger): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const started = performance.now();
    const log = logger.child({ requestId: c.get('requestId') });
    c.set('log', log);
    await next();
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
      },
      'request',
    );
  };

/** A fixed-window limit per client. In memory, so it is per instance: a guard, not a quota system. */
export function rateLimit(options: {
  readonly windowMs: number;
  readonly max: number;
  readonly now?: () => number;
}): MiddlewareHandler<AppEnv> {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { count: number; resetsAt: number }>();
  return async (c, next) => {
    const at = now();
    const client = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    if (windows.size > 10_000) {
      for (const [key, window] of windows) if (window.resetsAt <= at) windows.delete(key);
    }
    const window = windows.get(client);
    const current =
      window !== undefined && window.resetsAt > at
        ? window
        : { count: 0, resetsAt: at + options.windowMs };
    current.count += 1;
    windows.set(client, current);
    if (current.count > options.max) {
      throw new ApiError('RATE_LIMITED', {
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - at) / 1000)),
      });
    }
    await next();
  };
}

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Refuses a browser's cross-site write. A cookie session is sent along with a request from any page, so a
 * write whose `Origin` is not ours is somebody else's page speaking as the signed-in person. Callers that are
 * not browsers (an agent key, a webhook, a test) send no `Origin` and are unaffected.
 */
export const sameOrigin =
  (allowed: string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const origin = c.req.header('origin');
    if (WRITES.has(c.req.method) && origin !== undefined && origin !== new URL(allowed).origin)
      throw new ApiError('FORBIDDEN', { detail: 'This request came from another site.' });
    await next();
  };
