import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {
  createCatalog,
  createFixtureApi,
  createLiveApi,
  type ProductApi,
  RECORDED_PRODUCTS,
} from '@bursar/channel3';
import { type Actor, CoreError, createCore, WEBHOOK_EVENT_TYPES } from '@bursar/core';
import { decodeKey, decryptSecret, parseKeyring } from '@bursar/crypto';
import {
  actions,
  cartLines,
  carts,
  createDb,
  envelopes,
  mandates,
  missions,
  offers,
  organizations,
  users,
  withOrg,
} from '@bursar/db';
import {
  createCoreLab,
  DEFAULT_LIMITS,
  generate,
  invariants,
  judge,
  minimize,
  type PolicyConfig,
  policyBook,
  proposePatches,
  runLab,
  type Scenario,
} from '@bursar/lab';
import { createRuntime, persistRun } from '@bursar/llm';
import { Money } from '@bursar/money';
import { createPayPalClient, PayPalError } from '@bursar/paypal';
import { createFakePayPal } from '@bursar/paypal-fake';
import { standardPolicy } from '@bursar/policy';
import { runMissionOnRender } from '@bursar/render-workflow/client';
import { dayOf, planFromBasket, type Schedule, schedule as scheduleOf } from '@bursar/schedule';
import { type MissionId, newId, type OrganizationId } from '@bursar/schemas';
import { createWorkflows, recoveryFor } from '@bursar/workflows';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { and, count, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Hono } from 'hono';
import { Pool } from 'pg';
import { createApp, type DemoHooks } from './app';
import { loadConfig } from './config';
import { webHeaders } from './http/headers';
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
  NODE_ENV: process.env['NODE_ENV'] === 'production' ? 'production' : 'development',
  DATABASE_URL: 'memory',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  DEMO_MODE: 'true',
  ...(process.env['PUBLIC_BASE_URL'] ? { PUBLIC_BASE_URL: process.env['PUBLIC_BASE_URL'] } : {}),
  PORT: process.env['PORT'] ?? '8787',
});
const logger = createLogger(config.logLevel);
// With BURSAR_DATABASE_URL the demo uses a real Postgres (migrated at start, so workspaces survive a restart and
// the server stays small); without it, an in-memory one that needs nothing.
const databaseUrl = process.env['BURSAR_DATABASE_URL'];
const { db } = databaseUrl
  ? await connect(databaseUrl)
  : await (await import('@bursar/db/testing')).createTestDb();

async function connect(url: string) {
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
  });
  return createDb(url);
}

// `BURSAR_PAYPAL=sandbox` uses PayPal's real sandbox with the keys in `.env` and the buyers in the payer pool
// (`pnpm dev:payer`). Without it, everything runs against an in-process fake and needs no keys.
const sandbox = process.env['BURSAR_PAYPAL'] === 'sandbox';
const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`BURSAR_PAYPAL=sandbox needs ${name} in the environment.`);
  return value;
};
const fake = sandbox ? undefined : createFakePayPal();

/** Every call that reaches PayPal (not counting its sign-in), so a test of the guard can say "none". */
let paypalCalls = 0;
const countingFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  if (!url.includes('oauth')) paypalCalls++;
  return (fake?.fetch ?? fetch)(input, init);
};
const paypal = createPayPalClient(
  fake === undefined
    ? {
        clientId: need('PAYPAL_CLIENT_ID'),
        clientSecret: need('PAYPAL_CLIENT_SECRET'),
        baseUrl: 'https://api-m.sandbox.paypal.com',
        fetch: countingFetch,
      }
    : {
        clientId: fake.config.clientId,
        clientSecret: fake.config.clientSecret,
        baseUrl: 'https://fake.paypal.test',
        fetch: countingFetch,
        sleep: async () => undefined,
        maxRetries: 0,
      },
);
const vaultKeys = parseKeyring(
  sandbox ? need('VAULT_ENC_KEY') : Buffer.from(bytes(1)).toString('hex'),
);
/** How far the lab's clock has been moved on. It is put back after every run. */
let labSkewMs = 0;
const book = policyBook(standardPolicy());
const coreOptions = {
  db,
  paypal,
  vaultKeys,
  approvalKey:
    sandbox && process.env['APPROVAL_HMAC_KEY']
      ? decodeKey(process.env['APPROVAL_HMAC_KEY'])
      : sandbox
        ? randomBytes(32)
        : bytes(40),
  provenanceKeys: [sandbox ? decodeKey(need('PROVENANCE_HMAC_KEY')) : bytes(80)],
  webhookId: sandbox ? (process.env['PAYPAL_WEBHOOK_ID'] ?? 'unset') : 'WH-0001',
  // A pooled buyer's token is shared by every workspace, so one workspace revoking must not delete it.
  keepVaultTokens: sandbox,
  policyFor: book.policyFor as never,
};
const core = createCore(coreOptions);
// The Policy Lab runs scenarios in a made-up future (a day's limit has to mean a day), in organisations of its own,
// on a core with its own clock: a visitor approving a purchase while the lab runs must not be stamped in that future
// (the database refuses it, and the approval failed).
const labCore = createCore({ ...coreOptions, now: () => new Date(Date.now() + labSkewMs) });
if (fake !== undefined)
  await paypal.webhooks.register({
    requestId: 'hook',
    url: 'https://demo.test/webhooks/paypal',
    eventTypes: WEBHOOK_EVENT_TYPES,
  });

