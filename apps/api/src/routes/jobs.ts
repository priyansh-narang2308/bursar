import { constantTimeEqual } from '@bursar/crypto';
import { Hono } from 'hono';
import { ApiError } from '../http/problem';
import type { AppEnv } from '../types';

export interface JobsDeps {
  /** The secret a scheduler presents. Without one the door does not exist. */
  readonly token: string;
  /** What a scheduled run does, and what it reports. */
  readonly run: () => Promise<unknown>;
}

/**
 * The door a scheduler (a Render cron job) knocks on every few minutes: reconcile PayPal with the ledger, expire
 * what is stale, and answer what it did. It is outside `/v1` because it has no session, only a shared secret,
 * and the secret is compared in constant time.
 */
export function jobRoutes(jobs: JobsDeps) {
  const wanted = new TextEncoder().encode(jobs.token);
  return new Hono<AppEnv>().post('/internal/jobs', async (c) => {
    const given = new TextEncoder().encode(c.req.header('x-job-token') ?? '');
    if (!constantTimeEqual(given, wanted))
      throw new ApiError('FORBIDDEN', { detail: 'A scheduled job needs its token.' });
    const started = Date.now();
    const result = await jobs.run();
    c.get('log').info({ ms: Date.now() - started }, 'scheduled run');
    return c.json({ ok: true, ms: Date.now() - started, result });
  });
}
