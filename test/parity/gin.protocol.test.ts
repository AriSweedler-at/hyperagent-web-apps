// The gin protocol against the recorded wire corpus (docs/MIGRATION.md step 11; docs/ARCHITECTURE.md
// "Testing pyramid", protocol): every recorded frame decodes on the side that receives it and
// re-encodes byte for byte, the outbound builder rebuilds it from the decoded fields to the same
// text, and the decoders survive fuzzing: seeded arbitrary and hostile inputs never throw, every
// required key removed is refused naming its path, every leaf replaced by a wrong type is refused,
// and prototype keys never reach a decoded frame.
import { describe, expect, test } from 'vitest';

import {
  action,
  decodeFrame,
  decodeGuestFrame,
  decodeHostFrame,
  full,
  join,
  lobby,
  state,
  toast,
  welcome,
  type Frame,
} from '../../web/games/gin-rummy/src/protocol.ts';
import { mulberry32, type Rng } from '../../web/shared/lib/rng.ts';
import { wireFrames, type WireFrame } from './gin.fixtures.ts';

const frames = wireFrames();
const GUEST_TAGS = ['join', 'action'];
const label = (f: WireFrame): string => `${f.file}[${String(f.index)}]`;

/** The builder that makes a frame like `frame`, from its decoded fields. */
const rebuild = (frame: Frame): Frame => {
  switch (frame.t) {
    case 'join':
      return join(frame.name);
    case 'action':
      return action(frame.action);
    case 'welcome':
      return welcome(frame.hostName, frame.target);
    case 'lobby':
      return lobby(frame.hostName, frame.target);
    case 'full':
      return full();
    case 'toast':
      return toast(frame.msg);
    case 'state':
      return state(frame.view);
  }
};

describe('the recorded corpus', () => {
  test('has frames of every tag', () => {
    expect(new Set(frames.map((f) => f.frame['t'])).size).toBe(7);
    expect(frames.length).toBeGreaterThan(60);
  });

  test.each(frames.map((f) => [label(f), f] as const))(
    '%s decodes on its side, re-encodes byte for byte and rebuilds through its builder',
    (_name, f) => {
      const text = JSON.stringify(f.frame);
      const decoded = decodeFrame(JSON.parse(text));
      expect(decoded.ok, decoded.ok ? '' : decoded.error).toBe(true);
      if (!decoded.ok) return;
      expect(JSON.stringify(decoded.value)).toBe(text);
      expect(JSON.stringify(rebuild(decoded.value))).toBe(text);
      const guest = decodeGuestFrame(JSON.parse(text));
      const host = decodeHostFrame(JSON.parse(text));
      if (GUEST_TAGS.includes(f.frame['t'] as string)) {
        expect(guest).toEqual(decoded);
        expect(host.ok).toBe(false);
      } else {
        expect(host).toEqual(decoded);
        expect(guest.ok).toBe(false);
      }
    },
  );
});

// ---- fuzzing -------------------------------------------------------------------------------

// An index signature, not Record<string, Json>: that alias would be circular.
type JsonObject = { [k: string]: Json };
type Json = null | boolean | number | string | Json[] | JsonObject;
const isObject = (x: Json): x is JsonObject =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Every path to a key of an object tree, root first. */
const keyPaths = (
  x: Json,
  prefix: ReadonlyArray<string | number> = [],
): ReadonlyArray<ReadonlyArray<string | number>> => {
  if (isObject(x)) {
    return Object.entries(x).flatMap(([k, v]) => [[...prefix, k], ...keyPaths(v, [...prefix, k])]);
  }
  if (Array.isArray(x)) return x.flatMap((v, i) => keyPaths(v, [...prefix, i]));
  return [];
};

/** A deep copy with the value at `path` replaced (`undefined` deletes the key). */
const withPath = (x: Json, path: ReadonlyArray<string | number>, value: Json | undefined): Json => {
  const [head, ...rest] = path;
  if (head === undefined) return value as Json;
  if (isObject(x) && typeof head === 'string') {
    const copy = { ...x };
    if (rest.length === 0 && value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- fuzzing: the key must go
      delete copy[head];
      return copy;
    }
    copy[head] = withPath(x[head] ?? null, rest, value);
    return copy;
  }
  if (Array.isArray(x) && typeof head === 'number') {
    return x.map((v, i) => (i === head ? withPath(v, rest, value) : v));
  }
  return x;
};

const valueAt = (x: Json, path: ReadonlyArray<string | number>): Json =>
  path.reduce<Json>((acc, step) => {
    if (isObject(acc) && typeof step === 'string') return acc[step] ?? null;
    if (Array.isArray(acc) && typeof step === 'number') return acc[step] ?? null;
    return null;
  }, x);

/** A value of a different JSON type than `v` (a number for null: many null leaves take a string). */
const wrongType = (v: Json): Json => {
  if (v === null) return 12345;
  if (typeof v === 'boolean') return 'true';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return 12345;
  if (Array.isArray(v)) return { length: v.length };
  return [v];
};

/** Keys the legacy engine leaves out at times (optional in the types): deleting them is fine. */
const OPTIONAL_LEAVES = new Set(['lastAction.card', 'lastAction.by']);
const isOptional = (path: ReadonlyArray<string | number>): boolean =>
  OPTIONAL_LEAVES.has(
    path
      .filter((s) => typeof s === 'string')
      .slice(-2)
      .join('.'),
  );

const pathText = (path: ReadonlyArray<string | number>): string =>
  path.map((s) => (typeof s === 'number' ? `[${String(s)}]` : `.${s}`)).join('');

