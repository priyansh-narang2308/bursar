import { type AgentRole, createToolbox } from '@bursar/agent-tools';
import type { Catalog } from '@bursar/channel3';
import type { Core } from '@bursar/core';
import type { Db } from '@bursar/db';
import { handleMcp, type ToolkitBridge } from '@bursar/mcp-gateway';
import type { Policy } from '@bursar/policy';
import { Hono } from 'hono';
import { can, requirePrincipal } from '../auth';
import { allowed } from '../auth/permissions';
import { ApiError } from '../http/problem';
import type { AppEnv } from '../types';

export interface AgentToolsDeps {
  readonly catalog: Catalog;
  readonly policy: Policy;
  /** PayPal's own read-only tools, if the real toolkit is wired in. Without it none are offered. */
  readonly bridge?: ToolkitBridge | undefined;
}

/**
 * The MCP door for agents (`claude mcp add --transport http bursar <url>/v1/mcp --header "Authorization: Bearer <key>"`).
 * Only an agent key gets in, and the key's scopes decide which tools it is shown at all.
 */
export function mcpRoutes(db: Db, core: Core, tools: AgentToolsDeps) {
  return new Hono<AppEnv>().post('/mcp', can('missions:read'), (c) => {
    const principal = requirePrincipal(c);
    if (principal.kind !== 'agent' || principal.agentId === null)
      throw new ApiError('FORBIDDEN', { detail: 'The MCP gateway is for agent keys.' });
    const { agentId, orgId } = principal;
    const toolbox = (role: AgentRole) =>
      createToolbox({
        db,
        core,
        catalog: tools.catalog,
        policy: tools.policy,
        orgId,
        agentId,
        role,
        missionId: null,
      });
    return handleMcp(
      c.req.raw,
      { toolbox, bridge: tools.bridge },
      { read: allowed(principal, 'missions:read'), propose: allowed(principal, 'actions:propose') },
    );
  });
}
