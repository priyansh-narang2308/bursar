import { appendEvent, genesisHead, headOf, verifyChain } from '@bursar/audit';
import { ACTION_TRANSITIONS, newId, type OrganizationId } from '@bursar/schemas';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actions,
  auditEvents,
  createDb,
  type Db,
  envelopes,
  mandates,
  missions,
  organizations,
  payers,
  paypalEvents,
  policySets,
  withOrg,
} from '../src';
import { createTestDb } from '../src/testing';
import { MONEY, query, rejects, seedOrg, sha } from './support';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

describe('createDb', () => {
  it('builds a pooled connection without connecting until it is used', async () => {
    const pooled = createDb('postgres://bursar@127.0.0.1:1/none');
    expect(typeof pooled.db.transaction).toBe('function');
    await pooled.close();
  });
});

describe('tenant isolation', () => {
  let a: OrganizationId;
  let b: OrganizationId;
  beforeAll(async () => {
    a = await seedOrg(db);
    b = await seedOrg(db);
  });

  it('shows a tenant only its own rows, even from a query with no WHERE', async () => {
    const seen = await withOrg(db, a, (tx) => tx.select({ org: missions.orgId }).from(missions));
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((row) => row.org))).toEqual(new Set([a]));
  });

  it('shows no rows at all when no organisation is set', async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role bursar_app`);
      return tx.select().from(missions);
    });
    expect(rows).toEqual([]);
  });

  it('refuses a write for another tenant, and cannot touch its rows', async () => {
    const foreign = await db.select().from(missions).where(sql`org_id = ${b}`);
    const [theirs] = foreign;
    await rejects(
      withOrg(db, a, (tx) =>
        tx.insert(missions).values({ ...MONEY.mission(), id: newId('mission'), orgId: b }),
      ),
      /row-level security/,
    );
    const changed = await withOrg(db, a, (tx) =>
      tx.update(missions).set({ goal: 'hijacked' }).where(sql`id = ${theirs?.id}`).returning(),
    );
    const removed = await withOrg(db, a, (tx) =>
      tx.delete(missions).where(sql`id = ${theirs?.id}`).returning(),
    );
    expect([changed, removed]).toEqual([[], []]);
  });

  it('hides the other organisations and the global tables from a tenant', async () => {
    expect(
      (await withOrg(db, a, (tx) => tx.select().from(organizations))).map((o) => o.id),
    ).toEqual([a]);
    await rejects(
      withOrg(db, a, (tx) => tx.execute(sql`select * from webhook_inbox`)),
      /permission denied/,
    );
  });

  it('holds every table that has an org_id to the same rule', async () => {
    const result = await query<{ tbl: string; rls: boolean; policies: number }>(
      db,
      sql`
      select c.table_name as tbl, t.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.tablename = c.table_name) as policies
      from information_schema.columns c join pg_class t on t.relname = c.table_name
      where c.table_schema = 'public' and c.column_name = 'org_id'`,
    );
    expect(result.length).toBeGreaterThan(15);
    expect(result.filter((row) => !row.rls || row.policies === 0)).toEqual([]);
  });

  it('knows every table: tenant tables carry an org_id and the rest are listed here as global', async () => {
    const result = await query<{ name: string }>(
      db,
      sql`
      select table_name as name from information_schema.tables t where table_schema = 'public'
        and not exists (select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'org_id')`,
    );
    expect(result.map((row) => row.name).sort()).toEqual([
      'action_transitions',
      'organizations',
      'users',
      'webhook_inbox',
    ]);
  });
});

describe('what the database enforces itself', () => {
  let org: OrganizationId;
  beforeAll(async () => {
    org = await seedOrg(db);
  });

  it('refuses two actions with one idempotency key', async () => {
    const key = sha('same action');
    await db.insert(actions).values(MONEY.action(org, { idempotencyKey: key }));
    await rejects(
      db.insert(actions).values(MONEY.action(org, { idempotencyKey: key })),
      /idempotency_key/,
    );
  });

  it('moves an action only along the legal transitions', async () => {
    const [action] = await db.insert(actions).values(MONEY.action(org)).returning();
    const move = (state: string) =>
      db
        .update(actions)
        .set({ state: state as 'APPROVED' })
        .where(sql`id = ${action?.id}`);
    await rejects(move('CONFIRMED'), /cannot move from PROPOSED to CONFIRMED/);
    await move('APPROVED');
    await move('SUBMITTING');
    await move('SUBMITTED');
    await move('CONFIRMED');
    await rejects(move('SUBMITTING'), /cannot move from CONFIRMED/);
  });

  it('starts every action as PROPOSED', async () => {
    await rejects(
      db.insert(actions).values(MONEY.action(org, { state: 'APPROVED' })),
      /starts as PROPOSED/,
    );
  });

  it('keeps the legal transitions equal to ACTION_TRANSITIONS in @bursar/schemas', async () => {
    const result = await query<{ from_state: string; to_state: string }>(
      db,
      sql`select from_state, to_state from action_transitions`,
    );
    const inDatabase = result.map((row) => `${row.from_state}>${row.to_state}`).sort();
    const inCode = Object.entries(ACTION_TRANSITIONS)
      .flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`))
      .sort();
    expect(inDatabase).toEqual(inCode);
  });

  it('never lets the Verifier spend, or a money action go without an amount', async () => {
    await rejects(
      db.insert(actions).values(MONEY.action(org, { proposedBy: 'VERIFIER' })),
      /verifier_never_spends/,
    );
    await rejects(
      db.insert(actions).values(MONEY.action(org, { amountMinor: null, currency: null })),
      /moves_money/,
    );
  });

  it('never lets an envelope hold or capture more than its ceiling', async () => {
    const [mission, mandate] = await MONEY.fundedMission(db, org);
    const envelope = { ...MONEY.envelope(org, mission, mandate), ceilingMinor: 10_000n };
    await rejects(
      db.insert(envelopes).values({ ...envelope, heldMinor: 6_000n, capturedMinor: 4_001n }),
      /never_overspent/,
    );
    const [ok] = await db
      .insert(envelopes)
      .values({ ...envelope, heldMinor: 6_000n, capturedMinor: 4_000n })
      .returning();
    await rejects(
      db.update(envelopes).set({ heldMinor: 6_001n }).where(sql`id = ${ok?.id}`),
      /never_overspent/,
    );
  });

  it('checks a cart line’s arithmetic and an approval’s signature', async () => {
    await rejects(MONEY.cartLine(db, org, { lineTotalMinor: 1n }), /cart_lines_total/);
    await rejects(
      MONEY.approval(db, org, { status: 'APPROVED', signature: null }),
      /approvals_signed/,
    );
  });

  it('refuses a duplicate PayPal event, and a payer repeated', async () => {
    const event = MONEY.paypalEvent(org);
    await db.insert(paypalEvents).values(event);
    await rejects(
      db.insert(paypalEvents).values({ ...event, id: newId('paypalEvent') }),
      /event_id/,
    );
    const [policySet] = await db
      .insert(policySets)
      .values({ id: newId('policySet'), orgId: org, name: 'p' })
      .returning();
    expect(policySet).toBeDefined();
    const payer = { id: newId('payer'), orgId: org, paypalPayerId: 'PAYER-1', displayName: 'Pat' };
    await db.insert(payers).values(payer);
    await rejects(
      db.insert(payers).values({ ...payer, id: newId('payer') }),
      /payers_paypal_unique/,
    );
  });

  it('stores a Vault token only sealed', async () => {
    await rejects(
      MONEY.mandate(db, org, { vaultTokenSealed: 'plain-token-1234' }),
      /mandates_sealed/,
    );
    await MONEY.mandate(db, org, { vaultTokenSealed: 'bursar:secret:v1:1:iv:ct:tag' });
    expect(await db.select().from(mandates).where(sql`org_id = ${org}`)).not.toHaveLength(0);
  });
});

