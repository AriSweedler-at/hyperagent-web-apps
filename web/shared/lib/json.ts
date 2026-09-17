// Decoders: `unknown` in, `Result` out, never an exception. Every inbound wire frame and every
// localStorage payload passes one of these before the program trusts its shape
// (docs/ARCHITECTURE.md "Module boundaries": protocol.ts is the trust boundary). Combinators
// compose from the leaves up; `object` copies only the declared keys onto a fresh literal, so a
// hostile `__proto__` or `constructor` key in the input never reaches the decoded value.
import { err, ok, type Result } from './result.ts';

export type DecodeError = Readonly<{
  /** Where in the input the mismatch is: keys for objects, indices for arrays, [] at the root. */
  path: ReadonlyArray<string | number>;
  /** What the decoder wanted there, e.g. `string`, `integer in [1, 6]`, `one of "a" | "b"`. */
  expected: string;
}>;

export type Decoder<T> = (input: unknown) => Result<T, DecodeError>;

/** Value type of a decoder, for spelling the output of `object` without repeating it. */
export type Decoded<D> = D extends Decoder<infer T> ? T : never;

const fail = (expected: string, path: ReadonlyArray<string | number> = []): DecodeError => ({
  path,
  expected,
});

const nested = (error: DecodeError, key: string | number): Result<never, DecodeError> =>
  err({ path: [key, ...error.path], expected: error.expected });

const show = (value: unknown): string =>
  typeof value === 'string' ? JSON.stringify(value) : String(value);

export const string: Decoder<string> = (input) =>
  typeof input === 'string' ? ok(input) : err(fail('string'));

export const boolean: Decoder<boolean> = (input) =>
  typeof input === 'boolean' ? ok(input) : err(fail('boolean'));

/** A finite number: NaN and the infinities are rejected, as JSON cannot carry them anyway. */
export const number: Decoder<number> = (input) =>
  typeof input === 'number' && Number.isFinite(input) ? ok(input) : err(fail('finite number'));

/** A safe integer within [min, max] (both inclusive); the bounds default to the safe range. */
export const integer = (
  min: number = Number.MIN_SAFE_INTEGER,
  max: number = Number.MAX_SAFE_INTEGER,
): Decoder<number> => {
  const expected = `integer in [${String(min)}, ${String(max)}]`;
  return (input) =>
    typeof input === 'number' && Number.isSafeInteger(input) && input >= min && input <= max
      ? ok(input)
      : err(fail(expected));
};

/** Exactly one of the given primitive values; the output type is their union. */
export const literal = <const L extends ReadonlyArray<string | number | boolean | null>>(
  ...values: L
): Decoder<L[number]> => {
  const expected = `one of ${values.map(show).join(' | ')}`;
  const isMember = (input: unknown): input is L[number] => values.some((v) => v === input);
  return (input) => (isMember(input) ? ok(input) : err(fail(expected)));
};

/** An array whose every element satisfies `item`; the first failing index is reported. */
export const arrayOf =
  <T>(item: Decoder<T>): Decoder<ReadonlyArray<T>> =>
  (input) => {
    if (!Array.isArray(input)) return err(fail('array'));
    const items: ReadonlyArray<unknown> = input;
    return items.reduce<Result<ReadonlyArray<T>, DecodeError>>((acc, element, index) => {
      if (!acc.ok) return acc;
      const decoded = item(element);
      return decoded.ok ? ok([...acc.value, decoded.value]) : nested(decoded.error, index);
    }, ok([]));
  };

/** Accepts `undefined` (a missing field) in addition to whatever `inner` accepts. */
export const optional =
  <T>(inner: Decoder<T>): Decoder<T | undefined> =>
  (input) =>
    input === undefined ? ok(undefined) : inner(input);

/** Accepts `null` in addition to whatever `inner` accepts. */
export const nullable =
  <T>(inner: Decoder<T>): Decoder<T | null> =>
  (input) =>
    input === null ? ok(null) : inner(input);

const isRecord = (input: unknown): input is Readonly<Record<string, unknown>> =>
  typeof input === 'object' && input !== null && !Array.isArray(input);

/** Own, enumerable properties only: inherited members (and the prototype itself) are not data. */
const own = (record: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

/**
 * A plain object with the declared fields. Keys not declared are dropped, so the decoded value has
 * exactly the shape of `fields`; a field decoder that accepts `undefined` (see `optional`) makes
 * that key optional in the input. The output is built key by key on a fresh literal, never by
 * spreading the input.
 */
export const object =
  <F extends Readonly<Record<string, Decoder<unknown>>>>(
    fields: Readonly<F>,
  ): Decoder<Readonly<{ [K in keyof F]: Decoded<F[K]> }>> =>
  (input) => {
    if (!isRecord(input)) return err(fail('object'));
    const entries: ReadonlyArray<readonly [string, Decoder<unknown>]> = Object.entries(
      fields as Readonly<Record<string, Decoder<unknown>>>,
    );
    const decoded = entries.reduce<Result<ReadonlyArray<readonly [string, unknown]>, DecodeError>>(
      (acc, entry) => {
        if (!acc.ok) return acc;
        const [key, decoder] = entry;
        const field = decoder(own(input, key));
        return field.ok
          ? ok([...acc.value, [key, field.value] as const])
          : nested(field.error, key);
      },
      ok([]),
    );
    return decoded.ok
      ? ok(Object.fromEntries(decoded.value) as Readonly<{ [K in keyof F]: Decoded<F[K]> }>)
      : decoded;
  };

/** Post-process a decoded value; the mapping itself cannot fail. */
export const map =
  <T, U>(inner: Decoder<T>, f: (value: T) => U): Decoder<U> =>
  (input) => {
    const decoded = inner(input);
    return decoded.ok ? ok(f(decoded.value)) : decoded;
  };

/** Add a check to a decoder: `predicate` false fails with `expected` at the current path. */
export const refine =
  <T>(inner: Decoder<T>, predicate: (value: T) => boolean, expected: string): Decoder<T> =>
  (input) => {
    const decoded = inner(input);
    if (!decoded.ok) return decoded;
    return predicate(decoded.value) ? decoded : err(fail(expected));
  };

/** The first decoder that accepts the input wins; the error names every alternative. */
export const oneOf =
  <T>(...alternatives: ReadonlyArray<Decoder<T>>): Decoder<T> =>
  (input) => {
    const results = alternatives.map((decode) => decode(input));
    const hit = results.find((r) => r.ok);
    if (hit !== undefined) return hit;
    const expected = results
      .filter((r) => !r.ok)
      .map((r) => r.error.expected)
      .join(' or ');
    return err(fail(expected === '' ? 'nothing (no alternatives)' : expected));
  };

/** `$.players[2].name: expected string`, for logs and toasts. */
export const formatError = (error: DecodeError): string => {
  const path = error.path
    .map((step) => (typeof step === 'number' ? `[${String(step)}]` : `.${step}`))
    .join('');
  return `$${path}: expected ${error.expected}`;
};
