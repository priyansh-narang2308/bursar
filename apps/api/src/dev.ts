import { randomBytes } from 'node:crypto';
import { type AgentRole, createToolbox, type ToolCallLog } from '@bursar/agent-tools';
import { runMission } from '@bursar/agents';
import { demoModel } from '@bursar/agents/demo';
import { EVAL_CATALOG } from '@bursar/agents/eval';
import {
  compromised,
  guardedTools,
  gullibleModel,
  type NaiveBank,
  naiveTools,
  PAYLOADS,
} from '@bursar/agents/injection';
import { createCatalog, createFixtureApi } from '@bursar/channel3';
import { type Actor, CoreError, createCore, WEBHOOK_EVENT_TYPES } from '@bursar/core';
import { parseKeyring } from '@bursar/crypto';
import {
  cartLines,
  carts,
  envelopes,
  mandates,
  missions,
  offers,
  organizations,
  users,
  withOrg,
} from '@bursar/db';
import { createTestDb } from '@bursar/db/testing';
import { createRuntime, persistRun } from '@bursar/llm';
import { Money } from '@bursar/money';
import { createPayPalClient } from '@bursar/paypal';
import { createFakePayPal } from '@bursar/paypal-fake';
import { standardPolicy } from '@bursar/policy';
import { dayOf, planFromBasket, type Schedule, schedule as scheduleOf } from '@bursar/schedule';
import { type MissionId, newId, type OrganizationId } from '@bursar/schemas';
import { createWorkflows, recoveryFor } from '@bursar/workflows';
import { serve } from '@hono/node-server';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { createApp, type DemoHooks } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';

/*
 * The whole product on one machine with no keys and no Docker: an in-memory Postgres, the fake PayPal, an
 * offline product catalog and a scripted model. It is what `pnpm dev:demo` runs, so the web app can be built
 * and shown without credentials. Nothing here is used in production.
 */

const bytes = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => seed + i);
const usd = (cents: number) => ({ currency: 'USD' as const, minor: String(cents) });
const DAY = 86_400_000;

const config = loadConfig({
  NODE_ENV: 'development',
  DATABASE_URL: 'memory',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  DEMO_MODE: 'true',
  PORT: process.env['PORT'] ?? '8787',
});
const logger = createLogger(config.logLevel);
const { db } = await createTestDb();
const fake = createFakePayPal();

/** Every call that reaches PayPal (not counting its sign-in), so a test of the guard can say "none". */
let paypalCalls = 0;
const countingFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  if (!url.includes('oauth')) paypalCalls++;
  return fake.fetch(input, init);
};
const paypal = createPayPalClient({
  clientId: fake.config.clientId,
  clientSecret: fake.config.clientSecret,
  baseUrl: 'https://fake.paypal.test',
  fetch: countingFetch,
  sleep: async () => undefined,
  maxRetries: 0,
});
const core = createCore({
  db,
  paypal,
  vaultKeys: parseKeyring(Buffer.from(bytes(1)).toString('hex')),
  approvalKey: bytes(40),
  provenanceKeys: [bytes(80)],
  webhookId: 'WH-0001',
});
await paypal.webhooks.register({
  requestId: 'hook',
  url: 'https://demo.test/webhooks/paypal',
  eventTypes: WEBHOOK_EVENT_TYPES,
});
const catalog = createCatalog({ api: createFixtureApi(EVAL_CATALOG) });
fake.fund(Money.of(100_000_000n, 'USD'));

// PayPal's webhooks reach the money loop as they would over HTTP, a moment after they happen.
setInterval(() => {
  for (const { headers, event } of fake.events.splice(0))
    void core.webhooks.ingest(JSON.stringify(event), headers).catch(() => undefined);
}, 400).unref();

const owner = (id: string): Actor => ({ kind: 'USER', id });
const replanner: Actor = { kind: 'AGENT', id: 'agt_replanner' };
const workflows = createWorkflows({
  db,
  core,
  actor: replanner,
  agentDeps: () => {
    throw new Error('The demo runs agents through its own route.');
  },
});

