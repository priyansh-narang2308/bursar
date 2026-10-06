import { type AgentDeps, buy, plan, research } from '@bursar/agents';
import { type Actor, type Core, CoreError, emitEvent } from '@bursar/core';
import {
  cartLines,
  carts,
  type Db,
  missions,
  offers,
  outbox,
  withOrg,
  workflowRuns,
} from '@bursar/db';
import {
  generate,
  invariants,
  judge,
  type LabEnv,
  type PolicyConfig,
  type Scenario,
} from '@bursar/lab';
import {
  type Alternative,
  type CarrierEvent,
  dayOf,
  planFromBasket,
  replan,
} from '@bursar/schedule';
import type { JsonObject, JsonValue, MissionId, OrganizationId } from '@bursar/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';

/*
 * A task is a named function with a JSON input and a JSON result. `startTask` gives it a durable record keyed
 * by (organisation, task, key): run it twice with the same key and the second call returns the first result
 * and does nothing. That is the whole idempotency story, and it is what lets a queue or a Render Workflow
 * deliver a task more than once without a double effect.
 */

export interface TaskContext {
  readonly orgId: OrganizationId;
  readonly db: Db;
  readonly core: Core;
  readonly actor: Actor;
  /** Builds the agents' dependencies for a mission, with run costs reported to `onRun`. */
  readonly agentDeps: (missionId: MissionId) => AgentDeps;
  readonly start: (
    orgId: OrganizationId,
    name: string,
    input: JsonObject,
    key: string,
  ) => Promise<RunView>;
}

export type Task = (ctx: TaskContext, input: JsonObject) => Promise<JsonValue>;

export interface WorkflowOptions {
  readonly db: Db;
  readonly core: Core;
  readonly agentDeps: (orgId: OrganizationId, missionId: MissionId) => AgentDeps;
  readonly actor?: Actor;
  /** Total tries for a task that throws something other than a decision of ours. */
  readonly attempts?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** More tasks, such as the policy lab's. */
  readonly extraTasks?: Readonly<Record<string, Task>>;
}

export interface RunView {
  readonly id: string;
  readonly task: string;
  readonly status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  readonly attempts: number;
  readonly result: JsonValue | null;
  readonly error: string | null;
  /** True when this call returned an earlier run instead of doing the work. */
  readonly replayed: boolean;
}

const asJson = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as JsonValue;

// ---------------------------------------------------------------------------------------
// The tasks
// ---------------------------------------------------------------------------------------

const str = (input: JsonObject, key: string): string => {
  const value = input[key];
  if (typeof value !== 'string') throw new CoreError('VALIDATION_FAILED', `${key} must be text.`);
  return value;
};

/** The latest cart's lines of a mission, as plan tasks keyed by offer. */
async function basketOf(ctx: TaskContext, missionId: MissionId) {
  return withOrg(ctx.db, ctx.orgId, async (tx) => {
    const [mission] = await tx.select().from(missions).where(eq(missions.id, missionId));
    const [cart] = await tx
      .select()
      .from(carts)
      .where(eq(carts.missionId, missionId))
      .orderBy(desc(carts.version))
      .limit(1);
    if (mission === undefined || cart === undefined)
      throw new CoreError('NOT_FOUND', 'The mission has no cart to plan.');
    const lines = await tx
      .select({ line: cartLines, offer: offers })
      .from(cartLines)
      .innerJoin(offers, eq(offers.id, cartLines.offerId))
      .where(eq(cartLines.cartId, cart.id));
    return { mission, lines };
  });
}

interface ReplanInput {
  readonly event: CarrierEvent;
  readonly leadDays: Record<string, number>;
  readonly alternatives: readonly Alternative[];
}

/**
 * A carrier delay in, a recovery out. The swaps become a new cart and a new proposal, so the replacement goes
 * through the same decision pipeline as any purchase: the Replanner has no way to order anything itself.
 */
export async function recoveryFor(ctx: Pick<TaskContext, 'db' | 'orgId'>, input: JsonObject) {
  const missionId = str(input, 'missionId') as MissionId;
  const request = input['replan'] as unknown as ReplanInput;
  const { mission, lines } = await basketOf(ctx as TaskContext, missionId);
  if (mission.deadline === null)
    throw new CoreError('VALIDATION_FAILED', 'The mission has no deadline.');
  const start = new Date(String(input['start']));
  const tasks = planFromBasket(
    lines.map(({ offer }) => ({
      id: offer.id,
      label: offer.title,
      leadDays: request.leadDays[offer.id] ?? 1,
    })),
  );
  const recovery = replan(tasks, request.event, {
    deadline: dayOf(start, mission.deadline),
    alternatives: request.alternatives,
  });
  return { recovery, lines, missionId };
}

