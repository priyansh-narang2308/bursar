import { type AuditEvent, auditEventSchema } from '@bursar/schemas';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AuditError,
  appendEvent,
  CHAIN_FAILURES,
  type ChainFailure,
  type ChainHead,
  type ChainVerdict,
  chainHeadSchema,
  entryHash,
  genesisHash,
  genesisHead,
  headOf,
  MAX_AUDIT_PAYLOAD_BYTES,
  verifyChain,
} from '../src';
import {
  auditId,
  buildChain,
  draft,
  nested,
  ORG,
  ORG2,
  replaceAt,
  rewriteFrom,
  USER,
} from './support';
import { GOLDEN_CHAIN, GOLDEN_GENESIS } from './vectors';

const failed = (verdict: ChainVerdict) => {
  if (verdict.ok) {
    throw new Error('Expected the chain to fail verification.');
  }
  return verdict;
};

describe('the format, against values computed independently', () => {
  it('starts every organisation from its own genesis hash', () => {
    expect(genesisHash(ORG)).toBe(GOLDEN_GENESIS);
    expect(genesisHash(ORG2)).not.toBe(GOLDEN_GENESIS);
    expect(genesisHead(ORG)).toEqual({ orgId: ORG, seq: 0, hash: GOLDEN_GENESIS });
  });

  it('hashes each entry as the reference does', () => {
    for (const event of GOLDEN_CHAIN) {
      expect(entryHash(event)).toBe(event.hash);
    }
  });

  it('builds the reference chain entry by entry', () => {
    let head = genesisHead(ORG);
    for (const expected of GOLDEN_CHAIN) {
      const { id, ts, actor, type, payload } = expected;
      const event = appendEvent(head, { id, ts, actor, type, payload });
      expect(event).toEqual(expected);
      head = headOf(event);
    }
  });

  it('verifies the reference chain', () => {
    expect(verifyChain(GOLDEN_CHAIN, { orgId: ORG })).toEqual({
      ok: true,
      head: headOf(GOLDEN_CHAIN[2] as AuditEvent),
      count: 3,
    });
  });
});

