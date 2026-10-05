import { z } from 'zod';
import { amountSchema, cartHashSchema, textSchema, timestampSchema } from '../common';
import { availabilitySchema, cartStatusSchema, offerSourceSchema } from '../enums';
import { idSchemas } from '../ids';
import { isProductOf, isSumOf, sameCurrency } from '../invariants';
import { rule } from '../rule';

/** The most of one item a cart line may hold. The same limit applies to what an LLM may ask for. */
export const MAX_LINE_QUANTITY = 99;

/** The most lines a cart may hold. */
export const MAX_CART_LINES = 50;

/**
 * An offer is a price quote for a product from a supplier, frozen at the moment it was read. Carts
 * and decisions refer to these snapshots, never to a live price, so every total can be recomputed.
 */
export const offerSchema = z
  .strictObject({
    id: idSchemas.offer,
    supplierId: idSchemas.supplier,
    title: textSchema(300),
    brand: textSchema(100).nullable(),
    category: textSchema(100),
    imageUrl: z.httpUrl().max(2000).nullable(),
    url: z.httpUrl().max(2000),
    price: amountSchema,
    availability: availabilitySchema,
    source: offerSourceSchema,
    quoteId: z.string().min(1).max(100).nullable(),
    observedAt: timestampSchema,
  })
  .meta({
    id: 'Offer',
    description: 'A price quote for a product from a supplier, frozen when it was read.',
  });
export type Offer = z.infer<typeof offerSchema>;

export const cartLineSchema = z
  .strictObject({
    id: idSchemas.cartLine,
    offerId: idSchemas.offer,
    quantity: z.int().min(1).max(MAX_LINE_QUANTITY),
    unitPrice: amountSchema,
    lineTotal: amountSchema,
    /** Why the agent chose this offer, in its own words. Untrusted text. */
    rationale: textSchema(500).nullable(),
  })
  .refine(
    ({ unitPrice, lineTotal }) => sameCurrency(unitPrice, lineTotal),
    rule('The unit price and the line total must be in the same currency', 'lineTotal'),
  )
  .refine(
    ({ lineTotal, unitPrice, quantity }) => isProductOf(lineTotal, unitPrice, quantity),
    rule('The line total must equal the unit price times the quantity', 'lineTotal'),
  )
  .meta({
    id: 'CartLine',
    description: 'One offer and a quantity, with the price the server worked out.',
  });
export type CartLine = z.infer<typeof cartLineSchema>;

/**
 * A cart is what an approval signs. Its prices and total are computed by the server from offer
 * snapshots, and a cart whose arithmetic does not add up is not a valid cart at all.
 */
export const cartSchema = z
  .strictObject({
    id: idSchemas.cart,
    orgId: idSchemas.organization,
    missionId: idSchemas.mission,
    /** Starts at 1; a change makes a new version and supersedes the old one. */
    version: z.int().min(1),
    lines: z.array(cartLineSchema).min(1).max(MAX_CART_LINES),
    total: amountSchema,
    cartHash: cartHashSchema,
    status: cartStatusSchema,
    createdAt: timestampSchema,
  })
  .refine(
    ({ total, lines }) => sameCurrency(total, ...lines.map((line) => line.lineTotal)),
    rule('Every line must be priced in the cart currency', 'lines'),
  )
  .refine(
    ({ total, lines }) =>
      isSumOf(
        total,
        lines.map((line) => line.lineTotal),
      ),
    rule('The total must equal the sum of the line totals', 'total'),
  )
  .refine(
    ({ lines }) => new Set(lines.map((line) => line.id)).size === lines.length,
    rule('Line ids must be unique within a cart', 'lines'),
  )
  .meta({
    id: 'Cart',
    description: 'What an approval signs: lines, a server-computed total, and its hash.',
  });
export type Cart = z.infer<typeof cartSchema>;
