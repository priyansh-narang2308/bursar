import { z } from 'zod';
import { textSchema, timestampSchema } from './common';
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from './entities/commerce';
import { idSchemas } from './ids';

/*
 * What an LLM agent can call. These are the only tools the model is ever shown, and they are
 * deliberately incapable of moving money:
 *
 *  - No input is an amount, a price, a currency or a payee. The model names an offer and a
 *    quantity; the server looks up the price, the currency and the payee from verified records.
 *  - Nothing here pays. The strongest tools only *propose*, and a policy engine and, where it asks,
 *    a person decide what happens next.
 *  - Every input is bounded: strings have a maximum length, numbers a range, arrays a maximum size,
 *    and objects refuse unknown keys.
 *
 * `guards.ts` turns those rules into a test that fails if a tool ever breaks them.
 */

export const MAX_RATIONALE_LENGTH = 500;
export const MAX_QUERY_LENGTH = 200;
export const MAX_SEARCH_RESULTS = 10;

export const SWAP_REASONS = [
  'OUT_OF_STOCK',
  'PRICE_INCREASE',
  'DELIVERY_DELAY',
  'QUALITY_ISSUE',
  'OTHER',
] as const;
export const swapReasonSchema = z.enum(SWAP_REASONS);
export type SwapReason = z.infer<typeof swapReasonSchema>;

export const RESCHEDULE_REASONS = [
  'SUPPLIER_DELAY',
  'DEADLINE_CHANGE',
  'DEPENDENCY_CHANGE',
  'OTHER',
] as const;
export const rescheduleReasonSchema = z.enum(RESCHEDULE_REASONS);
export type RescheduleReason = z.infer<typeof rescheduleReasonSchema>;

const missionId = idSchemas.mission.meta({
  description: 'The mission this is about.',
});
const needId = idSchemas.need.meta({
  description: 'The need this is about, such as "10 desks".',
});
const offerId = idSchemas.offer.meta({
  description: 'An offer id taken from a search, a shortlist or a comparison.',
});

// ---------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------

export const getOrgContextInputSchema = z.strictObject({});

export const getPolicySummaryInputSchema = z.strictObject({});

export const getMissionInputSchema = z.strictObject({ missionId });

export const searchOffersInputSchema = z.strictObject({
  needId,
  query: textSchema(MAX_QUERY_LENGTH).meta({
    description: 'What to search for, in plain words.',
  }),
  maxResults: z
    .int()
    .min(1)
    .max(MAX_SEARCH_RESULTS)
    .meta({ description: 'How many offers to return at most.' }),
});

export const getOfferInputSchema = z.strictObject({ offerId });

export const getShortlistInputSchema = z.strictObject({ needId });

export const compareOffersInputSchema = z.strictObject({
  needId,
  offerIds: z.array(offerId).min(2).max(5),
});

export const proposeCartInputSchema = z.strictObject({
  missionId,
  lines: z
    .array(
      z.strictObject({
        offerId,
        quantity: z
          .int()
          .min(1)
          .max(MAX_LINE_QUANTITY)
          .meta({ description: 'How many to buy, as a whole number.' }),
      }),
    )
    .min(1)
    .max(MAX_CART_LINES),
  rationale: textSchema(MAX_RATIONALE_LENGTH).meta({
    description: 'Why this selection meets the need. A person may read it when approving.',
  }),
});
export type ProposeCartInput = z.infer<typeof proposeCartInputSchema>;

export const requestSwapInputSchema = z.strictObject({
  missionId,
  lineId: idSchemas.cartLine.meta({ description: 'The cart line to replace.' }),
  replacementOfferId: offerId,
  reason: swapReasonSchema,
});

export const rescheduleTaskInputSchema = z.strictObject({
  missionId,
  taskId: idSchemas.task.meta({ description: 'The plan task to move.' }),
  newStart: timestampSchema.meta({
    description: 'The proposed new start, in UTC.',
  }),
  reason: rescheduleReasonSchema,
});

// ---------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------

export interface ToolContract {
  /** What the model is told the tool does. */
  readonly description: string;
  /**
   * `read` tools only look. `propose` tools ask for something that policy, and where it asks a
   * person, then judge. There is deliberately no effect that moves money.
   */
  readonly effect: 'read' | 'propose';
  readonly input: z.ZodObject;
}

export const LLM_TOOLS = {
  get_org_context: {
    description: "Read the organisation's name and which missions are open. Takes no input.",
    effect: 'read',
    input: getOrgContextInputSchema,
  },
  get_policy_summary: {
    description: 'Read a plain-language summary of the spending rules that apply. Takes no input.',
    effect: 'read',
    input: getPolicySummaryInputSchema,
  },
  get_mission: {
    description: 'Read a mission: its goal, deadline, status and the needs it has.',
    effect: 'read',
    input: getMissionInputSchema,
  },
  search_offers: {
    description:
      'Search the product catalog for one need. You choose the words to search for; the system decides which suppliers and price ranges are allowed.',
    effect: 'read',
    input: searchOffersInputSchema,
  },
  get_offer: {
    description: 'Read the current details of one offer, re-quoted live.',
    effect: 'read',
    input: getOfferInputSchema,
  },
  get_shortlist: {
    description: 'Read the offers already shortlisted for a need.',
    effect: 'read',
    input: getShortlistInputSchema,
  },
  compare_offers: {
    description: 'Compare two to five offers for the same need side by side.',
    effect: 'read',
    input: compareOffersInputSchema,
  },
  propose_cart: {
    description:
      'Propose which offers to buy and how many of each. Never state prices, totals, currencies or payees: the system looks them up, checks the proposal against policy and asks a person to approve it where required.',
    effect: 'propose',
    input: proposeCartInputSchema,
  },
  request_swap: {
    description:
      'Propose replacing one cart line with a different offer, and say why. This is a proposal that policy and a person judge, not a purchase.',
    effect: 'propose',
    input: requestSwapInputSchema,
  },
  reschedule_task: {
    description:
      'Propose a new start for a plan task, and say why. This is a proposal only; the system checks it against the schedule constraints.',
    effect: 'propose',
    input: rescheduleTaskInputSchema,
  },
} as const satisfies Readonly<Record<string, ToolContract>>;

export type LlmToolName = keyof typeof LLM_TOOLS;

export const LLM_TOOL_NAMES: readonly LlmToolName[] = Object.keys(LLM_TOOLS).filter(isToolName);

function isToolName(value: string): value is LlmToolName {
  return Object.hasOwn(LLM_TOOLS, value);
}
