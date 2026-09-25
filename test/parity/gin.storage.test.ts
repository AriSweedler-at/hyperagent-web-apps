// storage.ts against the payloads a real legacy session wrote (docs/MIGRATION.md step 11): every
// capture in test/fixtures/legacy/gin-storage decodes through the reader for its key, and writing
// the decoded value back produces the captured string byte for byte. Garbage under each key is
// refused (a legacy page would have swallowed it or misbehaved; the reader says so instead).
import { describe, expect, test } from 'vitest';

import type { Capture } from '../../tools/legacy/capture-gin-storage.ts';
import {
  STORAGE_KEYS,
  readHomeTab,
  readName,
  readPlayMode,
  readSave,
  readScorerState,
  readSoundState,
  soundEnabled,
  writeHomeTab,
  writeName,
  writePlayMode,
  writeSave,
  writeScorerState,
  writeSoundState,
} from '../../web/games/gin-rummy/src/storage.ts';
import { createStore, type StorageLike, type Store } from '../../web/shared/edge/storage.ts';
import { storageCaptures } from './gin.fixtures.ts';

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

const captures = storageCaptures();
const label = (c: Capture): string => `${c.key}.${c.variant}`;

/** Read the key through its typed reader and write the value back; both as `unknown`. */
type RoundTrip = (
  store: Store,
) => Readonly<{ read: { ok: boolean; error?: unknown }; written: boolean }>;
const roundTrips: Readonly<Record<string, RoundTrip>> = {
  [STORAGE_KEYS.save]: (store) => {
    const read = readSave(store);
    return { read, written: read.ok && writeSave(store, read.value).ok };
  },
  [STORAGE_KEYS.name]: (store) => {
    const read = readName(store);
    return { read, written: read.ok && writeName(store, read.value).ok };
  },
  [STORAGE_KEYS.homeTab]: (store) => {
    const read = readHomeTab(store);
    return { read, written: read.ok && writeHomeTab(store, read.value).ok };
  },
  [STORAGE_KEYS.playMode]: (store) => {
    const read = readPlayMode(store);
    return { read, written: read.ok && writePlayMode(store, read.value).ok };
  },
  [STORAGE_KEYS.sound]: (store) => {
    const read = readSoundState(store);
    return { read, written: read.ok && writeSoundState(store, read.value).ok };
  },
  [STORAGE_KEYS.scorerState]: (store) => {
    const read = readScorerState(store);
    return { read, written: read.ok && writeScorerState(store, read.value).ok };
  },
};

describe('the captured legacy payloads', () => {
  test('cover all seven legacy keys, the three save roles and both sound states', () => {
    // `ginRummy_p2Name`, `ginRummy_sort`, `ginRummy_cardPack`, `ginRummy_soundFont` and
    // `ginRummy_recentGames` are this page's own keys: the legacy never stored the second name, an
    // arrangement, a pack, a font or a finished game, so no capture exists for them. `ginRummy_scorerNames` is
    // retired (the Score Counter scores the two pass-and-play names): its capture stays as the
    // record of what the legacy wrote, and nothing reads it.
    const ours: ReadonlyArray<string> = [
      STORAGE_KEYS.p2Name,
      STORAGE_KEYS.sort,
      STORAGE_KEYS.cardPack,
      STORAGE_KEYS.soundFont,
      STORAGE_KEYS.recentGames,
    ];
    const retired: ReadonlyArray<string> = ['ginRummy_scorerNames'];
    const legacyKeys = Object.values(STORAGE_KEYS).filter((k) => !ours.includes(k));
    expect(legacyKeys).toHaveLength(6);
    expect(new Set(captures.map((c) => c.key).filter((k) => !retired.includes(k)))).toEqual(
      new Set(legacyKeys),
    );
    const roles = captures
      .filter((c) => c.key === STORAGE_KEYS.save)
      .map((c) => (JSON.parse(c.raw) as { role: string }).role);
    expect(new Set(roles)).toEqual(new Set(['local', 'host', 'guest']));
    expect(
      captures
        .filter((c) => c.key === STORAGE_KEYS.sound)
        .map((c) => c.raw)
        .sort(),
    ).toEqual(['off', 'on']);
  });

  test.each(
    captures.filter((c) => c.key !== 'ginRummy_scorerNames').map((c) => [label(c), c] as const),
  )('%s decodes through its reader and writes back byte for byte', (_name, c) => {
    const storage = fakeStorage();
    storage.setItem(c.key, c.raw);
    const trip = roundTrips[c.key];
    expect(trip).toBeDefined();
    if (trip === undefined) return;
    const { read, written } = trip(createStore(storage));
    expect(read.ok, JSON.stringify(read.error)).toBe(true);
    expect(written).toBe(true);
    expect(storage.map.get(c.key)).toBe(c.raw);
    expect([...storage.map.keys()]).toEqual([c.key]);
  });

  test('the sound captures read as the legacy `!== "off"` did', () => {
    captures
      .filter((c) => c.key === STORAGE_KEYS.sound)
      .forEach((c) => {
        const storage = fakeStorage();
        storage.setItem(c.key, c.raw);
        expect(soundEnabled(createStore(storage))).toBe(c.raw !== 'off');
      });
  });
});

