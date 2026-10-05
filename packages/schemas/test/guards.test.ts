import { CURRENCY_CODES } from '@bursar/money';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  FORBIDDEN_FIELD_WORDS,
  forbiddenWordsIn,
  inspectToolSchema,
  inspectTools,
  type JsonSchema,
  LLM_TOOL_FIELDS,
  LLM_TOOLS,
  splitWords,
  type ToolContract,
  toJsonSchema,
} from '../src';

const MONEY_FIELD_RULES = ['forbidden-field', 'unlisted-field'];

/** A tiny tool schema with the given properties, valid in every respect except the ones a test breaks. */
function objectWith(properties: JsonSchema, extra: JsonSchema = {}): JsonSchema {
  return { type: 'object', properties, additionalProperties: false, ...extra };
}

const id = { type: 'string', minLength: 30, maxLength: 30 };

describe('the guard on what an LLM is shown', () => {
  it('finds nothing wrong with any real tool', () => {
    expect(inspectTools()).toEqual([]);
  });

  it('allows exactly the property names the tools use, no more and no fewer', () => {
    const used = new Set(
      Object.values(LLM_TOOLS).flatMap((tool) => {
        const schema = toJsonSchema(tool.input, 'input');
        const collect = (node: unknown): string[] => {
          if (typeof node !== 'object' || node === null) {
            return [];
          }
          return Object.entries(node).flatMap(([key, value]) => [
            ...(key === 'properties' && typeof value === 'object' && value !== null
              ? Object.keys(value)
              : []),
            ...collect(value),
          ]);
        };
        return collect(schema);
      }),
    );

    expect([...used].sort()).toEqual([...LLM_TOOL_FIELDS].sort());
  });

  it('keeps every allowed name free of words that mean money', () => {
    for (const name of LLM_TOOL_FIELDS) {
      expect(forbiddenWordsIn(name)).toEqual([]);
    }
  });

  it('refuses every currency code PayPal supports, as a word in a name', () => {
    for (const code of CURRENCY_CODES) {
      expect(FORBIDDEN_FIELD_WORDS.has(code.toLowerCase())).toBe(true);
      expect(forbiddenWordsIn(`unit${code}`)).toEqual([code.toLowerCase()]);
    }
  });
});

describe('splitWords and forbiddenWordsIn', () => {
  it.each([
    ['offerId', ['offer', 'id']],
    ['offer_ids', ['offer', 'ids']],
    ['unit-price', ['unit', 'price']],
    ['priceUsd', ['price', 'usd']],
    ['USDAmount', ['usd', 'amount']],
    ['x', ['x']],
    ['', []],
    ['__', []],
  ])('splits %j into %j', (name, words) => {
    expect(splitWords(name)).toEqual(words);
  });

  it.each([
    ['amount', ['amount']],
    ['prices', ['prices']], // a plural counts
    ['totalCount', ['total']],
    ['payeeId', ['payee']],
    ['cost_minor', ['cost']],
    ['paypalEmail', ['paypal']],
    ['spendLimit', ['limit']],
    ['unit_total_usd', ['total', 'usd']],
    ['quantity', []],
    ['offerIds', []],
    ['maxResults', []],
    ['rationale', []],
    ['classes', []], // "classes" is not "classe" + s
    ['address', []], // ends in s, but "addres" is not a word that means money
  ])('finds %j means %j', (name, words) => {
    expect(forbiddenWordsIn(name)).toEqual(words);
  });
});

describe('inspectToolSchema: a tool that tries to take money', () => {
  const findings = (schema: JsonSchema) =>
    inspectToolSchema(schema).map(({ path, rule }) => `${path} ${rule}`);

  it('is caught when it asks for an amount, a price, a currency or a payee', () => {
    for (const name of ['amount', 'price', 'currency', 'payee', 'totalUsd', 'payee_email']) {
      expect(findings(objectWith({ [name]: id }))).toEqual([
        `$.${name} forbidden-field`,
        `$.${name} unlisted-field`,
      ]);
    }
  });

  it('is caught however deep it hides: in an array, in a nested object, in a union', () => {
    const lines = { type: 'array', maxItems: 5, items: objectWith({ offerId: id, unitPrice: id }) };
    const nested = objectWith({ lines: objectWith({ detail: objectWith({ payee: id }) }) });
    const union = objectWith({ lines: { anyOf: [id, objectWith({ amount: id })] } });

    expect(findings(objectWith({ lines }))).toContain('$.lines[].unitPrice forbidden-field');
    expect(findings(nested)).toContain('$.lines.detail.payee forbidden-field');
    expect(findings(union)).toContain('$.lines.amount forbidden-field');
  });

  it('is caught through a reference, and a cycle does not hang the guard', () => {
    const viaRef = {
      ...objectWith({ lines: { $ref: '#/$defs/Line' } }),
      $defs: { Line: objectWith({ amount: id }) },
    };
    const cyclic = {
      ...objectWith({ child: { $ref: '#/$defs/Node' } }),
      $defs: { Node: objectWith({ child: { $ref: '#/$defs/Node' } }) },
    };

    expect(findings(viaRef)).toContain('$.lines.amount forbidden-field');
    expect(
      findings(cyclic).filter((entry) => entry.endsWith('unlisted-field')).length,
    ).toBeGreaterThan(0);
  });

  it('reports a reference it cannot follow, rather than skipping it', () => {
    expect(findings(objectWith({ lines: { $ref: '#/$defs/Missing' } }))).toContain(
      '$.lines unresolved-reference',
    );
    expect(findings(objectWith({ lines: { $ref: 'https://example.com/schema' } }))).toContain(
      '$.lines unresolved-reference',
    );
    expect(findings({ ...objectWith({}), $ref: '#/$defs/Gone' })).toEqual([
      '$ unresolved-reference',
    ]);
  });

  it('is caught when it takes a name that is merely not on the allow-list', () => {
    expect(findings(objectWith({ colour: id }))).toEqual(['$.colour unlisted-field']);
  });

  it('is not fooled by a harmless-looking name that contains a word that means money', () => {
    expect(forbiddenWordsIn('totalCount')).toEqual(['total']);
    expect(findings(objectWith({ totalCount: id }))).toContain('$.totalCount forbidden-field');
  });
});

