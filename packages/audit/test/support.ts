import { type AuditEvent, idSchemas, type JsonObject } from '@bursar/schemas';
import { type AuditDraft, appendEvent, entryHash, genesisHash, genesisHead, headOf } from '../src';

export const ORG = idSchemas.organization.parse('org_01ARZ3NDEKTSV4RRFFQ69G5FAV');
export const ORG2 = idSchemas.organization.parse('org_01ARZ3NDEKTSV4RRFFQ69G5FAW');
export const USER = idSchemas.user.parse('usr_01ARZ3NDEKTSV4RRFFQ69G5FAV');

const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The nth distinct audit event id, for n up to 1023. */
export function auditId(n: number) {
  const suffix = `${BASE32.charAt(n >> 5)}${BASE32.charAt(n & 31)}`;
  return idSchemas.auditEvent.parse(`aud_01ARZ3NDEKTSV4RRFFQ69G5F${suffix}`);
}

export function draft(n: number, over: Partial<AuditDraft> = {}): AuditDraft {
  return {
    id: auditId(n),
    ts: `2026-10-05T12:${String(n % 60).padStart(2, '0')}:00Z`,
    actor: { kind: 'USER', id: USER },
    type: 'approval.granted',
    payload: { n, note: `entry ${n}` },
    ...over,
  };
}

/** A valid chain of `length` entries for an organisation, built the way production builds one. */
export function buildChain(length: number, orgId = ORG): AuditEvent[] {
  const events: AuditEvent[] = [];
  let head = genesisHead(orgId);
  for (let n = 1; n <= length; n++) {
    const event = appendEvent(head, draft(n));
    events.push(event);
    head = headOf(event);
  }
  return events;
}

/**
 * What an attacker who can run this code and write the database can do: change the entry at
 * `index`, then recompute the links and hashes from there to the end, so the result is a chain
 * that is consistent with itself but is not the history that was recorded.
 */
export function rewriteFrom(
  events: readonly AuditEvent[],
  index: number,
  edit: (event: AuditEvent) => AuditEvent,
): AuditEvent[] {
  let prevHash = events[index - 1]?.hash ?? genesisHash(ORG);
  const result = events.slice(0, index);
  for (const [offset, event] of events.slice(index).entries()) {
    const linked = { ...(offset === 0 ? edit(event) : event), prevHash };
    const sealed = { ...linked, hash: entryHash(linked) };
    result.push(sealed);
    prevHash = sealed.hash;
  }
  return result;
}

/** The same events with the one at `index` replaced. */
export function replaceAt<T>(items: readonly T[], index: number, replacement: T): T[] {
  return items.map((item, position) => (position === index ? replacement : item));
}

/** An object nested `levels` deep, deeper than canonical JSON allows beyond 64. */
export function nested(levels: number): JsonObject {
  let value: JsonObject = {};
  for (let level = 0; level < levels; level++) {
    value = { a: value };
  }
  return value;
}
