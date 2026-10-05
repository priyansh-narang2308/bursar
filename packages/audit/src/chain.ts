import { canonicalize, domainHash } from '@bursar/crypto';
import {
  type AuditEvent,
  auditEventSchema,
  idSchemas,
  type OrganizationId,
  sha256HexSchema,
} from '@bursar/schemas';
import { z } from 'zod';
import { AuditError, type AuditErrorCode } from './errors';

/**
 * The most an entry's payload may be, as canonical JSON in UTF-8. The log holds facts and
 * references, not documents.
 */
export const MAX_AUDIT_PAYLOAD_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------------------
// Heads
// ---------------------------------------------------------------------------------------

/**
 * Where a chain stands: the sequence number and hash of its last entry. A head is all that is
 * needed to append the next entry, and a head recorded somewhere an attacker cannot reach (a daily
 * root shown in the UI) is what makes the log's history impossible to rewrite unnoticed.
 */
export const chainHeadSchema = z.strictObject({
  orgId: idSchemas.organization,
  /** 0 for an empty log. */
  seq: z.int().min(0),
  hash: sha256HexSchema,
});
export type ChainHead = z.infer<typeof chainHeadSchema>;

/**
 * The hash every organisation's chain starts from, so one organisation's entries cannot be moved
 * into another's log.
 */
export function genesisHash(orgId: OrganizationId): string {
  return domainHash('auditGenesis', { orgId });
}

/** The head of an empty log. */
export function genesisHead(orgId: OrganizationId): ChainHead {
  return { orgId, seq: 0, hash: genesisHash(orgId) };
}

/** The head a chain has after this entry. */
export function headOf(event: AuditEvent): ChainHead {
  return { orgId: event.orgId, seq: event.seq, hash: event.hash };
}

// ---------------------------------------------------------------------------------------
// Entry hash
// ---------------------------------------------------------------------------------------

type EntryFields = Omit<AuditEvent, 'hash'>;

/**
 * The hash of an entry: a SHA-256 over everything it says except the hash itself, in canonical
 * JSON, in the audit-entry domain. It covers the previous hash, so each entry commits to the whole
 * history before it.
 */
export function entryHash(fields: EntryFields): string {
  return domainHash('auditEntry', {
    id: fields.id,
    orgId: fields.orgId,
    seq: fields.seq,
    ts: fields.ts,
    actor: { kind: fields.actor.kind, id: fields.actor.id },
    type: fields.type,
    payload: fields.payload,
    prevHash: fields.prevHash,
  });
}

/** The entry's hash, or undefined if its payload cannot be written as canonical JSON. */
function tryEntryHash(fields: EntryFields): string | undefined {
  try {
    return entryHash(fields);
  } catch {
    // `canonicalize` reports every problem (depth, unsupported values) as a CryptoError.
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------
// Appending
// ---------------------------------------------------------------------------------------

/**
 * What the caller supplies for a new entry. The id and the time come from outside so that
 * appending stays a pure function; the organisation, the sequence number and both hashes come
 * from the head.
 */
export const auditDraftSchema = z.strictObject({
  id: auditEventSchema.shape.id,
  ts: auditEventSchema.shape.ts,
  actor: auditEventSchema.shape.actor,
  type: auditEventSchema.shape.type,
  payload: auditEventSchema.shape.payload,
});
export type AuditDraft = z.infer<typeof auditDraftSchema>;

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseOrThrow<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  code: AuditErrorCode,
  what: string,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AuditError(code, `Not a valid ${what}: ${describeIssues(result.error)}`);
  }
  return result.data;
}

/**
 * The next entry in a chain: validated, numbered, linked to the head and hashed. It returns the
 * entry and changes nothing; storing it, and holding the head steady while it does (a row lock, or
 * a unique `(org, seq)` constraint that makes a concurrent append fail), is the database's job.
 */
export function appendEvent(head: ChainHead, draft: AuditDraft): AuditEvent {
  const {
    orgId,
    seq,
    hash: prevHash,
  } = parseOrThrow(chainHeadSchema, head, 'invalid-head', 'head');
  const fields = {
    ...parseOrThrow(auditDraftSchema, draft, 'invalid-event', 'audit entry'),
    orgId,
    seq: seq + 1,
    prevHash,
  };
  const hash = tryEntryHash(fields);
  if (hash === undefined) {
    throw new AuditError('invalid-event', 'The payload cannot be written as canonical JSON.');
  }
  if (new TextEncoder().encode(canonicalize(fields.payload)).length > MAX_AUDIT_PAYLOAD_BYTES) {
    throw new AuditError(
      'payload-too-large',
      `A payload may be at most ${MAX_AUDIT_PAYLOAD_BYTES} bytes.`,
    );
  }
  return parseOrThrow(auditEventSchema, { ...fields, hash }, 'invalid-event', 'audit entry');
}

// ---------------------------------------------------------------------------------------
// Verifying
// ---------------------------------------------------------------------------------------

