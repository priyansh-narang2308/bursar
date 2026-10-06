import { aiTurnRequestSchema } from '@bursar/schemas';
import { Hono } from 'hono';
import { treasurerTurn } from '../ai/treasurer';
import { can } from '../auth';
import { rateLimit } from '../http/middleware';
import type { AppEnv } from '../types';
import { readBody } from './support';

/** The model proxy behind the Studio assistant. Today it answers from the scripted Treasurer. */
export function studioAiRoutes() {
  return new Hono<AppEnv>().post(
    '/studio/ai/turn',
    can('audit:read'),
    // A model call is the dearest thing a visitor can ask for, so it has its own, tighter limit.
    rateLimit({ windowMs: 60_000, max: 30 }),
    async (c) => c.json(treasurerTurn(await readBody(c, aiTurnRequestSchema))),
  );
}
