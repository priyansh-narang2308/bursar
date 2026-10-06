import { randomBytes } from 'node:crypto';
import { type AgentRole, createToolbox, type ToolCallLog } from '@bursar/agent-tools';
import { runMission } from '@bursar/agents';
import { demoModel } from '@bursar/agents/demo';
import { EVAL_CATALOG } from '@bursar/agents/eval';
import { createCatalog, createFixtureApi } from '@bursar/channel3';
import { type Actor, createCore, WEBHOOK_EVENT_TYPES } from '@bursar/core';
import { parseKeyring } from '@bursar/crypto';
import { mandates, offers, withOrg } from '@bursar/db';
import { createTestDb } from '@bursar/db/testing';
import { createRuntime, persistRun } from '@bursar/llm';
import { Money } from '@bursar/money';
import { createPayPalClient } from '@bursar/paypal';
import { createFakePayPal } from '@bursar/paypal-fake';
import { standardPolicy } from '@bursar/policy';
import type { MissionId, OrganizationId } from '@bursar/schemas';
import { serve } from '@hono/node-server';
import { eq, inArray } from 'drizzle-orm';
import { createApp, type DemoHooks } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';

/*
 * The whole product on one machine with no keys and no Docker: an in-memory Postgres, the fake PayPal, an
 * offline product catalog and a scripted model. It is what `pnpm dev:demo` runs, so the web app can be built
 * and shown without credentials. Nothing here is used in production.
 */

const bytes = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => seed + i);
const usd = (cents: number) => ({
  currency: 'USD' as const,
  minor: String(cents),
});
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
const paypal = createPayPalClient({
  clientId: fake.config.clientId,
  clientSecret: fake.config.clientSecret,
  baseUrl: 'https://fake.paypal.test',
  fetch: fake.fetch,
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

const demo: DemoHooks = {
  async seed(orgId, ownerId) {
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
      deadline: new Date(now + 7 * DAY),
      mandateId: started.mandateId,
    });
  },

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
      needs: outcome.needs.map((n) => ({
        label: n.label,
        query: n.query,
        quantity: n.quantity,
      })),
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
};

const app = createApp({
  config,
  db,
  logger,
  core,
  demo,
  agentTools: { catalog, policy: standardPolicy() },
});
serve({ fetch: app.fetch, port: config.port });
logger.info({ port: config.port }, 'demo api listening (in-memory data, fake PayPal)');
