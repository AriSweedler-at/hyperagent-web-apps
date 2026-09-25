import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../shared/lib/rng.ts';
import { createGame } from './engine/index.ts';
import {
  ALL_KEYS,
  CURTAIN_MODES,
  DEFAULT_CURTAIN_MODE,
  DEFAULT_HOME_TAB,
  DEFAULT_MATCH_LENGTH,
  DEFAULT_PLAY_MODE,
  DEFAULT_SOUND_FONT,
  DEFAULT_VARIANT,
  HOME_TABS,
  MATCH_LENGTHS,
  NAME_MAX,
  PLAY_MODES,
  SHIPPED_VARIANTS,
  SOUND_FONTS,
  SOUND_STATES,
  STORAGE_KEYS,
  clearSave,
  readCurtainMode,
  readHomeTab,
  readMatchLength,
  readName,
  readP2Name,
  readPlayMode,
  readSave,
  readRecentGames,
  readSoundFont,
  readSoundState,
  readVariant,
  soundEnabled,
  writeCurtainMode,
  writeHomeTab,
  writeMatchLength,
  writeName,
  writeP2Name,
  writePlayMode,
  writeSave,
  writeRecentGames,
  writeSoundFont,
  appendRecentGame,
  writeSoundState,
  writeVariant,
} from './storage.ts';

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

const game = createGame(
  [
    { id: 'p1', name: 'Ann' },
    { id: 'p2', name: 'Bob' },
  ],
  { matchLength: 5, rotation: ['portes'] },
  mulberry32(1),
  () => 1_700_000_000_000,
);

describe('frozen constants', () => {
  test('the eleven keys, the tabs, modes, sound states, curtain modes, the engine defaults and the name cap', () => {
    expect(ALL_KEYS).toEqual([
      'backgammonMP_v1',
      'backgammon_name',
      'backgammon_p2Name',
      'backgammon_homeTab',
      'backgammon_playMode',
      'backgammon_sound',
      'backgammon_soundFont',
      'backgammon_recentGames',
      'backgammon_variant',
      'backgammon_matchLength',
      'backgammon_curtain',
    ]);
    // Nothing of gin's: the two games on one origin never read each other's keys.
    ALL_KEYS.forEach((key) => {
      expect(key.startsWith('backgammon')).toBe(true);
    });
    expect(HOME_TABS).toEqual(['play', 'rules', 'about']);
    expect(DEFAULT_HOME_TAB).toBe('play');
    expect(PLAY_MODES).toEqual(['online', 'local']);
    expect(DEFAULT_PLAY_MODE).toBe('online');
    expect(SOUND_STATES).toEqual(['on', 'off']);
    expect(CURTAIN_MODES).toEqual(['always', 'never']);
    expect(DEFAULT_CURTAIN_MODE).toBe('always');
    expect(SOUND_FONTS).toEqual(['default', 'felt', 'arcade']);
    expect(DEFAULT_SOUND_FONT).toBe('default');
    expect(SHIPPED_VARIANTS).toEqual(['portes', 'backgammon']);
    expect(DEFAULT_VARIANT).toBe('portes');
    expect(MATCH_LENGTHS).toEqual([1, 3, 5, 7]);
    expect(DEFAULT_MATCH_LENGTH).toBe(5);
    expect(NAME_MAX).toBe(20);
  });
});

describe('the finished games (the owner`s history, 2026-09-25)', () => {
  test('a JSON list under the game`s own key, newest first; a missing or foreign value reads as none', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(STORAGE_KEYS.recentGames).toBe('backgammon_recentGames');
    expect(readRecentGames(store)).toEqual([]);
    const first = {
      at: 1_700_000_000_000,
      mode: 'local' as const,
      players: ['Ann', 'Bob'],
      score: '5–0',
      winner: 0,
      outcome: 'win' as const,
    };
    const second = { ...first, at: first.at + 1, winner: 1, outcome: 'loss' as const };
    expect(appendRecentGame(store, first).ok).toBe(true);
    expect(appendRecentGame(store, second).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.recentGames)).toBe(JSON.stringify([second, first]));
    expect(readRecentGames(store)).toEqual([second, first]);
    expect(writeRecentGames(store, [first]).ok).toBe(true);
    expect(readRecentGames(store)).toEqual([first]);
    s.setItem(STORAGE_KEYS.recentGames, '{"not":"a list"}');
    expect(readRecentGames(store)).toEqual([]);
  });
});

