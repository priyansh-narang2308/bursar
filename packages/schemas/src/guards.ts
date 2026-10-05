import { CURRENCY_CODES } from '@bursar/money';
import { type JsonSchema, toJsonSchema } from './json-schema';
import { LLM_TOOLS, type ToolContract } from './tools';

/*
 * The guard on everything an LLM is shown. The rule is simple: a model must never be able to name
 * an amount, a currency or a payee, because anything it can write, an attacker who can write to its
 * context (a product description, a review) can write too. These checks read the JSON Schema of
 * each tool, as the model would receive it, so they cannot be fooled by how the Zod was written.
 *
 * Three layers, each catching what the others might miss:
 *  1. a deny-list of words that mean money, matched against every property name;
 *  2. an allow-list: every property name an LLM may ever fill in is listed here, so adding one is a
 *     deliberate, reviewed change to this file and not a side effect;
 *  3. bounds: every string, array and integer has a limit, and objects refuse unknown keys.
 */

/** Words that mean money, a payee or a credential. A property name containing one is refused. */
export const FORBIDDEN_FIELD_WORDS: ReadonlySet<string> = new Set([
  'amount',
  'price',
  'cost',
  'total',
  'subtotal',
  'fee',
  'tax',
  'discount',
  'tip',
  'charge',
  'currency',
  'payee',
  'payer',
  'recipient',
  'beneficiary',
  'receiver',
  'merchant',
  'account',
  'iban',
  'routing',
  'swift',
  'card',
  'wallet',
  'paypal',
  'vault',
  'credential',
  'password',
  'secret',
  'budget',
  'balance',
  'payment',
  'pay',
  'money',
  'funds',
  'cap',
  'ceiling',
  'limit',
  ...CURRENCY_CODES.map((code) => code.toLowerCase()),
]);

/** Every property name any LLM tool may take. Adding to this list is a reviewed decision. */
export const LLM_TOOL_FIELDS: ReadonlySet<string> = new Set([
  'missionId',
  'needId',
  'offerId',
  'offerIds',
  'lines',
  'quantity',
  'rationale',
  'lineId',
  'replacementOfferId',
  'reason',
  'taskId',
  'newStart',
  'query',
  'maxResults',
]);

export type GuardRule =
  | 'forbidden-field' // a name that means money, a payee or a credential
  | 'unlisted-field' // a name that is not on the allow-list
  | 'open-object' // an object that would accept keys nobody listed
  | 'unbounded-string'
  | 'unbounded-array'
  | 'unbounded-integer'
  | 'float' // a number that may be fractional
  | 'unresolved-reference';

export interface GuardFinding {
  readonly path: string;
  readonly rule: GuardRule;
  readonly detail: string;
}

/** `priceUsd` becomes `price` and `usd`; `pay_load` becomes `pay` and `load`. */
export function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

/** The words of `name` that mean money. A plural counts: `prices` is `price`. */
export function forbiddenWordsIn(name: string): string[] {
  return splitWords(name).filter(
    (word) =>
      FORBIDDEN_FIELD_WORDS.has(word) ||
      (word.endsWith('s') && FORBIDDEN_FIELD_WORDS.has(word.slice(0, -1))),
  );
}

