import type { Catalog, Quote } from '@bursar/channel3';
import { type Actor, type Core, CoreError } from '@bursar/core';
import { type Db, missions, offers, organizations, suppliers, withOrg } from '@bursar/db';
import { type CurrencyCode, Money } from '@bursar/money';
import type { Policy } from '@bursar/policy';
import { LLM_TOOLS, type LlmToolName, type MissionId, type OrganizationId } from '@bursar/schemas';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

/*
 * The tools an LLM agent is given. Three things hold here, and the tests pin each of them:
 *
 *  - An agent can call only what its role allows, and never anything outside `LLM_TOOLS`, whose inputs carry
 *    no amount, currency or payee (a test in @bursar/schemas guards that).
 *  - What comes back from the web is fenced as untrusted data. The model is told to read it, never obey it.
 *  - Search results are kept only when they come from a supplier a person has registered. The registry, not
 *    the model and not the catalog, decides who can be paid.
 */

export type AgentRole = 'PLANNER' | 'RESEARCHER' | 'BUYER';

/** Who may call what. A planner reads; a researcher searches; a buyer proposes. Nobody pays. */
export const ALLOW_LISTS: Readonly<Record<AgentRole, readonly LlmToolName[]>> = {
  PLANNER: ['get_org_context', 'get_policy_summary', 'get_mission'],
  RESEARCHER: ['get_mission', 'search_offers', 'get_offer', 'compare_offers'],
  BUYER: ['get_mission', 'get_policy_summary', 'get_offer', 'compare_offers', 'propose_cart'],
};

export interface ToolContext {
  readonly db: Db;
  readonly core: Core;
  readonly catalog: Catalog;
  readonly policy: Policy;
  readonly orgId: OrganizationId;
  readonly agentId: string;
  readonly role: AgentRole;
  /** The mission this run works for. It scopes the catalog budget. */
  readonly missionId: MissionId | null;
  readonly onCall?: (call: ToolCallLog) => void | Promise<void>;
}

export interface ToolCallLog {
  readonly tool: string;
  readonly agentId: string;
  readonly role: AgentRole;
  readonly ok: boolean;
  readonly code: string | null;
  readonly ms: number;
}

export type ToolResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

const fail = (code: string, message: string): ToolResult => ({
  ok: false,
  error: { code, message },
});
const ok = (data: unknown): ToolResult => ({ ok: true, data });

/** Text from outside (a product title, a description) wrapped so it reads as data and cannot close its own fence. */
export function untrusted(source: string, text: string, max = 200): string {
  const printable = [...text].map((ch) =>
    ch.charCodeAt(0) < 32 || ch === '\u007f' || ch === '<' || ch === '>' ? ' ' : ch,
  );
  const clean = printable.join('').replace(/\s+/g, ' ').trim();
  return `<untrusted source="${source}">${clean.slice(0, max)}</untrusted>`;
}

const display = (minor: bigint, currency: string) =>
  Money.of(minor, currency as CurrencyCode).toString();

type OfferRow = typeof offers.$inferSelect;
const present = (o: OfferRow, supplier: string) => ({
  offerId: o.id,
  title: untrusted('catalog', o.title),
  brand: o.brand === null ? null : untrusted('catalog', o.brand, 60),
  category: o.category,
  price: display(o.priceMinor, o.currency),
  availability: o.availability,
  supplier,
  observedAt: o.observedAt.toISOString(),
});

type Input<N extends LlmToolName> = z.infer<(typeof LLM_TOOLS)[N]['input']>;

async function supplierNames(tx: Parameters<Parameters<typeof withOrg>[2]>[0], ids: string[]) {
  const rows = await tx
    .select()
    .from(suppliers)
    .where(inArray(suppliers.id, ids as never));
  return new Map(rows.map((s) => [s.id as string, s.name]));
}

