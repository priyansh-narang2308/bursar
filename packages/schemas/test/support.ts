import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { id } from './fixtures';

/** Every problem a schema reports, as `path: message` lines. Empty when the value is valid. */
export function problemsOf(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

type Fixture = Record<string, unknown>;

const ID_SHAPE = /^[a-z]{3}_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * The tests every entity schema has to pass: it accepts its example (also after a trip through
 * JSON), refuses unknown keys, needs every field present, and checks that each id field holds an
 * id of the right kind. Each entity's own file adds its specific rules on top.
 */
export function describeEntityContract(
  name: string,
  schema: z.ZodType,
  example: () => Fixture,
): void {
  const keys = Object.keys(example());
  const idKeys = Object.entries(example())
    .filter(([, value]) => typeof value === 'string' && ID_SHAPE.test(value))
    .map(([key]) => key);

  describe(`${name} contract`, () => {
    it('accepts a valid example, also after a trip through JSON', () => {
      expect(problemsOf(schema, example())).toEqual([]);
      expect(problemsOf(schema, JSON.parse(JSON.stringify(example())))).toEqual([]);
    });

    it('refuses a key it does not know', () => {
      expect(problemsOf(schema, { ...example(), surprise: 1 })).toEqual([
        ': Unrecognized key: "surprise"',
      ]);
    });

    it.each(keys)('requires %s to be present, even when it may be null', (key) => {
      const { [key]: _removed, ...rest } = example();

      expect(problemsOf(schema, rest).length).toBeGreaterThan(0);
    });

    it.each(idKeys)('requires %s to be an id of the right kind', (key) => {
      // An event id is not the id of anything an entity refers to.
      expect(problemsOf(schema, { ...example(), [key]: id('event') })).toEqual([
        expect.stringContaining(`${key}: Expected a`),
      ]);
    });

    it('does not mistake a non-object for an entity', () => {
      for (const value of [null, undefined, 'text', 7, [], [example()]]) {
        expect(problemsOf(schema, value).length).toBeGreaterThan(0);
      }
    });
  });
}