function describeForbidden(name: string, words: readonly string[]): string {
  const quoted = words.map((word) => `"${word}"`).join(' and ');
  return `"${name}" contains ${quoted}, which means money, a payee or a credential.`;
}

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typesOf(node: JsonSchema): string[] {
  const type = node['type'];
  if (typeof type === 'string') {
    return [type];
  }
  return Array.isArray(type)
    ? type.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

class Inspector {
  readonly findings: GuardFinding[] = [];
  private readonly visiting = new Set<string>();
  private readonly root: JsonSchema;

  constructor(root: JsonSchema) {
    this.root = root;
  }

  private add(path: string, rule: GuardRule, detail: string): void {
    this.findings.push({ path, rule, detail });
  }

  visit(node: unknown, path: string): void {
    if (!isRecord(node)) {
      return;
    }
    if (typeof node['$ref'] === 'string') {
      this.follow(node['$ref'], path);
      return;
    }

    const types = typesOf(node);
    if (types.includes('object') || isRecord(node['properties'])) {
      this.checkObject(node, path);
    }
    if (types.includes('string')) {
      this.checkString(node, path);
    }
    if (types.includes('array')) {
      this.checkArray(node, path);
    }
    if (types.includes('number')) {
      this.add(path, 'float', 'A number may be fractional; use a bounded integer.');
    }
    if (types.includes('integer')) {
      this.checkInteger(node, path);
    }
    this.visitCombinators(node, path);
  }

  private follow(ref: string, path: string): void {
    const target = ref.startsWith('#/$defs/')
      ? this.defOf(ref.slice('#/$defs/'.length))
      : undefined;
    if (target === undefined) {
      this.add(path, 'unresolved-reference', `Cannot resolve ${ref}.`);
    } else if (!this.visiting.has(ref)) {
      this.visiting.add(ref);
      this.visit(target, path);
      this.visiting.delete(ref);
    }
  }

  private defOf(name: string): unknown {
    const defs = this.root['$defs'];
    return isRecord(defs) ? defs[name] : undefined;
  }

  private checkObject(node: JsonSchema, path: string): void {
    if (node['additionalProperties'] !== false) {
      this.add(path, 'open-object', 'An object must set additionalProperties to false.');
    }
    if (isRecord(node['patternProperties'])) {
      this.add(path, 'open-object', 'patternProperties would accept keys nobody listed.');
    }

    const properties = isRecord(node['properties']) ? node['properties'] : {};
    for (const [name, child] of Object.entries(properties)) {
      const here = `${path}.${name}`;
      const words = forbiddenWordsIn(name);
      if (words.length > 0) {
        this.add(here, 'forbidden-field', describeForbidden(name, words));
      }
      if (!LLM_TOOL_FIELDS.has(name)) {
        this.add(
          here,
          'unlisted-field',
          `"${name}" is not on the allow-list of fields an LLM may fill in.`,
        );
      }
      this.visit(child, here);
    }
  }

  private checkString(node: JsonSchema, path: string): void {
    const fixed = 'enum' in node || 'const' in node;
    if (!fixed && typeof node['maxLength'] !== 'number') {
      this.add(path, 'unbounded-string', 'A string needs a maxLength.');
    }
  }

  private checkArray(node: JsonSchema, path: string): void {
    if (typeof node['maxItems'] !== 'number') {
      this.add(path, 'unbounded-array', 'An array needs a maxItems.');
    }
    this.visit(node['items'], `${path}[]`);
  }

  private checkInteger(node: JsonSchema, path: string): void {
    const { minimum, maximum } = node;
    const bounded =
      typeof minimum === 'number' &&
      typeof maximum === 'number' &&
      minimum > -Number.MAX_SAFE_INTEGER && // Zod's implicit bounds for z.int() do not count
      maximum < Number.MAX_SAFE_INTEGER;
    if (!bounded) {
      this.add(path, 'unbounded-integer', 'An integer needs explicit, narrow minimum and maximum.');
    }
  }

  private visitCombinators(node: JsonSchema, path: string): void {
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
      const branches = node[keyword];
      if (Array.isArray(branches)) {
        for (const branch of branches) {
          this.visit(branch, path);
        }
      }
    }
  }
}

/** Everything wrong with one tool's input schema, as the model would receive it. */
export function inspectToolSchema(schema: JsonSchema): GuardFinding[] {
  const inspector = new Inspector(schema);
  inspector.visit(schema, '$');
  return inspector.findings;
}

/** Everything wrong with a set of tools: their names, and each input schema. Empty means safe. */
export function inspectTools(
  tools: Readonly<Record<string, ToolContract>> = LLM_TOOLS,
): GuardFinding[] {
  return Object.entries(tools).flatMap(([name, tool]) => [
    ...(forbiddenWordsIn(name).length > 0
      ? [
          {
            path: name,
            rule: 'forbidden-field' as const,
            detail: describeForbidden(name, forbiddenWordsIn(name)),
          },
        ]
      : []),
    ...inspectToolSchema(toJsonSchema(tool.input, 'input')).map((finding) => ({
      ...finding,
      path: `${name}: ${finding.path}`,
    })),
  ]);
}
