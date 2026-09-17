import { afterEach, describe, expect, test, vi } from 'vitest';

import { integer, object, string } from '../lib/json.ts';
import { err, ok } from '../lib/result.ts';
import { browserStore, createStore, unavailableStore, type StorageLike } from './storage.ts';

const fakeStorage = (): StorageLike & Readonly<{ map: Map<string, string> }> => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
};

const throwing = (message: string): StorageLike => ({
  getItem: () => {
    throw new DOMException(message, 'SecurityError');
  },
  setItem: () => {
    throw new DOMException(message, 'QuotaExceededError');
  },
  removeItem: () => {
    throw new Error(message);
  },
});

const save = object({ name: string, target: integer(1) });

describe('createStore over a working storage', () => {
  test('text round-trips; a missing key is reported as such', () => {
    const store = createStore(fakeStorage());
    expect(store.readText('ginRummy_name')).toEqual(err({ kind: 'missing', key: 'ginRummy_name' }));
    expect(store.writeText('ginRummy_name', 'Ari')).toEqual(ok(null));
    expect(store.readText('ginRummy_name')).toEqual(ok('Ari'));
    expect(store.remove('ginRummy_name')).toEqual(ok(null));
    expect(store.readText('ginRummy_name')).toEqual(err({ kind: 'missing', key: 'ginRummy_name' }));
  });

  test('json round-trips through the decoder and stores the JSON text', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(store.writeJson('ginRummyMP_v1', { name: 'Ari', target: 100, extra: 1 })).toEqual(
      ok(null),
    );
    expect(s.map.get('ginRummyMP_v1')).toBe('{"name":"Ari","target":100,"extra":1}');
    expect(store.readJson('ginRummyMP_v1', save)).toEqual(ok({ name: 'Ari', target: 100 }));
  });

  test('legacy payloads written by hand decode too', () => {
    const s = fakeStorage();
    s.setItem('k', '{"target": 50, "name": "Jeff"}');
    expect(createStore(s).readJson('k', save)).toEqual(ok({ name: 'Jeff', target: 50 }));
  });

  test('a value that is not JSON is invalid with the parser message', () => {
    const s = fakeStorage();
    s.setItem('k', '{not json');
    const r = createStore(s).readJson('k', save);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('invalid');
      expect(r.error.key).toBe('k');
      expect(r.error).toMatchObject({ reason: expect.stringMatching(/JSON/) as string });
    }
  });

  test('a value the decoder rejects is invalid with the decode path', () => {
    const s = fakeStorage();
    s.setItem('k', '{"name": "Ari", "target": 0}');
    expect(createStore(s).readJson('k', save)).toEqual(
      err({
        kind: 'invalid',
        key: 'k',
        reason: '$.target: expected integer in [1, 9007199254740991]',
      }),
    );
  });

  test('readJson of a missing key is missing, not invalid', () => {
    expect(createStore(fakeStorage()).readJson('k', save)).toEqual(
      err({ kind: 'missing', key: 'k' }),
    );
  });

  test('writeJson refuses what JSON cannot carry', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(store.writeJson('k', undefined)).toEqual(
      err({ kind: 'invalid', key: 'k', reason: 'not serialisable' }),
    );
    expect(store.writeJson('k', () => 1)).toEqual(
      err({ kind: 'invalid', key: 'k', reason: 'not serialisable' }),
    );
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const r = store.writeJson('k', cyclic);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unavailable');
    expect(s.map.size).toBe(0);
  });
});

describe('createStore over a throwing storage', () => {
  const store = createStore(throwing('denied'));

  test('every operation is unavailable with the thrown message, nothing escapes', () => {
    expect(store.readText('k')).toEqual(err({ kind: 'unavailable', key: 'k', reason: 'denied' }));
    expect(store.readJson('k', save)).toEqual(
      err({ kind: 'unavailable', key: 'k', reason: 'denied' }),
    );
    expect(store.writeText('k', 'v')).toEqual(
      err({ kind: 'unavailable', key: 'k', reason: 'denied' }),
    );
    expect(store.writeJson('k', { a: 1 })).toEqual(
      err({ kind: 'unavailable', key: 'k', reason: 'denied' }),
    );
    expect(store.remove('k')).toEqual(err({ kind: 'unavailable', key: 'k', reason: 'denied' }));
  });

  test('an Error without a message reports its name; a non-Error is stringified', () => {
    const nameless = createStore({
      ...throwing('x'),
      getItem: () => {
        throw new RangeError('');
      },
    });
    expect(nameless.readText('k')).toEqual(
      err({ kind: 'unavailable', key: 'k', reason: 'RangeError' }),
    );
    const plain = createStore({
      ...throwing('x'),
      getItem: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- browsers do throw non-Errors here
        throw 'boom';
      },
    });
    expect(plain.readText('k')).toEqual(err({ kind: 'unavailable', key: 'k', reason: 'boom' }));
  });
});

describe('unavailableStore', () => {
  test('answers every call with the reason', () => {
    const store = unavailableStore('private window');
    expect(store.readText('a')).toEqual(
      err({ kind: 'unavailable', key: 'a', reason: 'private window' }),
    );
    expect(store.writeJson('b', 1)).toEqual(
      err({ kind: 'unavailable', key: 'b', reason: 'private window' }),
    );
    expect(store.remove('c')).toEqual(
      err({ kind: 'unavailable', key: 'c', reason: 'private window' }),
    );
  });
});

describe('browserStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('without a localStorage global it is unavailable', () => {
    expect(browserStore().readText('k')).toEqual(
      err({ kind: 'unavailable', key: 'k', reason: 'no localStorage' }),
    );
  });

  test('wraps the global when present', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const store = browserStore();
    expect(store.writeText('k', 'v')).toEqual(ok(null));
    expect(store.readText('k')).toEqual(ok('v'));
  });

  test('a getter that throws on access yields an unavailable store', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('access denied');
      },
    });
    try {
      expect(browserStore().readText('k')).toEqual(
        err({ kind: 'unavailable', key: 'k', reason: 'access denied' }),
      );
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, 'localStorage');
      else Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});