const handlers = {
  async get_org_context(ctx: ToolContext) {
    return withOrg(ctx.db, ctx.orgId, async (tx) => {
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId));
      const open = await tx.select().from(missions);
      return {
        organization: org === undefined ? null : untrusted('workspace', org.name, 80),
        missions: open.map((m) => ({
          id: m.id,
          goal: untrusted('workspace', m.goal, 300),
          status: m.status,
        })),
      };
    });
  },

  async get_policy_summary(ctx: ToolContext) {
    // The rules' names, never their thresholds: a model that knows the limit can aim just under it.
    return {
      rules: ctx.policy.rules.map((r) => r.rule.id),
      note: 'The system checks every proposal against these rules and asks a person where they say so. Limits are not shown.',
    };
  },

  async get_mission(ctx: ToolContext, input: Input<'get_mission'>) {
    const [m] = await withOrg(ctx.db, ctx.orgId, (tx) =>
      tx.select().from(missions).where(eq(missions.id, input.missionId)),
    );
    if (m === undefined) return fail('NOT_FOUND', 'No such mission.');
    return {
      id: m.id,
      goal: untrusted('workspace', m.goal, 500),
      status: m.status,
      deadline: m.deadline?.toISOString() ?? null,
      budget: display(m.budgetMinor, m.currency),
    };
  },

  async search_offers(ctx: ToolContext, input: Input<'search_offers'>) {
    const quotes = await ctx.catalog.search(input.query, { missionId: ctx.missionId, limit: 25 });
    const registry = await withOrg(ctx.db, ctx.orgId, (tx) =>
      tx.select().from(suppliers).where(eq(suppliers.status, 'ACTIVE')),
    );
    const byDomain = new Map(registry.map((s) => [s.name.toLowerCase(), s]));
    const matched = quotes.flatMap((q) => {
      const supplier = byDomain.get(q.domain);
      return supplier === undefined ? [] : [{ q, supplier }];
    });
    const shown = [];
    for (const { q, supplier } of matched.slice(0, input.maxResults))
      shown.push(present(await snapshot(ctx, q, supplier.id, 'SEARCH'), supplier.name));
    return {
      needId: input.needId,
      offers: shown,
      // Offers from sellers nobody registered are not shown, and not an error.
      notFromApprovedSuppliers: quotes.length - matched.length,
    };
  },

  async get_offer(ctx: ToolContext, input: Input<'get_offer'>) {
    const [offer] = await withOrg(ctx.db, ctx.orgId, (tx) =>
      tx.select().from(offers).where(eq(offers.id, input.offerId)),
    );
    if (offer === undefined) return fail('NOT_FOUND', 'No such offer.');
    const names = await withOrg(ctx.db, ctx.orgId, (tx) => supplierNames(tx, [offer.supplierId]));
    const name = names.get(offer.supplierId) ?? '';
    if (offer.quoteId === null) return { offer: present(offer, name), requoted: false };
    const now = await ctx.catalog.requote(
      offer.quoteId,
      Money.of(offer.priceMinor, offer.currency as CurrencyCode),
      ctx.missionId,
    );
    if (now.quote === undefined)
      return fail('OFFER_UNAVAILABLE', 'The seller no longer lists this.');
    if (!now.changed) return { offer: present(offer, name), requoted: true, priceChanged: false };
    const fresh = await snapshot(ctx, now.quote, offer.supplierId, 'DETAIL');
    return {
      offer: present(fresh, name),
      requoted: true,
      priceChanged: true,
      previousOfferId: offer.id,
      changeBasisPoints: now.driftBasisPoints,
    };
  },

  async compare_offers(ctx: ToolContext, input: Input<'compare_offers'>) {
    return withOrg(ctx.db, ctx.orgId, async (tx) => {
      const rows = await tx.select().from(offers).where(inArray(offers.id, input.offerIds));
      if (rows.length !== new Set(input.offerIds).size)
        return fail('NOT_FOUND', 'One of those offers does not exist.');
      if (new Set(rows.map((r) => r.currency)).size > 1)
        return fail('CURRENCY_MISMATCH', 'These offers are in different currencies.');
      const names = await supplierNames(tx, [...new Set(rows.map((r) => r.supplierId))]);
      const sorted = [...rows].sort((a, b) => Number(a.priceMinor - b.priceMinor));
      return {
        needId: input.needId,
        cheapest: sorted[0]?.id,
        offers: sorted.map((o) => present(o, names.get(o.supplierId) ?? '')),
      };
    });
  },

  async propose_cart(ctx: ToolContext, input: Input<'propose_cart'>) {
    const actor: Actor = { kind: 'AGENT', id: ctx.agentId };
    const lines = input.lines.map((l) => ({ ...l, rationale: input.rationale }));
    const cart = await ctx.core.catalog.buildCart(ctx.orgId, actor, input.missionId, lines);
    const proposal = await ctx.core.actions.propose(ctx.orgId, actor, {
      type: 'AUTHORIZE',
      missionId: input.missionId,
      cartId: cart.cartId as never,
    });
    return {
      cartId: cart.cartId,
      actionId: proposal.actionId,
      total: display(BigInt(cart.total.minor), cart.total.currency),
      state: proposal.state,
      outcome: proposal.outcome,
      needsApproval: proposal.state === 'AWAITING_APPROVAL',
    };
  },
};