describe('the ledger', () => {
  let org: OrganizationId;
  beforeAll(async () => {
    org = await seedOrg(db);
  });
  const entry = (txn: string, side: 'DEBIT' | 'CREDIT', amount: bigint, currency = 'USD') => sql`
    insert into ledger_entries (org_id, txn_id, account, side, currency, amount_minor)
    values (${org}, ${txn}, 'cash', ${side}, ${currency}, ${amount})`;

  it('commits a balanced transaction, per currency', async () => {
    await db.transaction(async (tx) => {
      const txn = crypto.randomUUID();
      await tx.execute(entry(txn, 'DEBIT', 500n));
      await tx.execute(entry(txn, 'CREDIT', 500n));
      await tx.execute(entry(txn, 'DEBIT', 70n, 'EUR'));
      await tx.execute(entry(txn, 'CREDIT', 70n, 'EUR'));
    });
  });

  it('refuses an unbalanced transaction when it commits, and nothing of it is kept', async () => {
    const txn = crypto.randomUUID();
    await rejects(
      db.transaction(async (tx) => {
        await tx.execute(entry(txn, 'DEBIT', 500n));
        await tx.execute(entry(txn, 'CREDIT', 499n));
      }),
      /does not balance/,
    );
    const kept = await query(db, sql`select 1 from ledger_entries where txn_id = ${txn}`);
    expect(kept).toEqual([]);
  });

  it('is append-only', async () => {
    await rejects(
      db.execute(sql`update ledger_entries set account = 'x' where org_id = ${org}`),
      /append-only/,
    );
    await rejects(db.execute(sql`delete from ledger_entries where org_id = ${org}`), /append-only/);
  });
});

