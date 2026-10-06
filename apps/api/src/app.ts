import type { Core } from '@bursar/core';
import type { Db } from '@bursar/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { authenticate } from './auth';
import type { Config } from './config';
import { accessLog, rateLimit, requestId } from './http/middleware';
import { ApiError, handleError } from './http/problem';
import type { Logger } from './logger';
import { openApiDocument } from './openapi';
import { agentRoutes } from './routes/agents';
import { demoRoutes } from './routes/demo';
import { healthRoutes } from './routes/health';
import { type AgentToolsDeps, mcpRoutes } from './routes/mcp';
import { moneyRoutes } from './routes/money';
import { oversightRoutes } from './routes/oversight';
import { webhookRoutes } from './routes/webhooks';
import { workspaceRoutes } from './routes/workspace';
import type { AppEnv } from './types';

export interface AppDeps {
  readonly config: Config;
  readonly db: Db;
  readonly logger: Logger;
  readonly now?: () => Date;
  /** The money loop. Without it the money routes are not served. */
  readonly core?: Core;
  /** What agents may use over MCP. Without it the MCP door is closed. */
  readonly agentTools?: AgentToolsDeps;
}

/** The whole API as a value, so tests and the server build it the same way. */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const { config, db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(accessLog(logger));
  app.use(secureHeaders());
  app.use(cors({ origin: config.publicBaseUrl, credentials: true }));
  app.onError(handleError);
  app.notFound(() => {
    throw new ApiError('NOT_FOUND');
  });

  app.route('/', healthRoutes(db));
  app.get('/openapi.json', (c) => c.json(openApiDocument()));

  const v1 = new Hono<AppEnv>();
  v1.use(rateLimit({ windowMs: 60_000, max: 300 }));
  v1.use(authenticate({ db, config, now }));
  v1.route('/', demoRoutes({ db, config, now }));
  v1.route('/', workspaceRoutes(db));
  v1.route('/', agentRoutes(db));
  if (deps.core !== undefined) {
    v1.route('/', moneyRoutes(db, deps.core));
    v1.route('/', oversightRoutes(db, deps.core));
    if (deps.agentTools !== undefined) v1.route('/', mcpRoutes(db, deps.core, deps.agentTools));
  }
  app.route('/v1', v1);
  if (deps.core !== undefined) app.route('/', webhookRoutes(deps.core));
  return app;
}
