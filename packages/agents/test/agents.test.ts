import { type AgentRole, createToolbox } from '@bursar/agent-tools';
import { createCatalog, createFixtureApi } from '@bursar/channel3';
import { world } from '@bursar/core/testing';
import { createRuntime, mockProvider, type Provider, say, useTool } from '@bursar/llm';
import { standardPolicy } from '@bursar/policy';
import { newId } from '@bursar/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AgentDeps, buy, plan, research, runMission } from '../src';
import { EVAL_CASES, EVAL_CATALOG, type EvalCase, evaluate, heuristicModel } from '../src/eval';

let w: Awaited<ReturnType<typeof world>>;
beforeAll(async () => {
  w = await world({ budget: 100_000 });
  await w.core.catalog.createSupplier(w.orgId, w.owner, {
    name: 'shop.example',
    payoutEmail: 's@example.com',
  });
});
afterAll(() => w.close());

const usd = (cents: number) => ({ currency: 'USD' as const, minor: String(cents) });

async function setup(
  provider: Provider,
  budgetMinor = 100_000,
  onRun: Parameters<typeof createRuntime>[0]['onRun'] = undefined,
) {
  const mission = await w.core.catalog.createMission(w.orgId, w.owner, {
    goal: 'Equip the office',
    budget: usd(budgetMinor),
    mandateId: w.mandateId,
  });
  const missionId = mission?.id as never;
  const catalog = createCatalog({ api: createFixtureApi(EVAL_CATALOG) });
  const toolbox = (role: AgentRole) =>
    createToolbox({
      db: w.db,
      core: w.core,
      catalog,
      policy: standardPolicy(),
      orgId: w.orgId,
      agentId: 'agt_buyer',
      role,
      missionId,
    });
  const deps: AgentDeps = {
    runtime: createRuntime({
      provider,
      sleep: async () => undefined,
      ...(onRun === undefined ? {} : { onRun }),
    }),
    missionId,
    toolbox,
  };
  return { deps, missionId };
}

describe('the agents', () => {
  it('plans a goal into needs with ids of their own', async () => {
    const { deps } = await setup(
      mockProvider([useTool('plan', { needs: [{ label: 'desk', query: 'desk', quantity: 2 }] })]),
    );
    const { needs } = await plan(deps);
    expect(needs).toMatchObject([{ label: 'desk', quantity: 2 }]);
    expect(needs[0]?.needId).toMatch(/^ned_/);
  });

  it('refuses a pick the search never returned, and one that says nothing fits', async () => {
    const need = { needId: 'need_x' as never, label: 'desk', query: 'standing desk', quantity: 1 };
    const invented = heuristicModel([]);
    const lying: Provider = {
      complete: async (r) =>
        r.forceTool === 'pick'
          ? useTool('pick', {
              offerId: newId('offer'),
              quantity: 1,
              rationale: 'trust me',
            })
          : invented.complete(r),
    };
    const a = await research((await setup(lying)).deps, need);
    expect(a).toMatchObject({ pick: null, cited: 'invalid' });
    const none: Provider = {
      complete: async (r) =>
        r.forceTool === 'pick'
          ? useTool('pick', { offerId: null, quantity: 1, rationale: 'none' })
          : invented.complete(r),
    };
    expect(await research((await setup(none)).deps, need)).toMatchObject({
      pick: null,
      cited: 'none',
    });
  });

  it('proposes nothing when there is nothing to buy', async () => {
    expect(await buy((await setup(mockProvider([say('x')]))).deps, [])).toBeNull();
  });

  it('runs a whole mission: plan, research in parallel, one cart the server priced', async () => {
    const goal = EVAL_CASES[0] as EvalCase;
    const { deps } = await setup(heuristicModel(EVAL_CASES), goal.budgetMinor);
    // The heuristic finds the case by the mission's goal text, so name the mission after it.
    const mission = await w.core.catalog.createMission(w.orgId, w.owner, {
      goal: goal.goal,
      budget: usd(goal.budgetMinor),
      mandateId: w.mandateId,
    });
    const outcome = await runMission({
      ...deps,
      missionId: mission?.id as never,
      toolbox: (r) => deps.toolbox(r),
    });
    expect(outcome.needs).toHaveLength(2);
    expect(outcome.problems).toEqual([]);
    expect(outcome.proposal).toMatchObject({ ok: true });
  });
});

describe('the eval harness', () => {
  it('scores every goal offline, and the guards show up in the score', async () => {
    const report = await evaluate(EVAL_CASES, async (c, onRun) => {
      const mission = await w.core.catalog.createMission(w.orgId, w.owner, {
        goal: c.goal,
        budget: usd(c.budgetMinor),
        mandateId: w.mandateId,
      });
      const missionId = mission?.id as never;
      const catalog = createCatalog({ api: createFixtureApi(EVAL_CATALOG) });
      const toolbox = (role: AgentRole) =>
        createToolbox({
          db: w.db,
          core: w.core,
          catalog,
          policy: standardPolicy(),
          orgId: w.orgId,
          agentId: 'agt_buyer',
          role,
          missionId,
        });
      return {
        deps: {
          runtime: createRuntime({
            provider: heuristicModel(EVAL_CASES),
            sleep: async () => undefined,
            onRun,
          }),
          missionId,
          toolbox,
        },
        db: w.db,
        orgId: w.orgId,
      };
    });
    expect(report.cases).toHaveLength(EVAL_CASES.length);
    const byId = Object.fromEntries(report.cases.map((s) => [s.id, s]));
    expect(byId['desks']).toMatchObject({ constraintsMet: true, inStockRate: 1 }); // skipped the cheaper desk that is out of stock
    expect(byId['unobtainable']).toMatchObject({ constraintsMet: true });
    expect(byId['unobtainable']?.problems.join()).toContain('treadmill');
    expect(report.summary.validCitationRate).toBe(1);
    expect(report.summary.constraintsMetRate).toBeGreaterThanOrEqual(0.7);
    expect(report.summary.meanTokens).toBeGreaterThan(0);
    expect(byId['lamps']?.constraintsMet).toBe(false); // 20 lamps do not fit the budget, and the score says so
  });
});
