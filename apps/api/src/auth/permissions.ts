import type { Role } from '@bursar/schemas';
import type { Principal } from '../types';

export const PERMISSIONS = [
  'workspace:read',
  'missions:read',
  'missions:write',
  'mandates:write',
  'actions:propose',
  'approvals:decide',
  'audit:read',
  'agents:manage',
  'incidents:respond',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * What each role may do. The Verifier can protect (respond to incidents) and read, and can never
 * propose spending. An agent can only propose and read; a person decides approvals.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  OWNER: PERMISSIONS,
  APPROVER: ['workspace:read', 'missions:read', 'approvals:decide', 'audit:read'],
  OPERATOR: [
    'workspace:read',
    'missions:read',
    'missions:write',
    'actions:propose',
    'agents:manage',
  ],
  AUDITOR: ['workspace:read', 'missions:read', 'audit:read'],
  AGENT: ['missions:read', 'actions:propose'],
  VERIFIER: ['workspace:read', 'audit:read', 'incidents:respond'],
};

/** Whether a caller may do something: the role must allow it, and an agent key must also be scoped to it. */
export function allowed(principal: Principal, permission: Permission): boolean {
  return (
    ROLE_PERMISSIONS[principal.role].includes(permission) &&
    (principal.scopes === null || principal.scopes.includes(permission))
  );
}