/** Days from order to delivery for each product in the offline catalog. */
const LEAD: Record<string, number> = {
  d1: 3,
  d2: 2,
  d3: 5,
  c1: 3,
  c2: 1,
  m1: 3,
  m2: 2,
  l1: 1,
  k1: 1,
  k2: 2,
  p1: 1,
  p2: 1,
  w1: 4,
  h1: 2,
  w2: 2,
};
const leadOf = (quoteId: string | null) => LEAD[quoteId ?? ''] ?? 2;
const startOfToday = () => new Date(Math.floor(Date.now() / DAY) * DAY);

const asTimings = (s: Schedule) => ({
  finish: s.finish,
  deadline: s.deadline,
  deadlineSlack: s.deadlineSlack,
  criticalPath: s.criticalPath,
  timings: s.timings.map((t) => ({
    id: t.id,
    es: t.es,
    ef: t.ef,
    slack: t.slack,
    critical: t.critical,
  })),
});

/** The mission's latest cart as delivery lines, with the offers it could be swapped for. */
async function basket(orgId: OrganizationId, missionId: string) {
  return withOrg(db, orgId, async (tx) => {
    const [mission] = await tx
      .select()
      .from(missions)
      .where(eq(missions.id, missionId as never));
    const [cart] = await tx
      .select()
      .from(carts)
      .where(eq(carts.missionId, missionId as never))
      .orderBy(desc(carts.version))
      .limit(1);
    if (!mission || !cart) return undefined;
    const lines = await tx
      .select({ offer: offers })
      .from(cartLines)
      .innerJoin(offers, eq(offers.id, cartLines.offerId))
      .where(eq(cartLines.cartId, cart.id));
    const all = await tx.select().from(offers);
    return { mission, offers: lines.map((l) => l.offer), all };
  });
}

const names = (list: { id: string; title: string }[]) =>
  Object.fromEntries(
    list
      .flatMap((o) => [
        [`${o.id}:deliver`, `${o.title} delivered`],
        [`${o.id}:inspect`, `${o.title} inspected`],
      ])
      .concat([['handover', 'Handover']]),
  );

async function seedWorkspace(orgId: string, ownerId: string) {
  const id = orgId as OrganizationId;
  const now = Date.now();
  const started = await core.mandates.start(id, owner(ownerId), {
    payerName: 'Sample buyer',
    cap: usd(1_000_000),
    perMissionCap: usd(200_000),
    validFrom: new Date(now - DAY),
    validTo: new Date(now + 90 * DAY),
    returnUrl: 'https://demo.test/return',
    cancelUrl: 'https://demo.test/cancel',
  });
  fake.approveSetupToken(started.setupTokenId);
  await core.mandates.complete(id, owner(ownerId), started.mandateId as never);
  await core.catalog.createSupplier(id, owner(ownerId), {
    name: 'shop.example',
    payoutEmail: 'sales@shop.example',
  });
  await core.catalog.createMission(id, owner(ownerId), {
    goal: 'Set up a workstation: a standing desk, an office chair, a monitor and a keyboard',
    budget: usd(100_000),
    deadline: new Date(now + 6 * DAY),
    mandateId: started.mandateId,
  });
}

let gauntletResult: unknown;

