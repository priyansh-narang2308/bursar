import { type TaskContext, task } from '@renderinc/sdk/workflows';
import { assemble, buyCart, planMission, researchNeed } from './tasks';
import { wiring } from './wiring';

/*
 * Bursar's mission pipeline as a Render Workflow. `run_mission` is the entry point: it plans, then runs one
 * `research_need` per need at the same time (each on its own instance), then buys. A failed step is retried with
 * backoff by Render. Deploy: see this package's README.
 */
const retry = { maxRetries: 2, waitDurationMs: 1_000, backoffScaling: 2 };

const plan = task(
  { name: 'plan_mission', retry },
  async (_ctx: TaskContext, orgId: string, missionId: string) =>
    JSON.parse(JSON.stringify(await planMission(wiring(), orgId, missionId))) as Awaited<
      ReturnType<typeof planMission>
    >,
);

const researchOne = task(
  { name: 'research_need', retry },
  async (
    _ctx: TaskContext,
    orgId: string,
    missionId: string,
    need: Parameters<typeof researchNeed>[3],
  ) =>
    JSON.parse(JSON.stringify(await researchNeed(wiring(), orgId, missionId, need))) as Awaited<
      ReturnType<typeof researchNeed>
    >,
);

const buy = task(
  { name: 'buy_cart', retry },
  async (
    _ctx: TaskContext,
    orgId: string,
    missionId: string,
    picks: Parameters<typeof buyCart>[3],
  ) =>
    JSON.parse(JSON.stringify(await buyCart(wiring(), orgId, missionId, picks))) as Awaited<
      ReturnType<typeof buyCart>
    >,
);

task(
  { name: 'run_mission', timeoutSeconds: 300 },
  async (ctx: TaskContext, orgId: string, missionId: string) => {
    const planned = await ctx.run(plan, orgId, missionId);
    const researched = await Promise.all(
      planned.needs.map((need) => ctx.run(researchOne, orgId, missionId, need as never)),
    );
    const picks = researched.flatMap((r) => (r.pick?.offerId ? [r.pick] : []));
    const bought = await ctx.run(buy, orgId, missionId, picks as never);
    return assemble(planned, researched, bought);
  },
);