describe('garbage under each key is refused with the key and the reason', () => {
  const garbage: ReadonlyArray<readonly [string, string, string]> = [
    [
      STORAGE_KEYS.save,
      '{"role":"observer"}',
      '$.role: expected one of "local" | "host" | "guest"',
    ],
    [STORAGE_KEYS.save, '{"role":"local"}', '$.game: expected object'],
    [
      STORAGE_KEYS.save,
      '{"role":"host","code":"AB","myName":"x","target":1,"game":null,"oppName":null}',
      '$.code: expected a 4-letter room code',
    ],
    [STORAGE_KEYS.save, '{"role":"guest","code":"ABCD"}', '$.myName: expected string'],
    [STORAGE_KEYS.save, 'not json', 'Unexpected token'],
    [STORAGE_KEYS.name, '', '$: expected a non-empty name'],
    [STORAGE_KEYS.homeTab, 'settings', '$: expected one of "play" | "rules" | "score"'],
    [STORAGE_KEYS.playMode, 'bots', '$: expected one of "online" | "local"'],
    [STORAGE_KEYS.sound, 'loud', '$: expected one of "on" | "off"'],
    [
      STORAGE_KEYS.scorerState,
      '{"players":[{"id":"a","name":"A"}],"target":100,"rounds":[],"startedAt":1}',
      '$.players: expected at least two players',
    ],
    [
      STORAGE_KEYS.scorerState,
      '{"players":[{"id":"a","name":"A"},{"id":"b","name":"B"}],"target":100,"rounds":[{"deadwood":{"a":-1},"knockerId":"a","knockType":"knock","scores":{},"ts":1}],"startedAt":1}',
      '$.rounds[0].deadwood.a: expected integer in [0,',
    ],
    [
      STORAGE_KEYS.scorerState,
      '{"players":[{"id":"a","name":"A"},{"id":"b","name":"B"}],"target":100,"rounds":[{"deadwood":{},"knockerId":"a","knockType":"undercut","scores":{},"ts":1}],"startedAt":1}',
      '$.rounds[0].knockType: expected one of "knock" | "gin"',
    ],
  ];

  test.each(garbage.map(([key, raw, reason]) => [key, raw, reason] as const))(
    '%s <- %s',
    (key, raw, reason) => {
      const storage = fakeStorage();
      storage.setItem(key, raw);
      const trip = roundTrips[key];
      if (trip === undefined) throw new Error(key);
      const { read } = trip(createStore(storage));
      expect(read.ok).toBe(false);
      expect(read.error).toMatchObject({ kind: 'invalid', key });
      expect((read.error as { reason: string }).reason).toContain(reason);
      // Nothing was written back.
      expect(storage.map.get(key)).toBe(raw);
    },
  );

  test('a missing key is reported as missing, not invalid', () => {
    const store = createStore(fakeStorage());
    Object.values(roundTrips).forEach((trip) => {
      expect(trip(store).read).toMatchObject({ ok: false, error: { kind: 'missing' } });
    });
    expect(soundEnabled(store)).toBe(true);
  });
});
