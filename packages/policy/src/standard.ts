import type { RuleId } from '@bursar/schemas';
import type { Policy } from './engine';
import type { RuleDefinition } from './kit';
import * as r from './rules';

/** Every rule in the catalog, by id. */
export const RULES: Readonly<Record<RuleId, RuleDefinition>> = {
  'R-MANDATE': r.mandate,
  'R-ENVELOPE': r.envelope,
  'R-ITEM-CAP': r.itemCap,
  'R-ORDER-CAP': r.orderCap,
  'R-CATEGORY': r.category,
  'R-VENDOR': r.vendor,
  'R-NEW-VENDOR': r.newVendor,
  'R-QTY': r.quantity,
  'R-PRICE-DRIFT': r.priceDrift,
  'R-DUPLICATE': r.duplicate,
  'R-VELOCITY': r.velocity,
  'R-DELIVERY': r.delivery,
  'R-DUAL': r.dual,
  'R-REFUND-AUTH': r.refundAuth,
  'R-PAYOUT-GATE': r.payoutGate,
  'R-PROVENANCE': r.provenance,
  'R-TENANT': r.tenant,
};

const usd = (dollars: number) => ({ currency: 'USD', minor: String(dollars * 100) });

/** Sensible starting parameters, in US dollars. An organisation overrides what it needs to. */
export const DEFAULT_PARAMS: Readonly<Record<RuleId, unknown>> = {
  'R-MANDATE': {},
  'R-ENVELOPE': {},
  'R-ITEM-CAP': { max: usd(500) },
  'R-ORDER-CAP': { max: usd(2_000) },
  'R-CATEGORY': { caps: [] },
  'R-VENDOR': {},
  'R-NEW-VENDOR': {},
  'R-QTY': {},
  'R-PRICE-DRIFT': {},
  'R-DUPLICATE': {},
  'R-VELOCITY': { max: usd(3_000) },
  'R-DELIVERY': {},
  'R-DUAL': { above: usd(1_000) },
  'R-REFUND-AUTH': { agentMax: usd(50) },
  'R-PAYOUT-GATE': {},
  'R-PROVENANCE': {},
  'R-TENANT': {},
};

/** The order rules run in: the cheap and absolute ones first. The trace follows this order. */
const ORDER: readonly RuleId[] = [
  'R-TENANT',
  'R-PROVENANCE',
  'R-MANDATE',
  'R-ENVELOPE',
  'R-VENDOR',
  'R-NEW-VENDOR',
  'R-ITEM-CAP',
  'R-ORDER-CAP',
  'R-CATEGORY',
  'R-QTY',
  'R-PRICE-DRIFT',
  'R-DUPLICATE',
  'R-VELOCITY',
  'R-DELIVERY',
  'R-DUAL',
  'R-REFUND-AUTH',
  'R-PAYOUT-GATE',
];

/** The full catalog as one policy, with the defaults and any overrides by rule id. */
export function standardPolicy(overrides: Partial<Record<RuleId, unknown>> = {}): Policy {
  return { rules: ORDER.map((id) => RULES[id].use(overrides[id] ?? DEFAULT_PARAMS[id])) };
}
