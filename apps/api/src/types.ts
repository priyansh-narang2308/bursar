import type { OrganizationId, Role } from '@bursar/schemas';
import type { Logger } from './logger';

/** Who is calling: a person in a browser session, or an agent holding an API key. */
export interface Principal {
  readonly kind: 'session' | 'agent';
  readonly orgId: OrganizationId;
  readonly role: Role;
  readonly userId: string | null;
  readonly agentId: string | null;
  /** The permissions an agent key was limited to. Null for a session: its role decides. */
  readonly scopes: readonly string[] | null;
}

export interface AppEnv {
  Variables: {
    requestId: string;
    log: Logger;
    principal: Principal | undefined;
  };
}
