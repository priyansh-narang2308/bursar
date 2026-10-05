import { MAX_MINOR } from '@bursar/money';
import { describe, expect, it } from 'vitest';
import {
  AVAILABILITIES,
  cartLineSchema,
  cartSchema,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  OFFER_SOURCES,
  offerSchema,
} from '../src';
import { cart, cartLine, eur, id, offer, usd } from './fixtures';
import { describeEntityContract, problemsOf } from './support';

describeEntityContract('Offer', offerSchema, offer);
describeEntityContract('CartLine', cartLineSchema, cartLine);
describeEntityContract('Cart', cartSchema, cart);

describe('Offer rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(offerSchema, offer(overrides));

  it.each([...AVAILABILITIES])('accepts the availability %s', (availability) => {
    expect(problems({ availability })).toEqual([]);
  });

  it.each([...OFFER_SOURCES])('accepts the source %s', (source) => {
    expect(problems({ source })).toEqual([]);
  });

  it('lets the optional details be absent', () => {
    expect(problems({ brand: null, imageUrl: null, quoteId: null })).toEqual([]);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://files.example.com/desk',
    'file:///etc/passwd',
    'not a url',
    `https://shop.example.com/${'a'.repeat(2000)}`,
  ])('accepts only a web link for the product page: not %j', (url) => {
    expect(problems({ url })).toEqual([expect.stringContaining('url:')]);
  });

  it('refuses a negative price and a blank title', () => {
    expect(problems({ price: usd('-1') })).toEqual([expect.stringContaining('price.minor:')]);
    expect(problems({ title: ' ' })).toEqual([expect.stringContaining('title:')]);
  });
});

describe('CartLine rules', () => {
  const problems = (overrides: Record<string, unknown>) =>
    problemsOf(cartLineSchema, cartLine(overrides));

  it('requires the line total to be the unit price times the quantity', () => {
    expect(problems({ lineTotal: usd('125001') })).toEqual([
      'lineTotal: The line total must equal the unit price times the quantity',
    ]);
    expect(problems({ quantity: 11 })).toEqual([
      'lineTotal: The line total must equal the unit price times the quantity',
    ]);
  });

  it('keeps the unit price and the line total in one currency', () => {
    expect(problems({ lineTotal: eur('125000') })).toEqual([
      'lineTotal: The unit price and the line total must be in the same currency',
    ]);
  });

  it('rejects a line whose total does not fit in 64 bits, without throwing', () => {
    expect(
      problems({ unitPrice: usd(MAX_MINOR.toString()), lineTotal: usd(MAX_MINOR.toString()) }),
    ).toEqual(['lineTotal: The line total must equal the unit price times the quantity']);
  });

  it.each([0, -1, 1.5, MAX_LINE_QUANTITY + 1, '10'])('rejects the quantity %j', (quantity) => {
    expect(problems({ quantity })).toEqual([expect.stringContaining('quantity:')]);
  });

  it('accepts the smallest and the largest quantity', () => {
    expect(problems({ quantity: 1, lineTotal: usd('12500') })).toEqual([]);
    expect(problems({ quantity: MAX_LINE_QUANTITY, lineTotal: usd('1237500') })).toEqual([]);
  });

  it('lets the rationale be absent, but not blank', () => {
    expect(problems({ rationale: null })).toEqual([]);
    expect(problems({ rationale: '   ' })).toEqual([expect.stringContaining('rationale:')]);
  });
});

describe('Cart rules', () => {
  const problems = (overrides: Record<string, unknown>) => problemsOf(cartSchema, cart(overrides));
  const lineOf = (n: number) =>
    cartLine({
      id: id('cartLine', n),
      offerId: id('offer', n),
      quantity: 1,
      lineTotal: usd('12500'),
    });

  it('requires the total to be exactly the sum of its lines', () => {
    expect(problems({ total: usd('134999') })).toEqual([
      'total: The total must equal the sum of the line totals',
    ]);
    expect(problems({ total: usd('134997') })).toEqual([
      'total: The total must equal the sum of the line totals',
    ]);
  });

  it('prices every line in the currency of the cart', () => {
    const lines = [
      cartLine(),
      cartLine({ id: id('cartLine', 1), unitPrice: eur('12500'), lineTotal: eur('125000') }),
    ];

    expect(problems({ lines, total: usd('250000') })).toEqual([
      'lines: Every line must be priced in the cart currency',
    ]);
  });

  it('refuses two lines with the same id', () => {
    const lines = [cartLine(), cartLine()];

    expect(problems({ lines, total: usd('250000') })).toEqual([
      'lines: Line ids must be unique within a cart',
    ]);
  });

  it('refuses a total whose sum would not fit in 64 bits, without throwing', () => {
    const huge = usd(MAX_MINOR.toString());
    const lines = [
      cartLine({ unitPrice: huge, lineTotal: huge, quantity: 1 }),
      cartLine({ id: id('cartLine', 1), unitPrice: huge, lineTotal: huge, quantity: 1 }),
    ];

    expect(problems({ lines, total: huge })).toEqual([
      'total: The total must equal the sum of the line totals',
    ]);
  });

  it('needs between one and the maximum number of lines', () => {
    expect(problems({ lines: [], total: usd('0') })).toEqual([expect.stringContaining('lines:')]);

    const many = Array.from({ length: MAX_CART_LINES }, (_, n) => lineOf(n));
    expect(problems({ lines: many, total: usd(String(12500 * MAX_CART_LINES)) })).toEqual([]);
    expect(
      problems({
        lines: [...many, lineOf(MAX_CART_LINES)],
        total: usd(String(12500 * (MAX_CART_LINES + 1))),
      }),
    ).toEqual([expect.stringContaining('lines:')]);
  });

  it('starts at version 1', () => {
    expect(problems({ version: 0 })).toEqual([expect.stringContaining('version:')]);
    expect(problems({ version: 1.5 })).toEqual([expect.stringContaining('version:')]);
    expect(problems({ version: 7 })).toEqual([]);
  });

  it('reports a broken line once, on the line, without also blaming the total', () => {
    const lines = [
      cartLine({ lineTotal: usd('1') }),
      cartLine({
        id: id('cartLine', 1),
        offerId: id('offer', 1),
        quantity: 2,
        unitPrice: usd('4999'),
        lineTotal: usd('9998'),
      }),
    ];

    expect(problems({ lines })).toEqual([
      'lines.0.lineTotal: The line total must equal the unit price times the quantity',
    ]);
  });
});
