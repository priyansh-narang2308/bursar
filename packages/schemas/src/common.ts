import { CURRENCY_CODES, type Money, moneyFromJSON } from '@bursar/money';
import { z } from 'zod';
import { rule } from './rule';

/** An instant in UTC, as RFC 3339 with a trailing Z: `2026-10-05T12:30:00Z` (fractions allowed). */
export const timestampSchema = z.iso
  .datetime()
  .max(35)
  .meta({ description: 'An instant in UTC, as RFC 3339 with a trailing Z.' });

/** Free text a person or an LLM wrote: bounded, and not just whitespace. */
export function textSchema(maxLength: number) {
  // `abort` so empty text gets one message, not both "too short" and "blank".
  return z.string().min(1, { abort: true }).max(maxLength).regex(/\S/, 'Must not be blank');
}

// ---------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------

export const currencyCodeSchema = z
  .enum(CURRENCY_CODES)
  .meta({ description: 'A currency PayPal accepts.' });

const SIGNED_MINOR = /^(?:0|-?[1-9][0-9]*)$/;
const UNSIGNED_MINOR = /^(?:0|[1-9][0-9]*)$/;

/**
 * The `Money` for a JSON amount, or undefined if `@bursar/money` rejects it (which also checks the
 * signed 64-bit range). Cross-field rules use this so a bad amount is reported once, by the field
 * that holds it, instead of making every rule that mentions it throw.
 */
export function tryMoney(value: unknown): Money | undefined {
  try {
    return moneyFromJSON(value);
  } catch {
    return undefined;
  }
}

function isValidMoney(value: unknown): boolean {
  return tryMoney(value) !== undefined;
}

function moneyShape(minor: RegExp) {
  return z.strictObject({
    currency: currencyCodeSchema,
    minor: z
      .string()
      .regex(minor, {
        error: 'Expected whole minor units as an integer string',
        abort: true,
      })
      .max(20)
      .meta({
        description:
          'Whole minor units (cents for USD) as a string, since JSON numbers cannot hold a bigint.',
      }),
  });
}

/** A signed amount of money, in the JSON form `Money#toJSON` writes. Read it with `moneyFromJSON`. */
export const moneySchema = moneyShape(SIGNED_MINOR)
  .refine(isValidMoney, rule('Not an amount that fits in a signed 64-bit integer'))
  .meta({
    id: 'Money',
    description: 'A signed amount of money in whole minor units.',
  });
export type MoneyJSON = z.infer<typeof moneySchema>;

/** An amount that cannot be negative: a price, a cap, a total. */
export const amountSchema = moneyShape(UNSIGNED_MINOR)
  .refine(isValidMoney, rule('Not an amount that fits in a signed 64-bit integer'))
  .meta({
    id: 'Amount',
    description: 'A non-negative amount of money in whole minor units.',
  });
export type AmountJSON = z.infer<typeof amountSchema>;

// ---------------------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------------------

export const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, {
    error: 'Expected 64 lower-case hex characters',
    abort: true,
  })
  .length(64) // for the JSON Schema bounds
  .meta({ description: 'A SHA-256 digest as 64 lower-case hex characters.' });

/** The digest of the canonical cart. An approval signs this, so any change to the cart voids it. */
export const cartHashSchema = sha256HexSchema.brand<'CartHash'>().meta({
  description: 'The SHA-256 of the canonical cart: what an approval signs.',
});
export type CartHash = z.infer<typeof cartHashSchema>;

/** The digest of the policy version that decided. An approval binds to it as well. */
export const policyHashSchema = sha256HexSchema.brand<'PolicyHash'>().meta({
  description: 'The SHA-256 of the policy version a decision was made under.',
});
export type PolicyHash = z.infer<typeof policyHashSchema>;

/** The digest of what was evaluated, so a stored decision can be replayed and compared. */
export const inputsHashSchema = sha256HexSchema.brand<'InputsHash'>().meta({
  description: 'The SHA-256 of the inputs a decision was evaluated on.',
});
export type InputsHash = z.infer<typeof inputsHashSchema>;

/** Derived from the action's identity, so a retry of the same action can never be a second one. */
export const idempotencyKeySchema = sha256HexSchema.brand<'IdempotencyKey'>().meta({
  description: 'The idempotency key of an action: a SHA-256, unique per action.',
});
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

// ---------------------------------------------------------------------------------------
// Free-form JSON (rule traces and incident evidence)
// ---------------------------------------------------------------------------------------

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Written out rather than `z.json()` so its recursion exports under its own name, `JsonValue`. */
export const jsonValueSchema: z.ZodType<JsonValue> = z
  .lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string().max(100), jsonValueSchema),
    ]),
  )
  .meta({ id: 'JsonValue', description: 'Any JSON value.' });

export const jsonObjectSchema = z
  .record(z.string().max(100), jsonValueSchema)
  .meta({ description: 'A JSON object.' });
export type JsonObject = z.infer<typeof jsonObjectSchema>;

// ---------------------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------------------

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/** Query parameters for a list endpoint. They arrive as text, so `limit` is coerced. */
export const pageQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** A page of results. `nextCursor` is null on the last page. */
export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.strictObject({
    items: z.array(item).max(MAX_PAGE_SIZE),
    nextCursor: z.string().min(1).max(200).nullable(),
  });
}