describe('the game save', () => {
  test('each role writes its literal and reads back equal, whatever key order it had', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(writeSave(store, { game, role: 'local' })).toEqual({ ok: true, value: null });
    expect(s.map.get(STORAGE_KEYS.save)).toBe(JSON.stringify({ role: 'local', game }));
    expect(readSave(store)).toEqual({ ok: true, value: { role: 'local', game } });

    const host = {
      oppName: null,
      game: null,
      variant: 'backgammon',
      matchLength: 7,
      myName: 'Ann',
      code: 'LRZL',
      role: 'host',
    } as const;
    expect(writeSave(store, host).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.save)).toBe(
      '{"role":"host","code":"LRZL","myName":"Ann","matchLength":7,"variant":"backgammon","game":null,"oppName":null}',
    );
    expect(readSave(store)).toEqual({ ok: true, value: host });

    expect(writeSave(store, { myName: 'Jeff', code: 'KQZM', role: 'guest' }).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.save)).toBe('{"role":"guest","code":"KQZM","myName":"Jeff"}');
    expect(readSave(store)).toEqual({
      ok: true,
      value: { role: 'guest', code: 'KQZM', myName: 'Jeff' },
    });

    expect(clearSave(store)).toEqual({ ok: true, value: null });
    expect(readSave(store)).toEqual({
      ok: false,
      error: { kind: 'missing', key: STORAGE_KEYS.save },
    });
  });

  test('a host save with a game and an opponent round-trips too', () => {
    const store = createStore(fakeStorage());
    const save = {
      role: 'host',
      code: 'ABCD',
      myName: 'Ann',
      matchLength: 5,
      variant: 'portes',
      game,
      oppName: 'Jeff',
    } as const;
    expect(writeSave(store, save).ok).toBe(true);
    expect(readSave(store)).toEqual({ ok: true, value: save });
  });

  test.each<[string, string, string]>([
    [
      'a malformed code',
      '{"role":"host","code":"AB1D","myName":"Ann","matchLength":5,"variant":"portes","game":null,"oppName":null}',
      '$.code: expected a 4-letter room code',
    ],
    [
      'an unshipped variant',
      '{"role":"host","code":"ABCD","myName":"Ann","matchLength":5,"variant":"plakoto","game":null,"oppName":null}',
      '$.variant: expected one of "portes" | "backgammon"',
    ],
    [
      'a match length below one',
      '{"role":"host","code":"ABCD","myName":"Ann","matchLength":0,"variant":"portes","game":null,"oppName":null}',
      '$.matchLength: expected integer in [1, 9007199254740991]',
    ],
    [
      "gin's target field in place of the match",
      '{"role":"host","code":"ABCD","myName":"Ann","target":100,"game":null,"oppName":null}',
      '$.matchLength: expected integer in [1, 9007199254740991]',
    ],
    [
      'an unknown role',
      '{"role":"spectator"}',
      '$.role: expected one of "local" | "host" | "guest"',
    ],
    ['a local save without a game', '{"role":"local"}', '$.game: expected object'],
  ])('refuses %s', (_label, text, reason) => {
    const s = fakeStorage();
    s.setItem(STORAGE_KEYS.save, text);
    expect(readSave(createStore(s))).toEqual({
      ok: false,
      error: { kind: 'invalid', key: STORAGE_KEYS.save, reason },
    });
  });
});