/** Every way a chain can fail verification, in the order the checks run. */
export const CHAIN_FAILURES = [
  'malformed', // not an audit entry at all
  'wrong-org', // belongs to another organisation's log
  'seq-gap', // a number out of place: an entry was removed, inserted, repeated or reordered
  'prev-hash-mismatch', // does not follow the entry before it
  'hash-mismatch', // its content no longer matches its own hash: it was altered
  'anchor-mismatch', // history before a recorded head was rewritten
  'anchor-missing', // the log ends before a recorded head: it was cut short
] as const;
export type ChainFailure = (typeof CHAIN_FAILURES)[number];

export type ChainVerdict =
  | {
      readonly ok: true;
      /** The head after the last entry checked. */
      readonly head: ChainHead;
      readonly count: number;
    }
  | {
      readonly ok: false;
      readonly reason: ChainFailure;
      /** Where in the entries given verification stopped, counting from 0. */
      readonly index: number;
      /** The sequence number that should have been there. */
      readonly seq: number;
      readonly detail: string;
    };

export interface VerifyOptions {
  readonly orgId: OrganizationId;
  /** Verify the entries that follow this head instead of the whole log, such as one day's. */
  readonly after?: ChainHead;
  /**
   * A head recorded outside the database that the chain must pass through: the entry with this
   * sequence number must have this hash. Without one, a chain rewritten from some point on is
   * still internally consistent, and nothing can tell.
   */
  readonly through?: ChainHead;
}

function fail(
  reason: ChainFailure,
  index: number,
  seq: number,
  detail: string,
): Extract<ChainVerdict, { ok: false }> {
  return { ok: false, reason, index, seq, detail };
}

interface EntryProblem {
  readonly reason: ChainFailure;
  readonly detail: string;
}

/** The entry if it is sound and follows `previous`, or the first thing wrong with it. */
function checkEntry(
  raw: unknown,
  previous: ChainHead,
  orgId: OrganizationId,
): AuditEvent | EntryProblem {
  const parsed = auditEventSchema.safeParse(raw);
  if (!parsed.success) {
    return { reason: 'malformed', detail: describeIssues(parsed.error) };
  }
  const event = parsed.data;
  const expectedSeq = previous.seq + 1;
  if (event.orgId !== orgId) {
    return { reason: 'wrong-org', detail: 'The entry belongs to another organisation.' };
  }
  if (event.seq !== expectedSeq) {
    return {
      reason: 'seq-gap',
      detail: `Expected sequence number ${expectedSeq}, found ${event.seq}.`,
    };
  }
  if (event.prevHash !== previous.hash) {
    return { reason: 'prev-hash-mismatch', detail: 'The entry does not follow the one before it.' };
  }
  if (tryEntryHash(event) !== event.hash) {
    return { reason: 'hash-mismatch', detail: 'The entry does not match its own hash.' };
  }
  return event;
}

/** The head to start from and the anchor to pass through, checked: the caller's configuration. */
function readOptions({ orgId, after, through }: VerifyOptions) {
  const start = parseOrThrow(
    chainHeadSchema,
    after ?? genesisHead(orgId),
    'invalid-head',
    'head to verify after',
  );
  const anchor =
    through === undefined
      ? undefined
      : parseOrThrow(chainHeadSchema, through, 'invalid-head', 'anchor');
  if (start.orgId !== orgId || (anchor !== undefined && anchor.orgId !== orgId)) {
    throw new AuditError(
      'invalid-head',
      'A head to verify against belongs to another organisation.',
    );
  }
  if (anchor !== undefined && anchor.seq <= start.seq) {
    throw new AuditError('invalid-head', 'An anchor must come after where verification starts.');
  }
  return { start, anchor };
}

/**
 * Walks a log and reports whether it is an unbroken chain: every entry well formed, in this
 * organisation, numbered without gaps, pointing at the entry before it and matching its own hash.
 * Altering, removing, inserting, repeating or reordering an entry breaks one of those at that
 * point.
 *
 * It never throws on the entries: whatever is wrong with them is the verdict. It stops at the
 * first problem and says where.
 */
export function verifyChain(events: Iterable<unknown>, options: VerifyOptions): ChainVerdict {
  const { start, anchor } = readOptions(options);
  let head = start;
  let count = 0;
  let anchored = anchor === undefined;
  for (const raw of events) {
    const checked = checkEntry(raw, head, options.orgId);
    if ('reason' in checked) {
      return fail(checked.reason, count, head.seq + 1, checked.detail);
    }
    head = headOf(checked);
    count += 1;
    if (anchor?.seq === head.seq) {
      if (anchor.hash !== head.hash) {
        return fail(
          'anchor-mismatch',
          count - 1,
          head.seq,
          'History was rewritten before the recorded head.',
        );
      }
      anchored = true;
    }
  }
  if (anchor !== undefined && !anchored) {
    return fail('anchor-missing', count, anchor.seq, 'The log ends before the recorded head.');
  }
  return { ok: true, head, count };
}