describe('appendEvent', () => {
  it('numbers the first entry 1 and links it to the genesis hash', () => {
    const event = appendEvent(genesisHead(ORG), draft(1));
    expect(event).toMatchObject({ orgId: ORG, seq: 1, prevHash: genesisHash(ORG) });
    expect(event.hash).toBe(entryHash(event));
    expect(auditEventSchema.safeParse(event).success).toBe(true);
  });

  it('numbers each entry after the last and links it to its hash', () => {
    const [first, second] = buildChain(2);
    expect(second).toMatchObject({ seq: 2, prevHash: first?.hash });
  });

  it('changes nothing it is given', () => {
    const head = Object.freeze(genesisHead(ORG));
    const input = draft(1);
    const frozen = Object.freeze({
      ...input,
      actor: Object.freeze({ ...input.actor }),
      payload: Object.freeze({ ...input.payload }),
    });
    expect(() => appendEvent(head, frozen)).not.toThrow();
  });

  it('is deterministic', () => {
    expect(appendEvent(genesisHead(ORG), draft(1))).toEqual(
      appendEvent(genesisHead(ORG), draft(1)),
    );
  });

  it('gives the same draft a different hash in a different organisation', () => {
    expect(appendEvent(genesisHead(ORG), draft(1)).hash).not.toBe(
      appendEvent(genesisHead(ORG2), draft(1)).hash,
    );
  });

  describe('a draft it refuses', () => {
    it.each([
      ['an id of another kind', { id: ORG }, 'id'],
      ['a malformed time', { ts: 'yesterday' }, 'ts'],
      ['an unknown kind of actor', { actor: { kind: 'ROBOT', id: null } }, 'actor.kind'],
      ['an empty actor id', { actor: { kind: 'USER', id: '' } }, 'actor.id'],
      ['an event type in the wrong case', { type: 'Approval.Granted' }, 'type'],
      ['an empty event type', { type: '' }, 'type'],
      ['an event type that is too long', { type: 'a'.repeat(101) }, 'type'],
      ['a payload that is not an object', { payload: [1, 2] }, 'payload'],
      ['a payload with a value JSON cannot hold', { payload: { n: 10n } }, 'payload'],
      ['a payload value of undefined', { payload: { n: undefined } }, 'payload'],
      ['an extra field, which would not be hashed', { hash: 'x' }, '(root)'],
      ['a field set by the head instead', { seq: 9 }, '(root)'],
    ])('refuses %s', (_what, change, where) => {
      const bad = { ...draft(1), ...change } as unknown as Parameters<typeof appendEvent>[1];
      expect(() => appendEvent(genesisHead(ORG), bad)).toThrow(AuditError);
      expect(() => appendEvent(genesisHead(ORG), bad)).toThrow(
        expect.objectContaining({ code: 'invalid-event', message: expect.stringContaining(where) }),
      );
    });
  });

  describe('a head it refuses', () => {
    const head = genesisHead(ORG);
    it.each([
      ['a negative sequence number', { ...head, seq: -1 }],
      ['a fractional sequence number', { ...head, seq: 1.5 }],
      ['a malformed hash', { ...head, hash: 'abc' }],
      ['an upper-case hash', { ...head, hash: head.hash.toUpperCase() }],
      ['an organisation id of another kind', { ...head, orgId: USER }],
      ['an extra field', { ...head, extra: 1 }],
      ['nothing', undefined],
    ])('refuses %s', (_what, bad) => {
      expect(() => appendEvent(bad as unknown as ChainHead, draft(1))).toThrow(
        expect.objectContaining({ name: 'AuditError', code: 'invalid-head' }),
      );
    });
  });

  describe('the size of a payload', () => {
    // `{"a":"` and `"}` around the text are 8 bytes of canonical JSON.
    const sized = (bytes: number) => ({ a: 'x'.repeat(bytes - 8) });

    it('allows exactly the limit and no more', () => {
      expect(() =>
        appendEvent(genesisHead(ORG), draft(1, { payload: sized(MAX_AUDIT_PAYLOAD_BYTES) })),
      ).not.toThrow();
      expect(() =>
        appendEvent(genesisHead(ORG), draft(1, { payload: sized(MAX_AUDIT_PAYLOAD_BYTES + 1) })),
      ).toThrow(expect.objectContaining({ code: 'payload-too-large' }));
    });

    it('counts bytes, not characters', () => {
      const euros = { a: '€'.repeat(Math.floor((MAX_AUDIT_PAYLOAD_BYTES - 8) / 3) + 1) };
      expect(euros.a.length).toBeLessThan(MAX_AUDIT_PAYLOAD_BYTES);
      expect(() => appendEvent(genesisHead(ORG), draft(1, { payload: euros }))).toThrow(
        expect.objectContaining({ code: 'payload-too-large' }),
      );
    });

    it('refuses a payload nested too deeply to hash', () => {
      expect(() => appendEvent(genesisHead(ORG), draft(1, { payload: nested(70) }))).toThrow(
        expect.objectContaining({
          code: 'invalid-event',
          message: expect.stringContaining('canonical JSON'),
        }),
      );
    });
  });

  it('refuses to number an entry beyond what a number can count exactly', () => {
    const head = { ...genesisHead(ORG), seq: Number.MAX_SAFE_INTEGER };
    expect(() => appendEvent(head, draft(1))).toThrow(
      expect.objectContaining({ code: 'invalid-event' }),
    );
    expect(appendEvent({ ...head, seq: Number.MAX_SAFE_INTEGER - 1 }, draft(1)).seq).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

describe('heads', () => {
  it('takes a head from an entry', () => {
    const [event] = buildChain(1);
    expect(headOf(event as AuditEvent)).toEqual({ orgId: ORG, seq: 1, hash: event?.hash });
    expect(chainHeadSchema.safeParse(headOf(event as AuditEvent)).success).toBe(true);
  });
});

describe('verifyChain: an intact log', () => {
  const chain = buildChain(6);
  const last = headOf(chain.at(-1) as AuditEvent);

  it('accepts a chain and reports its head and length', () => {
    expect(verifyChain(chain, { orgId: ORG })).toEqual({ ok: true, head: last, count: 6 });
  });

  it('accepts an empty log, whose head is the genesis head', () => {
    expect(verifyChain([], { orgId: ORG })).toEqual({ ok: true, head: genesisHead(ORG), count: 0 });
  });

  it('accepts any iterable, and reads it only as far as it needs', () => {
    let pulled = 0;
    function* entries() {
      for (const event of chain) {
        pulled += 1;
        yield event;
      }
    }
    expect(verifyChain(entries(), { orgId: ORG })).toMatchObject({ ok: true, count: 6 });
    expect(pulled).toBe(6);

    pulled = 0;
    function* broken() {
      for (const event of replaceAt(chain, 1, {
        ...chain[1],
        hash: 'f'.repeat(64),
      } as AuditEvent)) {
        pulled += 1;
        yield event;
      }
    }
    expect(failed(verifyChain(broken(), { orgId: ORG })).index).toBe(1);
    expect(pulled).toBe(2);
  });

  it('verifies a slice that follows a known head, wherever the slice starts', () => {
    for (let start = 0; start <= chain.length; start++) {
      const after = start === 0 ? undefined : headOf(chain[start - 1] as AuditEvent);
      expect(verifyChain(chain.slice(start), { orgId: ORG, ...(after && { after }) })).toEqual({
        ok: true,
        head: start === chain.length ? (after as ChainHead) : last,
        count: chain.length - start,
      });
    }
  });

  it('accepts a slice only after the head it really follows', () => {
    const slice = chain.slice(3);
    const wrongPlace = headOf(chain[1] as AuditEvent);
    expect(failed(verifyChain(slice, { orgId: ORG, after: wrongPlace }))).toMatchObject({
      reason: 'seq-gap',
      index: 0,
      seq: 3,
    });
    const sameSeqWrongHash = { ...headOf(chain[2] as AuditEvent), hash: 'f'.repeat(64) };
    expect(failed(verifyChain(slice, { orgId: ORG, after: sameSeqWrongHash })).reason).toBe(
      'prev-hash-mismatch',
    );
  });

  it('accepts a chain that passes through a recorded head, however much follows it', () => {
    for (const recorded of chain) {
      expect(verifyChain(chain, { orgId: ORG, through: headOf(recorded) }).ok).toBe(true);
    }
  });
});

describe('verifyChain: what breaks a chain', () => {
  const chain = buildChain(6);
  const seen = new Set<ChainFailure>();
  const reasonOf = (events: readonly unknown[], options = {}): ChainVerdict & { ok: false } => {
    const verdict = failed(verifyChain(events, { orgId: ORG, ...options }));
    seen.add(verdict.reason);
    return verdict;
  };

  const edits: ReadonlyArray<readonly [string, (event: AuditEvent) => unknown, ChainFailure]> = [
    ['the id', (e) => ({ ...e, id: auditId(999) }), 'hash-mismatch'],
    ['the organisation', (e) => ({ ...e, orgId: ORG2 }), 'wrong-org'],
    ['the sequence number', (e) => ({ ...e, seq: e.seq + 7 }), 'seq-gap'],
    ['the time', (e) => ({ ...e, ts: '2030-01-01T00:00:00Z' }), 'hash-mismatch'],
    ['the actor kind', (e) => ({ ...e, actor: { ...e.actor, kind: 'SYSTEM' } }), 'hash-mismatch'],
    ['the actor id', (e) => ({ ...e, actor: { ...e.actor, id: 'someone-else' } }), 'hash-mismatch'],
    ['the actor id, removed', (e) => ({ ...e, actor: { ...e.actor, id: null } }), 'hash-mismatch'],
    ['the type', (e) => ({ ...e, type: 'approval.revoked' }), 'hash-mismatch'],
    ['a payload value', (e) => ({ ...e, payload: { ...e.payload, n: 1000 } }), 'hash-mismatch'],
    [
      'a payload key, added',
      (e) => ({ ...e, payload: { ...e.payload, extra: 1 } }),
      'hash-mismatch',
    ],
    ['the payload, emptied', (e) => ({ ...e, payload: {} }), 'hash-mismatch'],
    [
      'the payload, nested too deeply to hash',
      (e) => ({ ...e, payload: nested(70) }),
      'hash-mismatch',
    ],
    ['the previous hash', (e) => ({ ...e, prevHash: 'f'.repeat(64) }), 'prev-hash-mismatch'],
    ['the hash', (e) => ({ ...e, hash: 'f'.repeat(64) }), 'hash-mismatch'],
  ];

  describe.each(chain.map((event, index) => [index, event] as const))(
    'entry %i',
    (index, event) => {
      it.each(edits)('is caught when %s is altered', (_what, edit, reason) => {
        const verdict = reasonOf(replaceAt(chain, index, edit(event) as AuditEvent));
        expect(verdict).toMatchObject({ reason, index, seq: index + 1 });
      });
    },
  );

  it('is caught when any single character of either hash is changed', () => {
    const hex = '0123456789abcdef';
    for (const field of ['hash', 'prevHash'] as const) {
      const original = (chain[3] as AuditEvent)[field];
      for (let at = 0; at < original.length; at++) {
        const swapped = hex.charAt((hex.indexOf(original.charAt(at)) + 1) % 16);
        const altered = `${original.slice(0, at)}${swapped}${original.slice(at + 1)}`;
        const verdict = reasonOf(
          replaceAt(chain, 3, { ...chain[3], [field]: altered } as AuditEvent),
        );
        expect(verdict.index).toBe(3);
      }
    }
  });

  describe('structure', () => {
    it.each([0, 1, 2, 3, 4])('is caught when entry %i is removed', (index) => {
      const without = chain.filter((_, position) => position !== index);
      expect(reasonOf(without)).toMatchObject({ reason: 'seq-gap', index, seq: index + 1 });
    });

    it.each([0, 2, 5])('is caught when entry %i is repeated', (index) => {
      const repeated = [...chain.slice(0, index + 1), chain[index], ...chain.slice(index + 1)];
      expect(reasonOf(repeated)).toMatchObject({ reason: 'seq-gap', index: index + 1 });
    });

    it.each([0, 2, 4])('is caught when entries %i and the next are swapped', (index) => {
      const swapped = [...chain];
      swapped[index] = chain[index + 1] as AuditEvent;
      swapped[index + 1] = chain[index] as AuditEvent;
      expect(reasonOf(swapped)).toMatchObject({ reason: 'seq-gap', index });
    });

    it('is caught when an entry from another organisation’s log takes a place', () => {
      const foreign = buildChain(6, ORG2);
      for (const index of [0, 3, 5]) {
        expect(reasonOf(replaceAt(chain, index, foreign[index] as AuditEvent))).toMatchObject({
          reason: 'wrong-org',
          index,
        });
      }
      expect(reasonOf(foreign)).toMatchObject({ reason: 'wrong-org', index: 0 });
    });

    it('does not name the other organisation, whose log the verdict may be shown from', () => {
      const foreign = buildChain(1, ORG2);
      expect(reasonOf(foreign).detail).not.toContain(ORG2);
    });

    it('is caught when an entry is moved to another organisation and its hash recomputed', () => {
      const moved = rewriteFrom(chain, 2, (event) => ({ ...event, orgId: ORG2 }));
      expect(reasonOf(moved)).toMatchObject({ reason: 'wrong-org', index: 2 });
    });
  });

  describe('things that are not entries', () => {
    const valid = chain[2] as AuditEvent;
    it.each([
      ['null', null],
      ['a number', 42],
      ['text', 'an entry'],
      ['an array', [valid]],
      ['an empty object', {}],
      ['an entry with an extra field', { ...valid, extra: 1 }],
      ['an entry missing a field', { ...valid, payload: undefined }],
      ['a fractional sequence number', { ...valid, seq: 3.5 }],
      ['a sequence number as text', { ...valid, seq: '3' }],
      ['an event type in the wrong case', { ...valid, type: 'Bad Type' }],
      ['an unparseable time', { ...valid, ts: 'yesterday' }],
      ['a hash that is not hex', { ...valid, hash: 'xyz' }],
      ['a payload that is an array', { ...valid, payload: [1] }],
      ['an entry whose hash equals its predecessor', { ...valid, hash: valid.prevHash }],
    ])('are reported as malformed: %s', (_what, bad) => {
      expect(reasonOf(replaceAt(chain, 2, bad as AuditEvent))).toMatchObject({
        reason: 'malformed',
        index: 2,
        seq: 3,
      });
    });

    it('says what is wrong with a malformed entry', () => {
      expect(reasonOf([{ ...chain[0], seq: '1' }]).detail).toContain('seq');
    });
  });

  describe('a rewritten tail, which is consistent with itself', () => {
    const genuine = headOf(chain.at(-1) as AuditEvent);

    it.each([0, 2, 5])(
      'passes without an anchor when entry %i and all after it are rewritten',
      (index) => {
        const rewritten = rewriteFrom(chain, index, (event) => ({
          ...event,
          payload: { forged: true },
        }));
        const verdict = verifyChain(rewritten, { orgId: ORG });
        expect(verdict.ok).toBe(true);
        expect(verdict.ok && verdict.head.hash).not.toBe(genuine.hash);
      },
    );

    it.each([0, 2, 5])(
      'is caught by a head recorded before the rewrite: from entry %i',
      (index) => {
        const rewritten = rewriteFrom(chain, index, (event) => ({
          ...event,
          payload: { forged: true },
        }));
        expect(reasonOf(rewritten, { through: genuine })).toMatchObject({
          reason: 'anchor-mismatch',
          index: 5,
          seq: 6,
        });
      },
    );

    it('is not caught by a head recorded before the part that was rewritten', () => {
      const rewritten = rewriteFrom(chain, 4, (event) => ({ ...event, payload: { forged: true } }));
      for (const before of chain.slice(0, 4)) {
        expect(verifyChain(rewritten, { orgId: ORG, through: headOf(before) }).ok).toBe(true);
      }
      expect(
        verifyChain(rewritten, { orgId: ORG, through: headOf(chain[4] as AuditEvent) }).ok,
      ).toBe(false);
    });

    it('is caught at the first anchored entry, even if only one entry in the middle was recorded', () => {
      const rewritten = rewriteFrom(chain, 1, (event) => ({
        ...event,
        ts: '2031-01-01T00:00:00Z',
      }));
      expect(reasonOf(rewritten, { through: headOf(chain[3] as AuditEvent) })).toMatchObject({
        reason: 'anchor-mismatch',
        index: 3,
      });
    });
  });

  describe('a log cut short', () => {
    const genuine = headOf(chain.at(-1) as AuditEvent);

    it.each([1, 2, 5])('passes without an anchor when its last %i entries are removed', (cut) => {
      expect(verifyChain(chain.slice(0, -cut), { orgId: ORG })).toMatchObject({
        ok: true,
        count: chain.length - cut,
      });
    });

    it.each([1, 2, 5, 6])('is caught by a recorded head: last %i entries removed', (cut) => {
      const verdict = reasonOf(chain.slice(0, -cut), { through: genuine });
      expect(verdict).toMatchObject({
        reason: 'anchor-missing',
        index: chain.length - cut,
        seq: 6,
      });
    });

    it('is caught when nothing is left', () => {
      expect(reasonOf([], { through: genuine })).toMatchObject({
        reason: 'anchor-missing',
        index: 0,
      });
    });
  });

  it('exercises every kind of failure there is', () => {
    expect([...seen].sort()).toEqual([...CHAIN_FAILURES].sort());
  });
});

describe('verifyChain: how it is called', () => {
  const chain = buildChain(4);
  const head = headOf(chain[1] as AuditEvent);

  it.each([
    ['a head after which is malformed', { after: { ...head, hash: 'abc' } }],
    ['a head after which belongs to another organisation', { after: { ...head, orgId: ORG2 } }],
    ['an anchor that is malformed', { through: { ...head, seq: -1 } }],
    ['an anchor in another organisation', { through: { ...head, orgId: ORG2 } }],
    ['an anchor that is the start of the log', { through: genesisHead(ORG) }],
    [
      'an anchor behind where verification starts',
      { after: head, through: headOf(chain[0] as AuditEvent) },
    ],
    ['an anchor where verification starts', { after: head, through: head }],
  ])('refuses %s, because that is a mistake by the caller and not a finding', (_what, options) => {
    expect(() => verifyChain(chain, { orgId: ORG, ...options })).toThrow(
      expect.objectContaining({ name: 'AuditError', code: 'invalid-head' }),
    );
  });
});

describe('AuditError', () => {
  it('is an Error with a code', () => {
    const error = new AuditError('invalid-event', 'no');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'AuditError', code: 'invalid-event', message: 'no' });
  });
});

describe('properties', () => {
  const payloads = fc.array(
    fc.dictionary(fc.string({ maxLength: 12 }), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 4 }),
    { maxLength: 8 },
  );

  const build = (list: ReadonlyArray<Record<string, unknown>>): AuditEvent[] => {
    const events: AuditEvent[] = [];
    let head = genesisHead(ORG);
    for (const [index, payload] of list.entries()) {
      const event = appendEvent(head, draft(index + 1, { payload: payload as never }));
      events.push(event);
      head = headOf(event);
    }
    return events;
  };

  it('every chain built by appendEvent verifies, whatever it holds', () => {
    fc.assert(
      fc.property(payloads, (list) => {
        const events = build(list);
        const verdict = verifyChain(events, { orgId: ORG });
        expect(verdict).toMatchObject({ ok: true, count: list.length });
        expect(verdict.ok && verdict.head).toEqual(
          events.length === 0 ? genesisHead(ORG) : headOf(events.at(-1) as AuditEvent),
        );
      }),
    );
  });

  it('altering any one field of any one entry is always caught, at that entry', () => {
    const fields = [
      (e: AuditEvent) => ({ ...e, id: auditId(1000) }),
      (e: AuditEvent) => ({ ...e, ts: '2031-02-03T04:05:06Z' }),
      (e: AuditEvent) => ({ ...e, type: `${e.type}.x` }),
      (e: AuditEvent) => ({ ...e, actor: { kind: 'VERIFIER' as const, id: null } }),
      (e: AuditEvent) => ({ ...e, payload: { ...e.payload, tampered: true } }),
      (e: AuditEvent) => ({ ...e, prevHash: 'e'.repeat(64) }),
      (e: AuditEvent) => ({ ...e, hash: 'e'.repeat(64) }),
    ];
    fc.assert(
      fc.property(
        payloads.filter((list) => list.length > 0),
        fc.nat(),
        fc.nat(fields.length - 1),
        (list, at, which) => {
          const events = build(list);
          const index = at % events.length;
          const edit = fields[which] as (e: AuditEvent) => AuditEvent;
          const verdict = verifyChain(replaceAt(events, index, edit(events[index] as AuditEvent)), {
            orgId: ORG,
          });
          expect(verdict).toMatchObject({ ok: false, index });
        },
      ),
    );
  });

  it('removing, repeating or swapping entries is always caught', () => {
    fc.assert(
      fc.property(
        payloads.filter((list) => list.length > 1),
        fc.nat(),
        (list, at) => {
          const events = build(list);
          const index = at % (events.length - 1); // never the last: that needs an anchor
          const removed = events.filter((_, position) => position !== index);
          const repeated = [...events.slice(0, index + 1), ...events.slice(index)];
          const swapped = [...events];
          swapped[index] = events[index + 1] as AuditEvent;
          swapped[index + 1] = events[index] as AuditEvent;
          for (const broken of [removed, repeated, swapped]) {
            expect(verifyChain(broken, { orgId: ORG }).ok).toBe(false);
          }
        },
      ),
    );
  });

  it('cutting the end is always caught by a recorded head', () => {
    fc.assert(
      fc.property(
        payloads.filter((list) => list.length > 0),
        fc.nat(),
        (list, at) => {
          const events = build(list);
          const recorded = headOf(events.at(-1) as AuditEvent);
          const kept = events.slice(0, at % events.length);
          expect(verifyChain(kept, { orgId: ORG, through: recorded })).toMatchObject({
            ok: false,
            reason: 'anchor-missing',
          });
        },
      ),
    );
  });
});