describe('the bare-string preferences', () => {
  test('the name is stored cut to 20 and removed when empty; an empty stored name is refused', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(writeName(store, 'Ann')).toEqual({ ok: true, value: null });
    expect(s.map.get(STORAGE_KEYS.name)).toBe('Ann');
    expect(readName(store)).toEqual({ ok: true, value: 'Ann' });
    expect(writeName(store, 'abcdefghijklmnopqrstuvwxyz').ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.name)).toBe('abcdefghijklmnopqrst');
    expect(writeName(store, '')).toEqual({ ok: true, value: null });
    expect(s.map.has(STORAGE_KEYS.name)).toBe(false);
    s.setItem(STORAGE_KEYS.name, '');
    expect(readName(store)).toEqual({
      ok: false,
      error: { kind: 'invalid', key: STORAGE_KEYS.name, reason: '$: expected a non-empty name' },
    });
  });

  test('the second name round-trips under its own key by the same rule', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(writeP2Name(store, 'Bob')).toEqual({ ok: true, value: null });
    expect(s.map.get(STORAGE_KEYS.p2Name)).toBe('Bob');
    expect(readP2Name(store)).toEqual({ ok: true, value: 'Bob' });
    // The first name's key is untouched: the two are remembered apart.
    expect(s.map.has(STORAGE_KEYS.name)).toBe(false);
    expect(writeP2Name(store, 'abcdefghijklmnopqrstuvwxyz').ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.p2Name)).toBe('abcdefghijklmnopqrst');
    expect(writeP2Name(store, '')).toEqual({ ok: true, value: null });
    expect(s.map.has(STORAGE_KEYS.p2Name)).toBe(false);
  });

  test('home tab and play mode write the literal and read back; garbage is refused', () => {
    const s = fakeStorage();
    const store = createStore(s);
    HOME_TABS.forEach((tab) => {
      expect(writeHomeTab(store, tab).ok).toBe(true);
      expect(s.map.get(STORAGE_KEYS.homeTab)).toBe(tab);
      expect(readHomeTab(store)).toEqual({ ok: true, value: tab });
    });
    PLAY_MODES.forEach((mode) => {
      expect(writePlayMode(store, mode).ok).toBe(true);
      expect(s.map.get(STORAGE_KEYS.playMode)).toBe(mode);
      expect(readPlayMode(store)).toEqual({ ok: true, value: mode });
    });
    s.setItem(STORAGE_KEYS.homeTab, 'Play');
    expect(readHomeTab(store).ok).toBe(false);
    // Gin's third tab is not one of ours.
    s.setItem(STORAGE_KEYS.homeTab, 'score');
    expect(readHomeTab(store)).toEqual({
      ok: false,
      error: {
        kind: 'invalid',
        key: STORAGE_KEYS.homeTab,
        reason: '$: expected one of "play" | "rules" | "about"',
      },
    });
  });

  test('sound: on unless the key says off, including when the key is missing or garbage', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(soundEnabled(store)).toBe(true);
    expect(writeSoundState(store, 'off').ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.sound)).toBe('off');
    expect(readSoundState(store)).toEqual({ ok: true, value: 'off' });
    expect(soundEnabled(store)).toBe(false);
    expect(writeSoundState(store, 'on').ok).toBe(true);
    expect(soundEnabled(store)).toBe(true);
    s.setItem(STORAGE_KEYS.sound, 'OFF');
    expect(readSoundState(store).ok).toBe(false);
    expect(soundEnabled(store)).toBe(true);
  });

  test('the sound font round-trips as a bare string; a missing or unknown value reads as an error', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(readSoundFont(store)).toEqual({
      ok: false,
      error: { kind: 'missing', key: STORAGE_KEYS.soundFont },
    });
    SOUND_FONTS.forEach((font) => {
      expect(writeSoundFont(store, font).ok).toBe(true);
      expect(s.map.get(STORAGE_KEYS.soundFont)).toBe(font);
      expect(readSoundFont(store)).toEqual({ ok: true, value: font });
    });
    s.setItem(STORAGE_KEYS.soundFont, 'plaid');
    expect(readSoundFont(store)).toEqual({
      ok: false,
      error: {
        kind: 'invalid',
        key: STORAGE_KEYS.soundFont,
        reason: '$: expected one of "default" | "felt" | "arcade"',
      },
    });
  });

  test('the variant round-trips over the shipped literals only', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(readVariant(store)).toEqual({
      ok: false,
      error: { kind: 'missing', key: STORAGE_KEYS.variant },
    });
    SHIPPED_VARIANTS.forEach((variant) => {
      expect(writeVariant(store, variant).ok).toBe(true);
      expect(s.map.get(STORAGE_KEYS.variant)).toBe(variant);
      expect(readVariant(store)).toEqual({ ok: true, value: variant });
    });
    ['plakoto', 'fevga', 'Portes', ''].forEach((bad) => {
      s.setItem(STORAGE_KEYS.variant, bad);
      expect(readVariant(store)).toEqual({
        ok: false,
        error: {
          kind: 'invalid',
          key: STORAGE_KEYS.variant,
          reason: '$: expected one of "portes" | "backgammon"',
        },
      });
    });
  });

  test('the match length is stored as its digits and read back as one of 1, 3, 5, 7', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(readMatchLength(store)).toEqual({
      ok: false,
      error: { kind: 'missing', key: STORAGE_KEYS.matchLength },
    });
    MATCH_LENGTHS.forEach((length) => {
      expect(writeMatchLength(store, length).ok).toBe(true);
      expect(s.map.get(STORAGE_KEYS.matchLength)).toBe(String(length));
      expect(readMatchLength(store)).toEqual({ ok: true, value: length });
    });
    ['2', '05', '5.0', 'five', '', '9'].forEach((bad) => {
      s.setItem(STORAGE_KEYS.matchLength, bad);
      expect(readMatchLength(store)).toEqual({
        ok: false,
        error: {
          kind: 'invalid',
          key: STORAGE_KEYS.matchLength,
          reason: '$: expected one of 1 | 3 | 5 | 7',
        },
      });
    });
  });

  test('the curtain mode round-trips; garbage is refused', () => {
    const s = fakeStorage();
    const store = createStore(s);
    CURTAIN_MODES.forEach((mode) => {
      expect(writeCurtainMode(store, mode).ok).toBe(true);
      expect(s.map.get(STORAGE_KEYS.curtain)).toBe(mode);
      expect(readCurtainMode(store)).toEqual({ ok: true, value: mode });
    });
    s.setItem(STORAGE_KEYS.curtain, 'sometimes');
    expect(readCurtainMode(store)).toEqual({
      ok: false,
      error: {
        kind: 'invalid',
        key: STORAGE_KEYS.curtain,
        reason: '$: expected one of "always" | "never"',
      },
    });
  });
});

