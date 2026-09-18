// The storage fallback rules the header comment states, over two Stores; and the browser effects
// over stubbed globals (node has no `location`, `window` or `document`; `vi.stubGlobal` supplies
// the members each effect touches, so a call is checked, not only constructed).
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createStore,
  unavailableStore,
  type StorageLike,
} from '../../../../shared/edge/storage.ts';
import { FIDICE_CODE_ALPHABET } from '../../../../shared/lib/roomCode.ts';
import { CODE_ALPHABET, browserEffects, storageEffects } from './effects.ts';

type Counting = StorageLike & Readonly<{ map: Map<string, string>; reads: () => number }>;

const memory = (): Counting => {
  const map = new Map<string, string>();
  const count = { reads: 0 };
  return {
    map,
    reads: () => count.reads,
    getItem: (k) => {
      count.reads += 1;
      return map.get(k) ?? null;
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
};

/** Reads work; every write throws, as a full or private-window storage does. */
const readOnly = (): Counting => {
  const inner = memory();
  return {
    ...inner,
    setItem: () => {
      throw new DOMException('quota', 'QuotaExceededError');
    },
  };
};

describe('storageEffects', () => {
  test('a value in localStorage is returned without a look at sessionStorage', () => {
    const local = memory();
    const session = memory();
    local.map.set('fidice-name', 'Ari');
    session.map.set('fidice-name', 'Tyler');
    expect(storageEffects(createStore(local), createStore(session)).get('fidice-name')).toBe('Ari');
    expect(session.reads()).toBe(0);
  });

  test('a key missing from localStorage falls back to sessionStorage, then to null', () => {
    const local = memory();
    const session = memory();
    session.map.set('fidice-token-KEZAR', 'tok');
    const storage = storageEffects(createStore(local), createStore(session));
    expect(storage.get('fidice-token-KEZAR')).toBe('tok');
    expect(storage.get('fidice-name')).toBeNull();
    expect(session.reads()).toBe(2);
  });

  test('an unavailable localStorage yields null and sessionStorage is not consulted', () => {
    const session = memory();
    session.map.set('fidice-name', 'Tyler');
    const storage = storageEffects(unavailableStore('SecurityError'), createStore(session));
    expect(storage.get('fidice-name')).toBeNull();
    expect(session.reads()).toBe(0);
  });

  test('a write lands in localStorage alone when that works', () => {
    const local = memory();
    const session = memory();
    storageEffects(createStore(local), createStore(session)).set('fidice-name', 'Ari');
    expect(local.map.get('fidice-name')).toBe('Ari');
    expect(session.map.has('fidice-name')).toBe(false);
  });

  test('a failed localStorage write falls back to sessionStorage', () => {
    const local = readOnly();
    const session = memory();
    storageEffects(createStore(local), createStore(session)).set('fidice-name', 'Ari');
    expect(local.map.has('fidice-name')).toBe(false);
    expect(session.map.get('fidice-name')).toBe('Ari');
  });

  test('a write both storages refuse is dropped silently', () => {
    const storage = storageEffects(createStore(readOnly()), unavailableStore('none'));
    expect(() => {
      storage.set('fidice-name', 'Ari');
    }).not.toThrow();
    expect(storage.get('fidice-name')).toBeNull();
  });
});

describe('browserEffects', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const rngOf = (values: ReadonlyArray<number>): (() => number) => {
    const state = { i: 0 };
    return () => {
      const v = values[state.i % values.length] ?? 0;
      state.i += 1;
      return v;
    };
  };

  test('the code alphabet is the frozen shared one', () => {
    expect(CODE_ALPHABET).toBe(FIDICE_CODE_ALPHABET);
  });

  test('storage reads and writes go through localStorage, then sessionStorage', () => {
    const local = readOnly();
    const session = memory();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    const fx = browserEffects(rngOf([0.5]));
    fx.storage.set('fidice-name', 'Ari');
    expect(session.map.get('fidice-name')).toBe('Ari');
    expect(fx.storage.get('fidice-name')).toBe('Ari');
  });

  test('a page without either storage reads null and drops writes', () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    const fx = browserEffects(rngOf([0.5]));
    fx.storage.set('fidice-name', 'Ari');
    expect(fx.storage.get('fidice-name')).toBeNull();
  });

  test('a sessionStorage whose access throws is an unavailable store', () => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    const fx = browserEffects(rngOf([0.5]));
    fx.storage.set('fidice-name', 'Ari');
    expect(fx.storage.get('fidice-name')).toBeNull();
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  });

  test('random codes and ids come from the injected rng', () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    const code = browserEffects(rngOf([0, 0.5, 0.999])).randomCode();
    expect(code).toHaveLength(5);
    expect(code.split('').every((c) => FIDICE_CODE_ALPHABET.includes(c))).toBe(true);
    const id = browserEffects(rngOf([0.5, 0.999])).randomId();
    expect(id).toBe((0.5).toString(36).slice(2) + (0.999).toString(36).slice(2));
  });

  test('the clipboard resolves true on success and false when refused', async () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    const written: string[] = [];
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: (text: string) => {
          written.push(text);
          return text === 'no' ? Promise.reject(new Error('denied')) : Promise.resolve();
        },
      },
    });
    const fx = browserEffects(rngOf([0.5]));
    await expect(fx.copyToClipboard('https://x/#join=KEZAR')).resolves.toBe(true);
    await expect(fx.copyToClipboard('no')).resolves.toBe(false);
    expect(written).toEqual(['https://x/#join=KEZAR', 'no']);
  });

  test('hash, scrolling and confirm reach the page globals', () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    const loc = { hash: '#join=KEZAR' };
    const scrolled: (readonly [number, number])[] = [];
    const questions: string[] = [];
    const log = { scrollTop: 0, scrollHeight: 640, scrollIntoView: vi.fn() };
    const centered = { scrollTop: 0, scrollHeight: 10, scrollIntoView: vi.fn() };
    vi.stubGlobal('location', loc);
    vi.stubGlobal('window', {
      scrollTo: (x: number, y: number) => {
        scrolled.push([x, y]);
      },
      confirm: (q: string) => {
        questions.push(q);
        return false;
      },
    });
    vi.stubGlobal('document', {
      getElementById: (id: string) =>
        id === 'log' ? log : id === 'main-cat-pair' ? centered : null,
    });
    const fx = browserEffects(rngOf([0.5]));
    expect(fx.readHash()).toBe('#join=KEZAR');
    fx.setHash('');
    expect(loc.hash).toBe('');
    fx.scrollToTop();
    expect(scrolled).toEqual([[0, 0]]);
    fx.scrollToBottom('log');
    fx.scrollToBottom('spec-log');
    expect(log.scrollTop).toBe(640);
    fx.scrollIntoView('main-cat-pair');
    fx.scrollIntoView('missing');
    expect(centered.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(log.scrollIntoView).not.toHaveBeenCalled();
    expect(fx.confirm('Leave?')).toBe(false);
    expect(questions).toEqual(['Leave?']);
  });
});