async function replanSchedule(ctx: TaskContext, input: JsonObject): Promise<JsonValue> {
  const { recovery, lines, missionId } = await recoveryFor(ctx, input);
  const base = {
    finishDelta: recovery.delayDiff.finishDelta,
    deadlineSlack: recovery.delayed.deadlineSlack,
  };
  if (recovery.swaps.length === 0)
    return asJson({ ...base, status: recovery.recovered === null ? 'UNRECOVERABLE' : 'ON_TIME' });
  const swapped = new Map(recovery.swaps.map((s) => [s.taskId.replace(':deliver', ''), s.offerId]));
  const cart = await ctx.core.catalog.buildCart(
    ctx.orgId,
    ctx.actor,
    missionId,
    lines.map(({ line, offer }) => ({
      offerId: (swapped.get(offer.id) ?? offer.id) as never,
      quantity: line.quantity,
    })),
  );
  const proposal = await ctx.core.actions.propose(ctx.orgId, ctx.actor, {
    type: 'AUTHORIZE',
    missionId,
    cartId: cart.cartId as never,
  });
  return asJson({
    ...base,
    status: 'RECOVERY_PROPOSED',
    swaps: recovery.swaps,
    cartId: cart.cartId,
    state: proposal.state,
    outcome: proposal.outcome,
  });
}

export const TASKS: Readonly<Record<string, Task>> = {
  async plan_mission(ctx, input) {
    const { needs } = await plan(ctx.agentDeps(str(input, 'missionId') as MissionId));
    return asJson(needs);
  },
  async research_need(ctx, input) {
    const missionId = str(input, 'missionId') as MissionId;
    const found = await research(ctx.agentDeps(missionId), input['need'] as never);
    return asJson({
      needId: found.need.needId,
      pick: found.pick,
      problem: found.problem,
      cited: found.cited,
    });
  },
  async buy(ctx, input) {
    const missionId = str(input, 'missionId') as MissionId;
    return asJson(await buy(ctx.agentDeps(missionId), input['picks'] as never));
  },
  async execute_action(ctx, input) {
    return asJson(await ctx.core.actions.execute(ctx.orgId, str(input, 'actionId') as never));
  },
  async ingest_paypal_event(ctx, input) {
    return asJson(await ctx.core.webhooks.ingest(str(input, 'body'), input['headers'] as never));
  },
  /** Pays one supplier for goods that passed inspection: proposes the payout, then executes it if approved. */
  async settle_supplier(ctx, input) {
    const proposal = await ctx.core.actions.propose(ctx.orgId, ctx.actor, {
      type: 'PAYOUT',
      missionId: str(input, 'missionId') as never,
      cartId: str(input, 'cartId') as never,
      supplierId: str(input, 'supplierId') as never,
    });
    const execution =
      proposal.state === 'APPROVED'
        ? await ctx.core.actions.execute(ctx.orgId, proposal.actionId)
        : null;
    return asJson({ proposal, execution });
  },
  replan_schedule: replanSchedule,
};

// ---------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------

