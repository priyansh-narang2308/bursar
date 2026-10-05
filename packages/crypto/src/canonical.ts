import { CryptoError } from './errors';

/** The deepest nesting accepted, so hostile input cannot exhaust the stack. */
export const MAX_CANONICAL_DEPTH = 64;

function refuse(path: string, what: string): never {
  throw new CryptoError('invalid-input', `Cannot write ${what} at ${path} as canonical JSON.`);
}

function writeString(value: string, path: string): string {
  if (!value.isWellFormed()) {
    refuse(path, 'a string with a lone surrogate');
  }
  return JSON.stringify(value);
}

function writeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    refuse(path, 'a number that is not finite');
  }
  return JSON.stringify(value);
}

function writeArray(items: readonly unknown[], path: string, depth: number): string {
  // `Array.from` visits holes as `undefined`, which is then refused like any other.
  const members = Array.from(items, (item, index) => write(item, `${path}[${index}]`, depth + 1));
  return `[${members.join(',')}]`;
}

function assertPlainObject(object: object, path: string): void {
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) {
    refuse(path, 'an object that is not plain data');
  }
  if (Object.getOwnPropertySymbols(object).length > 0) {
    refuse(path, 'an object with symbol keys');
  }
}

function writeObject(object: object, path: string, depth: number): string {
  assertPlainObject(object, path);
  // Keys sort by UTF-16 code units, which is what `<` on strings does and what RFC 8785 requires.
  const members = Object.entries(object)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([key, value]) => `${writeString(key, path)}:${write(value, `${path}.${key}`, depth + 1)}`,
    );
  return `{${members.join(',')}}`;
}

function write(value: unknown, path: string, depth: number): string {
  if (depth > MAX_CANONICAL_DEPTH) {
    refuse(path, 'a value nested too deeply');
  }
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'string':
      return writeString(value, path);
    case 'number':
      return writeNumber(value, path);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object':
      return Array.isArray(value)
        ? writeArray(value, path, depth)
        : writeObject(value, path, depth);
    default:
      return refuse(path, `a ${typeof value}`);
  }
}

/**
 * The one way to serialise a value that will be hashed, signed or compared: JSON in the form of
 * RFC 8785 (JCS). Object keys are sorted, there is no whitespace, numbers and strings are written
 * the way ECMAScript writes them, so the same data always gives the same bytes on every machine.
 *
 * Only plain JSON data is accepted. `undefined`, `bigint`, functions, symbols, `NaN`, infinities,
 * class instances (call `toJSON()` first), sparse arrays, symbol keys and lone surrogates are
 * errors rather than being dropped or rewritten, because a hash must never ignore part of what it
 * covers.
 */
export function canonicalize(value: unknown): string {
  return write(value, '$', 0);
}
