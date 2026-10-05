import { payPalRequestId, sha256Hex } from '@bursar/crypto';
import { type CurrencyCode, Money } from '@bursar/money';
import { type AmountJSON, idempotencyKeySchema } from '@bursar/schemas';

export const money = (minor: bigint, currency: string): Money =>
  Money.of(minor, currency as CurrencyCode);
export const amountJson = (minor: bigint, currency: string): AmountJSON =>
  money(minor, currency).toJSON();

/** A stable `PayPal-Request-Id` for something that has an id but no idempotency key of its own. */
export const requestIdFor = (seed: string, step: string): string =>
  payPalRequestId(idempotencyKeySchema.parse(sha256Hex(seed)), step);
