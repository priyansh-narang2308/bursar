import { createCore } from '@bursar/core';
import { parseKeyring } from '@bursar/crypto';
import { createDb } from '@bursar/db';
import { createPayPalClient } from '@bursar/paypal';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
const { db, close } = createDb(config.databaseUrl);
const { money } = config;
const core =
  money === undefined
    ? undefined
    : createCore({
        db,
        paypal: createPayPalClient({
          clientId: money.paypal.clientId,
          clientSecret: money.paypal.clientSecret,
          baseUrl: money.paypal.baseUrl,
        }),
        vaultKeys: parseKeyring(money.vaultKeys),
        approvalKey: money.approvalKey,
        provenanceKeys: [money.provenanceKey],
        webhookId: money.paypal.webhookId,
      });
if (core === undefined)
  logger.warn('PayPal credentials or keys are not set: the money routes are off');
const server = serve({
  fetch: createApp({ config, db, logger, ...(core === undefined ? {} : { core }) }).fetch,
  port: config.port,
});
logger.info({ port: config.port, demoMode: config.demoMode }, 'api listening');

/** Stops taking requests, lets the ones in flight finish, closes the database, and exits. */
function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  const forced = setTimeout(() => process.exit(1), 10_000);
  forced.unref();
  server.close(() => {
    void close().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
