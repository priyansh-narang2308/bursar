import { decodeKey } from '@bursar/crypto';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DATABASE_URL: z.string().min(1),
  PUBLIC_BASE_URL: z.url().default('http://localhost:5173'),
  /** 64 hex or 43 base64url characters (`openssl rand -hex 32`). */
  SESSION_SECRET: z.string().refine((text) => {
    try {
      decodeKey(text);
      return true;
    } catch {
      return false;
    }
  }, 'must be a 256-bit key: 64 hex characters'),
  /** Bursar is sandbox-only. The only accepted value is `false`. */
  ALLOW_LIVE: z.literal('false').default('false'),
  DEMO_MODE: z.enum(['true', 'false']).default('true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Config {
  readonly env: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseUrl: string;
  readonly publicBaseUrl: string;
  readonly sessionKey: Uint8Array;
  /** Lets anyone open a demo workspace and switch roles. Off outside a demo. */
  readonly demoMode: boolean;
  readonly logLevel: string;
}

/** Reads the environment into a config. A failure names the variables, never their values. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration. ${problems.join('; ')}`);
  }
  const v = parsed.data;
  return {
    env: v.NODE_ENV,
    port: v.PORT,
    databaseUrl: v.DATABASE_URL,
    publicBaseUrl: v.PUBLIC_BASE_URL,
    sessionKey: decodeKey(v.SESSION_SECRET),
    demoMode: v.DEMO_MODE === 'true',
    logLevel: v.LOG_LEVEL,
  };
}