/** Records a quote as an offer snapshot under a registered supplier. Carts price from snapshots, never live. */
async function snapshot(
  ctx: ToolContext,
  quote: Quote,
  supplierId: string,
  source: 'SEARCH' | 'DETAIL',
): Promise<OfferRow> {
  const row = await ctx.core.catalog.recordOffer(ctx.orgId, {
    supplierId: supplierId as never,
    title: quote.title,
    category: quote.category,
    url: quote.url,
    price: { currency: quote.price.currency, minor: String(quote.price.minor) },
    availability: quote.availability,
    source,
    quoteId: quote.productId,
    ...(quote.brand === null ? {} : { brand: quote.brand }),
    ...(quote.imageUrl === null ? {} : { imageUrl: quote.imageUrl }),
  });
  if (row === undefined) throw new Error('The offer was not stored.');
  return row;
}

type Handler = (ctx: ToolContext, input: never) => Promise<unknown>;
const HANDLERS: Readonly<Partial<Record<LlmToolName, Handler>>> = handlers as never;

export function createToolbox(ctx: ToolContext) {
  const allowed = new Set<string>(ALLOW_LISTS[ctx.role]);
  const log = async (tool: string, started: number, result: ToolResult) =>
    ctx.onCall?.({
      tool,
      agentId: ctx.agentId,
      role: ctx.role,
      ok: result.ok,
      code: result.ok ? null : result.error.code,
      ms: Date.now() - started,
    });

  /** Whether this call may go ahead, and if so which handler and what input. */
  function admit(name: string, raw: unknown): ToolResult | { handler: Handler; input: unknown } {
    if (!Object.hasOwn(LLM_TOOLS, name))
      return fail('UNKNOWN_TOOL', `There is no tool called ${name}.`);
    if (!allowed.has(name))
      return fail('NOT_ALLOWED', `A ${ctx.role.toLowerCase()} may not use ${name}.`);
    const handler = HANDLERS[name as LlmToolName];
    if (handler === undefined) return fail('UNAVAILABLE', `${name} is not available yet.`);
    const parsed = LLM_TOOLS[name as LlmToolName].input.safeParse(raw);
    if (parsed.success) return { handler, input: parsed.data };
    const where = parsed.error.issues.map((i) => i.path.join('.') || '(input)').join(', ');
    return fail('INVALID_INPUT', `Fix these fields and try again: ${where}.`);
  }

  async function run(name: string, raw: unknown): Promise<ToolResult> {
    const admitted = admit(name, raw);
    if ('ok' in admitted) return admitted;
    try {
      const out = await admitted.handler(ctx, admitted.input as never);
      return typeof out === 'object' && out !== null && 'ok' in out ? (out as ToolResult) : ok(out);
    } catch (error) {
      if (error instanceof CoreError) return fail(error.code, error.detail);
      if (error instanceof Error && error.name === 'CatalogError')
        return fail('CATALOG_UNAVAILABLE', error.message);
      throw error;
    }
  }

  return {
    /** The tools this agent is shown, in the shape an LLM API takes. */
    definitions: () =>
      ALLOW_LISTS[ctx.role]
        .filter((n) => HANDLERS[n] !== undefined)
        .map((n) => ({
          name: n,
          description: LLM_TOOLS[n].description,
          input_schema: z.toJSONSchema(LLM_TOOLS[n].input),
        })),
    async call(name: string, raw: unknown): Promise<ToolResult> {
      const started = Date.now();
      const result = await run(name, raw);
      await log(name, started, result);
      return result;
    },
  };
}

export type Toolbox = ReturnType<typeof createToolbox>;
