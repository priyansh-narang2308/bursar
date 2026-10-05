# ADR-0005: Cryptography and the audit log

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Bursar's promises rest on a few cryptographic facts being true: an approval covers exactly the cart that was shown, a PayPal transaction can be traced to the action that caused it, a stored vault token is useless to someone who only has the database, and the audit log cannot be quietly rewritten. Each is small to build and easy to get subtly wrong (a hash that skips a field, a comparison that leaks timing, an IV that repeats), so they live in two packages with no I/O, tested against published vectors, instead of in whatever code happens to need them. What shaped the decisions:

- Hashes and signatures cover structured data, and JSON has many spellings of one value. The bytes must be the same on every machine, and in any language an auditor might use.
- `@bursar/schemas` already brands the digests it needs (cart, policy, inputs, idempotency), so one function should make each, and nothing else should.
- PayPal limits what can be attached to a transaction: `custom_id` takes 255 characters and the `PayPal-Request-Id` header 108.
- Node's own `crypto` is the only primitive library needed, so no dependency is added for it.

## Decision

| Concern | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Canonical form | RFC 8785 (JCS) in `canonicalize`, which refuses `undefined`, `bigint`, `NaN`, lone surrogates, class instances, sparse arrays, symbol keys and nesting beyond 64 levels | A published standard with vectors, the same bytes in any language, and a hash can never silently skip part of its input | `JSON.stringify` (key order follows insertion, `undefined` vanishes); an invented form; CBOR |
| Hash input | SHA-256 of `<label>\n<canonical JSON>`, with every label in one registry and ending in a version | A digest made for one purpose cannot be presented as another. Labels are constants with no newline, so the framing is unambiguous | A bare SHA-256 of JSON; length-prefixed framing |
| Cart hash | Covers the cart's identity, version, every line (id, offer, quantity, prices, rationale) and total. Lines are order-independent. Status, creation time and the hash itself are excluded, and a test fails if either schema gains a field | An approval signs what the approver saw; a database returning lines in another order cannot cause a false alarm; a new field forces a decision | Hashing the whole row; order-dependent lines |
| Idempotency key | SHA-256 over an action's identity: organisation, type, mission, mandate, supplier, cart hash, the action it undoes and an ordinal. Never the amount | A retry cannot become a second action by changing a parameter. It extends the plan's `sha256(org\|mission\|type\|cart_hash\|ordinal)` with what FREEZE, REVOKE, PAYOUT, VOID and REFUND need to be distinct | Including the amount; random keys |
| `PayPal-Request-Id` | UUIDv5 of `<idempotency key>:<step>` | Stable per call, so a retry is idempotent, and two calls for one action never share an id. The plan's `uuidv5(idempotency_key)` gains a step because creating and then authorising an order are two POSTs for one action. A standard with published vectors | One id per action; a random id that must be stored |
| Provenance tag | `bursar:v1:<action id>:<128-bit MAC>`, an HMAC-SHA-256 over organisation, action, amount and currency, verified by recomputing the whole tag in constant time against a list of keys | Someone with PayPal access but not the key cannot forge a tag, and a tag cannot be moved to another amount. 128 bits is RFC 2104's minimum for a truncated HMAC-SHA-256 (the plan's `[0:16]` read as hex characters would be only 64), and the tag is 73 characters. A list of keys lets tags, which outlive their transactions, survive a rotation | A 64-bit MAC; a MAC over the action id alone |
| Approvals | A base64url HMAC-SHA-256 under a dedicated key over the approval id (the nonce), decision, approver, cart hash, policy hash and expiry, verified against claims taken from what the server holds now | Someone who can write to the database cannot set a row to APPROVED and make it verify, and a changed cart, policy or expiry voids the signature | A public-key signature (no third party verifies yet; revisit with approvals signed on a person's device); a JWT; trusting stored hashes |
| Secrets at rest | AES-256-GCM with a random 96-bit IV. The additional data binds the format, the key version and a caller-supplied context. A versioned keyring (the highest version seals, all open) with `needsRotation` and `resealSecret` | Authenticated; a value copied to another row does not open; keys rotate without downtime | AES-CBC with a separate MAC; deterministic IVs; one key without versions |
| Keys | 256 bits, hex or base64url, one per purpose (`PROVENANCE_HMAC_KEY`, `APPROVAL_HMAC_KEY`, `VAULT_ENC_KEY`). Errors never contain key material | A leak of one key does not endanger the others | One master key; deriving every key from one secret |
| Audit chain | One hash chain per organisation. An entry's hash covers every field and the previous hash, and the first entry links to a per-organisation genesis hash. `appendEvent` and `verifyChain` are pure functions; the database only stores | Any change, removal, insertion, repeat or reorder breaks the chain at that point, and the verdict says where | Computing hashes in SQL triggers; one global chain |
| Anchoring | The chain is unkeyed. `verifyChain` takes a recorded head the chain must pass through (`through`) and a head to start after (`after`) | An auditor can verify with no secret, and a head recorded outside the database turns a consistent rewrite or a truncation into a finding | An HMAC-keyed chain, which only the key holder can verify; a Merkle tree (later, for single-entry proofs) |

## Consequences

- **A chain alone does not stop someone who can write the database.** They can rewrite an entry and everything after it, or cut off the end, and the result still verifies. Only a head recorded outside the database catches it. The tests show both attacks passing without an anchor and failing with one; the UI's daily root is the operational answer.
- **Whoever holds the approval key can forge approvals.** It belongs to the API and the executor only. Revisit if approvals ever have to be verified by someone else.
- **Sealed secrets protect the database at rest**, not the application server, which holds the key. Moving keys into a KMS is a deployment change.
- **Random 96-bit IVs limit one key to about 2^32 encryptions**, orders of magnitude beyond what a vault holds.
- **Verifying provenance needs the retired keys listed** for as long as their tags matter.
- **The cart hash is a contract.** Changing what it covers changes what every approval means, so it takes a new label version (`bursar.cart.v2`) and a decision here.
- **An `AuditEvent` entity and an `aud` id kind were added to `@bursar/schemas`**, which ADR-0004 had deferred. The ledger is still deferred.
- **An entry's payload is capped at 64 KiB** of canonical JSON, because the log holds facts and references, not documents.
- **No new dependencies.** Both packages use Node's `crypto`, and `@bursar/audit` uses Zod to validate what it is given, as `@bursar/schemas` does.

## Verification (2026-10-05)

- **Published vectors:** RFC 8785 (the number table, the sorting example and the worked example byte for byte), FIPS 180 SHA-256 including the million-`a` message, RFC 4231 HMAC-SHA-256 cases 1 to 7, the McGrew and Viega AES-GCM test case 16, RFC 4648 base64 and the RFC 9562 UUIDv5 example.
- **Independent oracle:** a separate Python implementation (`hashlib`, `hmac`, `json`, `uuid`, `cryptography`) produced every Bursar-specific reference value from the formats as the READMEs write them: the cart, policy and inputs hashes, an idempotency key, a request id, a provenance tag, an approval signature, a sealed secret, the genesis hash and a three-entry chain. The scripts are in each package's `test/reference/`; both READMEs quote the values and a test fails if they stop doing so.
- **Tamper tests:** every bit of a sealed secret's IV, ciphertext, tag and additional data; every character of a tag, a signature and a hash; every claim of an approval and a tag; every field of every entry of a chain, with the verdict's reason and position checked; entries removed, repeated, swapped and substituted from another organisation.
- **A consistent rewrite and a truncation pass without an anchor and fail with one**, in the tests, which is the limit above stated as an executable fact.
- **Mutation testing:** 62 deliberate faults in `@bursar/crypto`, 61 caught. The survivor drops `authTagLength` when decrypting; it is equivalent on Node 26, which rejects short GCM tags by default, and it is caught on Node 22, which accepts them, so the explicit option stays. 28 of 28 in `@bursar/audit`.