describe('fuzzing the decoders over the corpus', () => {
  const sample = frames.filter((_, i) => i % 3 === 0);

  test('removing any required key is refused, and the error names a prefix of its path', () => {
    sample.forEach((f) => {
      const frame = f.frame as Json;
      keyPaths(frame)
        .filter((p) => typeof p.at(-1) === 'string')
        .forEach((path) => {
          const damaged = withPath(frame, path, undefined);
          const r = decodeFrame(damaged);
          if (isOptional(path)) {
            expect(r.ok, `${label(f)}${pathText(path)} removed`).toBe(true);
            return;
          }
          // A record's keys (discardOptions, deadwood/scores by id) may be dropped freely.
          const parent = pathText(path.slice(0, -1));
          if (/\.(discardOptions|deadwood|scores)$/.test(parent) && path.length > 2) {
            expect(r.ok, `${label(f)}${pathText(path)} removed`).toBe(true);
            return;
          }
          expect(r.ok, `${label(f)}${pathText(path)} removed should be refused`).toBe(false);
          if (r.ok) return;
          // The error points at the removed key or an enclosing oneOf alternative.
          const at = r.error.slice(0, r.error.indexOf(':'));
          expect(`$${pathText(path)}`.startsWith(at), `${r.error} for ${pathText(path)}`).toBe(
            true,
          );
        });
    });
  });

  test('replacing any leaf with a value of the wrong type is refused', () => {
    sample.forEach((f) => {
      const frame = f.frame as Json;
      keyPaths(frame)
        .filter((p) => {
          const v = valueAt(frame, p);
          return !isObject(v) && !Array.isArray(v);
        })
        .forEach((path) => {
          const damaged = withPath(frame, path, wrongType(valueAt(frame, path)));
          expect(decodeFrame(damaged).ok, `${label(f)}${pathText(path)} of the wrong type`).toBe(
            false,
          );
        });
    });
  });

  test('prototype keys anywhere are dropped from objects and refused in records', () => {
    sample.forEach((f) => {
      const text = JSON.stringify(f.frame);
      const polluted = JSON.parse(
        text.replace(/^\{/, '{"__proto__":{"polluted":true},'),
      ) as unknown;
      const r = decodeFrame(polluted);
      expect(r.ok).toBe(true);
      expect(r.ok && JSON.stringify(r.value)).toBe(text);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });
    const withOptions = frames.find(
      (f) =>
        f.frame['t'] === 'state' &&
        (f.frame['view'] as { discardOptions: unknown }).discardOptions !== null,
    );
    expect(withOptions).toBeDefined();
    if (withOptions === undefined) return;
    const view = withOptions.frame['view'] as { discardOptions: Record<string, unknown> };
    const hostile = JSON.parse(
      JSON.stringify({
        ...withOptions.frame,
        view: {
          ...view,
          discardOptions: JSON.parse('{"__proto__": {"locked": true}}') as unknown,
        },
      }),
    ) as unknown;
    expect(decodeFrame(hostile)).toEqual({
      ok: false,
      error: '$.view.discardOptions.__proto__: expected a key that is not a prototype member',
    });
  });

  const pick = <T>(rng: Rng, xs: ReadonlyArray<T>): T => {
    const x = xs[Math.floor(rng() * xs.length)];
    if (x === undefined) throw new Error('empty');
    return x;
  };
  const arbitrary = (rng: Rng, depth = 0): unknown => {
    const kind = pick(rng, [
      'str',
      'num',
      'bool',
      'null',
      'undef',
      'arr',
      'obj',
      'frame',
      'hostile',
      'fn',
      'sym',
      'big',
    ] as const);
    switch (kind) {
      case 'str':
        return pick(rng, [
          '',
          'join',
          'state',
          'AS',
          '__proto__',
          'x'.repeat(Math.floor(rng() * 40)),
        ]);
      case 'num':
        return pick(rng, [0, 1, -1, 2, 13, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e300]);
      case 'bool':
        return rng() < 0.5;
      case 'null':
        return null;
      case 'undef':
        return undefined;
      case 'fn':
        return () => 1;
      case 'sym':
        return Symbol('s');
      case 'big':
        return 10n;
      case 'arr':
        return depth > 2
          ? []
          : Array.from({ length: Math.floor(rng() * 3) }, () => arbitrary(rng, depth + 1));
      case 'obj':
        return depth > 2
          ? {}
          : Object.fromEntries(
              Array.from({ length: Math.floor(rng() * 4) }, () => [
                pick(rng, [
                  't',
                  'name',
                  'view',
                  'action',
                  'type',
                  'hostName',
                  'target',
                  'msg',
                  'cardId',
                  'melds',
                ]),
                arbitrary(rng, depth + 1),
              ]),
            );
      case 'frame':
        return {
          ...pick(rng, frames).frame,
          [pick(rng, ['t', 'name', 'view', 'action', 'x'])]: arbitrary(rng, depth + 1),
        };
      case 'hostile':
        return JSON.parse(
          '{"t":"join","name":"J","__proto__":{"p":1},"constructor":{"prototype":{}}}',
        ) as unknown;
    }
  };

  test('never throws on 3000 seeded arbitrary and hostile inputs, and an Ok is a well-formed frame', () => {
    const rng = mulberry32(2024);
    Array.from({ length: 3000 }, () => arbitrary(rng)).forEach((input) => {
      const r = decodeFrame(input);
      expect(typeof r.ok).toBe('boolean');
      if (r.ok) {
        expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype);
        expect(decodeFrame(JSON.parse(JSON.stringify(r.value)))).toEqual(r);
      }
      expect(typeof decodeGuestFrame(input).ok).toBe('boolean');
      expect(typeof decodeHostFrame(input).ok).toBe('boolean');
    });
  });
});
