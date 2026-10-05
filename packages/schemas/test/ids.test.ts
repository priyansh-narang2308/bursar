import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createUlidGenerator,
  ID_KINDS,
  ID_PREFIXES,
  type IdKind,
  idSchema,
  idSchemas,
  idTime,
  isId,
  newId,
  ULID_PATTERN,
} from '../src/ids';

const SPEC_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'; // the example in the ULID specification
const SPEC_TIME = 1469922850259;

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const ZERO = new Uint8Array(10);
const ONES = new Uint8Array(10).fill(255);

function generator(time: number, random: Uint8Array = ZERO): () => string {
  return createUlidGenerator({ now: () => time, randomBytes: () => random });
}

describe('ULID generation', () => {
  it.each([
    [0, '0000000000'],
    [1, '0000000001'],
    [31, '000000000Z'],
    [32, '0000000010'],
    [SPEC_TIME, '01ARZ3NDEK'],
    [1_800_000_000_000, '01MCC5RM00'],
    [2 ** 48 - 1, '7ZZZZZZZZZ'],
  ])('writes the time %s as %s, as the specification does', (time, expected) => {
    expect(generator(time)()).toBe(`${expected}0000000000000000`);
  });

  it.each([
    [ZERO, '0000000000000000'],
    [bytes(0, 1, 2, 3, 4, 5, 6, 7, 8, 9), '000G40R40M30E209'],
    [ONES, 'ZZZZZZZZZZZZZZZZ'],
  ])('writes the 80 random bits %j in base 32', (random, expected) => {
    expect(generator(0, random)()).toBe(`0000000000${expected}`);
  });

  it('counts up in the same millisecond, carrying between digits', () => {
    const next = generator(5, bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 31));

    expect(next()).toBe('0000000005000000000000000Z');
    expect(next()).toBe('00000000050000000000000010');
    expect(next()).toBe('00000000050000000000000011');
  });

  it('keeps counting up if the clock steps backwards', () => {
    const times = [100, 99, 50];
    const next = createUlidGenerator({ now: () => times.shift() ?? 0, randomBytes: () => ZERO });

    // 100 is "34" in base 32; the later, smaller readings keep that time and count up.
    expect([next(), next(), next()]).toEqual([
      '00000000340000000000000000',
      '00000000340000000000000001',
      '00000000340000000000000002',
    ]);
  });

  it('draws fresh randomness when the clock moves forward', () => {
    const times = [1, 2];
    const draws = [bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 7), bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 9)];
    const next = createUlidGenerator({
      now: () => times.shift() ?? 0,
      randomBytes: () => draws.shift() ?? ZERO,
    });

    expect([next(), next()]).toEqual(['00000000010000000000000007', '00000000020000000000000009']);
  });

  it('refuses to wrap when the random part runs out within one millisecond', () => {
    const next = generator(1, ONES);

    expect(next()).toBe('0000000001ZZZZZZZZZZZZZZZZ');
    expect(() => next()).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 2 ** 48])(
    'refuses the clock reading %s',
    (time) => {
      expect(() => generator(time)()).toThrow(RangeError);
    },
  );

  it('refuses a random source that returns the wrong number of bytes', () => {
    expect(() => generator(1, bytes(1, 2, 3))()).toThrow('needs 10 random bytes');
  });

  it('works with the real clock and the platform random source', () => {
    const next = createUlidGenerator();
    const [first, second] = [next(), next()];

    expect(first).toMatch(ULID_PATTERN);
    expect(second > first).toBe(true);
  });

  describe('properties', () => {
    const clock = fc.array(fc.integer({ min: 0, max: 2 ** 48 - 1 }), {
      minLength: 2,
      maxLength: 30,
    });
    // The top bit is cleared so the random part cannot overflow while counting up.
    const random = fc
      .uint8Array({ minLength: 10, maxLength: 10 })
      .map((raw) => Uint8Array.from(raw, (byte, index) => (index === 0 ? byte & 0x7f : byte)));

    it('always makes ids that sort in the order they were made, whatever the clock does', () => {
      fc.assert(
        fc.property(clock, random, (times, bits) => {
          const queue = [...times];
          const next = createUlidGenerator({
            now: () => queue.shift() ?? 0,
            randomBytes: () => bits,
          });
          const ids = times.map(() => next());

          for (const [index, id] of ids.entries()) {
            expect(id).toMatch(ULID_PATTERN);
            if (index > 0) {
              expect(id > (ids[index - 1] ?? '')).toBe(true);
            }
          }
        }),
      );
    });

    it('reads its own time back, for any time', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 2 ** 48 - 1 }), random, (time, bits) => {
          const id = idSchema('action').parse(`act_${generator(time, bits)()}`);
          expect(idTime(id)).toBe(time);
        }),
      );
    });
  });
});

