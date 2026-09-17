import { describe, expect, expectTypeOf, test } from 'vitest';

import {
  andThen,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrapOr,
  type Err,
  type Ok,
  type Result,
} from './result.ts';

const parseEven = (n: number): Result<number, string> =>
  n % 2 === 0 ? ok(n) : err(`${String(n)} is odd`);

const half = (n: number): number => n / 2;

describe('ok / err', () => {
  test('ok wraps a value with ok: true', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
  });

  test('err wraps an error with ok: false', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  test('the discriminant narrows the union', () => {
    const r: Result<number, string> = parseEven(2);
    if (r.ok) {
      expectTypeOf(r).toEqualTypeOf<Ok<number>>();
      expect(r.value).toBe(2);
    } else {
      expectTypeOf(r).toEqualTypeOf<Err<string>>();
    }
  });

  test('values are usable as-is, not copied', () => {
    const value = { nested: [1, 2, 3] };
    expect(ok(value).value).toBe(value);
  });
});

describe('isOk / isErr', () => {
  test('isOk is true only for Ok', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isOk(err('e'))).toBe(false);
  });

  test('isErr is true only for Err', () => {
    expect(isErr(err('e'))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
  });

  test('both act as type guards', () => {
    const r: Result<number, string> = parseEven(4);
    if (isOk(r)) {
      expectTypeOf(r.value).toEqualTypeOf<number>();
    }
    if (isErr(r)) {
      expectTypeOf(r.error).toEqualTypeOf<string>();
    }
  });
});

describe('map', () => {
  test('transforms the value of an Ok', () => {
    expect(map(parseEven(8), half)).toEqual(ok(4));
  });

  test('passes an Err through untouched', () => {
    const e = parseEven(7);
    expect(map(e, half)).toBe(e);
  });

  test('can change the value type', () => {
    const r: Result<string, string> = map(parseEven(2), (n) => `n=${String(n)}`);
    expect(r).toEqual(ok('n=2'));
  });
});

describe('mapErr', () => {
  test('transforms the error of an Err', () => {
    expect(mapErr(parseEven(7), (e) => e.toUpperCase())).toEqual(err('7 IS ODD'));
  });

  test('passes an Ok through untouched', () => {
    const o = parseEven(6);
    expect(mapErr(o, (e) => e.toUpperCase())).toBe(o);
  });
});

describe('andThen', () => {
  const halveIfEven = (n: number): Result<number, string> => map(parseEven(n), half);

  test('chains a second fallible step on an Ok', () => {
    expect(andThen(parseEven(8), halveIfEven)).toEqual(ok(4));
    expect(andThen(andThen(parseEven(6), halveIfEven), halveIfEven)).toEqual(err('3 is odd'));
  });

  test('short-circuits on the first Err without calling f', () => {
    const e = parseEven(5);
    const neverCalled = (): Result<number, string> => {
      throw new Error('f must not be called on an Err');
    };
    expect(andThen(e, neverCalled)).toBe(e);
  });

  test('a pipeline reads left to right', () => {
    const r = andThen(andThen(parseEven(16), halveIfEven), halveIfEven);
    expect(r).toEqual(ok(4));
  });
});

describe('unwrapOr', () => {
  test('returns the value of an Ok', () => {
    expect(unwrapOr(parseEven(2), -1)).toBe(2);
  });

  test('returns the fallback for an Err', () => {
    expect(unwrapOr(parseEven(3), -1)).toBe(-1);
  });
});
