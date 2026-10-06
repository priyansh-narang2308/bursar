import { type AgentRole, createToolbox } from '@bursar/agent-tools';
import { EVAL_CASES, EVAL_CATALOG, heuristicModel } from '@bursar/agents/eval';
import { createCatalog, createFixtureApi } from '@bursar/channel3';
import { CoreError } from '@bursar/core';
import { world } from '@bursar/core/testing';
import { carts, workflowRuns } from '@bursar/db';
import { createRuntime } from '@bursar/llm';
import { standardPolicy } from '@bursar/policy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflows, labTasks, reconcileWindow, type Task } from '../src';

let w: Awaited<ReturnType<typeof world>>;
const usd = (cents: number) => ({ currency: 'USD' as const, minor: String(cents) });
const START = '2026-10-05T00:00:00Z';

beforeAll(async () => {
  w = await world({ budget: 100_000 });
  await w.core.catalog.createSupplier(w.orgId, w.owner, {
    name: 'shop.example',
    payoutEmail: 's@example.com',
  });
});
afterAll(() => w.close());

const flaky = { calls: 0 };
const extraTasks: Record<string, Task> = {
  flaky: async () => {
    if (flaky.calls++ === 0) throw new Error('worker crashed');
    return { ok: true };
  },
  refuses: async () => {
    throw new CoreError('FORBIDDEN', 'No.');
  },
};

function workflows(attempts = 2) {
  const catalog = createCatalog({ api: createFixtureApi(EVAL_CATALOG) });
  return createWorkflows({
    db: w.db,
    core: w.core,
    attempts,
    sleep: async () => undefined,
    extraTasks,
    agentDeps: (orgId, missionId) => {
      const toolbox = (role: AgentRole) =>
        createToolbox({
          db: w.db,
          core: w.core,
          catalog,
          policy: standardPolicy(),
          orgId,
          agentId: 'agt_buyer',
          role,
          missionId,
        });
      return {
        runtime: createRuntime({
          provider: heuristicModel(EVAL_CASES),
          sleep: async () => undefined,
        }),
        missionId,
        toolbox,
      };
    },
  });
}