describe('identifier kinds', () => {
  it('give every kind a distinct three-letter lower-case prefix', () => {
    const prefixes = Object.values(ID_PREFIXES);

    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^[a-z]{3}$/);
    }
  });

  it('list the same kinds the prefix table and the schema table have', () => {
    expect([...ID_KINDS].sort()).toEqual(Object.keys(ID_PREFIXES).sort());
    expect(Object.keys(idSchemas).sort()).toEqual([...ID_KINDS].sort());
  });
});

describe('identifier schemas', () => {
  const sample = (kind: IdKind): string => `${ID_PREFIXES[kind]}_${SPEC_ULID}`;

  it.each(ID_KINDS)('accept a %s id and reject the id of every other kind', (kind) => {
    expect(idSchemas[kind].safeParse(sample(kind)).success).toBe(true);
    for (const other of ID_KINDS.filter((candidate) => candidate !== kind)) {
      expect(idSchemas[kind].safeParse(sample(other)).success).toBe(false);
    }
  });

  it.each([
    ['a bare ULID with no prefix', SPEC_ULID],
    ['a lower-case ULID', `act_${SPEC_ULID.toLowerCase()}`],
    ['a letter outside the alphabet (I, L, O, U)', 'act_01ARZ3NDEKTSV4RRFFQ69G5FAI'],
    ['a first digit above 7, which overflows 48 bits', 'act_81ARZ3NDEKTSV4RRFFQ69G5FAV'],
    ['a short ULID', 'act_01ARZ3NDEKTSV4RRFFQ69G5FA'],
    ['a long ULID', `act_${SPEC_ULID}0`],
    ['no underscore', `act${SPEC_ULID}0`],
    ['a space', `act_${SPEC_ULID} `],
    ['an empty string', ''],
  ])('reject %s', (_label, value) => {
    expect(idSchemas.action.safeParse(value).success).toBe(false);
  });

  it.each([null, undefined, 42, {}, [`act_${SPEC_ULID}`]])('reject the non-string %s', (value) => {
    expect(idSchemas.action.safeParse(value).success).toBe(false);
    expect(isId('action', value)).toBe(false);
  });

  it('explain what an id should look like', () => {
    const result = idSchemas.mission.safeParse(`act_${SPEC_ULID}`);

    expect(result.error?.issues[0]?.message).toBe(
      'Expected a mission id such as mis_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
  });

  it('reads the creation time out of a real ULID', () => {
    expect(idTime(idSchemas.action.parse(`act_${SPEC_ULID}`))).toBe(SPEC_TIME);
  });
});

describe('newId', () => {
  it.each(ID_KINDS)('makes a valid %s id', (kind) => {
    const id = newId(kind);

    expect(id.startsWith(`${ID_PREFIXES[kind]}_`)).toBe(true);
    expect(isId(kind, id)).toBe(true);
  });

  it('makes ids that are unique and sort by creation time', () => {
    const ids = Array.from({ length: 200 }, () => newId('action'));

    expect(new Set(ids).size).toBe(200);
    expect([...ids].sort()).toEqual(ids);
  });

  it('stamps ids with the current time', () => {
    const before = Date.now();
    const id = newId('mission');

    expect(idTime(id)).toBeGreaterThanOrEqual(before);
    expect(idTime(id)).toBeLessThanOrEqual(Date.now());
  });
});
