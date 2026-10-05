import { type DestinationStream, type Logger, pino } from 'pino';

export type { Logger };

/** Anything under these names is replaced before it is written, whatever the caller logged. */
const REDACT = [
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.key',
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
  'apiKey',
  'key',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino({ level, redact: { paths: REDACT, censor: '[redacted]' } }, destination);
}
