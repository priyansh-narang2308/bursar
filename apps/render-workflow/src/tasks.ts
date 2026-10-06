import { type AgentRole, createToolbox, type ToolCallLog } from '@bursar/agent-tools';
import { buy, type Need, plan, research } from '@bursar/agents';
import { demoModel } from '@bursar/agents/demo';
import type { Catalog } from '@bursar/channel3';
import type { Core } from '@bursar/core';
import { type Db, offers, withOrg } from '@bursar/db';
import { createRuntime } from '@bursar/llm';
import { standardPolicy } from '@bursar/policy';
import type { MissionId, OrganizationId } from '@bursar/schemas';
import { eq } from 'drizzle-orm';

/*
 * The mission pipeline as a handful of small steps, each a plain function of what it needs (the database, the
 * core, the catalog). `main.ts` registers them with Render as tasks; here they are just functions, so they run
 * the same in a test as on a Render instance. Every argument and result is JSON, because a task's input and
 * output cross the network.
 */

export interface Wiring {
  readonly db: Db;
  readonly core: Core;
  readonly catalog: Catalog;
}

export interface Step {
  readonly need: string;
  readonly quantity: number;
  readonly offer: { id: string; title: string; unitMinor: string; currency: string } | null;
  readonly rationale: string | null;
  readonly citation: 'valid' | 'invalid' | 'none';
  readonly problem: string | null;
  readonly offerId: string | null;
}

type Calls = ToolCallLog[];

function depsFor(w: Wiring, orgId: string, missionId: string, calls: Calls) {
  const toolbox = (role: AgentRole) =>
    createToolbox({
      db: w.db,
      core: w.core,
      catalog: w.catalog,
      policy: standardPolicy(),
      orgId: orgId as OrganizationId,
      agentId: 'agt_workflow',
      role,
      missionId: missionId as MissionId,
      onCall: (c) => void calls.push(c),
    });
  return {
    runtime: createRuntime({ provider: demoModel() }),
    missionId: missionId as MissionId,
    toolbox,
    agentId: 'agt_workflow',
  };
}

/** Step 1: break the mission's goal into needs. */
export async function planMission(w: Wiring, orgId: string, missionId: string) {
  const calls: Calls = [];
  const { needs } = await plan(depsFor(w, orgId, missionId, calls));
  return {
    needs: needs.map((n) => ({
      needId: n.needId,
      label: n.label,
      query: n.query,
      quantity: n.quantity,
    })),
    calls,
  };
}

/** Step 2, once per need and all at the same time: find the best offer and say what it is. */
export async function researchNeed(w: Wiring, orgId: string, missionId: string, need: Need) {
  const calls: Calls = [];
  const found = await research(depsFor(w, orgId, missionId, calls), need);
  const offerId = found.pick?.offerId ?? null;
  const [row] =
    offerId === null
      ? []
      : await withOrg(w.db, orgId as OrganizationId, (tx) =>
          tx
            .select()
            .from(offers)
            .where(eq(offers.id, offerId as never)),
        );
  const step: Step = {
    need: need.label,
    quantity: need.quantity,
    offer: row
      ? { id: row.id, title: row.title, unitMinor: String(row.priceMinor), currency: row.currency }
      : null,
    rationale: found.pick?.rationale ?? null,
    citation: found.cited,
    problem: found.problem,
    offerId,
  };
  return { step, pick: found.pick, calls };
}

/** Step 3: one cart from the picks, priced by the server and judged by the policy. */
export async function buyCart(
  w: Wiring,
  orgId: string,
  missionId: string,
  picks: { offerId: string | null; quantity: number; rationale: string }[],
) {
  const calls: Calls = [];
  const proposal = await buy(depsFor(w, orgId, missionId, calls), picks as never);
  return { proposal, calls };
}

/** The whole trace the screen shows, assembled from the three steps. */
export function assemble(
  planned: Awaited<ReturnType<typeof planMission>>,
  researched: Awaited<ReturnType<typeof researchNeed>>[],
  bought: Awaited<ReturnType<typeof buyCart>>,
) {
  return {
    needs: planned.needs.map(({ label, query, quantity }) => ({ label, query, quantity })),
    steps: researched.map((r) => r.step),
    proposal: bought.proposal,
    problems: researched.flatMap((r) => (r.step.problem === null ? [] : [r.step.problem])),
    calls: [...planned.calls, ...researched.flatMap((r) => r.calls), ...bought.calls],
    ranOn: 'render-workflow' as const,
  };
}
