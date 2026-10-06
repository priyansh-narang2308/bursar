import type { AgentRole, Toolbox, ToolResult } from '@bursar/agent-tools';
import { LLM_TOOLS, type LlmToolName } from '@bursar/schemas';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

/*
 * The seatbelt. An agent that speaks MCP is handed these tools and no others. Bursar's own tools are the
 * amount-free ones from @bursar/agent-tools; PayPal's toolkit tools that can move money are present only as
 * redirects, and the rest of the toolkit is deny-by-default, reachable only if it is read-only and a bridge
 * to the real toolkit is supplied.
 */

// ---------------------------------------------------------------------------------------
// What PayPal's own toolkit offers, and what the gateway does with each
// ---------------------------------------------------------------------------------------

/** The tools of `@paypal/agent-toolkit` 1.11.0 (its MCP entry point), read from the package. */
export const PAYPAL_TOOLKIT_TOOLS = [
  'accept_dispute_claim',
  'activate_recurring_series',
  'cancel_invoice_auto_reminder',
  'cancel_recurring_series',
  'cancel_sent_invoice',
  'cancel_subscription',
  'create_conditional_rules_for_invoice',
  'create_invoice',
  'create_order',
  'create_product',
  'create_recurring_series',
  'create_refund',
  'create_shipment_tracking',
  'create_subscription',
  'create_subscription_plan',
  'delete_invoice',
  'delete_recurring_series',
  'generate_invoice_number',
  'generate_invoice_qr_code',
  'get_dispute',
  'get_invoice',
  'get_merchant_insights',
  'get_order',
  'get_recurring_series',
  'get_refund',
  'get_shipment_tracking',
  'list_disputes',
  'list_invoices',
  'list_products',
  'list_subscription_plans',
  'list_transactions',
  'pay_order',
  'record_payment_for_invoice',
  'record_refund_for_invoice',
  'search_invoicing',
  'send_invoice',
  'send_invoice_reminder',
  'setup_invoice_auto_reminders',
  'show_product_details',
  'show_subscription_details',
  'show_subscription_plan_details',
  'update_invoice_auto_reminder',
  'update_invoicing',
  'update_plan',
  'update_product',
  'update_shipment_tracking',
  'update_subscription',
] as const;

export type ToolkitKind = 'READ' | 'MONEY' | 'BLOCKED';

/** Tools that spend, pay out or refund. An agent that tries one is told where to go instead. */
const MONEY_TOOLS: ReadonlySet<string> = new Set([
  'create_order',
  'pay_order',
  'create_refund',
  'create_subscription',
  'send_invoice',
  'record_payment_for_invoice',
  'record_refund_for_invoice',
]);

/** Deny by default: only a name known to be read-only passes, and only a name known to move money is explained. */
export function classifyToolkitTool(name: string): ToolkitKind {
  if (MONEY_TOOLS.has(name)) return 'MONEY';
  const readOnly =
    /^(get|list|show)_/.test(name) ||
    ['search_invoicing', 'generate_invoice_number', 'generate_invoice_qr_code'].includes(name);
  return readOnly && (PAYPAL_TOOLKIT_TOOLS as readonly string[]).includes(name)
    ? 'READ'
    : 'BLOCKED';
}

/** The real toolkit, when there is one. The gateway passes read-only calls through and nothing else. */
export interface ToolkitBridge {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
}

// ---------------------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------------------

export interface GatewayDeps {
  /** A toolbox for a role. The gateway draws from the researcher's and the buyer's. */
  readonly toolbox: (role: AgentRole) => Toolbox;
  readonly bridge?: ToolkitBridge | undefined;
}

/** What the agent's key allows: reading, and proposing. A tool the key cannot use is not even listed. */
export interface Scopes {
  readonly read: boolean;
  readonly propose: boolean;
}

const text = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  isError,
});

/** Puts a proposal's fate in words an agent can act on. */
function withStatus(result: ToolResult, tool: string): unknown {
  if (!result.ok || tool !== 'propose_cart') return result;
  const data = result.data as { state: string; outcome: string };
  const status =
    data.outcome === 'DENY'
      ? 'BLOCKED'
      : data.state === 'AWAITING_APPROVAL'
        ? 'PENDING_APPROVAL'
        : 'APPROVED';
  return {
    ok: true,
    status,
    ...data,
    next:
      status === 'PENDING_APPROVAL'
        ? 'A person must approve this before anything is paid.'
        : undefined,
  };
}

function registerNative(server: McpServer, deps: GatewayDeps, scopes: Scopes) {
  const offered = new Set<string>();
  for (const box of [deps.toolbox('RESEARCHER'), deps.toolbox('BUYER')]) {
    for (const def of box.definitions()) {
      const name = def.name as LlmToolName;
      const contract = LLM_TOOLS[name];
      if (!(contract.effect === 'propose' ? scopes.propose : scopes.read) || offered.has(name))
        continue;
      offered.add(name);
      server.registerTool(
        name,
        { description: contract.description, inputSchema: contract.input },
        async (args: Record<string, unknown>) => {
          const result = await box.call(name, args);
          return text(withStatus(result, name), !result.ok);
        },
      );
    }
  }
}

function registerToolkit(server: McpServer, deps: GatewayDeps, scopes: Scopes) {
  for (const name of PAYPAL_TOOLKIT_TOOLS) {
    const kind = classifyToolkitTool(name);
    if (kind === 'MONEY') {
      server.registerTool(
        name,
        {
          description: 'Blocked. Spending goes through propose_cart, and a person approves it.',
          inputSchema: z.looseObject({}),
        },
        async () =>
          text(
            {
              ok: false,
              status: 'BLOCKED',
              reason: `${name} moves money, which this gateway does not allow directly.`,
              useInstead: 'propose_cart',
            },
            true,
          ),
      );
    } else if (kind === 'READ' && deps.bridge !== undefined && scopes.read) {
      const bridge = deps.bridge;
      server.registerTool(
        name,
        {
          description: `PayPal: ${name.replaceAll('_', ' ')} (read only).`,
          inputSchema: z.looseObject({}),
        },
        async (args: Record<string, unknown>) => text(await bridge.call(name, args)),
      );
    }
  }
}

export function createGatewayServer(deps: GatewayDeps, scopes: Scopes): McpServer {
  const server = new McpServer({ name: 'bursar', version: '0.0.0' });
  registerNative(server, deps, scopes);
  registerToolkit(server, deps, scopes);
  return server;
}

/** One request, one server: no session state to leak between agents. Returns the HTTP response. */
export async function handleMcp(
  request: Request,
  deps: GatewayDeps,
  scopes: Scopes,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  const server = createGatewayServer(deps, scopes);
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    queueMicrotask(() => void server.close());
  }
}
