"""Independent reference chain for @bursar/audit.

This implements the chain format as the package README writes it, using only Python's standard
library, and never looks at the TypeScript. It prints the genesis hash and a three-entry chain,
which are the ones in test/vectors.ts, and the README quotes their hashes.

    python3 test/reference/chain.py
"""

import hashlib
import json


def canonical(value):
    """RFC 8785 for the data used here: ASCII keys, integers, one simple float, text, null."""
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def domain_hash(label, value):
    return hashlib.sha256((label + '\n' + canonical(value)).encode('utf-8')).hexdigest()


ORG = 'org_01ARZ3NDEKTSV4RRFFQ69G5FAV'
USER = 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV'

# Every organisation's chain starts from its own genesis hash.
genesis = domain_hash('bursar.audit.genesis.v1', {'orgId': ORG})

ENTRIES = [
    {'id': 'aud_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'seq': 1, 'ts': '2026-10-05T12:00:00Z',
     'actor': {'kind': 'USER', 'id': USER}, 'type': 'mission.created',
     'payload': {'missionId': 'mis_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'goal': 'Café supplies for the team'}},
    {'id': 'aud_01ARZ3NDEKTSV4RRFFQ69G5FAW', 'seq': 2, 'ts': '2026-10-05T12:01:00Z',
     'actor': {'kind': 'AGENT', 'id': 'agt_01ARZ3NDEKTSV4RRFFQ69G5FAV'}, 'type': 'cart.proposed',
     'payload': {'cartId': 'crt_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'lines': 2,
                 'total': {'currency': 'USD', 'minor': '3499'}}},
    {'id': 'aud_01ARZ3NDEKTSV4RRFFQ69G5FAX', 'seq': 3, 'ts': '2026-10-05T12:02:00Z',
     'actor': {'kind': 'SYSTEM', 'id': None}, 'type': 'policy.evaluated',
     'payload': {'outcome': 'REQUIRE_APPROVAL',
                 'rules': [{'id': 'R-ITEM-CAP', 'ok': True, 'ratio': 0.5}],
                 'note': None, 'fx': 'a/b\n"€"'}},
]

# An entry's hash covers every field except the hash, including the previous entry's hash.
previous = genesis
chain = []
for entry in ENTRIES:
    entry = dict(entry, orgId=ORG, prevHash=previous)
    entry['hash'] = domain_hash('bursar.audit.entry.v1', entry)
    previous = entry['hash']
    chain.append(entry)

print(json.dumps({'genesis': genesis, 'entries': chain}, indent=2, ensure_ascii=False))
