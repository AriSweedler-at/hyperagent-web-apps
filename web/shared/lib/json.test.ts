import { describe, expect, expectTypeOf, test } from 'vitest';

import {
  arrayOf,
  boolean,
  formatError,
  integer,
  literal,
  map,
  nullable,
  number,
  object,
  oneOf,
  optional,
  pair,
  record,
  refine,
  string,
  taggedUnion,
  type DecodeError,
  type Decoder,
} from './json.ts';
import { err, ok, type Result } from './result.ts';
import { mulberry32, type Rng } from './rng.ts';

const failure = (
  path: ReadonlyArray<string | number>,
  expected: string,
): Result<never, DecodeError> => err({ path, expected });

// A small generator of arbitrary JSON-ish (and some hostile, non-JSON) values for property tests.
const pick = <T>(rng: Rng, xs: ReadonlyArray<T>): T => {
  const x = xs[Math.floor(rng() * xs.length)];
  if (x === undefined) throw new Error('empty choice');
  return x;
};
const HOSTILE_KEYS = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'];
const arbitrary = (rng: Rng, depth = 0): unknown => {
  const kind = pick(rng, [
    'string',
    'number',
    'int',
    'bool',
    'null',
    'undefined',
    'nan',
    'inf',
    'fn',
    'symbol',
    'bigint',
    'date',
    'array',
    'object',
    'hostile',
    'nullProto',
  ] as const);
  const nest = (): unknown => (depth > 2 ? null : arbitrary(rng, depth + 1));
  switch (kind) {
    case 'string':
      return pick(rng, ['', 'a', 'ABCD', '__proto__', '0', 'true', 'null']);
    case 'number':
      return (rng() - 0.5) * 1e6;
    case 'int':
      return Math.floor((rng() - 0.5) * 1e4);
    case 'bool':
      return rng() < 0.5;
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'nan':
      return Number.NaN;
    case 'inf':
      return rng() < 0.5 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    case 'fn':
      return () => 1;
    case 'symbol':
      return Symbol('s');
    case 'bigint':
      return 10n;
    case 'date':
      return new Date(0);
    case 'array':
      return Array.from({ length: Math.floor(rng() * 4) }, nest);
    case 'object':
      return Object.fromEntries(
        Array.from({ length: Math.floor(rng() * 4) }, () => [pick(rng, ['a', 'b', 'c']), nest()]),
      );
    case 'hostile':
      return JSON.parse(`{"${pick(rng, HOSTILE_KEYS)}": {"polluted": true}, "a": 1}`) as unknown;
    case 'nullProto': {
      const o: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      o['a'] = nest();
      return o;
    }
  }
};
const samples = (seed: number, n: number): ReadonlyArray<unknown> => {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => arbitrary(rng));
};

const neverThrows = (decoder: Decoder<unknown>, inputs: ReadonlyArray<unknown>): void => {
  inputs.forEach((input) => {
    const result = decoder(input);
    expect(typeof result.ok).toBe('boolean');
  });
};

