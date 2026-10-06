import { z } from 'zod';
import type { Permission } from './auth/permissions';

interface Operation {
  readonly method: 'get' | 'post' | 'delete';
  /** The Hono path, `:id` style. */
  readonly path: string;
  readonly summary: string;
  readonly permission?: Permission | 'signed-in' | 'public';
  readonly body?: z.ZodType;
  readonly status: number;
}

const role = z.enum(['OWNER', 'APPROVER', 'OPERATOR', 'AUDITOR', 'AGENT', 'VERIFIER']);

/** Every route the API serves. A test fails if this list and the app disagree. */
export const OPERATIONS: readonly Operation[] = [
  {
    method: 'get',
    path: '/healthz',
    summary: 'Liveness',
    permission: 'public',
    status: 200,
  },
  {
    method: 'get',
    path: '/readyz',
    summary: 'Readiness: the database answers',
    permission: 'public',
    status: 200,
  },
  {
    method: 'get',
    path: '/openapi.json',
    summary: 'This document',
    permission: 'public',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/demo/workspace',
    summary: 'Open a demo workspace (demo mode only)',
    permission: 'public',
    body: z.object({ name: z.string().optional() }),
    status: 201,
  },
  {
    method: 'post',
    path: '/v1/demo/mandates/:id/approve',
    summary: 'Approve a mandate as the buyer would on PayPal’s page (demo mode only)',
    permission: 'mandates:write',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/missions/:id/run',
    summary: 'Run the agents on a mission and return what they did (demo mode only)',
    permission: 'actions:propose',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/policy',
    summary: 'The rules in force, their parameters and the policy hash',
    permission: 'workspace:read',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/integrations',
    summary: 'Which services are real and which are stand-ins',
    permission: 'workspace:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/demo/rogue-capture',
    summary: 'Move money outside the gateway so the Verifier reacts (demo mode only)',
    permission: 'mandates:write',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/missions/:id/schedule',
    summary: 'The delivery schedule for a mission (demo mode only)',
    permission: 'missions:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/missions/:id/replan',
    summary: 'Delay a delivery and plan the recovery (demo mode only)',
    permission: 'actions:propose',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/demo/gauntlet',
    summary: 'Run the injection corpus against a naive and a guarded agent (demo mode only)',
    permission: 'missions:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/demo/lab/run',
    summary: 'Run adversarial spending scenarios against a policy (demo mode only)',
    permission: 'audit:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/demo/lab/fix',
    summary: 'Shrink a scenario that broke the policy and propose a patch (demo mode only)',
    permission: 'audit:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/demo/role',
    summary: 'Switch role in the demo',
    permission: 'signed-in',
    body: z.object({ role }),
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/me',
    summary: 'Who am I',
    permission: 'signed-in',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/workspace',
    summary: 'The current workspace',
    permission: 'workspace:read',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/audit-events',
    summary: 'The audit log, oldest first',
    permission: 'audit:read',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/agents',
    summary: 'Agents and their keys',
    permission: 'workspace:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/agents',
    summary: 'Create an agent',
    permission: 'agents:manage',
    body: z.object({ name: z.string() }),
    status: 201,
  },
  {
    method: 'post',
    path: '/v1/agents/:id/keys',
    summary: 'Create a key, shown once',
    permission: 'agents:manage',
    body: z.object({ scopes: z.array(z.string()).optional() }),
    status: 201,
  },
  {
    method: 'post',
    path: '/v1/agents/:id/keys/:keyId/rotate',
    summary: 'Replace a key with a new one',
    permission: 'agents:manage',
    status: 201,
  },
  {
    method: 'delete',
    path: '/v1/agents/:id/keys/:keyId',
    summary: 'Revoke a key',
    permission: 'agents:manage',
    status: 204,
  },
  {
    method: 'get',
    path: '/v1/mandates',
    summary: 'Mandates',
    permission: 'workspace:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/mandates',
    summary: 'Start a mandate: ask PayPal to save the payer’s account',
    permission: 'mandates:write',
    status: 201,
  },
  {
    method: 'post',
    path: '/v1/mandates/:id/complete',
    summary: 'Finish a mandate after the payer approved at PayPal',
    permission: 'mandates:write',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/mandates/:id/freeze',
    summary: 'Freeze a mandate',
    permission: 'mandates:write',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/mandates/:id/unfreeze',
    summary: 'Unfreeze a mandate',
    permission: 'mandates:write',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/mandates/:id/revoke',
    summary: 'Revoke a mandate: PayPal deletes the payment token',
    permission: 'mandates:write',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/suppliers',
    summary: 'The supplier registry',
    permission: 'missions:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/suppliers',
    summary: 'Register a supplier and where its payouts go',
    permission: 'missions:write',
    status: 201,
  },
  {
    method: 'get',
    path: '/v1/offers',
    summary: 'Offer snapshots',
    permission: 'missions:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/offers',
    summary: 'Record an offer snapshot',
    permission: 'missions:write',
    status: 201,
  },
  {
    method: 'get',
    path: '/v1/missions',
    summary: 'Missions',
    permission: 'missions:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/missions',
    summary: 'Create a mission',
    permission: 'missions:write',
    status: 201,
  },
  {
    method: 'post',
    path: '/v1/missions/:id/carts',
    summary: 'Build a cart from offers and quantities; prices are computed by the server',
    permission: 'actions:propose',
    status: 201,
  },
  {
    method: 'get',
    path: '/v1/carts/:id',
    summary: 'A cart',
    permission: 'missions:read',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/actions',
    summary: 'Actions, newest first',
    permission: 'missions:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/actions',
    summary: 'Propose an action; the amount comes from the cart, never the caller',
    permission: 'actions:propose',
    status: 201,
  },
  {
    method: 'post',
    path: '/v1/actions/:id/execute',
    summary: 'Carry out an approved action, or retry one whose outcome was unknown',
    permission: 'actions:propose',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/approvals',
    summary: 'Pending approval requests',
    permission: 'approvals:decide',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/approvals/:id/decide',
    summary: 'Approve or reject; not your own proposal',
    permission: 'approvals:decide',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/events',
    summary: 'Live events (server-sent), resumable with Last-Event-ID',
    permission: 'workspace:read',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/receipts/:actionId',
    summary: 'Everything that happened to one action, in order',
    permission: 'audit:read',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/audit/verify',
    summary: 'Whether the audit chain is unbroken',
    permission: 'audit:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/decisions/:id/replay',
    summary: 'Run a ruling again and say whether it reproduces',
    permission: 'audit:read',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/incidents',
    summary: 'Incidents and what was done about them',
    permission: 'audit:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/incidents/:id/resolve',
    summary: 'Close an incident with a note (owner)',
    permission: 'mandates:write',
    status: 200,
  },
  {
    method: 'get',
    path: '/v1/deliveries',
    summary: 'Deliveries and their inspection status',
    permission: 'missions:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/v1/deliveries',
    summary: 'Record a delivery, or inspect goods (a person)',
    permission: 'missions:write',
    status: 201,
  },
  {
    method: 'post',
    path: '/v1/mcp',
    summary: 'MCP over Streamable HTTP for agent keys: Bursar’s guarded tools, scoped to the key',
    permission: 'missions:read',
    status: 200,
  },
  {
    method: 'post',
    path: '/webhooks/paypal',
    summary: 'PayPal’s webhook door: signed events in, always 200 unless PayPal must retry',
    permission: 'public',
    status: 200,
  },
];

const toOpenApiPath = (path: string) => path.replace(/:(\w+)/g, '{$1}');

export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const parameters = [...op.path.matchAll(/:(\w+)/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const item = paths[toOpenApiPath(op.path)] ?? {};
    item[op.method] = {
      summary: op.summary,
      'x-permission': op.permission ?? 'signed-in',
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(op.body === undefined
        ? {}
        : {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: z.toJSONSchema(op.body) },
              },
            },
          }),
      responses: {
        [op.status]: { description: 'Success' },
        default: {
          description: 'An error',
          content: {
            'application/problem+json': {
              schema: { $ref: '#/components/schemas/ProblemDetails' },
            },
          },
        },
      },
    };
    paths[toOpenApiPath(op.path)] = item;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Bursar API', version: '0.0.0' },
    paths,
    components: {
      schemas: {
        ProblemDetails: {
          type: 'object',
          description: 'RFC 9457 problem details with a stable `code`; see @bursar/schemas.',
        },
      },
    },
  };
}
