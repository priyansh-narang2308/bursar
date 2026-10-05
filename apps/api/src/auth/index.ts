import { sha256Hex, signSession, verifySession } from '@bursar/crypto';
import { agents, apiKeys, type Db } from '@bursar/db';
import { idSchemas, type OrganizationId, type Role, roleSchema } from '@bursar/schemas';
import { and, eq, isNull } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Config } from '../config';
import { ApiError } from '../http/problem';
import type { AppEnv, Principal } from '../types';
import { allowed, type Permission } from './permissions';

export const SESSION_COOKIE = 'bursar_session';
const SESSION_HOURS = 12;
export const API_KEY_PREFIX = 'bk_';

const claimsSchema = z.object({
  sub: z.string(),
  org: idSchemas.organization,
  role: roleSchema,
  exp: z.number(),
});

/** Starts a browser session: a signed cookie the page cannot read, valid for twelve hours. */
export function startSession(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  config: Config,
  who: { userId: string; orgId: OrganizationId; role: Role },
  now: Date,
): void {
  const exp = Math.floor(now.getTime() / 1000) + SESSION_HOURS * 3600;
  setCookie(
    c,
    SESSION_COOKIE,
    signSession(config.sessionKey, { sub: who.userId, org: who.orgId, role: who.role, exp }),
    {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.env === 'production',
      path: '/',
      maxAge: SESSION_HOURS * 3600,
    },
  );
}

/** An agent key is `bk_` and 32 random characters. Only its SHA-256 is stored. */
export const hashApiKey = (key: string): string => sha256Hex(key);

async function agentFor(db: Db, key: string): Promise<Principal | undefined> {
  if (!key.startsWith(API_KEY_PREFIX)) return undefined;
  const [found] = await db
    .select({ orgId: apiKeys.orgId, agentId: apiKeys.agentId, scopes: apiKeys.scopes })
    .from(apiKeys)
    .innerJoin(agents, eq(agents.id, apiKeys.agentId))
    .where(
      and(
        eq(apiKeys.keyHash, hashApiKey(key)),
        isNull(apiKeys.revokedAt),
        eq(agents.status, 'ACTIVE'),
      ),
    );
  return found === undefined
    ? undefined
    : {
        kind: 'agent',
        orgId: found.orgId,
        role: 'AGENT',
        userId: null,
        agentId: found.agentId,
        scopes: found.scopes,
      };
}

/**
 * Works out who is calling, from an agent's bearer key or a session cookie, and leaves
 * `principal` unset if neither is good. Looking up a key is system code: it has to find the
 * organisation before there is one to scope to.
 */
export function authenticate(deps: {
  db: Db;
  config: Config;
  now: () => Date;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const bearer = c.req.header('authorization')?.match(/^Bearer (\S+)$/)?.[1];
    if (bearer !== undefined) {
      c.set('principal', await agentFor(deps.db, bearer));
    } else {
      const token = getCookie(c, SESSION_COOKIE);
      const claims =
        token === undefined
          ? undefined
          : claimsSchema.safeParse(verifySession(deps.config.sessionKey, token));
      if (claims?.success && claims.data.exp * 1000 > deps.now().getTime()) {
        const { sub, org, role } = claims.data;
        c.set('principal', {
          kind: 'session',
          orgId: org,
          role,
          userId: sub,
          agentId: null,
          scopes: null,
        });
      }
    }
    await next();
  };
}

export function requirePrincipal(c: Parameters<MiddlewareHandler<AppEnv>>[0]): Principal {
  const principal = c.get('principal');
  if (principal === undefined) throw new ApiError('UNAUTHENTICATED');
  return principal;
}

/** Only callers with this permission get through: 401 if not signed in, 403 if not allowed. */
export const can =
  (permission: Permission): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (!allowed(requirePrincipal(c), permission)) {
      throw new ApiError('FORBIDDEN', { detail: `This needs the ${permission} permission.` });
    }
    await next();
  };