describe('the audit log', () => {
  it('stores a chain that @bursar/audit still verifies after it comes back from the database', async () => {
    const org = await seedOrg(db);
    let head = genesisHead(org);
    for (let n = 1; n <= 3; n++) {
      const event = appendEvent(head, {
        id: newId('auditEvent'),
        ts: '2026-10-05T12:00:00Z',
        actor: { kind: 'SYSTEM', id: null },
        type: 'mission.created',
        payload: { n, note: 'café', nested: { b: 2, a: [1, 0.5, null] } },
      });
      await withOrg(db, org, (tx) =>
        tx
          .insert(auditEvents)
          .values({ ...event, actorKind: event.actor.kind, actorId: event.actor.id }),
      );
      head = headOf(event);
    }
    const rows = await withOrg(db, org, (tx) =>
      tx.select().from(auditEvents).orderBy(auditEvents.seq),
    );
    const entries = rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      seq: row.seq,
      ts: row.ts,
      actor: { kind: row.actorKind, id: row.actorId },
      type: row.type,
      payload: row.payload,
      prevHash: row.prevHash,
      hash: row.hash,
    }));
    expect(verifyChain(entries, { orgId: org, through: head })).toMatchObject({
      ok: true,
      count: 3,
    });
  });

  it('refuses a duplicate number, a fork, and any edit', async () => {
    const org = await seedOrg(db);
    const first = appendEvent(genesisHead(org), {
      id: newId('auditEvent'),
      ts: '2026-10-05T12:00:00Z',
      actor: { kind: 'SYSTEM', id: null },
      type: 'a.b',
      payload: {},
    });
    const row = (event: typeof first) => ({
      ...event,
      actorKind: event.actor.kind,
      actorId: event.actor.id,
    });
    await db.insert(auditEvents).values(row(first));
    const sameSeq = { ...first, id: newId('auditEvent'), prevHash: sha('other'), hash: sha('x') };
    await rejects(db.insert(auditEvents).values(row(sameSeq)), /audit_events_seq_unique/);
    const fork = { ...sameSeq, seq: 2, prevHash: first.prevHash };
    await rejects(db.insert(auditEvents).values(row(fork)), /audit_events_no_fork/);
    await rejects(
      db.execute(sql`update audit_events set type = 'x.y' where org_id = ${org}`),
      /append-only/,
    );
    await rejects(db.execute(sql`truncate audit_events`), /append-only/);
  });
});
