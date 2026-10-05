import { type AuditEvent, idSchemas } from '@bursar/schemas';
import { ORG, USER } from './support';

// Reference values computed independently from the written format, with Python's hashlib and
// json, never the code under test.
export const GOLDEN_GENESIS = '03f098fb5dea77f3103d0f7dd710008ea328dd8c5053f90aec309cecc7ce9922';
export const GOLDEN_CHAIN: readonly AuditEvent[] = [
  {
    id: idSchemas.auditEvent.parse('aud_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    orgId: ORG,
    seq: 1,
    ts: '2026-10-05T12:00:00Z',
    actor: { kind: 'USER', id: USER },
    type: 'mission.created',
    payload: { missionId: 'mis_01ARZ3NDEKTSV4RRFFQ69G5FAV', goal: 'Café supplies for the team' },
    prevHash: GOLDEN_GENESIS,
    hash: 'ce1d92e6fa56f092ccabd903ecc6a8b172d0277f9e4770580163b27829ff2fcd',
  },
  {
    id: idSchemas.auditEvent.parse('aud_01ARZ3NDEKTSV4RRFFQ69G5FAW'),
    orgId: ORG,
    seq: 2,
    ts: '2026-10-05T12:01:00Z',
    actor: { kind: 'AGENT', id: 'agt_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    type: 'cart.proposed',
    payload: {
      cartId: 'crt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      lines: 2,
      total: { currency: 'USD', minor: '3499' },
    },
    prevHash: 'ce1d92e6fa56f092ccabd903ecc6a8b172d0277f9e4770580163b27829ff2fcd',
    hash: '40c278a59aaedd652e9d45f19e4492c02d31f47208b510c688504c7dfb12c3ab',
  },
  {
    id: idSchemas.auditEvent.parse('aud_01ARZ3NDEKTSV4RRFFQ69G5FAX'),
    orgId: ORG,
    seq: 3,
    ts: '2026-10-05T12:02:00Z',
    actor: { kind: 'SYSTEM', id: null },
    type: 'policy.evaluated',
    payload: {
      outcome: 'REQUIRE_APPROVAL',
      rules: [{ id: 'R-ITEM-CAP', ok: true, ratio: 0.5 }],
      note: null,
      fx: 'a/b\n"€"',
    },
    prevHash: '40c278a59aaedd652e9d45f19e4492c02d31f47208b510c688504c7dfb12c3ab',
    hash: 'a7ea156565c1e6e55345479cf944992eacd34a8c7972364d24b6ff270f442c55',
  },
];
