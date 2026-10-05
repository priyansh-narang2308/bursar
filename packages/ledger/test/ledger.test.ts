import { type CurrencyCode, Money } from '@bursar/money';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balance, figures, isBalanced, LedgerError, type LedgerEvent, post } from '../src';

const usd = (minor: number) => Money.of(BigInt(minor), 'USD');
const USD: CurrencyCode = 'USD';

describe('post', () => {
  it.each<[string, LedgerEvent]>([
    ['authorize', { type: 'AUTHORIZE', amount: usd(10_000) }],
    ['void', { type: 'VOID', amount: usd(10_000) }],
    ['capture with a fee', { type: 'CAPTURE', amount: usd(6_000), fee: usd(200) }],
    ['capture without a fee', { type: 'CAPTURE', amount: usd(6_000), fee: usd(0) }],
    ['refund', { type: 'REFUND', amount: usd(1_000) }],
    ['payout', { type: 'PAYOUT', amount: usd(3_000) }],
  ])('balances for a %s', (_name, event) => {
    expect(isBalanced(post(event), USD)).toBe(true);
  });

  it('puts a capture’s money into escrow less the fee', () => {
    const entries = post({ type: 'CAPTURE', amount: usd(6_000), fee: usd(200) });
    expect(balance(entries, 'escrow', USD).toDecimal()).toBe('58.00');
    expect(balance(entries, 'fees', USD).toDecimal()).toBe('2.00');
    expect(balance(entries, 'hold', USD).toDecimal()).toBe('-60.00');
  });

  it('refuses amounts that make no sense', () => {
    for (const event of [
      { type: 'AUTHORIZE', amount: usd(0) },
      { type: 'REFUND', amount: usd(-5) },
      { type: 'CAPTURE', amount: usd(100), fee: usd(101) },
      { type: 'CAPTURE', amount: usd(100), fee: usd(-1) },
    ] as const) {
      expect(() => post(event)).toThrow(expect.objectContaining({ code: 'invalid' }));
    }
  });
});

describe('figures: the worked example', () => {
  // Authorize $100, capture $60 (fee $2), refund $10, pay a supplier $30.
  const events: LedgerEvent[] = [
    { type: 'AUTHORIZE', amount: usd(10_000) },
    { type: 'CAPTURE', amount: usd(6_000), fee: usd(200) },
    { type: 'REFUND', amount: usd(1_000) },
    { type: 'PAYOUT', amount: usd(3_000) },
  ];

  it('tracks held, captured, refunded, settled and what is left in escrow', () => {
    const result = figures(events, USD);
    expect(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.toDecimal()]))).toEqual({
      held: '40.00',
      captured: '60.00',
      fees: '2.00',
      refunded: '10.00',
      settled: '30.00',
      escrow: '18.00',
    });
  });

  it('refuses to take more than is there', () => {
    const base = events.slice(0, 2);
    for (const next of [
      { type: 'VOID', amount: usd(10_000) },
      { type: 'CAPTURE', amount: usd(4_001), fee: usd(0) },
      { type: 'REFUND', amount: usd(5_801) },
      { type: 'PAYOUT', amount: usd(5_801) },
    ] as const) {
      expect(() => figures([...base, next], USD)).toThrow(LedgerError);
    }
    expect(() => figures([...base, { type: 'PAYOUT', amount: usd(5_800) }], USD)).not.toThrow();
  });
});

describe('for any valid sequence of events', () => {
  const step = fc.record({
    op: fc.constantFrom('AUTHORIZE', 'VOID', 'CAPTURE', 'REFUND', 'PAYOUT'),
    amount: fc.integer({ min: 1, max: 50_000 }),
    fee: fc.integer({ min: 0, max: 100 }),
  });

  it('the ledger balances and its accounts reconcile with the envelope figures', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const accepted: LedgerEvent[] = [];
        for (const { op, amount, fee } of steps) {
          const event: LedgerEvent =
            op === 'CAPTURE'
              ? { type: op, amount: usd(amount), fee: usd(Math.min(fee, amount)) }
              : { type: op, amount: usd(amount) };
          try {
            figures([...accepted, event], USD);
            accepted.push(event);
          } catch (error) {
            expect(error).toBeInstanceOf(LedgerError); // an overdraw is refused, never half-applied
          }
        }
        const entries = accepted.flatMap(post);
        const result = figures(accepted, USD);
        expect(isBalanced(entries, USD)).toBe(true);
        expect(balance(entries, 'hold', USD).equals(result.held)).toBe(true);
        expect(balance(entries, 'escrow', USD).equals(result.escrow)).toBe(true);
        expect(balance(entries, 'fees', USD).equals(result.fees)).toBe(true);
        expect(balance(entries, 'supplier_paid', USD).equals(result.settled)).toBe(true);
        expect(result.escrow.isNegative()).toBe(false);
      }),
    );
  });
});
