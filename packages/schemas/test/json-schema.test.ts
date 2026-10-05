import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  exportJsonSchemas,
  hoistRootDefinition,
  JSON_SCHEMA_DIALECT,
  type JsonSchema,
  LLM_TOOL_NAMES,
  missionSchema,
  moneySchema,
  problem,
  SCHEMA_CATALOG,
  toJsonSchema,
} from '../src';
import { disagreements, mutantsOf } from './differential';
import {
  action,
  approval,
  approveActionRequest,
  cart,
  cartLine,
  createMissionRequest,
  decision,
  envelope,
  incident,
  mandate,
  mandateActionRequest,
  mission,
  offer,
  paypalEvent,
  proposalResult,
  rejectActionRequest,
  ruleResult,
  sseExamples,
  toolExamples,
  usd,
} from './fixtures';

const schemas = exportJsonSchemas();

/** A document of each published schema that is valid, and so must pass both Zod and the JSON Schema. */
const EXAMPLES: Record<string, unknown> = {
  'common/money': usd('-1550'),
  'common/amount': usd('1550'),
  'entities/mandate': mandate(),
  'entities/envelope': envelope(),
  'entities/mission': mission(),
  'entities/offer': offer(),
  'entities/cart-line': cartLine(),
  'entities/cart': cart(),
  'entities/action': action(),
  'entities/rule-result': ruleResult(),
  'entities/decision': decision(),
  'entities/approval': approval(),
  'entities/incident': incident(),
  'entities/paypal-event': paypalEvent(),
  'api/create-mission-request': createMissionRequest(),
  'api/proposal-result': proposalResult(),
  'api/approve-action-request': approveActionRequest(),
  'api/reject-action-request': rejectActionRequest(),
  'api/mandate-action-request': mandateActionRequest(),
  'api/list-decisions-query': { limit: 10 },
  'api/decision-page': { items: [decision()], nextCursor: null },
  'events/sse-event': sseExamples['mission.updated'],
  'errors/problem-details': problem('POLICY_DENIED'),
  ...Object.fromEntries(LLM_TOOL_NAMES.map((name) => [`tools/${name}`, toolExamples[name]])),
};

function newAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  return ajv;
}

function walk(node: unknown, visit: (node: JsonSchema) => void): void {
  if (Array.isArray(node)) {
    for (const entry of node) {
      walk(entry, visit);
    }
  } else if (typeof node === 'object' && node !== null) {
    visit(node as JsonSchema);
    for (const value of Object.values(node)) {
      walk(value, visit);
    }
  }
}

describe('toJsonSchema', () => {
  it('writes draft 2020-12, with a named schema as the document itself', () => {
    const schema = toJsonSchema(missionSchema);

    expect(schema['$schema']).toBe(JSON_SCHEMA_DIALECT);
    expect(schema['type']).toBe('object');
    expect(schema['$ref']).toBeUndefined();
    expect(schema['description']).toBe('A goal to achieve with a budget and a deadline.');
    expect(Object.keys(schema['$defs'] as object)).toEqual(['Amount']);
  });

  it('keeps a named schema that nothing else refers to free of a $defs block', () => {
    expect(toJsonSchema(moneySchema)['$defs']).toBeUndefined();
  });

  it('pins a timestamp to UTC with a Z and a web link to http or https, as Zod does', () => {
    const properties = toJsonSchema(missionSchema)['properties'] as Record<string, JsonSchema>;

    expect(properties['createdAt']).toEqual({
      type: 'string',
      format: 'date-time',
      pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$',
      maxLength: 35,
      description: 'An instant in UTC, as RFC 3339 with a trailing Z.',
    });

    const offerProperties = (schemas['entities/offer'] as JsonSchema)['properties'] as Record<
      string,
      JsonSchema
    >;
    expect(offerProperties['url']).toMatchObject({ format: 'uri', pattern: '^https?://' });
  });

  it('describes a request by what may be sent (defaults optional) and a response by what comes back', () => {
    const query = z.strictObject({ limit: z.int().min(1).max(10).default(5) });

    expect(toJsonSchema(query, 'input')['required']).toBeUndefined();
    expect(toJsonSchema(query, 'output')['required']).toEqual(['limit']);
  });

  it('refuses a schema JSON Schema cannot express, rather than writing a wrong one', () => {
    expect(() => toJsonSchema(z.string().transform((text) => text.length))).toThrow();
  });
});

