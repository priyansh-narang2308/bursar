import { EVAL_CATALOG } from '@bursar/agents/eval';
import { createCatalog, createFixtureApi } from '@bursar/channel3';
import { world } from '@bursar/core/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMissionOnRender } from '../src/client';
import { assemble, buyCart, planMission, researchNeed, type Wiring } from '../src/tasks';

let w: Awaited<ReturnType<typeof world>>;
let wiring: Wiring;
beforeAll(async () => {
  w = await world({ budget: 100_000 });
  await w.core.catalog.createSupplier(w.orgId, w.owner, {
    name: 'shop.example',
    payoutEmail: 's@example.com',
  });
  wiring = {
    db: w.db,
    core: w.core,
    catalog: createCatalog({ api: createFixtureApi(EVAL_CATALOG) }),
  };
});
afterAll(() => w.close());

const usd = (cents: number) => ({ currency: 'USD' as const, minor: String(cents) });

describe('the mission pipeline as separate steps', () => {
  it('plans, researches every need on its own, and buys one cart: the same trace the screen shows', async () => {
    const mission = await w.core.catalog.createMission(w.orgId, w.owner, {
      goal: 'Get 2 monitors and a keyboard',
      budget: usd(100_000),
      mandateId: w.mandateId,
    });
    const id = mission?.id as string;
    const planned = await planMission(wiring, w.orgId, id);
    expect(planned.needs.map((n) => `${n.quantity} ${n.label}`)).toEqual([
      '2 monitors',
      '1 keyboards',
    ]);

    // Each need is researched by itself, as it is on its own instance, and the results are plain JSON.
    const researched = await Promise.all(
      planned.needs.map((n) => researchNeed(wiring, w.orgId, id, n as never)),
    );
    for (const r of researched) expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(researched.map((r) => r.step.citation)).toEqual(['valid', 'valid']);
    expect(researched[0]?.step.offer).toMatchObject({ currency: 'USD' });

    const picks = researched.flatMap((r) => (r.pick ? [r.pick] : []));
    const bought = await buyCart(wiring, w.orgId, id, picks);
    const trace = assemble(planned, researched, bought);
    expect(trace).toMatchObject({ ranOn: 'render-workflow', problems: [], proposal: { ok: true } });
    expect(trace.steps).toHaveLength(2);
    expect(trace.calls.map((c) => c.tool)).toEqual(
      expect.arrayContaining(['get_mission', 'search_offers', 'propose_cart']),
    );
  });

  it('reports a need nothing can meet, and proposes nothing', async () => {
    const mission = await w.core.catalog.createMission(w.orgId, w.owner, {
      goal: 'something unusual entirely',
      budget: usd(100_000),
      mandateId: w.mandateId,
    });
    const id = mission?.id as string;
    const planned = await planMission(wiring, w.orgId, id);
    const researched = await Promise.all(
      planned.needs.map((n) => researchNeed(wiring, w.orgId, id, n as never)),
    );
    expect(researched.some((r) => r.step.problem !== null)).toBe(true);
    const trace = assemble(
      planned,
      researched,
      await buyCart(
        wiring,
        w.orgId,
        id,
        researched.flatMap((r) => (r.pick ? [r.pick] : [])),
      ),
    );
    expect(trace.problems.length).toBeGreaterThan(0);
    expect(trace.proposal).toBeNull();
  });
});

describe('starting a run from the API', () => {
  it('returns the trace of a completed run, and throws for one that did not complete', async () => {
    const runTask = vi.fn();
    vi.doMock('@renderinc/sdk', () => ({
      Render: class {
        workflows = { runTask };
      },
    }));
    vi.resetModules();
    const { runMissionOnRender: run } = await import('../src/client');
    runTask.mockResolvedValueOnce({ status: 'completed', results: [{ ranOn: 'render-workflow' }] });
    expect(await run({ slug: 'bursar', orgId: 'org_1', missionId: 'mis_1' })).toEqual({
      ranOn: 'render-workflow',
    });
    expect(runTask).toHaveBeenCalledWith('bursar/run_mission', ['org_1', 'mis_1']);
    runTask.mockResolvedValueOnce({ status: 'failed', results: [] });
    await expect(run({ slug: 'bursar', orgId: 'o', missionId: 'm' })).rejects.toThrow(/failed/);
    runTask.mockResolvedValueOnce({ status: 'completed', results: [] });
    await expect(run({ slug: 'bursar', orgId: 'o', missionId: 'm' })).rejects.toThrow(/nothing/);
    expect(typeof runMissionOnRender).toBe('function');
  });
});