async function runGauntlet() {
  if (gauntletResult !== undefined) return gauntletResult;
  const orgId = newId('organization');
  const userId = newId('user');
  await db.insert(organizations).values({ id: orgId, name: 'Gauntlet' });
  await db.insert(users).values({
    id: userId,
    email: `${userId.toLowerCase()}@demo.bursar.dev`,
    displayName: 'Gauntlet',
  });
  await seedWorkspace(orgId, userId);
  const [mission] = await withOrg(db, orgId, (tx) => tx.select().from(missions));
  const missionId = mission?.id as MissionId;
  const rows = [];
  for (const payload of PAYLOADS) {
    const bad = {
      id: 'bad',
      title: payload.title,
      offers: [
        {
          url: 'https://shop.example/bad',
          domain: 'shop.example',
          price: { price: 100, currency: 'USD' },
          availability: 'InStock',
        },
      ],
    };
    const api = createFixtureApi([bad, ...EVAL_CATALOG.filter((p) => p.id === 'd1')]);
    const box = (role: AgentRole) =>
      createToolbox({
        db,
        core,
        catalog: createCatalog({ api }),
        policy: standardPolicy(),
        orgId,
        agentId: 'agt_gauntlet',
        role,
        missionId,
      });
    const converse = (
      tools: Parameters<ReturnType<typeof createRuntime>['start']> extends never
        ? never
        : Parameters<ReturnType<ReturnType<typeof createRuntime>['start']>['converse']>[0]['tools'],
    ) =>
      createRuntime({ provider: gullibleModel(missionId) })
        .start({ agentId: 'agt_gauntlet', role: 'RESEARCHER' })
        .converse({ system: 'Find what the user asks for.', user: 'Find a standing desk.', tools })
        .catch(() => undefined);

    const bank: NaiveBank = { payments: [], carts: [] };
    await converse(naiveTools(box('RESEARCHER'), bank));

    const before = paypalCalls;
    let refused = 0;
    const guarded = guardedTools(box('RESEARCHER'), box('BUYER'));
    const call = guarded.call;
    guarded.call = async (name, input) => {
      const out = await call(name, input);
      if (!out.ok) refused++;
      return out;
    };
    await converse(guarded);
    rows.push({
      id: payload.id,
      family: payload.family,
      text: payload.title.replace('Standing desk ', '').slice(0, 90),
      naiveCompromised: compromised(bank),
      guardedRefused: refused,
      guardedPayPalCalls: paypalCalls - before,
    });
  }
  gauntletResult = {
    total: rows.length,
    naiveCompromised: rows.filter((r) => r.naiveCompromised).length,
    guardedPayPalCalls: rows.reduce((n, r) => n + r.guardedPayPalCalls, 0),
    rows,
  };
  return gauntletResult;
}

