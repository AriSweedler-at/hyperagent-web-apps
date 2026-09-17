// localStorage behind Result (docs/ARCHITECTURE.md "Module boundaries": `storage.ts` and
// `app/effects.ts` are the only modules that touch it, and every read goes through a decoder).
// The browser throws on access in private windows and when quota is exhausted; the legacy pages
// swallow that with try/catch and carry on. Here the failure is a value the caller sees.
import { err, ok, type Result } from '../lib/result.ts';
import { formatError, type Decoder } from '../lib/json.ts';

/** The three members of `Storage` this module uses; a `Map`-backed fake satisfies it in tests. */
export type StorageLike = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}>;

export type StorageError =
  /** No value under the key. */
  | Readonly<{ kind: 'missing'; key: string }>
  /** The value is there but is not JSON, or the decoder rejected it. */
  | Readonly<{ kind: 'invalid'; key: string; reason: string }>
  /** The storage itself threw (private window, quota, disabled). */
  | Readonly<{ kind: 'unavailable'; key: string; reason: string }>;

export type Store = Readonly<{
  /** The raw string under `key`. */
  readText: (key: string) => Result<string, StorageError>;
  /** JSON.parse the string under `key`, then run it through `decoder`. */
  readJson: <T>(key: string, decoder: Decoder<T>) => Result<T, StorageError>;
  writeText: (key: string, value: string) => Result<null, StorageError>;
  /** JSON.stringify `value` and store it. */
  writeJson: (key: string, value: unknown) => Result<null, StorageError>;
  remove: (key: string) => Result<null, StorageError>;
}>;

const reasonOf = (e: unknown): string =>
  e instanceof Error ? (e.message !== '' ? e.message : e.name) : String(e);

/** A Store over any StorageLike. Nothing here throws. */
export const createStore = (storage: StorageLike): Store => {
  const guard = <T>(key: string, action: () => T): Result<T, StorageError> => {
    try {
      return ok(action());
    } catch (e) {
      return err({ kind: 'unavailable', key, reason: reasonOf(e) });
    }
  };

  const readText: Store['readText'] = (key) => {
    const raw = guard(key, () => storage.getItem(key));
    if (!raw.ok) return raw;
    return raw.value === null ? err({ kind: 'missing', key }) : ok(raw.value);
  };

  const parse = (key: string, text: string): Result<unknown, StorageError> => {
    try {
      return ok(JSON.parse(text) as unknown);
    } catch (e) {
      return err({ kind: 'invalid', key, reason: reasonOf(e) });
    }
  };

  const readJson: Store['readJson'] = (key, decoder) => {
    const text = readText(key);
    if (!text.ok) return text;
    const parsed = parse(key, text.value);
    if (!parsed.ok) return parsed;
    const decoded = decoder(parsed.value);
    return decoded.ok ? decoded : err({ kind: 'invalid', key, reason: formatError(decoded.error) });
  };

  const writeText: Store['writeText'] = (key, value) =>
    guard(key, () => {
      storage.setItem(key, value);
      return null;
    });

  const writeJson: Store['writeJson'] = (key, value) => {
    const text = guard(key, () => JSON.stringify(value));
    if (!text.ok) return text;
    // JSON.stringify(undefined) and functions yield undefined; nothing sensible to store.
    if (typeof text.value !== 'string')
      return err({ kind: 'invalid', key, reason: 'not serialisable' });
    return writeText(key, text.value);
  };

  const remove: Store['remove'] = (key) =>
    guard(key, () => {
      storage.removeItem(key);
      return null;
    });

  return { readText, readJson, writeText, writeJson, remove };
};

/** A Store that reports every key as unavailable: for pages where `localStorage` is not there. */
export const unavailableStore = (reason: string): Store => {
  const fail = (key: string): Result<never, StorageError> =>
    err({ kind: 'unavailable', key, reason });
  return {
    readText: fail,
    readJson: fail,
    writeText: fail,
    writeJson: fail,
    remove: fail,
  };
};

/** The page's localStorage as a Store, or an unavailable one when even naming it throws. */
export const browserStore = (): Store => {
  try {
    const storage = (globalThis as Readonly<{ localStorage?: StorageLike }>).localStorage;
    return storage === undefined ? unavailableStore('no localStorage') : createStore(storage);
  } catch (e) {
    return unavailableStore(reasonOf(e));
  }
};
