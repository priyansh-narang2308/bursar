import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toHex, utf8 } from '../src/bytes';
import { canonicalize, MAX_CANONICAL_DEPTH } from '../src/canonical';
import { CryptoError } from '../src/errors';
import { reverseKeys } from './support';

/** The double with these IEEE 754 bits, as written in RFC 8785 appendix B. */
function doubleFromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

describe('canonicalize: RFC 8785 published vectors', () => {
  // Table 1 of appendix B: ECMAScript-compatible number serialization samples.
  it.each([
    ['0000000000000000', '0'],
    ['8000000000000000', '0'],
    ['0000000000000001', '5e-324'],
    ['8000000000000001', '-5e-324'],
    ['7fefffffffffffff', '1.7976931348623157e+308'],
    ['ffefffffffffffff', '-1.7976931348623157e+308'],
    ['4340000000000000', '9007199254740992'],
    ['c340000000000000', '-9007199254740992'],
    ['4430000000000000', '295147905179352830000'],
    ['44b52d02c7e14af5', '9.999999999999997e+22'],
    ['44b52d02c7e14af6', '1e+23'],
    ['44b52d02c7e14af7', '1.0000000000000001e+23'],
    ['444b1ae4d6e2ef4e', '999999999999999700000'],
    ['444b1ae4d6e2ef4f', '999999999999999900000'],
    ['444b1ae4d6e2ef50', '1e+21'],
    ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
    ['3eb0c6f7a0b5ed8d', '0.000001'],
    ['41b3de4355555553', '333333333.3333332'],
    ['41b3de4355555554', '333333333.33333325'],
    ['41b3de4355555555', '333333333.3333333'],
    ['41b3de4355555556', '333333333.3333334'],
    ['41b3de4355555557', '333333333.33333343'],
    ['becbf647612f3696', '-0.0000033333333333333333'],
    ['43143ff3c1cb0959', '1424953923781206.2'],
  ])('writes the number with IEEE 754 bits %s as %s', (bits, expected) => {
    expect(canonicalize(doubleFromBits(bits))).toBe(expected);
  });

  it.each([
    ['NaN', '7fffffffffffffff'],
    ['Infinity', '7ff0000000000000'],
    ['-Infinity', 'fff0000000000000'],
  ])('refuses %s', (_name, bits) => {
    expect(() => canonicalize(doubleFromBits(bits))).toThrow(CryptoError);
  });

  // Section 3.2.3: the property names must sort by UTF-16 code units, which differs from sorting
  // by code points for the emoji, and from sorting by UTF-8 bytes.
  it('sorts property names by UTF-16 code units', () => {
    const sample = JSON.parse(`{
      "\\u20ac": "Euro Sign",
      "\\r": "Carriage Return",
      "\\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\\ud83d\\ude00": "Emoji: Grinning Face",
      "\\u0080": "Control",
      "\\u00f6": "Latin Small Letter O With Diaeresis"
    }`);
    expect(canonicalize(sample)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control",' +
        '"ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign",' +
        '"😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  // Sections 3.2.2 to 3.2.4: the worked example, compared with the RFC's own UTF-8 bytes.
  it('produces the bytes the RFC lists for its worked example', () => {
    const sample = JSON.parse(`{
      "numbers": [333333333.33333329, 1E30, 4.50,
                  2e-3, 0.000000000000000000000000001],
      "string": "\\u20ac$\\u000F\\u000aA'\\u0042\\u0022\\u005c\\\\\\"\\/",
      "literals": [null, true, false]
    }`);
    const rfcBytes = [
      '7b 22 6c 69 74 65 72 61 6c 73 22 3a 5b 6e 75 6c 6c 2c 74 72',
      '75 65 2c 66 61 6c 73 65 5d 2c 22 6e 75 6d 62 65 72 73 22 3a',
      '5b 33 33 33 33 33 33 33 33 33 2e 33 33 33 33 33 33 33 2c 31',
      '65 2b 33 30 2c 34 2e 35 2c 30 2e 30 30 32 2c 31 65 2d 32 37',
      '5d 2c 22 73 74 72 69 6e 67 22 3a 22 e2 82 ac 24 5c 75 30 30',
      '30 66 5c 6e 41 27 42 5c 22 5c 5c 5c 5c 5c 22 2f 22 7d',
    ].join(' ');
    expect(toHex(utf8(canonicalize(sample)))).toBe(rfcBytes.replaceAll(' ', ''));
  });
});

describe('canonicalize: the form', () => {
  it('has no whitespace and writes literals', () => {
    expect(canonicalize({ a: [true, false, null], b: 'x' })).toBe(
      '{"a":[true,false,null],"b":"x"}',
    );
    expect(canonicalize([])).toBe('[]');
    expect(canonicalize({})).toBe('{}');
  });

  it('sorts keys at every depth but never reorders arrays', () => {
    expect(canonicalize({ b: [{ z: 1, a: 2 }, 3, 1], a: { y: 1, x: 2 } })).toBe(
      '{"a":{"x":2,"y":1},"b":[{"a":2,"z":1},3,1]}',
    );
  });

  it('sorts keys by code unit, not numerically', () => {
    expect(canonicalize({ '9': 1, '10': 2, '1': 3 })).toBe('{"1":3,"10":2,"9":1}');
  });

  it('escapes only what JSON requires, with lower-case hex', () => {
    expect(canonicalize('\u0000\u0008\t\n\u000c\r\u001f"\\/\u007f ')).toBe(
      '"\\u0000\\b\\t\\n\\f\\r\\u001f\\"\\\\/\u007f "',
    );
  });

  it('writes -0 as 0', () => {
    expect(canonicalize([-0, 0])).toBe('[0,0]');
  });

  it('keeps an own property called __proto__ as data', () => {
    expect(canonicalize(JSON.parse('{"__proto__":1,"a":2}'))).toBe('{"__proto__":1,"a":2}');
  });

  it('accepts an object without a prototype', () => {
    expect(canonicalize(Object.assign(Object.create(null), { b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
  });
});

describe('canonicalize: what it refuses, so a hash never skips part of its input', () => {
  class Money {
    readonly minor = '1';
  }

  const sparse: unknown[] = [1];
  sparse[2] = 3; // leaves a hole at index 1
  const withSymbol = { a: 1, [Symbol('hidden')]: 2 };
  const circular: Record<string, unknown> = {};
  circular['self'] = circular;

  it.each([
    ['undefined', undefined, '$'],
    ['undefined in an object', { a: { b: undefined } }, '$.a.b'],
    ['undefined in an array', { a: [1, undefined] }, '$.a[1]'],
    ['a bigint', { a: 10n }, '$.a'],
    ['a function', { a: () => 1 }, '$.a'],
    ['a symbol', { a: Symbol('x') }, '$.a'],
    ['NaN', [Number.NaN], '$[0]'],
    ['Infinity', { a: Number.POSITIVE_INFINITY }, '$.a'],
    ['a lone surrogate in a string', { a: 'x\ud800' }, '$.a'],
    ['a lone surrogate in a key', { 'x\udc00': 1 }, '$'],
    ['a Date', { a: new Date(0) }, '$.a'],
    ['a Map', { a: new Map() }, '$.a'],
    ['a Set', [new Set()], '$[0]'],
    ['a class instance', { a: new Money() }, '$.a'],
    ['a boxed string', { a: new String('x') }, '$.a'],
    ['a typed array', { a: new Uint8Array(1) }, '$.a'],
    ['a sparse array', sparse, '$[1]'],
    ['an object with a symbol key', withSymbol, '$'],
    ['a circular structure', circular, '$.self.self.self'],
  ])('refuses %s', (_name, value, path) => {
    expect(() => canonicalize(value)).toThrow(CryptoError);
    expect(() => canonicalize(value)).toThrow(path);
  });

  it('allows nesting up to the limit and refuses beyond it', () => {
    const nest = (levels: number): unknown => {
      let value: unknown = 1;
      for (let level = 0; level < levels; level++) {
        value = [value];
      }
      return value;
    };
    expect(MAX_CANONICAL_DEPTH).toBe(64);
    expect(canonicalize(nest(MAX_CANONICAL_DEPTH))).toBe(`${'['.repeat(64)}1${']'.repeat(64)}`);
    expect(() => canonicalize(nest(MAX_CANONICAL_DEPTH + 1))).toThrow('nested too deeply');
  });

  it('reports a code that callers can branch on', () => {
    expect(() => canonicalize(undefined)).toThrow(
      expect.objectContaining({ name: 'CryptoError', code: 'invalid-input' }),
    );
  });
});

describe('canonicalize: properties', () => {
  it('keeps the data: parsing the output gives the same value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(canonicalize(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });

  it('is its own fixed point', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const once = canonicalize(value);
        expect(canonicalize(JSON.parse(once))).toBe(once);
      }),
    );
  });

  it('does not depend on the order keys were written in', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(canonicalize(reverseKeys(value))).toBe(canonicalize(value));
      }),
    );
  });
});