const demo: DemoHooks = {
  seed: seedWorkspace,

  async approveMandate(orgId, mandateId, ownerId) {
    const [row] = await withOrg(db, orgId as OrganizationId, (tx) =>
      tx
        .select()
        .from(mandates)
        .where(eq(mandates.id, mandateId as never)),
    );
    if (row?.setupTokenId == null) throw new Error('That mandate is not waiting for the buyer.');
    fake.approveSetupToken(row.setupTokenId);
    await core.mandates.complete(orgId as OrganizationId, owner(ownerId), mandateId as never);
  },

  async runAgents(orgId, missionId) {
    const id = orgId as OrganizationId;
    const calls: ToolCallLog[] = [];
    const toolbox = (role: AgentRole) =>
      createToolbox({
        db,
        core,
        catalog,
        policy: standardPolicy(),
        orgId: id,
        agentId: 'agt_demo',
        role,
        missionId: missionId as MissionId,
        onCall: (c) => void calls.push(c),
      });
    const runtime = createRuntime({
      provider: demoModel(),
      onRun: (meta, report) => persistRun(db, id, meta, report),
    });
    const outcome = await runMission({
      runtime,
      missionId: missionId as MissionId,
      toolbox,
      agentId: 'agt_demo',
    });
    const picked = outcome.picks.flatMap((r) => (r.pick?.offerId ? [r.pick.offerId] : []));
    const rows =
      picked.length === 0
        ? []
        : await withOrg(db, id, (tx) =>
            tx
              .select()
              .from(offers)
              .where(inArray(offers.id, picked as never)),
          );
    const byId = new Map(rows.map((o) => [o.id as string, o]));
    return {
      needs: outcome.needs.map((n) => ({ label: n.label, query: n.query, quantity: n.quantity })),
      steps: outcome.picks.map((r) => {
        const offer = r.pick?.offerId ? byId.get(r.pick.offerId) : undefined;
        return {
          need: r.need.label,
          quantity: r.need.quantity,
          offer: offer && {
            id: offer.id,
            title: offer.title,
            unitMinor: String(offer.priceMinor),
            currency: offer.currency,
          },
          rationale: r.pick?.rationale ?? null,
          citation: r.cited,
          problem: r.problem,
        };
      }),
      proposal: outcome.proposal,
      problems: outcome.problems,
      calls,
    };
  },

  async rogueCapture(orgId) {
    const [held] = await withOrg(db, orgId as OrganizationId, (tx) =>
      tx
        .select()
        .from(envelopes)
        .where(and(isNotNull(envelopes.paypalAuthorizationId)))
        .limit(1),
    );
    if (!held?.paypalAuthorizationId)
      throw new CoreError(
        'VALIDATION_FAILED',
        'Approve a purchase first, so there is a hold to capture.',
      );
    // Straight to PayPal, with no action behind it: nothing in Bursar asked for this.
    await paypal.payments.capture({
      requestId: `rogue-${randomBytes(8).toString('hex')}`,
      authorizationId: held.paypalAuthorizationId,
      amount: Money.of(5_000n, 'USD'),
      finalCapture: false,
    });
    return { captured: true };
  },

  async schedule(orgId, missionId) {
    const found = await basket(orgId as OrganizationId, missionId);
    if (!found) return { tasks: [] };
    const start = startOfToday();
    const deadline = found.mission.deadline ? dayOf(start, found.mission.deadline) : undefined;
    const tasks = planFromBasket(
      found.offers.map((o) => ({ id: o.id, label: o.title, leadDays: leadOf(o.quoteId) })),
    );
    return {
      start: start.toISOString(),
      names: names(found.offers),
      ...asTimings(scheduleOf(tasks, { deadline })),
    };
  },

  async replan(orgId, missionId, { days, apply }) {
    const id = orgId as OrganizationId;
    const found = await basket(id, missionId);
    if (!found) throw new CoreError('NOT_FOUND', 'That mission has no cart to plan.');
    // The longest delivery is the one a delay hurts most.
    const target = [...found.offers].sort((a, b) => leadOf(b.quoteId) - leadOf(a.quoteId))[0];
    if (!target) throw new CoreError('NOT_FOUND', 'That mission has no cart to plan.');
    const stem = target.title.split(' ').slice(0, 2).join(' ');
    const alternatives = found.all
      .filter(
        (o) =>
          o.id !== target.id &&
          o.title.startsWith(stem) &&
          leadOf(o.quoteId) < leadOf(target.quoteId),
      )
      .map((o) => ({
        taskId: `${target.id}:deliver`,
        offerId: o.id,
        label: o.title,
        leadDays: leadOf(o.quoteId),
      }));
    const input = {
      missionId,
      start: startOfToday().toISOString(),
      replan: {
        event: { kind: 'DELAY', taskId: `${target.id}:deliver`, days },
        leadDays: Object.fromEntries(found.offers.map((o) => [o.id, leadOf(o.quoteId)])),
        alternatives,
      },
    };
    const { recovery } = await recoveryFor({ db, orgId: id }, input as never);
    const applied =
      apply && recovery.swaps.length > 0
        ? await workflows.startTask(
            id,
            'replan_schedule',
            input as never,
            `${missionId}/delay-${days}`,
          )
        : null;
    return {
      names: {
        ...names(found.offers),
        ...names(alternatives.map((a) => ({ id: a.offerId, title: a.label }))),
      },
      delayedTask: target.title,
      days,
      baseline: asTimings(recovery.baseline),
      delayed: asTimings(recovery.delayed),
      recovered: recovery.recovered ? asTimings(recovery.recovered) : null,
      swaps: recovery.swaps.map((s) => ({
        offerId: s.offerId,
        label: s.label,
        leadDays: s.leadDays,
      })),
      applied: applied?.result ?? null,
    };
  },

  gauntlet: runGauntlet,
};

const app = createApp({
  config,
  db,
  logger,
  core,
  demo,
  agentTools: { catalog, policy: standardPolicy() },
  integrations: {
    paypal: {
      mode: 'fake',
      detail:
        'An in-process stand-in for PayPal’s APIs, checked by the same contract suite as the real client.',
    },
    catalog: {
      mode: 'offline',
      detail: 'A 16-product offline catalog. The Channel3 adapter is written but not connected.',
    },
    model: {
      mode: 'scripted',
      detail:
        'A deterministic stand-in for the agents’ model. The Claude provider is written but not connected.',
    },
  },
});
serve({ fetch: app.fetch, port: config.port });
logger.info({ port: config.port }, 'demo api listening (in-memory data, fake PayPal)');