/** Buyers who approved once, with `pnpm dev:payer`, whose approval each workspace borrows. */
const POOL_FILE = fileURLToPath(new URL('../../../.bursar/payers.json', import.meta.url));
// On a host there is no file: the sealed pool travels in an environment variable instead.
const poolJson =
  process.env['BURSAR_PAYER_POOL'] ??
  (existsSync(POOL_FILE) ? readFileSync(POOL_FILE, 'utf8') : undefined);
const payerPool: string[] =
  sandbox && poolJson !== undefined
    ? (JSON.parse(poolJson) as { sealed: string }[]).map((p) =>
        decryptSecret(vaultKeys, p.sealed, 'payer-pool'),
      )
    : [];
let nextPayer = 0;
// Which products agents search: real ones recorded from Channel3 (the default, no key or credits needed),
// Channel3 itself (`BURSAR_CATALOG=live`, spends credits within a budget), or the small synthetic set.
const catalogMode = (process.env['BURSAR_CATALOG'] ?? 'recorded') as
  | 'recorded'
  | 'live'
  | 'synthetic';
const channel3Key = process.env['CHANNEL3_API_KEY'];
if (catalogMode === 'live' && !channel3Key)
  throw new Error('BURSAR_CATALOG=live needs CHANNEL3_API_KEY.');
const catalogProducts = catalogMode === 'synthetic' ? EVAL_CATALOG : RECORDED_PRODUCTS;
const productApi: ProductApi =
  catalogMode === 'live'
    ? createLiveApi({ apiKey: channel3Key ?? '' })
    : createFixtureApi(catalogProducts);
const catalog = createCatalog({ api: productApi });
/** The retailers an owner has approved: the ones in the recorded or synthetic set. A live search is held to the same list. */
const approvedDomains = [
  ...new Set(
    [...RECORDED_PRODUCTS, ...EVAL_CATALOG].flatMap((p) =>
      (p.offers ?? []).map((o) => o.domain.toLowerCase()),
    ),
  ),
];
const supplierEmail = process.env['PAYPAL_SUPPLIER_1_EMAIL'];
fake?.fund(Money.of(100_000_000n, 'USD'));

// PayPal's webhooks reach the money loop as they would over HTTP, a moment after they happen. The sandbox has
// no public address here, so there the loop asks PayPal instead (the fallback the product has for lost webhooks).
setInterval(() => {
  if (fake !== undefined)
    for (const { headers, event } of fake.events.splice(0))
      void core.webhooks.ingest(JSON.stringify(event), headers).catch(() => undefined);
}, 400).unref();
// Each poll holds a database connection while it asks PayPal, so workspaces are polled one at a time and a sweep
// never starts while the last one runs: polling them all at once took every connection in the pool as workspaces
// accumulated, and every request then waited for one.
let sweeping = false;
if (sandbox)
  setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void db
      .select({ id: organizations.id })
      .from(organizations)
      .then(async (orgs) => {
        for (const o of orgs) await core.webhooks.pollSubmitted(o.id, 4_000).catch(() => 0);
      })
      .catch(() => undefined)
      .finally(() => {
        sweeping = false;
      });
  }, 5_000).unref();

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
/** Real products have no lead time in the catalog, so the demo gives each a stable one from its id. */
const leadOf = (quoteId: string | null) =>
  LEAD[quoteId ?? ''] ??
  1 + ([...(quoteId ?? '')].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 997, 7) % 5);
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

