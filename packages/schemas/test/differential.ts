import type { z } from 'zod';

/*
 * Differential testing of a Zod schema against its exported JSON Schema: take a valid document,
 * break it in many small ways, and compare what Zod and a real JSON Schema validator say.
 */

type Path = readonly (string | number)[];
type Node = Record<string | number, unknown>;

/** A value that is wrong for most fields, used to break one field at a time. */
const POISON: readonly unknown[] = [null, 42, 1.5, -1, '', 'NOPE', [], {}, true];

function clone(value: unknown): Node {
  return structuredClone(value) as Node;
}

function valueAt(root: unknown, path: Path): unknown {
  return path.reduce<unknown>((node, key) => (node as Node)[key], root);
}

function parentIn(root: Node, path: Path): Node {
  return path.slice(0, -1).reduce<Node>((node, key) => node[key] as Node, root);
}

function setAt(root: unknown, path: Path, value: unknown): unknown {
  const key = path.at(-1);
  if (key === undefined) {
    return value;
  }
  const copy = clone(root);
  parentIn(copy, path)[key] = value;
  return copy;
}

function removeAt(root: unknown, path: Path): unknown {
  const key = path.at(-1);
  const copy = clone(root);
  if (key !== undefined) {
    Reflect.deleteProperty(parentIn(copy, path), key);
  }
  return copy;
}

/** The path to every node of a document, the root included. */
function pathsOf(value: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (typeof value !== 'object' || value === null) {
    return [prefix];
  }
  const children = Object.entries(value).flatMap(([key, child]) =>
    pathsOf(child, [...prefix, Array.isArray(value) ? Number(key) : key]),
  );
  return [prefix, ...children];
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type Mutant = readonly [label: string, document: unknown];

function mutantsAt(example: unknown, path: Path): Mutant[] {
  const where = path.join('.') || '(root)';
  const mutants: Mutant[] = POISON.map(
    (poison): Mutant => [`${where} = ${JSON.stringify(poison)}`, setAt(example, path, poison)],
  );
  if (path.length > 0) {
    mutants.push([`${where} removed`, removeAt(example, path)]);
  }
  if (isPlainObject(valueAt(example, path))) {
    mutants.push([`${where} given an unknown key`, setAt(example, [...path, 'surprise'], 1)]);
  }
  return mutants;
}

/** Every one-field breakage of `example`: a bad value, a missing value, an unknown key. */
export function mutantsOf(example: unknown): Mutant[] {
  return pathsOf(example).flatMap((path) => mutantsAt(example, path));
}

type Validate = (document: unknown) => boolean | PromiseLike<unknown>;

/**
 * Where the two validators disagree in a way that matters. JSON Schema cannot express a rule that
 * spans several fields, so Zod may be stricter for those (an issue with code `custom`), but never
 * the other way round: JSON Schema must accept whatever Zod accepts, and reject whatever Zod
 * rejects for a structural reason (a type, a format, a length, a missing or unknown key).
 */
export function disagreements(
  schema: z.ZodType,
  validate: Validate,
  mutants: readonly Mutant[],
): string[] {
  return mutants.flatMap(([label, document]) => {
    const zod = schema.safeParse(document);
    const accepted = validate(document) === true;

    if (zod.success) {
      return accepted ? [] : [`${label}: Zod accepts it but JSON Schema rejects it`];
    }
    const structural = zod.error.issues.find((issue) => issue.code !== 'custom');
    return structural !== undefined && accepted
      ? [`${label}: Zod rejects it (${structural.message}) but JSON Schema accepts it`]
      : [];
  });
}
