import { Render } from '@renderinc/sdk';

/**
 * Runs a mission on the Render Workflow and waits for its trace. It throws if the workflow is not there or the
 * run fails, so the caller can fall back to running the mission itself.
 */
export async function runMissionOnRender(input: {
  slug: string;
  orgId: string;
  missionId: string;
}): Promise<unknown> {
  const render = new Render();
  const run = await render.workflows.runTask(`${input.slug}/run_mission`, [
    input.orgId,
    input.missionId,
  ]);
  if (run.status !== 'completed') throw new Error(`The workflow run ended as ${run.status}.`);
  const [trace] = run.results as unknown[];
  if (trace === undefined) throw new Error('The workflow returned nothing.');
  return trace;
}
