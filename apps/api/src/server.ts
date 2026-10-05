import { createDb } from '@bursar/db';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
const { db, close } = createDb(config.databaseUrl);
const server = serve({ fetch: createApp({ config, db, logger }).fetch, port: config.port });
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