describe('hoistRootDefinition', () => {
  it('leaves alone anything that is not a named root', () => {
    const plain: JsonSchema = { type: 'object' };
    const elsewhere: JsonSchema = { $ref: 'https://example.com/schema', $defs: { X: {} } };
    const noDefs: JsonSchema = { $ref: '#/$defs/X' };
    const missing: JsonSchema = { $ref: '#/$defs/X', $defs: { Y: { type: 'string' } } };
    const notASchema: JsonSchema = { $ref: '#/$defs/X', $defs: { X: 'nonsense' } };

    for (const schema of [plain, elsewhere, noDefs, missing, notASchema]) {
      expect(hoistRootDefinition(schema)).toBe(schema);
    }
  });

  it('makes the named definition the document, and keeps the other definitions', () => {
    expect(
      hoistRootDefinition({
        $schema: 'dialect',
        $ref: '#/$defs/Thing',
        $defs: { Thing: { type: 'object', title: 'Thing' }, Other: { type: 'string' } },
      }),
    ).toEqual({
      $schema: 'dialect',
      type: 'object',
      title: 'Thing',
      $defs: { Other: { type: 'string' } },
    });
  });
});

describe('exportJsonSchemas', () => {
  it('publishes every schema in the catalog, in alphabetical order', () => {
    const names = Object.keys(schemas);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names.sort()).toEqual(Object.keys(SCHEMA_CATALOG).sort());
    expect(names).toHaveLength(23 + LLM_TOOL_NAMES.length);
  });

  it('has an example for every published schema', () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(Object.keys(SCHEMA_CATALOG).sort());
  });

  it('is the same every time, and plain JSON', () => {
    const first = JSON.stringify(exportJsonSchemas());

    expect(JSON.stringify(exportJsonSchemas())).toBe(first);
    expect(JSON.parse(first)).toEqual(schemas);
  });

  it('names every document by dialect, and leaves no generated names or leap-year regexes behind', () => {
    for (const schema of Object.values(schemas)) {
      expect(schema['$schema']).toBe(JSON_SCHEMA_DIALECT);
    }
    const text = JSON.stringify(schemas);

    expect(text).not.toContain('__schema');
    expect(text).not.toContain('[2468][048]');
  });

  it('only refers to definitions that exist', () => {
    for (const [name, schema] of Object.entries(schemas)) {
      const defs = Object.keys((schema['$defs'] as object | undefined) ?? {});
      walk(schema, (node) => {
        if (typeof node['$ref'] === 'string') {
          expect(defs, `${name} refers to ${node['$ref']}`).toContain(
            node['$ref'].replace('#/$defs/', ''),
          );
        }
      });
    }
  });

  it('closes every object, so nothing unlisted is ever accepted', () => {
    for (const [name, schema] of Object.entries(schemas)) {
      walk(schema, (node) => {
        if (node['properties'] !== undefined) {
          expect(node['additionalProperties'], `${name} has an open object`).toBe(false);
        }
      });
    }
  });

  it('can be compiled by a real JSON Schema validator, every one of them', () => {
    const ajv = newAjv();

    for (const [name, schema] of Object.entries(schemas)) {
      expect(() => ajv.compile(schema), name).not.toThrow();
    }
  });
});

describe('where JSON Schema formats are looser than Zod, the published schema is pinned to Zod', () => {
  const validator = (name: string) => newAjv().compile(schemas[name] as JsonSchema);

  it('refuses a timestamp with a UTC offset, which RFC 3339 allows but Zod does not', () => {
    const validate = validator('entities/mission');

    expect(validate(mission())).toBe(true);
    expect(validate(mission({ createdAt: '2026-10-05T10:00:00+02:00' }))).toBe(false);
    expect(validate(mission({ createdAt: '2026-10-05t10:00:00z' }))).toBe(false);
    expect(validate(mission({ createdAt: '2026-10-05T10:00:00.250Z' }))).toBe(true);
  });

  it('refuses a link that is not http or https, which `format: uri` alone would accept', () => {
    const validate = validator('entities/offer');

    expect(validate(offer())).toBe(true);
    for (const url of [
      'javascript:alert(1)',
      'ftp://files.example.com/desk',
      'data:text/plain,hi',
    ]) {
      expect(validate(offer({ url })), url).toBe(false);
    }
  });
});

describe('the published JSON Schemas agree with the Zod schemas they come from', () => {
  const subjects = Object.entries(SCHEMA_CATALOG)
    // A query string arrives as text and is coerced by Zod; JSON Schema describes the parsed value.
    .filter(([name]) => name !== 'api/list-decisions-query');

  it.each(subjects)(
    '%s: accepts its example, and is neither looser nor stricter than Zod where JSON Schema can say so',
    (name, { schema, io }) => {
      const validate = newAjv().compile(toJsonSchema(schema, io));
      const example = EXAMPLES[name];
      const mutants = mutantsOf(example);

      expect(schema.safeParse(example).success, `${name}: Zod rejects its own example`).toBe(true);
      expect(validate(example), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(mutants.length).toBeGreaterThan(0);
      expect(disagreements(schema, validate, mutants)).toEqual([]);
    },
  );
});

describe('the committed JSON Schema files', () => {
  it.each(Object.entries(schemas))('%s is exactly what the code produces', async (name, schema) => {
    await expect(`${JSON.stringify(schema, null, 2)}\n`).toMatchFileSnapshot(
      `../json-schema/${name}.json`,
    );
  });
});
