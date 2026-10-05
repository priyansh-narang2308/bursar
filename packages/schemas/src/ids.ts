import { z } from 'zod';

/** Crockford's base32, the ULID alphabet: digits and letters without I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const RANDOM_BYTES = 10;
const MAX_TIME = 2 ** 48 - 1;
const MAX_RANDOM = 2n ** 80n - 1n;

/** A bare ULID: 26 characters that sort by creation time. The first is at most 7 (48-bit time). */
export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * Every kind of identifier, with the three-letter prefix that makes it self-describing. A
 * `MissionId` cannot be mistaken for an `ActionId` in a log line, a URL or an LLM tool call: the
 * wrong prefix fails validation instead of reaching the wrong table.
 */
export const ID_PREFIXES = {
  organization: 'org',
  user: 'usr',
  agent: 'agt',
  payer: 'pyr',
  mandate: 'mnd',
  policySet: 'pls',
  policyVersion: 'plv',
  mission: 'mis',
  need: 'ned',
  task: 'tsk',
  supplier: 'sup',
  offer: 'ofr',
  cart: 'crt',
  cartLine: 'cln',
  action: 'act',
  decision: 'dec',
  approval: 'apv',
  envelope: 'env',
  incident: 'inc',
  paypalEvent: 'ppe',
  event: 'evt',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

function isIdKind(value: string): value is IdKind {
  return Object.hasOwn(ID_PREFIXES, value);
}

export const ID_KINDS: readonly IdKind[] = Object.keys(ID_PREFIXES).filter(isIdKind);

// ---------------------------------------------------------------------------------------
// ULID generation
// ---------------------------------------------------------------------------------------

/** The two things a ULID needs from the outside world, injectable so tests are deterministic. */
export interface UlidSources {
  /** Whole milliseconds since the Unix epoch. */
  readonly now: () => number;
  /** `length` random bytes. */
  readonly randomBytes: (length: number) => Uint8Array;
}

const DEFAULT_SOURCES: UlidSources = {
  now: () => Date.now(),
  randomBytes: (length) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
};

function encodeBase32(value: bigint, length: number): string {
  let rest = value;
  let text = '';
  for (let digit = 0; digit < length; digit++) {
    text = ALPHABET.charAt(Number(rest & 31n)) + text;
    rest >>= 5n;
  }
  return text;
}

function readRandom(bytes: Uint8Array): bigint {
  if (bytes.length !== RANDOM_BYTES) {
    throw new RangeError(`A ULID needs ${RANDOM_BYTES} random bytes, got ${bytes.length}.`);
  }
  return bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
}

/**
 * A generator of monotonic ULIDs: ids from one generator always sort in the order they were made,
 * even within the same millisecond or if the clock steps backwards, because the random part then
 * counts up from the previous one instead of being redrawn.
 */
export function createUlidGenerator(overrides: Partial<UlidSources> = {}): () => string {
  const { now, randomBytes } = { ...DEFAULT_SOURCES, ...overrides };
  let lastTime = -1;
  let lastRandom = 0n;

  return () => {
    const time = now();
    if (!Number.isInteger(time) || time < 0 || time > MAX_TIME) {
      throw new RangeError(
        `The clock must give whole milliseconds from 0 to 2^48 - 1, got ${time}.`,
      );
    }

    if (time > lastTime) {
      lastTime = time;
      lastRandom = readRandom(randomBytes(RANDOM_BYTES));
    } else {
      lastRandom += 1n;
      if (lastRandom > MAX_RANDOM) {
        throw new RangeError('More ULIDs than the random part can count in one millisecond.');
      }
    }
    return encodeBase32(BigInt(lastTime), TIME_LENGTH) + encodeBase32(lastRandom, RANDOM_LENGTH);
  };
}

const nextUlid = createUlidGenerator();

// ---------------------------------------------------------------------------------------
// Identifier schemas
// ---------------------------------------------------------------------------------------

/** The Zod schema for one kind of id: its prefix, an underscore, then a 26-character ULID. */
export function idSchema<K extends IdKind>(kind: K) {
  const prefix = ID_PREFIXES[kind];
  return z
    .string()
    .regex(new RegExp(`^${prefix}_[0-7][0-9A-HJKMNP-TV-Z]{25}$`), {
      error: `Expected ${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind} id such as ${prefix}_01ARZ3NDEKTSV4RRFFQ69G5FAV`,
      abort: true, // one message for a wrong id, not also "wrong length"
    })
    .length(prefix.length + 1 + TIME_LENGTH + RANDOM_LENGTH) // for the JSON Schema bounds
    .brand<K>()
    .meta({ description: `A ${kind} id: "${prefix}_" followed by a ULID.` });
}

/** A string that has been checked to be an id of kind `K`. */
export type Id<K extends IdKind> = z.infer<ReturnType<typeof idSchema<K>>>;

export const idSchemas = {
  organization: idSchema('organization'),
  user: idSchema('user'),
  agent: idSchema('agent'),
  payer: idSchema('payer'),
  mandate: idSchema('mandate'),
  policySet: idSchema('policySet'),
  policyVersion: idSchema('policyVersion'),
  mission: idSchema('mission'),
  need: idSchema('need'),
  task: idSchema('task'),
  supplier: idSchema('supplier'),
  offer: idSchema('offer'),
  cart: idSchema('cart'),
  cartLine: idSchema('cartLine'),
  action: idSchema('action'),
  decision: idSchema('decision'),
  approval: idSchema('approval'),
  envelope: idSchema('envelope'),
  incident: idSchema('incident'),
  paypalEvent: idSchema('paypalEvent'),
  event: idSchema('event'),
} as const satisfies { readonly [K in IdKind]: ReturnType<typeof idSchema<K>> };

export type OrganizationId = Id<'organization'>;
export type UserId = Id<'user'>;
export type AgentId = Id<'agent'>;
export type PayerId = Id<'payer'>;
export type MandateId = Id<'mandate'>;
export type PolicySetId = Id<'policySet'>;
export type PolicyVersionId = Id<'policyVersion'>;
export type MissionId = Id<'mission'>;
export type NeedId = Id<'need'>;
export type TaskId = Id<'task'>;
export type SupplierId = Id<'supplier'>;
export type OfferId = Id<'offer'>;
export type CartId = Id<'cart'>;
export type CartLineId = Id<'cartLine'>;
export type ActionId = Id<'action'>;
export type DecisionId = Id<'decision'>;
export type ApprovalId = Id<'approval'>;
export type EnvelopeId = Id<'envelope'>;
export type IncidentId = Id<'incident'>;
export type PayPalEventId = Id<'paypalEvent'>;
export type EventId = Id<'event'>;

/** A new id of the given kind, time-ordered and unique. */
export function newId<K extends IdKind>(kind: K): Id<K> {
  return idSchema(kind).parse(`${ID_PREFIXES[kind]}_${nextUlid()}`);
}

/** Whether `value` is a well-formed id of kind `kind`. */
export function isId<K extends IdKind>(kind: K, value: unknown): value is Id<K> {
  return idSchema(kind).safeParse(value).success;
}

/** When the id was created, in milliseconds since the Unix epoch. */
export function idTime(id: Id<IdKind>): number {
  const ulid = id.slice(id.indexOf('_') + 1);
  return [...ulid.slice(0, TIME_LENGTH)].reduce(
    (time, char) => time * 32 + ALPHABET.indexOf(char),
    0,
  );
}
