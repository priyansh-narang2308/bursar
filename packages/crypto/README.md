# @bursar/crypto

Everything cryptographic in Bursar, in one small package with no I/O: canonical JSON, domain-separated hashes, the provenance tag Bursar puts on PayPal transactions, approval signatures, and sealed secrets for the vault. It is the only place that hashes, signs, encrypts or compares a secret.

## The rules

- **Hash, sign and encrypt only through this package.** No other code calls `createHash`, `createHmac` or `createCipheriv`.
- **Never `JSON.stringify` data that is hashed or signed.** Use `canonicalize`: it is deterministic and it refuses what it cannot represent instead of dropping it.
- **Never compare a tag, signature or key with `===`.** Use the `verify*` functions, or `constantTimeEqual`.
- **One key, one purpose.** Provenance tags, approvals and sealed secrets each have their own key, and every hash, MAC and encryption is bound to its purpose by a label, so a value made for one cannot be passed off as another.
- **Errors never contain a key, a secret or a signature.** `CryptoError` carries a `code` to branch on and a message that is safe to log.
- **Pure.** Nothing here reads the environment, the clock or the network. Randomness is injectable and time is a parameter, so every test is deterministic.

## What it provides

| Export | What it does |
| --- | --- |
| `canonicalize` | JSON as RFC 8785 (JCS): sorted keys, no whitespace, ECMAScript numbers. Refuses `undefined`, `bigint`, `NaN`, lone surrogates, class instances, sparse arrays, symbol keys and nesting beyond 64 levels |
| `sha256Hex` | SHA-256 as 64 lower-case hex characters |
| `domainHash` | SHA-256 of a value in the context of one purpose (see [Formats](#formats)) |
| `cartHash`, `verifyCartHash` | The digest an approval signs, and a check that a stored cart still matches its hash |
| `policyHash`, `inputsHash` | Digests of a policy version and of what a decision was evaluated on |
| `idempotencyKey` | The key that makes a repeated request find its action instead of making another |
| `payPalRequestId` | The `PayPal-Request-Id` for one call made for an action |
| `provenanceTag`, `verifyProvenanceTag`, `actionIdFromTag` | The tag in PayPal's `custom_id`, its constant-time verification, and a way to find which action a tag claims |
| `signApproval`, `verifyApproval` | A server-held signature over an approval, and its verification including expiry |
| `parseKeyring`, `encryptSecret`, `decryptSecret`, `needsRotation`, `resealSecret` | AES-256-GCM sealed secrets with versioned keys and a rotation path |
| `signSession`, `verifySession` | A signed, stateless token for a browser session (`<payload>.<mac>`); the caller checks expiry |
| `decodeKey` | Reads a 256-bit key from configuration (64 hex or 43 base64url characters) |
| `toHex`, `fromHex`, `toBase64Url`, `fromBase64Url`, `constantTimeEqual` | Strict encodings (one value has one spelling) and a constant-time comparison |
| `systemRandomBytes` | The operating system's random bytes, the default for `encryptSecret` |
| `CryptoError` | The one error type, with a `code`: `invalid-input`, `invalid-key`, `unknown-key-version` or `decryption-failed` |

## Formats

These are the normative definitions. Another implementation that follows them produces the same bytes, and the reference values below were computed that way (see [Verification](#verification)).

### Canonical JSON and domains

Values are written as RFC 8785 canonical JSON. What is hashed, signed or authenticated is the purpose's label, a newline, then that text:

```
<label> "\n" <canonical JSON>
```

Labels never contain a newline and are fixed, so two different (purpose, value) pairs can never give the same bytes. They end in a version so a scheme can change without old and new values being confused.

| Purpose | Label |
| --- | --- |
| Cart hash | `bursar.cart.v1` |
| Policy hash | `bursar.policy.v1` |
| Decision inputs | `bursar.inputs.v1` |
| Idempotency key | `bursar.idempotency.v1` |
| Audit genesis | `bursar.audit.genesis.v1` |
| Audit entry | `bursar.audit.entry.v1` |
| Provenance MAC | `bursar.provenance.v1` |
| Approval MAC | `bursar.approval.v1` |
| Sealed secret (additional data) | `bursar.secret.v1` |
| Session token MAC | `bursar.session.v1` |

### Cart hash

SHA-256 of the `cart` domain over `{ id, orgId, missionId, version, lines, total }`. Each line is `{ id, offerId, quantity, unitPrice, lineTotal, rationale }` and each amount is `{ currency, minor }`. Lines are sorted by their canonical form, which starts with the line id, so loading them from the database in a different order cannot make an honest cart look altered. Not covered: `status` and `createdAt`, which change as a cart moves through its life, and `cartHash`, which cannot contain itself. A test fails if either schema gains a field until someone decides whether an approval should sign it.

Reference value for the cart in the tests: `3001994879c426dd478b10b43aac598817821609da4153e296ce9f3eefbe72a8`.

### Policy hash and decision inputs

SHA-256 of the `policy` domain over the policy version's content, and of the `inputs` domain over what a decision was evaluated on. They are different digests even for the same content, so one cannot stand in for the other.

| Value | Reference |
| --- | --- |
| Policy `{ "version": 3, "rules": [{ "id": "R-ITEM-CAP", "params": { "max": "5000" } }, { "id": "R-VENDOR", "params": {} }] }` | `6d61a34788017934a1804dc22191e12089d60c530788e7ee52a6725e471a0bf7` |
| Inputs `{ "actionId": "act_01ARZ3NDEKTSV4RRFFQ69G5FAV", "envelopeRemaining": "10000", "now": "2026-10-05T12:00:00Z" }` | `a36bfc8ce14588d6f24026a1556a613d75f8fdb9e3c87568b776d0998be9fbea` |

### Idempotency key and request id

The idempotency key is SHA-256 of the `idempotency` domain over `{ orgId, type, missionId, mandateId, supplierId, cartHash, compensatesActionId, ordinal }`: *which* action this is, never *how much*. A retry names the same action and gets the same key, and cannot become a second action by changing a parameter. `ordinal` counts actions of the same kind on the same subject, starting at 1 (a second partial capture is 2).

The `PayPal-Request-Id` for a call is a version 5 UUID (RFC 9562) in the namespace `d131fa55-6ad2-466f-8ea5-7a294a2ed117` of `<idempotency key>:<step>`, where the step names the call (`create-order`, `authorize`, `capture`). Retrying a call reuses its id, so PayPal answers with the original result; two different calls for one action never share one.

| Value | Reference |
| --- | --- |
| Idempotency key (a `CAPTURE`, ordinal 1) | `5ce7e5c9ebc15104e7420732dcf926ef500399bda299e7deaad74a0b128754a2` |
| Request id for step `capture` | `b307d7c2-c22d-5324-952a-0f3b070bebd3` |

### Provenance tag

```
bursar:v1:<action id>:<32 hex characters>
```

The characters are the first 128 bits of HMAC-SHA-256, under the provenance key, of the `provenance` domain over `{ orgId, actionId, amount: { currency, minor } }`. 128 bits is the least RFC 2104 recommends when truncating HMAC-SHA-256. The tag is 73 characters, well inside the 255 PayPal allows in `custom_id`.

The MAC covers the organisation, the action and the amount, so a tag copied onto another transaction, or onto the same action with a different amount, does not verify. Someone with PayPal access but without the key cannot make one.

Verification is two steps. `actionIdFromTag` reads which action a tag claims, which proves nothing; the server loads that action and passes its organisation and amount to `verifyProvenanceTag`, which recomputes the whole tag and compares it in constant time. It takes a list of keys, the current one first and then any retired key whose tags are still in circulation, because tags outlive the transactions they sit on.

Reference tag: `bursar:v1:act_01ARZ3NDEKTSV4RRFFQ69G5FAV:e30f3d22458a6c8a1bf10809916bd961`.

### Approval signature

Unpadded base64url of HMAC-SHA-256, under the approval key, of the `approval` domain over `{ approvalId, decisionId, approverId, cartHash, policyHash, expiresAt }`. 43 characters.

- **`approvalId` is the nonce.** It is unique to one approval, so a signature cannot be replayed onto another approval, even for the same cart and policy.
- **Verification takes claims from what the server holds now:** the cart hash recomputed from the stored cart, the policy hash of the policy in force. If either differs from what was signed, the signature fails, so a changed cart or policy voids the approval.
- **Expiry is signed**, so extending it fails too. An approval is valid strictly before `expiresAt`. `verifyApproval` says `bad-signature` before it says `expired`.
- **Why an HMAC and not a public-key signature:** only Bursar verifies approvals, and what must be prevented is someone with write access to the database setting a row to APPROVED, who does not hold the key. A public-key scheme becomes worth it when a third party has to verify, for example approvals signed on a person's own device.

Reference signature: `AxS-83xuFjbWNrtJ_LSuWfaqcbh0ALt_kNAKLq0HmA0`.

### Sealed secrets

```
bursar:secret:v1:<key version>:<iv>:<ciphertext>:<tag>
```

Each part is unpadded base64url. AES-256-GCM with a random 96-bit IV and a 128-bit tag. The additional data is `bursar.secret.v1`, a newline, the key version, a newline and the caller's context, so the ciphertext is bound to the format, the key version and where it is stored: a value copied into another row, or relabelled with another key version, does not open. Use something unique to the row as the context, such as `mandate:<mandate id>`. A secret is 1 to 4096 bytes of text.

Keys come from configuration as a keyring: `version:key` entries separated by commas, for example `2:<key>,1:<key>`. The highest version seals and every version opens; a single bare key, the output of `openssl rand -hex 32`, is version 1. To rotate, add the new key as the next version, re-seal in the background (`needsRotation`, then `resealSecret`), and retire the old key once nothing is sealed with it. `decryptSecret` says `unknown-key-version` if a key was retired too early, and `decryption-failed`, with the same message whatever the cause, for a wrong key, a wrong context or any altered byte.

With random 96-bit IVs, a key should seal fewer than 2^32 secrets. A vault holds a handful per mandate; rotate long before.

Reference value, sealing `VAULT-ID-8XJ2K-4` under context `mandate:mnd_01ARZ3NDEKTSV4RRFFQ69G5FAV` with IV bytes `a0` to `ab`:

```
bursar:secret:v1:1:oKGio6Slpqeoqaqr:gHZALcd-RSmcA95ZhHp2KA:TgFZd89-ZIJdEptPcBZ5zQ
```

## Configuration

| Variable | Used for | Format |
| --- | --- | --- |
| `PROVENANCE_HMAC_KEY` | Provenance tags | one key |
| `APPROVAL_HMAC_KEY` | Approval signatures | one key |
| `VAULT_ENC_KEY` | Sealed secrets | a keyring |

Generate each key separately with `openssl rand -hex 32` and never reuse one for two purposes. Read them with `decodeKey` and `parseKeyring`; neither repeats the text it refuses.

## Verification

- **Published vectors:** RFC 8785 (the number table of appendix B, the sorting example and the worked example, byte for byte), FIPS 180 SHA-256 including the million-`a` message, RFC 4231 HMAC-SHA-256 cases 1 to 7, the McGrew and Viega AES-GCM test case 16 (a 256-bit key with additional data), RFC 4648 base64, and the RFC 9562 UUIDv5 example.
- **Independent oracle:** every Bursar-specific value above was computed from the written format by a separate Python implementation (`hashlib`, `hmac`, `json`, `uuid` and `cryptography`), not by this code. `python3 test/reference/vectors.py` reproduces them (it needs `pip install cryptography`).
- **Tamper tests:** every bit of the ciphertext, IV, tag and additional data; every character of a tag and of a signature; every claim of an approval and a provenance tag; every field of a cart and of an action identity.
- **Properties** (fast-check): canonicalisation keeps the data, is its own fixed point and ignores key order; cart hashes ignore line order; sealed secrets round-trip any text.
- 100% statement, branch, function and line coverage is enforced.

## Not covered

- **Approval keys can forge approvals.** Anyone holding `APPROVAL_HMAC_KEY` can sign. It belongs only to the API and the executor.
- **Sealed secrets protect the database at rest.** They do not protect against a compromised application server, which holds the key.
- **No key management service.** Keys live in configuration; moving them into one is a deployment change, not an API change.
