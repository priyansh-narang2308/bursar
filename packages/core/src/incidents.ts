import { incidents, type Tx } from '@bursar/db';
import { type IncidentType, type JsonObject, newId, type OrganizationId } from '@bursar/schemas';
import { and, eq } from 'drizzle-orm';
import { emit, record } from './audit';
import type { CoreDeps } from './types';

/**
 * Opens an incident: something that does not add up. One open incident per kind and action, so a retry loop
 * does not bury the owner in copies. The Verifier's automatic responses build on this in the next task.
 */
export async function openIncident(
  tx: Tx,
  deps: CoreDeps,
  orgId: OrganizationId,
  type: IncidentType,
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  evidence: JsonObject,
): Promise<string> {
  const open = await tx
    .select()
    .from(incidents)
    .where(and(eq(incidents.orgId, orgId), eq(incidents.type, type), eq(incidents.status, 'OPEN')));
  const same = open.find(
    (i) =>
      (i.evidence as JsonObject)['actionId'] === evidence['actionId'] &&
      evidence['actionId'] !== undefined,
  );
  if (same !== undefined) return same.id;
  const id = newId('incident');
  await tx.insert(incidents).values({ id, orgId, type, severity, evidence });
  await record(
    tx,
    orgId,
    { kind: 'VERIFIER', id: null },
    'incident.opened',
    { incidentId: id, type, severity },
    deps.now(),
  );
  await emit(tx, orgId, 'incident.opened', { incidentId: id, type });
  return id;
}
