import { type CurrencyCode, type Money, moneyFromJSON } from '@bursar/money';
import {
  type AmountJSON,
  type JsonObject,
  type JsonValue,
  jsonValueSchema,
  type RuleId,
} from '@bursar/schemas';
import type { z } from 'zod';
import { type Context, contextSchema } from './context';
import type { PolicyRule, Rule, Verdict } from './engine';

export interface RuleDefinition<S extends z.ZodType = z.ZodType> {
  readonly id: RuleId;
  readonly version: number;
  /** One line for the catalog. */
  readonly summary: string;
  /** The parameters a policy sets for this rule. */
  readonly params: S;
  readonly rule: Rule<never>;
  /** This rule with parameters, checked now so a bad policy fails when it is written, not when used. */
  use(params: z.input<S>): PolicyRule;
}

/**
 * Defines a rule. The context and parameters are parsed before `check` runs, so a context with a
 * missing or malformed field throws, and the engine turns that into a denial.
 */
export function defineRule<S extends z.ZodType>(definition: {
  readonly id: RuleId;
  readonly version: number;
  readonly summary: string;
  readonly params: S;
  check(context: Context, params: z.output<S>): Verdict;
}): RuleDefinition<S> {
  const rule: Rule<JsonValue> = {
    id: definition.id,
    version: definition.version,
    evaluate: (raw: JsonObject, params: JsonValue) =>
      definition.check(contextSchema.parse(raw), definition.params.parse(params)),
  };
  return {
    id: definition.id,
    version: definition.version,
    summary: definition.summary,
    params: definition.params,
    rule,
    use: (params) => ({ rule, params: jsonValueSchema.parse(definition.params.parse(params)) }),
  };
}

// ---------------------------------------------------------------------------------------
// Helpers the rules share
// ---------------------------------------------------------------------------------------

export const allow = (
  message: string,
  inputs: JsonObject = {},
  threshold?: JsonValue,
): Verdict => ({
  outcome: 'ALLOW',
  message,
  inputs,
  ...(threshold === undefined ? {} : { threshold }),
});

export const deny = (message: string, inputs: JsonObject = {}, threshold?: JsonValue): Verdict => ({
  outcome: 'DENY',
  message,
  inputs,
  ...(threshold === undefined ? {} : { threshold }),
});

/** Money moves for these. FREEZE, REVOKE, VOID and REFUND only protect or undo, so spend rules skip them. */
export const SPENDS: ReadonlySet<string> = new Set([
  'AUTHORIZE',
  'REAUTHORIZE',
  'CAPTURE',
  'PAYOUT',
]);
export const isSpend = (context: Context): boolean => SPENDS.has(context.action.type);

export const notApplicable = (): Verdict => allow('This rule does not apply to this action.');

export const money = (amount: AmountJSON): Money => moneyFromJSON(amount);
export const show = (amount: Money): string => `${amount.toDecimal()} ${amount.currency}`;

/** The currency all of these share, or undefined if they do not (and so cannot be compared). */
export function commonCurrency(...amounts: readonly AmountJSON[]): CurrencyCode | undefined {
  const [first] = amounts;
  return first !== undefined && amounts.every((a) => a.currency === first.currency)
    ? first.currency
    : undefined;
}

export const currencyMismatch = (): Verdict => deny('The amounts are in different currencies.');

/** People who validly approved, other than the one who proposed: a maker is never their own checker. */
export function validApprovers(context: Context): Set<string> {
  const now = Date.parse(context.now);
  return new Set(
    context.approvals
      .filter(
        (a) =>
          a.status === 'APPROVED' &&
          a.signatureValid &&
          a.cartHashMatches &&
          a.policyHashMatches &&
          Date.parse(a.expiresAt) > now &&
          a.approverId !== context.action.proposerId,
      )
      .map((a) => a.approverId),
  );
}

/** Asks for `needed` approvers, and allows once that many have validly approved. */
export function ask(
  context: Context,
  message: string,
  needed = 1,
  inputs: JsonObject = {},
  threshold?: JsonValue,
): Verdict {
  const have = validApprovers(context).size;
  if (have >= needed) {
    return allow(`${message} Approved by ${have}.`, inputs, threshold);
  }
  return {
    outcome: 'REQUIRE_APPROVAL',
    message,
    inputs,
    approvals: needed,
    ...(threshold === undefined ? {} : { threshold }),
  };
}