describe('inspectToolSchema: bounds', () => {
  const rules = (schema: JsonSchema) =>
    inspectToolSchema(schema)
      .filter(({ rule }) => !MONEY_FIELD_RULES.includes(rule))
      .map(({ path, rule }) => `${path} ${rule}`);

  it('wants every object closed', () => {
    expect(rules({ type: 'object', properties: {} })).toEqual(['$ open-object']);
    expect(rules({ type: 'object', properties: {}, additionalProperties: {} })).toEqual([
      '$ open-object',
    ]);
    expect(
      rules({ type: 'object', additionalProperties: false, patternProperties: { '^x': {} } }),
    ).toEqual(['$ open-object']);
    expect(rules(objectWith({}))).toEqual([]);
  });

  it('wants every string bounded, unless it can only be one of a fixed set', () => {
    expect(rules(objectWith({ query: { type: 'string' } }))).toEqual(['$.query unbounded-string']);
    expect(rules(objectWith({ query: { type: 'string', maxLength: 10 } }))).toEqual([]);
    expect(rules(objectWith({ query: { type: 'string', enum: ['A', 'B'] } }))).toEqual([]);
    expect(rules(objectWith({ query: { type: 'string', const: 'A' } }))).toEqual([]);
    expect(rules(objectWith({ query: { type: ['string', 'null'] } }))).toEqual([
      '$.query unbounded-string',
    ]);
  });

  it('wants every array bounded, and looks inside it', () => {
    expect(rules(objectWith({ lines: { type: 'array', items: id } }))).toEqual([
      '$.lines unbounded-array',
    ]);
    expect(
      rules(objectWith({ lines: { type: 'array', maxItems: 3, items: { type: 'string' } } })),
    ).toEqual(['$.lines[] unbounded-string']);
    expect(rules(objectWith({ lines: { type: 'array', maxItems: 3 } }))).toEqual([]);
  });

  it('wants every integer narrowly bounded, and refuses a float', () => {
    expect(rules(objectWith({ quantity: { type: 'integer' } }))).toEqual([
      '$.quantity unbounded-integer',
    ]);
    expect(rules(objectWith({ quantity: { type: 'integer', minimum: 1 } }))).toEqual([
      '$.quantity unbounded-integer',
    ]);
    expect(rules(objectWith({ quantity: { type: 'integer', maximum: 9 } }))).toEqual([
      '$.quantity unbounded-integer',
    ]);
    expect(rules(objectWith({ quantity: { type: 'integer', minimum: 1, maximum: 99 } }))).toEqual(
      [],
    );
    expect(rules(objectWith({ quantity: { type: 'number', minimum: 1, maximum: 99 } }))).toEqual([
      '$.quantity float',
    ]);
  });

  it('does not count the safe-integer bounds Zod gives z.int() as a real limit', () => {
    const wideOpen = toJsonSchema(z.strictObject({ quantity: z.int() }), 'input');

    expect(rules(wideOpen)).toEqual(['$.quantity unbounded-integer']);
  });

  it('looks inside every branch of anyOf, oneOf and allOf, and ignores what is not a schema', () => {
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
      expect(
        rules(objectWith({ x: { [keyword]: [{ type: 'string' }, { type: 'integer' }] } })),
      ).toEqual(['$.x unbounded-string', '$.x unbounded-integer']);
    }
    expect(rules(objectWith({ x: true, y: 'not a schema', z: null }))).toEqual([]);
    expect(rules(objectWith({ x: { anyOf: 'nonsense' } }))).toEqual([]);
  });
});

describe('inspectTools: a tool that is wrong from the outside in', () => {
  const tool = (input: z.ZodObject): ToolContract => ({
    description: 'A test tool.',
    effect: 'propose',
    input,
  });

  it('is caught by its name', () => {
    const findings = inspectTools({ pay_invoice: tool(z.strictObject({})) });

    expect(findings).toEqual([
      expect.objectContaining({ path: 'pay_invoice', rule: 'forbidden-field' }),
    ]);
  });

  it('is caught when a real Zod tool takes an amount, naming the tool and the field', () => {
    const violating = tool(
      z.strictObject({
        missionId: z.string().max(30),
        amount: z.int().min(1).max(100),
      }),
    );

    expect(inspectTools({ spend: violating }).map(({ path, rule }) => `${path} ${rule}`)).toEqual([
      'spend: $.amount forbidden-field',
      'spend: $.amount unlisted-field',
    ]);
  });

  it('is caught when the real propose_cart tool is made to take a price on its lines', () => {
    const real = toJsonSchema(LLM_TOOLS.propose_cart.input, 'input');
    const lines = (real['properties'] as Record<string, Record<string, unknown>>)['lines'];
    const items = lines?.['items'] as { properties: Record<string, unknown> };
    items.properties['unitPrice'] = { type: 'integer', minimum: 0, maximum: 1000000 };

    const rules = inspectToolSchema(real).map(({ path, rule }) => `${path} ${rule}`);

    expect(rules).toEqual([
      '$.lines[].unitPrice forbidden-field',
      '$.lines[].unitPrice unlisted-field',
    ]);
  });
});
