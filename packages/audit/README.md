# @bursar/audit

The tamper-evident audit log: each organisation's entries form a hash chain, so changing, removing, inserting, repeating or reordering any entry is detected, and the point where the chain breaks is reported. Everything here is a pure function over values. Nothing reads a database, a clock or the environment: the caller supplies the id and the time of an entry, stores it, and streams entries back to be checked.

## Using it

**Appending.** In one transaction: read the organisation's last entry, build the next one, insert it. Make the insert fail if another writer got there first (a row lock on the last entry, or a unique `(org_id, seq)` constraint).

```ts
const head = last ? headOf(last) : genesisHead(orgId);
const entry = appendEvent(head, { id: newId('auditEvent'), ts: now, actor, type: 'approval.granted', payload });
```

**Verifying.** Stream the entries in `seq` order into `verifyChain`. It never throws on the entries; whatever is wrong with them is the verdict.

```ts
const verdict = verifyChain(entries, { orgId, through: recordedHead });
if (!verdict.ok) alert(`Chain broken at entry ${verdict.index + 1}: ${verdict.reason}`);
```

**A day at a time.** Record each day's head somewhere an attacker with database access cannot reach (the daily root shown in the UI, an email, another system). Then verify one day at a time with `after` set to the previous root and `through` set to that day's.

## What proves what

A hash chain makes a log **tamper-evident**, not tamper-proof, and it is only as strong as the heads recorded outside the database:

- **Without a recorded head**, the log is shown to be internally consistent. Someone who can write the database can still rewrite an entry *and every entry after it* with correct hashes, or cut entries off the end, and the result verifies. The tests demonstrate both.
- **With a recorded head** (`through`), the entry with that sequence number must have that hash. A rewrite from any point before it fails with `anchor-mismatch`, and a log cut short before it fails with `anchor-missing`.
- **The chain is unkeyed on purpose.** An auditor can verify it from the exported entries without any secret. A keyed chain (HMAC) would stop a database-only attacker from recomputing hashes, but only the key holder could verify it, which defeats the point of an audit.

## The format

Each entry carries `id`, `orgId`, `seq`, `ts`, `actor`, `type`, `payload`, `prevHash` and `hash`.

- **Genesis.** `genesisHash(orgId)` is the SHA-256 of the `auditGenesis` domain (`bursar.audit.genesis.v1`) over `{ orgId }`. The first entry's `prevHash` is its organisation's genesis hash, so entries cannot be moved from one organisation's log to another's.
- **Entry hash.** The SHA-256 of the `auditEntry` domain (`bursar.audit.entry.v1`) over `{ id, orgId, seq, ts, actor: { kind, id }, type, payload, prevHash }`: every field except the hash itself, as canonical JSON (RFC 8785, see `@bursar/crypto`). Each entry therefore commits to the whole history before it.
- **Numbering.** `seq` starts at 1 and increases by 1 with no gaps.
- **Payload.** Facts and references, never secrets: the log is read by auditors. At most 65536 bytes of canonical JSON.

Reference chain, computed independently with Python's `hashlib` and `json` (the entries are in `test/vectors.ts`):

| Entry | Hash |
| --- | --- |
| Genesis hash of `org_01ARZ3NDEKTSV4RRFFQ69G5FAV` | `03f098fb5dea77f3103d0f7dd710008ea328dd8c5053f90aec309cecc7ce9922` |
| 1, `mission.created` | `ce1d92e6fa56f092ccabd903ecc6a8b172d0277f9e4770580163b27829ff2fcd` |
| 2, `cart.proposed` | `40c278a59aaedd652e9d45f19e4492c02d31f47208b510c688504c7dfb12c3ab` |
| 3, `policy.evaluated` | `a7ea156565c1e6e55345479cf944992eacd34a8c7972364d24b6ff270f442c55` |

## What a failure means

`verifyChain` checks each entry in this order and stops at the first problem, reporting where (`index`, counting from 0) and which sequence number belonged there.

| Reason | Meaning | Typical cause |
| --- | --- | --- |
| `malformed` | Not a valid audit entry | A corrupted row, a wrong type, an extra field |
| `wrong-org` | Belongs to another organisation's log | An entry moved between organisations |
| `seq-gap` | The sequence number is not the one expected | An entry removed, inserted, repeated or reordered |
| `prev-hash-mismatch` | Does not follow the entry before it | A rewritten link, or an entry changed and re-hashed alone |
| `hash-mismatch` | Its content no longer matches its own hash | The entry was altered |
| `anchor-mismatch` | History before a recorded head was rewritten | A consistent rewrite from some earlier point |
| `anchor-missing` | The log ends before a recorded head | Entries cut off the end |

`appendEvent` throws an `AuditError` when the caller gives it something it must not accept (`invalid-head`, `invalid-event`, `payload-too-large`). `verifyChain` throws it only for options that are themselves wrong: a head in another organisation, or an anchor that is not ahead of where verification starts. That is a mistake by the caller, not a finding about the log.

## What it exports

| Export | What it is |
| --- | --- |
| `appendEvent` | The next entry for a head and a draft: validated, numbered, linked and hashed |
| `verifyChain` | Walks entries and returns a verdict |
| `genesisHash`, `genesisHead` | Where an organisation's chain starts |
| `headOf` | The head after an entry |
| `entryHash` | The hash of an entry's fields, for independent checkers |
| `chainHeadSchema`, `ChainHead` | A head: organisation, sequence number and hash. Safe to store as a daily root |
| `auditDraftSchema`, `AuditDraft` | What the caller supplies for a new entry |
| `CHAIN_FAILURES`, `ChainFailure`, `ChainVerdict`, `VerifyOptions` | The shapes `verifyChain` takes and returns |
| `MAX_AUDIT_PAYLOAD_BYTES` | The largest payload |
| `AuditError`, `AuditErrorCode` | Thrown by `appendEvent`, and by `verifyChain` for bad options |

The entry type itself, `AuditEvent`, is in `@bursar/schemas`.

## Verification

- **Independent oracle:** the genesis hash and the hashes of a three-entry chain (non-ASCII text, a float, nesting, `null`) were computed by a separate Python implementation of the format. `python3 test/reference/chain.py` reproduces them.
- **Tamper matrix:** every field of every entry in a six-entry chain is altered in turn, and each alteration is reported at that entry with the expected reason. Every single character of both hashes is changed. Entries are removed, repeated and swapped; entries from another organisation are substituted; a consistent rewrite and a truncation are shown to pass without an anchor and to fail with one. A test fails unless every reason in `CHAIN_FAILURES` is reached.
- **Properties** (fast-check): any chain built by `appendEvent` verifies, whatever it holds; altering one field, removing, repeating or swapping entries is always caught; cutting the end is always caught by a recorded head.
- 100% statement, branch, function and line coverage is enforced.

## Not covered

- **Concurrency.** Two writers appending at once is the database's problem to refuse; this package builds one entry from one head.
- **Where heads are kept.** Choosing and protecting the places daily roots are recorded is an operational decision.
- **Random access proofs.** A Merkle tree would let an auditor prove one entry's inclusion without the whole log. The chain needs the whole log, or a slice between two recorded heads.