async function seedWorkspace(
  orgId: string,
  ownerId: string,
  domains: readonly string[] = approvedDomains,
) {
  const id = orgId as OrganizationId;
  const now = Date.now();
  const caps = {
    cap: usd(1_000_000),
    perMissionCap: usd(200_000),
    validFrom: new Date(now - DAY),
    validTo: new Date(now + 90 * DAY),
  };
  let mandateId: string;
  if (sandbox) {
    const token = payerPool[nextPayer++ % Math.max(payerPool.length, 1)];
    if (token === undefined)
      throw new CoreError(
        'VALIDATION_FAILED',
        'The payer pool is empty. Run `pnpm dev:payer` once to approve a sandbox buyer.',
      );
    mandateId = (
      await core.mandates.adopt(id, owner(ownerId), {
        payerName: 'Sandbox buyer',
        ...caps,
        paymentTokenId: token,
      })
    ).mandateId;
  } else {
    const started = await core.mandates.start(id, owner(ownerId), {
      payerName: 'Sample buyer',
      ...caps,
      returnUrl: 'https://demo.test/return',
      cancelUrl: 'https://demo.test/cancel',
    });
    fake?.approveSetupToken(started.setupTokenId);
    await core.mandates.complete(id, owner(ownerId), started.mandateId as never);
    mandateId = started.mandateId;
  }
  for (const domain of domains)
    await core.catalog.createSupplier(id, owner(ownerId), {
      name: domain,
      payoutEmail: supplierEmail ?? `sales@${domain}`,
    });
  await core.catalog.createMission(id, owner(ownerId), {
    goal:
      catalogMode === 'synthetic'
        ? 'Set up a workstation: a standing desk, an office chair, a monitor and a keyboard'
        : 'Equip a workstation: a monitor, a keyboard, a webcam and a headset',
    budget: usd(100_000),
    deadline: new Date(now + 6 * DAY),
    mandateId: mandateId as never,
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
  await seedWorkspace(orgId, userId, ['shop.example']);
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

// The Policy Lab. First-supplier approvals are off in its organisations so an order can be approved on its own,
// which is what makes a hole in the other rules visible. "no-velocity" is the seeded hole: nothing limits a day.
const LAB_POLICIES: Record<'standard' | 'no-velocity', PolicyConfig> = {
  standard: { without: ['R-NEW-VENDOR'], overrides: {} },
  'no-velocity': { without: ['R-NEW-VENDOR', 'R-VELOCITY'], overrides: {} },
};
const labEnv = createCoreLab({
  core: labCore,
  db,
  book,
  advance: (minutes) => {
    labSkewMs += minutes * 60_000;
  },
});
let labBusy = false;
/*
 * The lab is deterministic (a fixed seed, the same pipeline), so the same question always has the same answer. Each
 * answer is worked out once and kept, and the two a visitor is most likely to ask are worked out at boot: on a small
 * instance a cold run takes minutes, and a judge should not wait for it.
 */
const labAnswers = new Map<string, Promise<unknown>>();
function remembered<T>(key: string, work: () => Promise<T>): Promise<T> {
  let answer = labAnswers.get(key) as Promise<T> | undefined;
  if (answer === undefined) {
    answer = work().catch((error: unknown) => {
      labAnswers.delete(key);
      throw error;
    });
    labAnswers.set(key, answer);
  }
  return answer;
}

/** One lab run at a time, and the clock put back afterwards, so a visitor cannot pile them up. */
async function withLab<T>(work: () => Promise<T>): Promise<T> {
  if (labBusy)
    throw new CoreError('CONFLICT', 'The lab is already running. Try again in a moment.');
  labBusy = true;
  try {
    return await work();
  } finally {
    labBusy = false;
    labSkewMs = 0;
  }
}

async function runAgentsHere(orgId: string, missionId: string) {
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
    if (fake === undefined)
      throw new CoreError(
        'VALIDATION_FAILED',
        'On PayPal’s sandbox the buyer approves on PayPal’s own page.',
      );
    fake.approveSetupToken(row.setupTokenId);
    await core.mandates.complete(orgId as OrganizationId, owner(ownerId), mandateId as never);
  },

  async runAgents(orgId, missionId) {
    // On a Render Workflow each need is researched on its own instance, in parallel. If that is not set up, or
    // the run fails, the mission runs here instead, so the demo never depends on it.
    const slug = process.env['RENDER_WORKFLOW_SLUG'];
    if (process.env['BURSAR_WORKFLOWS'] === 'render' && slug && process.env['RENDER_API_KEY']) {
      try {
        return await runMissionOnRender({ slug, orgId, missionId });
      } catch (error) {
        logger.warn(
          { err: error instanceof Error ? error.message : 'unknown' },
          'the Render workflow did not run; running here',
        );
      }
    }
    return { ...(await runAgentsHere(orgId, missionId)), ranOn: 'in-process' };
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
    await paypal.payments
      .capture({
        requestId: `rogue-${randomBytes(8).toString('hex')}`,
        authorizationId: held.paypalAuthorizationId,
        amount: Money.of(5_000n, 'USD'),
        finalCapture: false,
      })
      .catch((error: unknown) => {
        if (!(error instanceof PayPalError)) throw error;
        throw new CoreError(
          'CONFLICT',
          'That hold is already used up. Try the kill switch after approving a purchase and before capturing it.',
        );
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
    const alternatives = found.all
      .filter(
        (o) =>
          o.id !== target.id &&
          o.category === target.category &&
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

  labRun: ({ policy, count }) =>
    remembered(`run:${policy}:${count}`, () =>
      withLab(async () => {
        const config = LAB_POLICIES[policy];
        const report = await runLab(
          (scenario) => labEnv(config, scenario),
          await generate({ seed: 2026, count }),
          invariants(),
        );
        const brokenByFamily: Record<string, number> = {};
        for (const f of report.findings)
          brokenByFamily[f.scenario.family] = (brokenByFamily[f.scenario.family] ?? 0) + 1;
        return {
          policy,
          total: report.total,
          byFamily: report.byFamily,
          brokenByFamily,
          broken: report.findings.length,
          findings: report.findings.slice(0, 8),
        };
      }),
    ),

  labFix: ({ policy, scenario }) =>
    remembered(`fix:${policy}:${JSON.stringify(scenario)}`, () =>
      withLab(async () => {
        const config = LAB_POLICIES[policy];
        const rules = invariants();
        const broken = async (s: Scenario) =>
          (await judge(await labEnv(config, s), s, rules)).length > 0;
        const found = scenario as Scenario;
        if (!(await broken(found)))
          throw new CoreError('VALIDATION_FAILED', 'That scenario does not break this policy.');
        const minimal = await minimize(found, broken);
        const [violation] = await judge(await labEnv(config, minimal), minimal, rules);
        const [patch] = violation ? proposePatches(violation, config, DEFAULT_LIMITS) : [];
        const cleanAfter = patch
          ? (await judge(await labEnv(patch.apply(config), minimal), minimal, rules)).length === 0
          : false;
        return {
          minimal,
          violation: violation ?? null,
          patch: patch?.description ?? null,
          cleanAfter,
        };
      }),
    ),

  gauntlet: runGauntlet,
};

/**
 * What a scheduled run does, one step at a time so a failing step is reported and does not stop the rest:
 * reconcile PayPal's records with ours, expire approvals and mandates that ran out, and (against the sandbox,
 * which has no webhook for it) ask PayPal about captures still waiting. Reconciliation is cross-tenant, which
 * is why it runs here and not behind a tenant route.
 */
async function runScheduledJobs() {
  const step = async <T>(work: () => Promise<T>) =>
    work().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message.slice(0, 160) : 'failed',
      }),
    );
  // Cross-tenant on purpose (this is the job runner): it reads as the database owner, which row-level security
  // does not restrict. Only workspaces with something due are visited, one at a time: demo workspaces pile up by
  // the hundred, and sweeping them all outran the scheduler's wait.
  const [total] = await db.select({ n: count() }).from(organizations);
  const due = async (rows: Promise<{ id: string }[]>) =>
    (await rows).map((r) => r.id as OrganizationId);
  const sweep = async (ids: OrganizationId[], work: (id: OrganizationId) => Promise<number>) => {
    let done = 0;
    for (const id of ids) done += await work(id).catch(() => 0);
    return done;
  };
  const awaiting = await due(
    db
      .selectDistinct({ id: actions.orgId })
      .from(actions)
      .where(eq(actions.state, 'AWAITING_APPROVAL')),
  );
  const lapsed = await due(
    db
      .selectDistinct({ id: mandates.orgId })
      .from(mandates)
      .where(and(eq(mandates.status, 'ACTIVE'), lte(mandates.validTo, new Date()))),
  );
  const submitted = await due(
    db
      .selectDistinct({ id: actions.orgId })
      .from(actions)
      .where(and(eq(actions.state, 'SUBMITTED'), eq(actions.type, 'CAPTURE'))),
  );
  return {
    organisations: total?.n ?? 0,
    visited: { approvals: awaiting.length, mandates: lapsed.length, captures: submitted.length },
    reconcile: await step(async () => {
      const report = await core.incidents.reconcile();
      return { checked: report.checked, gaps: report.gaps.length };
    }),
    expiredApprovals: await step(() => sweep(awaiting, (id) => core.actions.expireApprovals(id))),
    expiredMandates: await step(() => sweep(lapsed, (id) => core.mandates.expire(id))),
    confirmedCaptures: await step(() =>
      sweep(submitted, (id) => core.webhooks.pollSubmitted(id, 60_000)),
    ),
  };
}

const app = createApp({
  config,
  db,
  logger,
  core,
  demo,
  agentTools: { catalog, policy: standardPolicy() },
  ...(process.env['JOB_TOKEN']
    ? { jobs: { token: process.env['JOB_TOKEN'], run: runScheduledJobs } }
    : {}),
  integrations: {
    paypal: sandbox
      ? {
          mode: 'sandbox',
          detail:
            'PayPal’s real sandbox: holds, captures and refunds are real calls, with sandbox money.',
        }
      : {
          mode: 'fake',
          detail:
            'An in-process stand-in for PayPal’s APIs, checked by the same contract suite as the real client.',
        },
    catalog:
      catalogMode === 'live'
        ? {
            mode: 'live',
            detail:
              'Channel3, searched live within a credit budget. Only retailers an owner has approved can be bought from.',
          }
        : catalogMode === 'recorded'
          ? {
              mode: 'recorded',
              detail: `${RECORDED_PRODUCTS.length} real products from Channel3, recorded once, so the demo needs no key. Set BURSAR_CATALOG=live to search live.`,
            }
          : { mode: 'offline', detail: 'A small synthetic catalog.' },
    model: {
      mode: 'scripted',
      detail:
        'A deterministic stand-in for the agents’ model. The Claude provider is written but not connected.',
    },
  },
});
// One address for everything: the API, and the built web app for any other path (so a deploy needs one service).
const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));
const hasWeb = existsSync(`${WEB_DIST}/index.html`);
const dist = relative(process.cwd(), WEB_DIST);
const isApi = (path: string) => /^\/(v1|webhooks|healthz|readyz|openapi\.json)(\/|$)/.test(path);
const server = new Hono();
if (hasWeb) {
  server.use('*', webHeaders());
  server.use('*', (c, next) => (isApi(c.req.path) ? next() : serveStatic({ root: dist })(c, next)));
  server.get('*', (c, next) =>
    isApi(c.req.path) ? next() : serveStatic({ path: `${dist}/index.html` })(c, next),
  );
}
server.route('/', app);
serve({ fetch: server.fetch, port: config.port });
// Work out the lab's two usual answers in the background, one after the other, while nobody is waiting.
setTimeout(() => {
  void (async () => {
    for (const policy of ['standard', 'no-velocity'] as const) {
      const run = await demo.labRun({ policy, count: 24 }).catch(() => undefined);
      const first = (run as { findings?: { scenario: unknown }[] } | undefined)?.findings?.[0]
        ?.scenario;
      if (first !== undefined)
        await demo.labFix({ policy, scenario: first }).catch(() => undefined);
    }
  })();
}, 5_000);
logger.info(
  { port: config.port, web: hasWeb, paypal: sandbox ? 'sandbox' : 'fake' },
  'demo listening (in-memory data)',
);
