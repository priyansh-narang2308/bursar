import { type Cart, type CartLine, cartLineSchema, cartSchema, idSchemas } from '@bursar/schemas';
import { type CartContent, cartHash } from '../src/digests';

/** A 32-byte key that is a function of its seed, so no key-like literal appears in the tests. */
export function testKey(seed: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (seed + index) & 0xff);
}

/** A copy of `bytes` with one bit flipped. */
export function flipBit(bytes: Uint8Array, byteIndex: number, bit = 0): Uint8Array {
  const copy = Uint8Array.from(bytes);
  copy[byteIndex] = (copy[byteIndex] ?? 0) ^ (1 << bit);
  return copy;
}

/** Another character from the same alphabet, so a corrupted text is still well formed. */
export function otherChar(char: string, alphabet: string): string {
  return alphabet.charAt((alphabet.indexOf(char) + 1) % alphabet.length);
}

export const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const HEX_ALPHABET = '0123456789abcdef';

export const ids = {
  org: idSchemas.organization.parse('org_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  org2: idSchemas.organization.parse('org_01ARZ3NDEKTSV4RRFFQ69G5FAW'),
  user: idSchemas.user.parse('usr_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  user2: idSchemas.user.parse('usr_01ARZ3NDEKTSV4RRFFQ69G5FAW'),
  mission: idSchemas.mission.parse('mis_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  mission2: idSchemas.mission.parse('mis_01ARZ3NDEKTSV4RRFFQ69G5FAW'),
  mandate: idSchemas.mandate.parse('mnd_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  supplier: idSchemas.supplier.parse('sup_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  action: idSchemas.action.parse('act_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  action2: idSchemas.action.parse('act_01ARZ3NDEKTSV4RRFFQ69G5FAW'),
  decision: idSchemas.decision.parse('dec_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  decision2: idSchemas.decision.parse('dec_01ARZ3NDEKTSV4RRFFQ69G5FAW'),
  approval: idSchemas.approval.parse('apv_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  approval2: idSchemas.approval.parse('apv_01ARZ3NDEKTSV4RRFFQ69G5FAW'),
  cart: idSchemas.cart.parse('crt_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  cart2: idSchemas.cart.parse('crt_01ARZ3NDEKTSV4RRFFQ69G5FAW'),
};

export const usd = (minor: string) => ({ currency: 'USD' as const, minor });

export const lineA: CartLine = cartLineSchema.parse({
  id: 'cln_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  offerId: 'ofr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  quantity: 2,
  unitPrice: usd('1250'),
  lineTotal: usd('2500'),
  rationale: 'Cheapest in stock',
});

export const lineB: CartLine = cartLineSchema.parse({
  id: 'cln_01ARZ3NDEKTSV4RRFFQ69G5FAW',
  offerId: 'ofr_01ARZ3NDEKTSV4RRFFQ69G5FAW',
  quantity: 1,
  unitPrice: usd('999'),
  lineTotal: usd('999'),
  rationale: null,
});

export const cartContent: CartContent = {
  id: ids.cart,
  orgId: ids.org,
  missionId: ids.mission,
  version: 2,
  lines: [lineA, lineB],
  total: cartSchema.shape.total.parse(usd('3499')),
};

/** A complete, valid cart: the content, its hash, and the fields the hash leaves out. */
export function buildCart(content: CartContent = cartContent): Cart {
  return cartSchema.parse({
    ...content,
    cartHash: cartHash(content),
    status: 'PROPOSED',
    createdAt: '2026-10-05T12:00:00Z',
  });
}

/** The same value with every object's keys inserted in reverse order. */
export function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseKeys);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, member]) => [key, reverseKeys(member)]),
    );
  }
  return value;
}