describe('leaves', () => {
  test('string', () => {
    expect(string('x')).toEqual(ok('x'));
    expect(string('')).toEqual(ok(''));
    expect(string(1)).toEqual(failure([], 'string'));
    expect(string(new String('x'))).toEqual(failure([], 'string'));
  });

  test('boolean', () => {
    expect(boolean(true)).toEqual(ok(true));
    expect(boolean('true')).toEqual(failure([], 'boolean'));
    expect(boolean(0)).toEqual(failure([], 'boolean'));
  });

  test('number accepts finite numbers only', () => {
    expect(number(1.5)).toEqual(ok(1.5));
    expect(number(-0)).toEqual(ok(-0));
    expect(number(Number.NaN)).toEqual(failure([], 'finite number'));
    expect(number(Number.POSITIVE_INFINITY)).toEqual(failure([], 'finite number'));
    expect(number('1')).toEqual(failure([], 'finite number'));
  });

  test('integer bounds are inclusive and default to the safe range', () => {
    const die = integer(1, 6);
    expect(die(1)).toEqual(ok(1));
    expect(die(6)).toEqual(ok(6));
    expect(die(0)).toEqual(failure([], 'integer in [1, 6]'));
    expect(die(7)).toEqual(failure([], 'integer in [1, 6]'));
    expect(die(2.5)).toEqual(failure([], 'integer in [1, 6]'));
    expect(die('3')).toEqual(failure([], 'integer in [1, 6]'));
    const any = integer();
    expect(any(Number.MAX_SAFE_INTEGER)).toEqual(ok(Number.MAX_SAFE_INTEGER));
    expect(any(Number.MAX_SAFE_INTEGER + 2).ok).toBe(false);
    expect(any(Number.MIN_SAFE_INTEGER)).toEqual(ok(Number.MIN_SAFE_INTEGER));
  });

  test('literal narrows to the union of its values', () => {
    const t = literal('hello', 'bye', 3, null);
    expectTypeOf(t).toEqualTypeOf<Decoder<'hello' | 'bye' | 3 | null>>();
    expect(t('hello')).toEqual(ok('hello'));
    expect(t(3)).toEqual(ok(3));
    expect(t(null)).toEqual(ok(null));
    expect(t('Hello')).toEqual(failure([], 'one of "hello" | "bye" | 3 | null'));
    expect(t(undefined)).toEqual(failure([], 'one of "hello" | "bye" | 3 | null'));
    expect(t('3')).toEqual(failure([], 'one of "hello" | "bye" | 3 | null'));
  });

  test('literal uses strict equality (no NaN, no coercion)', () => {
    expect(literal(0)(false).ok).toBe(false);
    expect(literal(0)(-0)).toEqual(ok(-0));
    expect(literal('')(0).ok).toBe(false);
  });
});

describe('arrayOf', () => {
  const dice = arrayOf(integer(1, 6));

  test('decodes every element', () => {
    expect(dice([1, 2, 6])).toEqual(ok([1, 2, 6]));
    expect(dice([])).toEqual(ok([]));
  });

  test('reports the first bad index with its path', () => {
    expect(dice([1, 9, 0])).toEqual(failure([1], 'integer in [1, 6]'));
    expect(dice([1, 2, 'x'])).toEqual(failure([2], 'integer in [1, 6]'));
  });

  test('rejects non-arrays, including array-likes', () => {
    expect(dice({ length: 1, 0: 1 })).toEqual(failure([], 'array'));
    expect(dice('123')).toEqual(failure([], 'array'));
    expect(dice(null)).toEqual(failure([], 'array'));
  });

  test('returns a fresh array, not the input', () => {
    const input = [1, 2];
    const result = dice(input);
    expect(result.ok && result.value !== input).toBe(true);
  });
});

describe('optional / nullable', () => {
  test('optional lets undefined through and defers otherwise', () => {
    const d = optional(string);
    expect(d(undefined)).toEqual(ok(undefined));
    expect(d('x')).toEqual(ok('x'));
    expect(d(null)).toEqual(failure([], 'string'));
  });

  test('nullable lets null through and defers otherwise', () => {
    const d = nullable(number);
    expect(d(null)).toEqual(ok(null));
    expect(d(2)).toEqual(ok(2));
    expect(d(undefined)).toEqual(failure([], 'finite number'));
  });
});