export function createWorkflows(options: WorkflowOptions) {
  const { db, core } = options;
  const tasks: Readonly<Record<string, Task>> = {
    ...TASKS,
    ...options.extraTasks,
  };
  const attempts = options.attempts ?? 2;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const actor = options.actor ?? { kind: 'SYSTEM' as const, id: null };
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const view = (row: typeof workflowRuns.$inferSelect, replayed: boolean): RunView => ({
    id: row.id,
    task: row.task,
    status: row.status as RunView['status'],
    attempts: row.attempts,
    result: (row.result ?? null) as JsonValue,
    error: row.error,
    replayed,
  });

  async function execute(
    orgId: OrganizationId,
    name: string,
    task: Task,
    input: JsonObject,
  ): Promise<JsonValue> {
    const ctx: TaskContext = {
      orgId,
      db,
      core,
      actor,
      agentDeps: (m) => options.agentDeps(orgId, m),
      start: workflows.startTask,
    };
    for (let attempt = 1; ; attempt++) {
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${name} timed out.`)), timeoutMs).unref(),
        );
        return await Promise.race([task(ctx, input), timeout]);
      } catch (error) {
        // A decision of ours (a refusal, a missing record) will not change on a retry; a crash or a timeout may.
        if (error instanceof CoreError || attempt >= attempts) throw error;
        await sleep(250 * 2 ** (attempt - 1));
      }
    }
  }

  const workflows = {
    /** Runs a task once per key. A repeat returns the stored result; a failed run is tried again. */
    async startTask(
      orgId: OrganizationId,
      name: string,
      input: JsonObject,
      key: string,
    ): Promise<RunView> {
      const task = tasks[name];
      if (task === undefined) throw new CoreError('NOT_FOUND', `There is no task ${name}.`);
      const claimed = await withOrg(db, orgId, async (tx) => {
        const [fresh] = await tx
          .insert(workflowRuns)
          .values({ orgId, task: name, idempotencyKey: key, input })
          .onConflictDoNothing()
          .returning();
        if (fresh !== undefined) {
          await emitEvent(tx, orgId, 'workflow.started', {
            runId: fresh.id,
            task: name,
          });
          return { row: fresh, mine: true };
        }
        const [existing] = await tx
          .select()
          .from(workflowRuns)
          .where(and(eq(workflowRuns.task, name), eq(workflowRuns.idempotencyKey, key)));
        if (existing?.status !== 'FAILED') return { row: existing, mine: false };
        // Take over a failed run: only one caller can flip it back to RUNNING.
        const [retaken] = await tx
          .update(workflowRuns)
          .set({
            status: 'RUNNING',
            error: null,
            attempts: sql`${workflowRuns.attempts} + 1`,
            finishedAt: null,
          })
          .where(and(eq(workflowRuns.id, existing.id), eq(workflowRuns.status, 'FAILED')))
          .returning();
        return { row: retaken ?? existing, mine: retaken !== undefined };
      });
      if (claimed.row === undefined) throw new Error('The run record is missing.');
      if (!claimed.mine) return view(claimed.row, true);
      return finish(orgId, claimed.row, await settle(orgId, name, task, input));
    },

    /** What a run did, from the outbox: started, then succeeded or failed. */
    async taskRunEvents(orgId: OrganizationId, runId: string) {
      const rows = await withOrg(db, orgId, (tx) =>
        tx
          .select()
          .from(outbox)
          .where(sql`${outbox.payload}->>'runId' = ${runId}`)
          .orderBy(outbox.id),
      );
      return rows.map((r) => ({ topic: r.topic, createdAt: r.createdAt }));
    },
  };

  async function settle(orgId: OrganizationId, name: string, task: Task, input: JsonObject) {
    try {
      return {
        ok: true as const,
        value: await execute(orgId, name, task, input),
      };
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof CoreError ? `${error.code}: ${error.detail}` : (error as Error).message,
      };
    }
  }

  async function finish(
    orgId: OrganizationId,
    row: typeof workflowRuns.$inferSelect,
    outcome: Awaited<ReturnType<typeof settle>>,
  ): Promise<RunView> {
    const done = await withOrg(db, orgId, async (tx) => {
      const [updated] = await tx
        .update(workflowRuns)
        .set(
          outcome.ok
            ? {
                status: 'SUCCEEDED',
                result: outcome.value,
                finishedAt: new Date(),
              }
            : {
                status: 'FAILED',
                error: outcome.message,
                finishedAt: new Date(),
              },
        )
        .where(eq(workflowRuns.id, row.id))
        .returning();
      await emitEvent(tx, orgId, outcome.ok ? 'workflow.succeeded' : 'workflow.failed', {
        runId: row.id,
        task: row.task,
      });
      return updated ?? row;
    });
    return view(done, false);
  }

  return {
    ...workflows,

    /**
     * The whole purchase, as tasks: plan, research every need (at once), then buy. Each step has its own
     * key, so running this again for the same mission repeats nothing.
     */
    async runPipeline(orgId: OrganizationId, missionId: MissionId) {
      const planned = await workflows.startTask(orgId, 'plan_mission', { missionId }, missionId);
      const needs = (planned.result ?? []) as JsonObject[];
      const researched = await Promise.all(
        needs.map((need) =>
          workflows.startTask(
            orgId,
            'research_need',
            { missionId, need },
            `${missionId}/${String(need['needId'])}`,
          ),
        ),
      );
      const picks = researched.flatMap((r) =>
        (r.result as JsonObject | null)?.['pick'] ? [(r.result as JsonObject)['pick']] : [],
      );
      const bought = await workflows.startTask(
        orgId,
        'buy',
        { missionId, picks: picks as JsonValue[] },
        missionId,
      );
      return { planned, researched, bought };
    },
  };
}

export type Workflows = ReturnType<typeof createWorkflows>;

/** Reconciliation looks across organisations, so it is a system job with no tenant run record. */
export const reconcileWindow = (
  core: Core,
  options?: { windowHours?: number; lagHours?: number },
) => core.incidents.reconcile(options);

/**
 * The Policy Lab as tasks. `lab_run` fans out one `lab_scenario` task per scenario, in batches, each with its
 * own key, so a run that is interrupted resumes where it stopped and repeats nothing.
 */
export function labTasks(
  makeEnv: (config: PolicyConfig, scenario: Scenario) => Promise<LabEnv>,
  batch = 8,
): Record<string, Task> {
  return {
    async lab_scenario(_ctx, input) {
      const scenario = input['scenario'] as unknown as Scenario;
      const violations = await judge(
        await makeEnv(input['config'] as unknown as PolicyConfig, scenario),
        scenario,
        invariants(),
      );
      return asJson({ id: scenario.id, family: scenario.family, violations });
    },
    async lab_run(ctx, input) {
      const seed = Number(input['seed']);
      const config = input['config'] as unknown as PolicyConfig;
      const scenarios = await generate({ seed, count: Number(input['count']) });
      const results: JsonObject[] = [];
      for (let i = 0; i < scenarios.length; i += batch) {
        const runs = await Promise.all(
          scenarios.slice(i, i + batch).map((scenario, j) =>
            ctx.start(
              ctx.orgId,
              'lab_scenario',
              {
                scenario: asJson(scenario),
                config: asJson(config),
              } as JsonObject,
              `lab/${seed}/${i + j}`,
            ),
          ),
        );
        results.push(...runs.map((r) => r.result as JsonObject));
      }
      const broken = results.filter((r) => (r['violations'] as unknown[]).length > 0);
      return asJson({
        total: results.length,
        broken: broken.length,
        findings: broken,
      });
    },
  };
}