describe('the runner', () => {
  it('runs the whole pipeline, and running it again repeats nothing', async () => {
    const goal = EVAL_CASES[0]?.goal ?? '';
    const mission = await w.core.catalog.createMission(w.orgId, w.owner, {
      goal,
      budget: usd(250_000),
      mandateId: w.mandateId,
      deadline: new Date('2026-10-09T00:00:00Z'),
    });
    const missionId = mission?.id as never;
    const wf = workflows();
    const first = await wf.runPipeline(w.orgId, missionId);
    expect(first.researched).toHaveLength(2);
    expect(first.bought).toMatchObject({
      status: 'SUCCEEDED',
      replayed: false,
      result: { ok: true },
    });
    const again = await wf.runPipeline(w.orgId, missionId);
    expect([again.planned, ...again.researched, again.bought].every((r) => r.replayed)).toBe(true);
    expect(again.bought.result).toEqual(first.bought.result);
    const made = await w.db.select().from(carts);
    expect(made.filter((c) => c.missionId === missionId)).toHaveLength(1);
    const events = await wf.taskRunEvents(w.orgId, first.bought.id);
    expect(events.map((e) => e.topic)).toEqual(['workflow.started', 'workflow.succeeded']);

    // A carrier is four days late on the chairs: the replan swaps them and proposes a new cart.
    const chair = (await wf.startTask(w.orgId, 'plan_mission', { missionId }, missionId)).result;
    expect(chair).toBeTruthy();
    const lines = await w.db.query.cartLines.findMany({
      where: (l, { eq }) => eq(l.cartId, made.find((c) => c.missionId === missionId)?.id as never),
    });
    const offerIds = lines.map((l) => l.offerId);
    const chairOffer = (await w.db.query.offers.findMany()).find(
      (o) => o.title.includes('chair') && offerIds.includes(o.id),
    )?.id as string;
    const replanned = await wf.startTask(
      w.orgId,
      'replan_schedule',
      {
        missionId,
        start: START,
        replan: {
          event: { kind: 'DELAY', taskId: `${chairOffer}:deliver`, days: 4 },
          leadDays: Object.fromEntries(offerIds.map((id) => [id, id === chairOffer ? 3 : 2])),
          alternatives: [
            {
              taskId: `${chairOffer}:deliver`,
              offerId: w.offers.pens?.id ?? '',
              label: 'Pens',
              leadDays: 1,
            },
          ],
        },
      },
      `${missionId}/delay-1`,
    );
    expect(replanned.result).toMatchObject({ status: 'RECOVERY_PROPOSED', finishDelta: 4 });
    expect((replanned.result as { outcome: string }).outcome).toBeTruthy(); // it went through the decision pipeline
    expect((await w.db.select().from(carts)).filter((c) => c.missionId === missionId)).toHaveLength(
      2,
    );
    const onTime = await wf.startTask(
      w.orgId,
      'replan_schedule',
      {
        missionId,
        start: START,
        replan: {
          event: { kind: 'DELAY', taskId: `${w.offers.pens?.id}:deliver`, days: 0 },
          leadDays: {},
          alternatives: [],
        },
      },
      `${missionId}/no-delay`,
    );
    expect(onTime.error).toBeNull();
    expect(onTime.result).toMatchObject({ status: 'ON_TIME' });
  });

  it('tries a crashed task again, but not one that was refused', async () => {
    const wf = workflows(1);
    const failed = await wf.startTask(w.orgId, 'flaky', {}, 'k1');
    expect(failed).toMatchObject({ status: 'FAILED', error: 'worker crashed' });
    const retried = await wf.startTask(w.orgId, 'flaky', {}, 'k1');
    expect(retried).toMatchObject({ status: 'SUCCEEDED', attempts: 2, replayed: false });
    expect((await wf.startTask(w.orgId, 'flaky', {}, 'k1')).replayed).toBe(true);

    const patient = workflows(3);
    flaky.calls = 0;
    expect(await patient.startTask(w.orgId, 'flaky', {}, 'k2')).toMatchObject({
      status: 'SUCCEEDED',
      attempts: 1,
    });
    const refused = await patient.startTask(w.orgId, 'refuses', {}, 'k3');
    expect(refused).toMatchObject({ status: 'FAILED', error: 'FORBIDDEN: No.' });
    const runs = await w.db.select().from(workflowRuns);
    expect(runs.filter((r) => r.task === 'refuses')).toHaveLength(1);
  });

  it('refuses an unknown task and bounds a slow one', async () => {
    const wf = workflows();
    await expect(wf.startTask(w.orgId, 'nope', {}, 'k')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const slow = createWorkflows({
      db: w.db,
      core: w.core,
      attempts: 1,
      timeoutMs: 20,
      agentDeps: () => {
        throw new Error('unused');
      },
      extraTasks: { slow: () => new Promise(() => undefined) },
    });
    expect(await slow.startTask(w.orgId, 'slow', {}, 'k')).toMatchObject({
      status: 'FAILED',
      error: 'slow timed out.',
    });
  });

  it('reconciles as a system job', async () => {
    expect(await reconcileWindow(w.core)).toMatchObject({ gaps: [] });
  });
});

describe('the policy lab as tasks', () => {
  it('fans a run out over scenarios, each once, and reports what broke', async () => {
    let played = 0;
    // A stand-in environment that approves everything, so any big scenario breaks the daily limit.
    const approveAll = async () => ({
      order: async (step: { unitCents: number; quantity: number }) => {
        played++;
        return { outcome: 'ALLOW' as const, amountCents: step.unitCents * step.quantity };
      },
    });
    const wf = createWorkflows({
      db: w.db,
      core: w.core,
      sleep: async () => undefined,
      agentDeps: () => {
        throw new Error('unused');
      },
      extraTasks: labTasks(approveAll, 4),
    });
    const input = { seed: 5, count: 16, config: { without: [], overrides: {} } };
    const run = await wf.startTask(w.orgId, 'lab_run', input, 'lab-1');
    expect(run.result).toMatchObject({ total: 16 });
    expect((run.result as { broken: number }).broken).toBeGreaterThan(0);
    const after = played;
    const again = await wf.startTask(w.orgId, 'lab_run', input, 'lab-1');
    expect(again.replayed).toBe(true);
    expect(played).toBe(after);
  });
});
