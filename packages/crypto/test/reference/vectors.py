"""Independent reference values for @bursar/crypto.

This implements the formats as the package README writes them, using only Python's standard
library and `cryptography` (for AES-GCM), and never looks at the TypeScript. The values it prints
are the ones in test/vectors.ts and test/uuid.test.ts, and the README quotes them.

    pip install cryptography
    python3 test/reference/vectors.py
"""

import base64
import hashlib
import hmac
import json
import uuid

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def canonical(value):
    """RFC 8785 for the data used here: ASCII keys, integers, strings, null and booleans."""
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def domain_input(label, value):
    return (label + '\n' + canonical(value)).encode('utf-8')


def domain_hash(label, value):
    return hashlib.sha256(domain_input(label, value)).hexdigest()


def domain_mac(key, label, value):
    return hmac.new(key, domain_input(label, value), hashlib.sha256).digest()


def base64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def test_key(seed):
    """The 32-byte key the tests derive from a seed: no key-like literal appears in the tests."""
    return bytes((seed + index) & 0xFF for index in range(32))


ORG = 'org_01ARZ3NDEKTSV4RRFFQ69G5FAV'
USER = 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV'
MISSION = 'mis_01ARZ3NDEKTSV4RRFFQ69G5FAV'
MANDATE = 'mnd_01ARZ3NDEKTSV4RRFFQ69G5FAV'
ACTION = 'act_01ARZ3NDEKTSV4RRFFQ69G5FAV'
DECISION = 'dec_01ARZ3NDEKTSV4RRFFQ69G5FAV'
APPROVAL = 'apv_01ARZ3NDEKTSV4RRFFQ69G5FAV'
CART = 'crt_01ARZ3NDEKTSV4RRFFQ69G5FAV'


def usd(minor):
    return {'currency': 'USD', 'minor': minor}


# Cart hash: the cart's identity, version, lines (sorted by their canonical form) and total.
LINES = [
    {'id': 'cln_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'offerId': 'ofr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
     'quantity': 2, 'unitPrice': usd('1250'), 'lineTotal': usd('2500'),
     'rationale': 'Cheapest in stock'},
    {'id': 'cln_01ARZ3NDEKTSV4RRFFQ69G5FAW', 'offerId': 'ofr_01ARZ3NDEKTSV4RRFFQ69G5FAW',
     'quantity': 1, 'unitPrice': usd('999'), 'lineTotal': usd('999'), 'rationale': None},
]
CART_CONTENT = {'id': CART, 'orgId': ORG, 'missionId': MISSION, 'version': 2,
                'lines': sorted(LINES, key=canonical), 'total': usd('3499')}
cart_hash = domain_hash('bursar.cart.v1', CART_CONTENT)

# Policy hash and decision inputs.
policy_hash = domain_hash('bursar.policy.v1', {
    'version': 3,
    'rules': [{'id': 'R-ITEM-CAP', 'params': {'max': '5000'}}, {'id': 'R-VENDOR', 'params': {}}]})
inputs_hash = domain_hash('bursar.inputs.v1', {
    'actionId': ACTION, 'envelopeRemaining': '10000', 'now': '2026-10-05T12:00:00Z'})

# Idempotency key: which action this is, never how much. Then the PayPal-Request-Id for one call.
idempotency = domain_hash('bursar.idempotency.v1', {
    'orgId': ORG, 'type': 'CAPTURE', 'missionId': MISSION, 'mandateId': None, 'supplierId': None,
    'cartHash': cart_hash, 'compensatesActionId': None, 'ordinal': 1})
REQUEST_NAMESPACE = uuid.UUID('d131fa55-6ad2-466f-8ea5-7a294a2ed117')
request_id = str(uuid.uuid5(REQUEST_NAMESPACE, idempotency + ':capture'))

# Provenance tag: the first 128 bits of the MAC, in hex.
provenance_mac = domain_mac(test_key(0x40), 'bursar.provenance.v1',
                            {'orgId': ORG, 'actionId': ACTION, 'amount': usd('3499')})
provenance_tag = 'bursar:v1:' + ACTION + ':' + provenance_mac.hex()[:32]

# Approval signature: unpadded base64url of the MAC. The approval id is the nonce.
approval_signature = base64url(domain_mac(test_key(0x80), 'bursar.approval.v1', {
    'approvalId': APPROVAL, 'decisionId': DECISION, 'approverId': USER,
    'cartHash': cart_hash, 'policyHash': policy_hash, 'expiresAt': '2026-10-05T13:00:00Z'}))

# Sealed secret: AES-256-GCM, 96-bit IV, additional data = label, key version and context.
iv = bytes(range(0xA0, 0xAC))
additional_data = ('bursar.secret.v1\n1\nmandate:' + MANDATE).encode()
sealed_raw = AESGCM(test_key(0xC0)).encrypt(iv, b'VAULT-ID-8XJ2K-4', additional_data)
sealed = ':'.join(['bursar:secret:v1', '1', base64url(iv),
                   base64url(sealed_raw[:-16]), base64url(sealed_raw[-16:])])

print(json.dumps({
    'cartHash': cart_hash,
    'policyHash': policy_hash,
    'inputsHash': inputs_hash,
    'idempotency': idempotency,
    'requestId': request_id,
    'provenanceTag': provenance_tag,
    'approvalSignature': approval_signature,
    'sealed': sealed,
    # RFC 9562 version 5, as in test/uuid.test.ts
    'uuidv5': {
        'dns www.example.com': str(uuid.uuid5(uuid.NAMESPACE_DNS, 'www.example.com')),
        'dns WWW.Example.COM': str(uuid.uuid5(uuid.NAMESPACE_DNS, 'WWW.Example.COM')),
        'dns café €': str(uuid.uuid5(uuid.NAMESPACE_DNS, 'café €')),
        'dns (empty)': str(uuid.uuid5(uuid.NAMESPACE_DNS, '')),
        'url https://example.com/a': str(uuid.uuid5(uuid.NAMESPACE_URL, 'https://example.com/a')),
    },
}, indent=2, ensure_ascii=False))
