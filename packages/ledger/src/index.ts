import { type CurrencyCode, Money } from '@bursar/money';

/** The chart of accounts. Each account's balance is its debits minus its credits. */
export const ACCOUNTS = ['payer_funds', 'hold', 'escrow', 'fees', 'supplier_paid'] as const;
export type Account = (typeof ACCOUNTS)[number];

export interface Entry {
  readonly account: Account;
  readonly side: 'DEBIT' | 'CREDIT';
  readonly amount: Money;
}

/** What happened at PayPal, as far as the ledger is concerned. Amounts are positive. */
export type LedgerEvent =
  | { readonly type: 'AUTHORIZE' | 'VOID' | 'REFUND' | 'PAYOUT'; readonly amount: Money }
  | { readonly type: 'CAPTURE'; readonly amount: Money; readonly fee: Money };

export class LedgerError extends Error {
  readonly code: 'invalid' | 'overdrawn';

  constructor(code: 'invalid' | 'overdrawn', message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

const debit = (account: Account, amount: Money): Entry => ({ account, side: 'DEBIT', amount });
const credit = (account: Account, amount: Money): Entry => ({ account, side: 'CREDIT', amount });

/**
 * The entries for an event. They always balance, because each is written as a pair or a split:
 * authorize holds funds; void releases the hold; capture releases it and moves the money into escrow
 * less PayPal's fee; refund and payout take money out of escrow.
 */
export function post(event: LedgerEvent): Entry[] {
  const { amount } = event;
  if (!amount.isPositive()) {
    throw new LedgerError('invalid', 'An amount must be positive.');
  }
  switch (event.type) {
    case 'AUTHORIZE':
      return [debit('hold', amount), credit('payer_funds', amount)];
    case 'VOID':
      return [debit('payer_funds', amount), credit('hold', amount)];
    case 'REFUND':
      return [debit('payer_funds', amount), credit('escrow', amount)];
    case 'PAYOUT':
      return [debit('supplier_paid', amount), credit('escrow', amount)];
    case 'CAPTURE': {
      if (event.fee.isNegative() || event.fee.greaterThan(amount)) {
        throw new LedgerError('invalid', 'A fee is between zero and the amount captured.');
      }
      return [
        debit('payer_funds', amount),
        credit('hold', amount),
        debit('escrow', amount.subtract(event.fee)),
        ...(event.fee.isZero() ? [] : [debit('fees', event.fee)]),
        credit('payer_funds', amount),
      ];
    }
  }
}

/** Whether total debits equal total credits. */
export function isBalanced(entries: readonly Entry[], currency: CurrencyCode): boolean {
  const total = (side: Entry['side']) =>
    Money.sum(
      entries.filter((entry) => entry.side === side).map((entry) => entry.amount),
      currency,
    );
  return total('DEBIT').equals(total('CREDIT'));
}

/** An account's balance: debits minus credits. */
export function balance(
  entries: readonly Entry[],
  account: Account,
  currency: CurrencyCode,
): Money {
  return entries
    .filter((entry) => entry.account === account)
    .reduce(
      (sum, entry) => (entry.side === 'DEBIT' ? sum.add(entry.amount) : sum.subtract(entry.amount)),
      Money.zero(currency),
    );
}

/** An envelope's figures: what is held at PayPal, and how much has been captured, refunded and paid out. */
export interface Figures {
  readonly held: Money;
  readonly captured: Money;
  readonly fees: Money;
  readonly refunded: Money;
  readonly settled: Money;
  /** Captured, less fees, refunds and payouts: what is still in escrow. */
  readonly escrow: Money;
}

function overdraw(what: string): never {
  throw new LedgerError('overdrawn', `${what} exceeds what is available.`);
}

/** Replays events into figures, refusing any that would take more than is held or in escrow. */
export function figures(events: Iterable<LedgerEvent>, currency: CurrencyCode): Figures {
  let [held, captured, fees, refunded, settled] = Array.from({ length: 5 }, () =>
    Money.zero(currency),
  ) as [Money, Money, Money, Money, Money];
  for (const event of events) {
    const { amount } = event;
    const escrow = captured.subtract(fees).subtract(refunded).subtract(settled);
    switch (event.type) {
      case 'AUTHORIZE':
        held = held.add(amount);
        break;
      case 'VOID':
        held = amount.greaterThan(held) ? overdraw('A void') : held.subtract(amount);
        break;
      case 'CAPTURE':
        held = amount.greaterThan(held) ? overdraw('A capture') : held.subtract(amount);
        captured = captured.add(amount);
        fees = fees.add(event.fee);
        break;
      case 'REFUND':
        refunded = amount.greaterThan(escrow) ? overdraw('A refund') : refunded.add(amount);
        break;
      case 'PAYOUT':
        settled = amount.greaterThan(escrow) ? overdraw('A payout') : settled.add(amount);
        break;
    }
  }
  return {
    held,
    captured,
    fees,
    refunded,
    settled,
    escrow: captured.subtract(fees).subtract(refunded).subtract(settled),
  };
}
