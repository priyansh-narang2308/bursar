import { parseKeyring } from '@bursar/crypto';
import { organizations, users } from '@bursar/db';
import { createTestDb } from '@bursar/db/testing';
import { createPayPalClient } from '@bursar/paypal';
import { createFakePayPal } from '@bursar/paypal-fake';
import { standardPolicy } from '@bursar/policy';
import { newId, type OrganizationId } from '@bursar/schemas';
import { type Actor, CircuitBreaker, createCore, WEBHOOK_EVENT_TYPES } from '../src';

const bytes = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => seed + i);
export const usd = (cents: number) => ({ currency: 'USD' as const, minor: String(cents) });

/** A hook into what the core says to PayPal: force a mock failure, or lose the answer to a call. */
export interface Wire {
  mock: string | undefined;
  /** Lose the answer to the next call whose path matches (PayPal acts; Bursar never hears). */
  dropAnswerTo: RegExp | undefined;
  /** Runs after PayPal handled a call and before the answer is returned. */
  afterCall: ((path: string) => Promise<void>) | undefined;
}

/**
 * The whole money loop on a throwaway database against the fake PayPal, with one organisation that has an
 * active mandate, a supplier, two offers and a mission. `lenient` drops R-NEW-VENDOR so a first order does
 * not wait for a person.
 */
export async function world(
  options: { lenient?: boolean; budget?: number; keepVaultTokens?: boolean } = {},
) {
  const { db, close } = await createTestDb();
  let clock = new Date('2026-10-05T12:00:00Z');
  const fake = createFakePayPal({ now: () => clock });
  const wire: Wire = { mock: undefined, dropAnswerTo: undefined, afterCall: undefined };
  const fetchWithWire: typeof fetch = async (input, init) => {
    const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      .pathname;
    const headers = new Headers(init?.headers);
    if (wire.mock !== undefined && !path.includes('oauth'))
      headers.set('paypal-mock-response', wire.mock);
    const response = await fake.fetch(input, { ...init, headers });
    if (wire.dropAnswerTo?.test(path)) {
      wire.dropAnswerTo = undefined;
      throw new TypeError('connection reset');
    }
    await wire.afterCall?.(path);
    return response;
  };
  const paypal = createPayPalClient({
    clientId: fake.config.clientId,
    clientSecret: fake.config.clientSecret,
    baseUrl: 'https://fake.paypal.test',
    fetch: fetchWithWire,
    sleep: async () => undefined,
    maxRetries: 0,
  });
  const breaker = new CircuitBreaker(3, 30_000, () => clock.getTime());
  const standard = standardPolicy();
  const policy =
    options.lenient === false
      ? standard
      : { rules: standard.rules.filter((r) => r.rule.id !== 'R-NEW-VENDOR') };
  const core = createCore({
    db,
    paypal,
    vaultKeys: parseKeyring(Buffer.from(bytes(1)).toString('hex')),
    approvalKey: bytes(40),
    provenanceKeys: [bytes(80)],
    webhookId: 'WH-0001',
    now: () => clock,
    keepVaultTokens: options.keepVaultTokens,
    breaker,
    policyFor: () => policy,
  });
  await paypal.webhooks.register({
    requestId: 'hook',
    url: 'https://app.test/webhooks/paypal',
    eventTypes: WEBHOOK_EVENT_TYPES,
  });

  const orgId: OrganizationId = newId('organization');
  await db.insert(organizations).values({ id: orgId, name: 'Acme' });
  const owner = { kind: 'USER', id: await person() } as Actor;
  async function person(): Promise<string> {
    const id = newId('user');
    await db
      .insert(users)
      .values({ id, email: `${id.toLowerCase()}@example.com`, displayName: 'Person' });
    return id;
  }
  const agent: Actor = { kind: 'AGENT', id: 'agt_buyer' };

  const started = await core.mandates.start(orgId, owner, {
    payerName: 'Pat',
    cap: usd(1_000_000),
    perMissionCap: usd(500_000),
    validFrom: new Date('2026-10-01T00:00:00Z'),
    validTo: new Date('2026-12-01T00:00:00Z'),
    returnUrl: 'https://app.test/r',
    cancelUrl: 'https://app.test/c',
  });
  fake.approveSetupToken(started.setupTokenId);
  await core.mandates.complete(orgId, owner, started.mandateId as never);

  const supplier = await core.catalog.createSupplier(orgId, owner, {
    name: 'Paper Co',
    payoutEmail: 'paper@example.com',
  });
  const offer = (title: string, cents: number) =>
    core.catalog.recordOffer(orgId, {
      supplierId: supplier?.id as never,
      title,
      category: 'office',
      url: 'https://shop.example/x',
      price: usd(cents),
    });
  const [pens, paper] = [await offer('Pens', 1_000), await offer('Paper', 500)];
  const mission = await core.catalog.createMission(orgId, owner, {
    goal: 'Office supplies',
    budget: usd(options.budget ?? 10_000),
    mandateId: started.mandateId,
  });
  const cart = (
    lines: { offerId: string; quantity: number }[] = [
      { offerId: pens?.id ?? '', quantity: 2 },
      { offerId: paper?.id ?? '', quantity: 2 },
    ],
  ) => core.catalog.buildCart(orgId, owner, mission?.id as never, lines as never);

  return {
    db,
    close,
    fake,
    paypal,
    wire,
    core,
    orgId,
    owner,
    agent,
    person,
    breaker,
    mandateId: started.mandateId,
    missionId: mission?.id as never,
    supplier,
    offers: { pens, paper },
    cart,
    advance(ms: number): void {
      clock = new Date(clock.getTime() + ms);
    },
    takeEvent() {
      const event = fake.events.shift();
      if (event === undefined) throw new Error('PayPal sent no webhook');
      return event;
    },
    /** Delivers to the core every webhook the fake has signed and not yet delivered. */
    async deliver(): Promise<string[]> {
      const statuses: string[] = [];
      for (const { headers, event } of fake.events.splice(0))
        statuses.push(await core.webhooks.ingest(JSON.stringify(event), headers));
      return statuses;
    },
  };
}
export type World = Awaited<ReturnType<typeof world>>;
