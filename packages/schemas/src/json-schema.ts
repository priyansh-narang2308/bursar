import { z } from 'zod';
import {
  approveActionRequestSchema,
  createMissionRequestSchema,
  decisionPageSchema,
  listDecisionsQuerySchema,
  mandateActionRequestSchema,
  proposalResultSchema,
  rejectActionRequestSchema,
} from './api';
import { amountSchema, moneySchema } from './common';
import { auditEventSchema } from './entities/audit';
import { cartLineSchema, cartSchema, offerSchema } from './entities/commerce';
import {
  actionSchema,
  approvalSchema,
  decisionSchema,
  ruleResultSchema,
} from './entities/decision';
import { envelopeSchema, mandateSchema } from './entities/funding';
import { missionSchema } from './entities/mission';
import { incidentSchema, paypalEventSchema } from './entities/verification';
import { problemDetailsSchema } from './errors';
import { sseEventSchema } from './events';
import { LLM_TOOL_NAMES, LLM_TOOLS } from './tools';

/** A JSON Schema document. */
export type JsonSchema = { [keyword: string]: unknown };

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** UTC with a trailing Z and no offset: what `timestampSchema` accepts, in a form a regex can say. */
const UTC_TIMESTAMP_PATTERN =
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$';

/**
 * JSON Schema's `format`s are looser than Zod's: `date-time` accepts a UTC offset, and `uri` accepts
 * any scheme, including `javascript:`. Both formats are kept, for tools that understand them, and
 * pinned with a pattern so a document that passes the JSON Schema also passes Zod. (This also
 * replaces the long, leap-year-aware date regex Zod writes, which only adds noise.)
 */
function pinFormats({ jsonSchema }: { readonly jsonSchema: { format?: string } }): void {
  if (jsonSchema.format === 'date-time') {
    Object.assign(jsonSchema, { pattern: UTC_TIMESTAMP_PATTERN });
  } else if (jsonSchema.format === 'uri') {
    Object.assign(jsonSchema, { pattern: '^https?://' });
  }
}

const DEFS = '#/$defs/';

/**
 * A schema with an `id` is written as `{ $ref: "#/$defs/Name", $defs: { Name: … } }`. For a
 * standalone document that indirection is noise, so the named definition becomes the document.
 */
export function hoistRootDefinition(schema: JsonSchema): JsonSchema {
  const { $ref: ref, $defs: defs, ...rest } = schema;
  if (typeof ref !== 'string' || !ref.startsWith(DEFS) || !isRecord(defs)) {
    return schema;
  }
  const { [ref.slice(DEFS.length)]: root, ...others } = defs;
  if (!isRecord(root)) {
    return schema;
  }
  return { ...rest, ...root, ...(Object.keys(others).length > 0 ? { $defs: others } : {}) };
}

/**
 * The JSON Schema (2020-12) for a Zod schema. `input` describes what a request may contain, so a
 * field with a default is optional; `output` describes what a response contains, so it is required.
 * Rules that span several fields (`refine`) cannot be expressed in JSON Schema and are runtime-only.
 */
export function toJsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'output'): JsonSchema {
  const generated: JsonSchema = {
    ...z.toJSONSchema(schema, { target: 'draft-2020-12', io, override: pinFormats }),
  };
  return hoistRootDefinition(generated);
}

interface CatalogEntry {
  readonly schema: z.ZodType;
  readonly io: 'input' | 'output';
}

const out = (schema: z.ZodType): CatalogEntry => ({ schema, io: 'output' });
const inn = (schema: z.ZodType): CatalogEntry => ({ schema, io: 'input' });

/** Every schema Bursar publishes, by name. The name is also the file name of its snapshot. */
export const SCHEMA_CATALOG: Readonly<Record<string, CatalogEntry>> = {
  'common/money': out(moneySchema),
  'common/amount': out(amountSchema),

  'entities/mandate': out(mandateSchema),
  'entities/envelope': out(envelopeSchema),
  'entities/mission': out(missionSchema),
  'entities/offer': out(offerSchema),
  'entities/cart-line': out(cartLineSchema),
  'entities/cart': out(cartSchema),
  'entities/action': out(actionSchema),
  'entities/rule-result': out(ruleResultSchema),
  'entities/decision': out(decisionSchema),
  'entities/approval': out(approvalSchema),
  'entities/incident': out(incidentSchema),
  'entities/paypal-event': out(paypalEventSchema),
  'entities/audit-event': out(auditEventSchema),

  'api/create-mission-request': inn(createMissionRequestSchema),
  'api/proposal-result': out(proposalResultSchema),
  'api/approve-action-request': inn(approveActionRequestSchema),
  'api/reject-action-request': inn(rejectActionRequestSchema),
  'api/mandate-action-request': inn(mandateActionRequestSchema),
  'api/list-decisions-query': inn(listDecisionsQuerySchema),
  'api/decision-page': out(decisionPageSchema),

  'events/sse-event': out(sseEventSchema),
  'errors/problem-details': out(problemDetailsSchema),

  ...Object.fromEntries(
    LLM_TOOL_NAMES.map((name) => [`tools/${name}`, inn(LLM_TOOLS[name].input)]),
  ),
};

/** The JSON Schema of everything in the catalog, keyed by name, in alphabetical order. */
export function exportJsonSchemas(): Readonly<Record<string, JsonSchema>> {
  return Object.fromEntries(
    Object.entries(SCHEMA_CATALOG)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, { schema, io }]) => [name, toJsonSchema(schema, io)]),
  );
}