describe('the handoff mark on a host save', () => {
  test('is written only when true, after the other keys, and reads back; a save without it is unchanged', () => {
    const s = fakeStorage();
    const store = createStore(s);
    const handed = {
      role: 'host',
      code: 'ABCD',
      myName: 'Ann',
      matchLength: 5,
      variant: 'portes',
      game,
      oppName: 'Bob',
      handoff: true,
    } as const;
    expect(writeSave(store, handed).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.save)).toBe(
      `{"role":"host","code":"ABCD","myName":"Ann","matchLength":5,"variant":"portes","game":${JSON.stringify(game)},"oppName":"Bob","handoff":true}`,
    );
    expect(readSave(store)).toEqual({ ok: true, value: handed });
    const plain = {
      role: 'host',
      code: 'ABCD',
      myName: 'Ann',
      matchLength: 5,
      variant: 'portes',
      game,
      oppName: 'Bob',
    } as const;
    expect(writeSave(store, plain).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.save)).toBe(
      `{"role":"host","code":"ABCD","myName":"Ann","matchLength":5,"variant":"portes","game":${JSON.stringify(game)},"oppName":"Bob"}`,
    );
    expect(readSave(store)).toEqual({ ok: true, value: plain });
    // Anything but `true` under the key is refused.
    s.map.set(
      STORAGE_KEYS.save,
      '{"role":"host","code":"ABCD","myName":"Ann","matchLength":5,"variant":"portes","game":null,"oppName":null,"handoff":false}',
    );
    expect(readSave(store)).toEqual({
      ok: false,
      error: { kind: 'invalid', key: STORAGE_KEYS.save, reason: '$.handoff: expected one of true' },
    });
  });
});