describe('object', () => {
  const player = object({ name: string, seat: integer(0, 1), nick: optional(string) });

  test('decodes the declared fields and infers the type (optional fields as optional keys)', () => {
    const r = player({ name: 'Ari', seat: 1 });
    expect(r).toEqual(ok({ name: 'Ari', seat: 1 }));
    if (r.ok) {
      expectTypeOf(r.value).toEqualTypeOf<
        Readonly<{ name: string; seat: number; nick?: string }>
      >();
    }
  });

  test('drops undeclared keys and keeps the declared order', () => {
    const r = player({ seat: 0, name: 'Ari', extra: 'x', t: 'hello' });
    expect(r).toEqual(ok({ name: 'Ari', seat: 0 }));
    expect(r.ok && Object.keys(r.value)).toEqual(['name', 'seat']);
  });

  test('an optional key absent in the input is absent in the output; present, it is kept in place', () => {
    const absent = player({ name: 'Ari', seat: 0 });
    expect(absent.ok && Object.keys(absent.value)).toEqual(['name', 'seat']);
    expect(absent.ok && 'nick' in absent.value).toBe(false);
    const present = player({ name: 'Ari', seat: 0, nick: 'A' });
    expect(present).toEqual(ok({ name: 'Ari', seat: 0, nick: 'A' }));
    expect(present.ok && Object.keys(present.value)).toEqual(['name', 'seat', 'nick']);
    // So the JSON text round-trips through the decoder (a wire golden's key set survives).
    const d = object({ text: string, card: optional(string), by: optional(integer(0, 1)) });
    ['{"text":"t"}', '{"text":"t","by":1}', '{"text":"t","card":"AS","by":0}'].forEach((json) => {
      const r = d(JSON.parse(json));
      expect(r.ok && JSON.stringify(r.value)).toBe(json);
    });
  });

  test('an explicit undefined under an optional key (not JSON) is left out like a missing one', () => {
    const r = player({ name: 'Ari', seat: 0, nick: undefined });
    expect(r.ok && Object.keys(r.value)).toEqual(['name', 'seat']);
  });

  test('reports a bad field by key, nested paths compose', () => {
    expect(player({ name: 'Ari', seat: 2 })).toEqual(failure(['seat'], 'integer in [0, 1]'));
    expect(player({ seat: 0 })).toEqual(failure(['name'], 'string'));
    const table = object({ players: arrayOf(player) });
    expect(
      table({
        players: [
          { name: 'a', seat: 0 },
          { name: 1, seat: 0 },
        ],
      }),
    ).toEqual(failure(['players', 1, 'name'], 'string'));
  });

  test('rejects non-objects: null, arrays, primitives', () => {
    expect(player(null)).toEqual(failure([], 'object'));
    expect(player([])).toEqual(failure([], 'object'));
    expect(player('{}')).toEqual(failure([], 'object'));
    expect(player(undefined)).toEqual(failure([], 'object'));
  });

  test('reads own properties only: inherited members are not data', () => {
    // `toString` exists on every object through the prototype; it must not satisfy a field.
    const d = object({ toString: string });
    expect(d({})).toEqual(failure(['toString'], 'string'));
    expect(d({ toString: 'own' })).toEqual(ok({ toString: 'own' }));
    const proto = { name: 'inherited', seat: 0 };
    expect(player(Object.create(proto) as unknown)).toEqual(failure(['name'], 'string'));
  });

  test('prototype-pollution keys in the input never reach the output', () => {
    const hostile = JSON.parse(
      '{"__proto__": {"polluted": true}, "constructor": {"prototype": {"x": 1}}, "name": "Ari", "seat": 0}',
    ) as unknown;
    const r = player(hostile);
    expect(r).toEqual(ok({ name: 'Ari', seat: 0 }));
    if (r.ok) {
      expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype);
      expect('polluted' in r.value).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(r.value, '__proto__')).toBe(false);
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  test('null-prototype objects decode like any other', () => {
    const o: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    o['name'] = 'n';
    o['seat'] = 1;
    expect(player(o)).toEqual(ok({ name: 'n', seat: 1 }));
  });

  test('an empty field set accepts any object and yields {}', () => {
    expect(object({})({ a: 1 })).toEqual(ok({}));
  });
});

describe('record', () => {
  const scores = record(integer(0, 100));

  test('keeps every own key in input order and decodes each value', () => {
    const r = scores({ b: 2, a: 1, AS: 10 });
    expect(r).toEqual(ok({ b: 2, a: 1, AS: 10 }));
    expect(r.ok && Object.keys(r.value)).toEqual(['b', 'a', 'AS']);
    expect(scores({})).toEqual(ok({}));
  });

  test('reports the failing key and rejects non-objects', () => {
    expect(scores({ a: 1, b: 'x' })).toEqual(failure(['b'], 'integer in [0, 100]'));
    expect(scores([1])).toEqual(failure([], 'object'));
    expect(scores(null)).toEqual(failure([], 'object'));
    expect(scores('a')).toEqual(failure([], 'object'));
    const nested = record(object({ n: integer(0, 9) }));
    expect(nested({ k: { n: 10 } })).toEqual(failure(['k', 'n'], 'integer in [0, 9]'));
  });

  test('refuses prototype-chain keys instead of carrying them', () => {
    HOSTILE_KEYS.slice(0, 3).forEach((key) => {
      const hostile = JSON.parse(`{"a": 1, "${key}": 2}`) as unknown;
      expect(scores(hostile)).toEqual(failure([key], 'a key that is not a prototype member'));
    });
    // Other inherited names are ordinary keys when they are own properties.
    expect(scores({ toString: 3 })).toEqual(ok({ toString: 3 }));
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  test('reads own properties only and yields a clean prototype', () => {
    const proto = { inherited: 1 };
    const r = scores(Object.create(proto) as unknown);
    expect(r).toEqual(ok({}));
    if (r.ok) expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype);
  });
});

describe('map / refine / oneOf', () => {
  test('map transforms the decoded value', () => {
    const upper = map(string, (s) => s.toUpperCase());
    expect(upper('abc')).toEqual(ok('ABC'));
    expect(upper(1)).toEqual(failure([], 'string'));
  });

  test('refine adds a check with its own message', () => {
    const code = refine(string, (s) => s.length === 4, '4-character code');
    expect(code('ABCD')).toEqual(ok('ABCD'));
    expect(code('ABC')).toEqual(failure([], '4-character code'));
    expect(code(4)).toEqual(failure([], 'string'));
  });

  test('oneOf takes the first match and lists every expectation otherwise', () => {
    const d = oneOf<string | number>(string, integer(0, 9));
    expect(d('a')).toEqual(ok('a'));
    expect(d(5)).toEqual(ok(5));
    expect(d(true)).toEqual(failure([], 'string or integer in [0, 9]'));
    expect(oneOf()(1)).toEqual(failure([], 'nothing (no alternatives)'));
  });
});

describe('pair', () => {
  test('exactly two items, typed as a tuple', () => {
    const d = pair(integer(0, 9));
    expect(d([1, 2])).toEqual(ok([1, 2]));
    expectTypeOf(d).returns.toEqualTypeOf<Result<readonly [number, number], DecodeError>>();
  });

  test('one or three items is not a pair; a non-array and a bad item report as arrayOf does', () => {
    const d = pair(integer(0, 9));
    expect(d([1])).toEqual(failure([], 'array of 2'));
    expect(d([1, 2, 3])).toEqual(failure([], 'array of 2'));
    expect(d([])).toEqual(failure([], 'array of 2'));
    expect(d('12')).toEqual(failure([], 'array'));
    expect(d([1, 'x'])).toEqual(failure([1], 'integer in [0, 9]'));
    expect(d([1, 12])).toEqual(failure([1], 'integer in [0, 9]'));
  });
});

describe('taggedUnion', () => {
  type Shape =
    | Readonly<{ kind: 'dot' }>
    | Readonly<{ kind: 'line'; length: number }>
    | Readonly<{ kind: 'box'; w: number; h: number }>;
  const shape: Decoder<Shape> = taggedUnion('kind', {
    dot: object({ kind: literal('dot') }),
    line: object({ kind: literal('line'), length: integer(0) }),
    box: object({ kind: literal('box'), w: integer(0), h: integer(0) }),
  });

  test('the tag picks the case decoder, which runs over the whole input', () => {
    expect(shape({ kind: 'dot' })).toEqual(ok({ kind: 'dot' }));
    expect(shape({ kind: 'line', length: 3 })).toEqual(ok({ kind: 'line', length: 3 }));
    expect(shape({ kind: 'box', w: 1, h: 2 })).toEqual(ok({ kind: 'box', w: 1, h: 2 }));
    expect(shape({ kind: 'line' })).toEqual(
      failure(['length'], 'integer in [0, 9007199254740991]'),
    );
  });

  test("the case's result is returned unchanged: its key order, not the tag first", () => {
    const d = taggedUnion('t', { a: object({ x: integer(), t: literal('a'), y: string }) });
    const r = d({ y: 'y', t: 'a', x: 1, extra: true });
    expect(r.ok && JSON.stringify(r.value)).toBe('{"x":1,"t":"a","y":"y"}');
  });

  test('an unknown or missing tag names every case in declaration order, at the tag field', () => {
    const expected = 'one of "dot" | "line" | "box"';
    expect(shape({ kind: 'blob' })).toEqual(failure(['kind'], expected));
    expect(shape({})).toEqual(failure(['kind'], expected));
    expect(shape({ kind: 1 })).toEqual(failure(['kind'], expected));
    expect(formatError({ path: ['kind'], expected })).toBe(`$.kind: expected ${expected}`);
  });

  test('a prototype member as the tag is an unknown tag, never a case', () => {
    ['constructor', '__proto__', 'toString'].forEach((tag) => {
      expect(shape({ kind: tag })).toEqual(failure(['kind'], 'one of "dot" | "line" | "box"'));
    });
    const inherited = Object.create({ kind: 'dot' }) as unknown;
    expect(shape(inherited)).toEqual(failure(['kind'], 'one of "dot" | "line" | "box"'));
  });

  test('rejects non-objects like object does', () => {
    expect(shape(null)).toEqual(failure([], 'object'));
    expect(shape(['dot'])).toEqual(failure([], 'object'));
    expect(shape('dot')).toEqual(failure([], 'object'));
  });
});

describe('formatError', () => {
  test('spells the path like a JS accessor', () => {
    expect(formatError({ path: [], expected: 'object' })).toBe('$: expected object');
    expect(formatError({ path: ['players', 2, 'name'], expected: 'string' })).toBe(
      '$.players[2].name: expected string',
    );
  });
});

describe('properties over arbitrary and hostile inputs', () => {
  const inputs = samples(7, 2000);
  const frame = object({
    t: literal('hello', 'bye'),
    n: optional(integer(0, 100)),
    xs: arrayOf(nullable(string)),
    who: object({ name: string }),
  });
  const decoders: ReadonlyArray<readonly [string, Decoder<unknown>]> = [
    ['string', string],
    ['number', number],
    ['integer', integer(-5, 5)],
    ['boolean', boolean],
    ['literal', literal('a', 1, true, null)],
    ['arrayOf', arrayOf(number)],
    ['frame', frame],
    ['record', record(oneOf<unknown>(string, number, boolean))],
    ['oneOf', oneOf<unknown>(string, number, boolean)],
  ];

  test.each(decoders)('%s never throws', (_name, decoder) => {
    neverThrows(decoder, inputs);
  });

  test('an Ok from a leaf means the predicate holds', () => {
    inputs.forEach((input) => {
      const s = string(input);
      if (s.ok) expect(typeof s.value).toBe('string');
      const n = number(input);
      if (n.ok) expect(Number.isFinite(n.value)).toBe(true);
      const i = integer(-5, 5)(input);
      if (i.ok) expect(Number.isInteger(i.value) && i.value >= -5 && i.value <= 5).toBe(true);
    });
  });

  test('an Ok from object has exactly the declared keys (the optional one when present) and a clean prototype', () => {
    const decoded = inputs.map((input) => frame(input)).filter((r) => r.ok);
    decoded.forEach((r) => {
      const keys = Object.keys(r.value).sort();
      expect(keys).toEqual(keys.includes('n') ? ['n', 't', 'who', 'xs'] : ['t', 'who', 'xs']);
      expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype);
    });
  });

  test('decoding is idempotent: decoding an Ok value again gives an equal Ok', () => {
    const okValues = inputs.map((input) => frame(input)).filter((r) => r.ok);
    okValues.forEach((r) => {
      expect(frame(r.value)).toEqual(r);
    });
    // The generator does produce some accepted frames, or this test proves nothing.
    expect(frame({ t: 'hello', xs: [], who: { name: 'x' } }).ok).toBe(true);
  });

  test('a decoder never mutates its input', () => {
    const input = { t: 'hello', xs: ['a', null], who: { name: 'x' }, extra: [1] };
    const before = JSON.stringify(input);
    frame(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
