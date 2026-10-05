import { cartHashSchema, cartLineSchema, cartSchema, type JsonValue } from '@bursar/schemas';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ActionIdentity,
  type CartContent,
  cartHash,
  idempotencyKey,
  inputsHash,
  policyHash,
  verifyCartHash,
} from '../src/digests';
import { buildCart, cartContent, ids, lineA, lineB, usd } from './support';
import { VECTORS } from './vectors';

const policy: JsonValue = {
  version: 3,
  rules: [
    { id: 'R-ITEM-CAP', params: { max: '5000' } },
    { id: 'R-VENDOR', params: {} },
  ],
};

const inputs: JsonValue = {
  actionId: ids.action,
  envelopeRemaining: '10000',
  now: '2026-10-05T12:00:00Z',
};

const identity: ActionIdentity = {
  orgId: ids.org,
  type: 'CAPTURE',
  missionId: ids.mission,
  mandateId: null,
  supplierId: null,
  cartHash: cartHashSchema.parse(VECTORS.cartHash),
  compensatesActionId: null,
  ordinal: 1,
};

describe('cartHash', () => {
  it('matches the independently computed value', () => {
    expect(cartHash(cartContent)).toBe(VECTORS.cartHash);
  });

  it('is the same however the lines were loaded', () => {
    expect(cartHash({ ...cartContent, lines: [lineB, lineA] })).toBe(VECTORS.cartHash);
  });

  it('is the same whatever the order of the lines', () => {
    const extra = [2, 3].map((quantity) =>
      cartLineSchema.parse({
        ...lineA,
        id: `cln_01ARZ3NDEKTSV4RRFFQ69G5FA${quantity === 2 ? 'X' : 'Y'}`,
        quantity,
        lineTotal: usd(String(1250 * quantity)),
      }),
    );
    const lines = [lineA, lineB, ...extra];
    const expected = cartHash({ ...cartContent, lines });
    fc.assert(
      fc.property(fc.shuffledSubarray(lines, { minLength: 4, maxLength: 4 }), (shuffled) => {
        expect(cartHash({ ...cartContent, lines: shuffled })).toBe(expected);
      }),
    );
  });

  it('ignores what changes as a cart moves through its life', () => {
    const approved = cartSchema.parse({
      ...buildCart(),
      status: 'APPROVED',
      createdAt: '2031-01-01T00:00:00Z',
    });
    expect(cartHash(approved)).toBe(VECTORS.cartHash);
  });

  it('ignores properties that are not part of the cart, so stray data cannot change it', () => {
    const [first] = cartContent.lines;
    const withStrays = {
      ...cartContent,
      stray: 'x',
      total: { ...cartContent.total, stray: 'x' },
      lines: [{ ...first, stray: 'x', unitPrice: { ...lineA.unitPrice, stray: 'x' } }, lineB],
    };
    expect(cartHash(withStrays as CartContent)).toBe(VECTORS.cartHash);
  });

  const changed: ReadonlyArray<readonly [string, CartContent]> = [
    ['the cart id', { ...cartContent, id: ids.cart2 }],
    ['the organisation', { ...cartContent, orgId: ids.org2 }],
    ['the mission', { ...cartContent, missionId: ids.mission2 }],
    ['the version', { ...cartContent, version: 3 }],
    ['the total', { ...cartContent, total: usd('3500') }],
    ['the total currency', { ...cartContent, total: { currency: 'EUR', minor: '3499' } }],
    [
      'a line id',
      {
        ...cartContent,
        lines: [
          { ...lineA, id: cartLineSchema.shape.id.parse('cln_01ARZ3NDEKTSV4RRFFQ69G5FAZ') },
          lineB,
        ],
      },
    ],
    ['a line offer', { ...cartContent, lines: [{ ...lineA, offerId: lineB.offerId }, lineB] }],
    ['a quantity', { ...cartContent, lines: [{ ...lineA, quantity: 3 }, lineB] }],
    ['a unit price', { ...cartContent, lines: [{ ...lineA, unitPrice: usd('1251') }, lineB] }],
    [
      'a unit price currency',
      {
        ...cartContent,
        lines: [{ ...lineA, unitPrice: { currency: 'EUR', minor: '1250' } }, lineB],
      },
    ],
    ['a line total', { ...cartContent, lines: [{ ...lineA, lineTotal: usd('2501') }, lineB] }],
    ['a rationale', { ...cartContent, lines: [{ ...lineA, rationale: 'Pricey' }, lineB] }],
    ['a rationale removed', { ...cartContent, lines: [{ ...lineA, rationale: null }, lineB] }],
    ['a rationale added', { ...cartContent, lines: [lineA, { ...lineB, rationale: 'x' }] }],
    ['a line removed', { ...cartContent, lines: [lineA] }],
    ['a line repeated', { ...cartContent, lines: [lineA, lineB, lineB] }],
  ];

  it.each(changed)('changes when %s changes', (_what, content) => {
    expect(cartHash(content)).not.toBe(VECTORS.cartHash);
  });

  it('gives every one of those changes a different hash', () => {
    const hashes = changed.map(([, content]) => cartHash(content));
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('covers every field of a cart and a line, or knowingly leaves one out', () => {
    // If a field is added to either schema this fails until someone decides whether it belongs in
    // what an approval signs. It must not be left out by accident.
    const hashedCartFields = ['id', 'lines', 'missionId', 'orgId', 'total', 'version'];
    const unhashedCartFields = ['cartHash', 'createdAt', 'status'];
    expect(Object.keys(cartSchema.shape).sort()).toEqual(
      [...hashedCartFields, ...unhashedCartFields].sort(),
    );
    expect(Object.keys(cartLineSchema.shape).sort()).toEqual([
      'id',
      'lineTotal',
      'offerId',
      'quantity',
      'rationale',
      'unitPrice',
    ]);
  });
});

describe('verifyCartHash', () => {
  it('accepts a cart whose hash is right', () => {
    expect(verifyCartHash(buildCart())).toBe(true);
  });

  it('rejects a cart whose content changed after it was hashed', () => {
    const cart = buildCart();
    expect(verifyCartHash({ ...cart, version: 3 })).toBe(false);
    expect(verifyCartHash({ ...cart, total: usd('1') })).toBe(false);
    expect(verifyCartHash({ ...cart, lines: [lineA] })).toBe(false);
  });

  it('rejects a cart whose stored hash was replaced', () => {
    expect(verifyCartHash({ ...buildCart(), cartHash: cartHashSchema.parse('0'.repeat(64)) })).toBe(
      false,
    );
  });
});

describe('policyHash and inputsHash', () => {
  it('match the independently computed values', () => {
    expect(policyHash(policy)).toBe(VECTORS.policyHash);
    expect(inputsHash(inputs)).toBe(VECTORS.inputsHash);
  });

  it('do not depend on key order', () => {
    expect(policyHash({ rules: policy['rules'] ?? null, version: 3 })).toBe(VECTORS.policyHash);
  });

  it('are different digests for the same content, so one cannot stand in for the other', () => {
    expect(policyHash(inputs)).not.toBe(inputsHash(inputs));
  });

  it('refuse data that is not JSON', () => {
    expect(() => policyHash(undefined as unknown as JsonValue)).toThrow('canonical JSON');
  });
});

describe('idempotencyKey', () => {
  it('matches the independently computed value', () => {
    expect(idempotencyKey(identity)).toBe(VECTORS.idempotency);
  });

  it('is the same for a retry of the same action', () => {
    expect(idempotencyKey({ ...identity })).toBe(idempotencyKey(identity));
  });

  const other: ReadonlyArray<readonly [string, Partial<ActionIdentity>]> = [
    ['the organisation', { orgId: ids.org2 }],
    ['the type', { type: 'REFUND' }],
    ['the mission', { missionId: ids.mission2 }],
    ['the mandate', { mandateId: ids.mandate }],
    ['the supplier', { supplierId: ids.supplier }],
    ['the cart', { cartHash: cartHashSchema.parse('1'.repeat(64)) }],
    ['the action it undoes', { compensatesActionId: ids.action }],
    ['the ordinal', { ordinal: 2 }],
  ];

  it.each(other)('is a different action when %s differs', (_what, change) => {
    expect(idempotencyKey({ ...identity, ...change })).not.toBe(VECTORS.idempotency);
  });

  it('keeps null apart from a value, and a field apart from its neighbours', () => {
    const keys = [
      { mandateId: ids.mandate },
      { supplierId: ids.supplier },
      { compensatesActionId: ids.action },
    ].map((change) => idempotencyKey({ ...identity, ...change }));
    expect(new Set([...keys, VECTORS.idempotency]).size).toBe(4);
  });

  it('ignores properties that are not part of an action’s identity', () => {
    expect(idempotencyKey({ ...identity, amount: usd('5') } as ActionIdentity)).toBe(
      VECTORS.idempotency,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 53, Number.POSITIVE_INFINITY])(
    'refuses the ordinal %s',
    (ordinal) => {
      expect(() => idempotencyKey({ ...identity, ordinal })).toThrow(
        expect.objectContaining({ code: 'invalid-input' }),
      );
    },
  );
});
