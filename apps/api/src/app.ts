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

/**
 * What a demo server adds: a seeded workspace, a stand-in for the buyer approving a mandate on PayPal's page,
 * and a run of the agents with a trace. Only the demo server supplies these; a real one leaves them out.
 */
export interface DemoHooks {
  seed(orgId: string, ownerId: string): Promise<void>;
  approveMandate(orgId: string, mandateId: string, ownerId: string): Promise<void>;
  runAgents(orgId: string, missionId: string): Promise<unknown>;
  /** Moves money at PayPal directly, outside the gateway, so the Verifier has something to catch. */
  rogueCapture(orgId: string): Promise<unknown>;
  schedule(orgId: string, missionId: string): Promise<unknown>;
  /** A carrier delay on the longest delivery, and the recovery for it; `apply` proposes the recovery. */
  replan(
    orgId: string,
    missionId: string,
    input: { days: number; apply: boolean },
  ): Promise<unknown>;
  gauntlet(): Promise<unknown>;
}

/** Which real services are behind the product and which are stand-ins. */
export interface Integrations {
  readonly paypal: { mode: string; detail: string };
  readonly catalog: { mode: string; detail: string };
  readonly model: { mode: string; detail: string };
}

export interface AppDeps {
  readonly config: Config;
  readonly db: Db;
  readonly logger: Logger;
  readonly now?: () => Date;
  /** The money loop. Without it the money routes are not served. */
  readonly core?: Core;
  /** What agents may use over MCP. Without it the MCP door is closed. */
  readonly agentTools?: AgentToolsDeps;
  /** Demo-only helpers. Without them the demo routes that need them answer 404. */
  readonly demo?: DemoHooks;
  readonly integrations?: Integrations;
}

function integrationsOf(deps: AppDeps): Integrations {
  const off = { mode: 'off', detail: 'Not configured.' };
  return (
    deps.integrations ?? {
      paypal: deps.config.money
        ? { mode: 'sandbox', detail: deps.config.money.paypal.baseUrl }
        : off,
      catalog: deps.agentTools ? { mode: 'configured', detail: 'Product search for agents.' } : off,
      model: off,
    }
  );
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
  v1.use(rateLimit({ windowMs: 60_000, max: 600 }));
  v1.use(authenticate({ db, config, now }));
  v1.route('/', demoRoutes({ db, config, now, hooks: deps.demo }));
  v1.route('/', workspaceRoutes(db));
  v1.route('/', agentRoutes(db));
  if (deps.core !== undefined) {
    v1.route('/', moneyRoutes(db, deps.core));
    v1.route('/', oversightRoutes(db, deps.core, integrationsOf(deps)));
    if (deps.agentTools !== undefined) v1.route('/', mcpRoutes(db, deps.core, deps.agentTools));
  }
  app.route('/v1', v1);
  if (deps.core !== undefined) app.route('/', webhookRoutes(deps.core));
  return app;
}
