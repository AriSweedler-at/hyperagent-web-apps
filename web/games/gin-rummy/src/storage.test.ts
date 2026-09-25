import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../shared/lib/rng.ts';
import { badCardBackMsg } from './cardBack.ts';
import { createGame } from './engine/index.ts';
import {
  ALL_KEYS,
  DEFAULT_HOME_TAB,
  DEFAULT_PLAY_MODE,
  CARD_BACKS,
  DEFAULT_CARD_BACK,
  DEFAULT_SOUND_FONT,
  SOUND_FONTS,
  DEFAULT_SORT,
  HOME_TABS,
  NAME_MAX,
  PLAY_MODES,
  RETIRED_KEYS,
  SORT_MODES,
  SOUND_STATES,
  STORAGE_KEYS,
  clearSave,
  migrateCardBack,
  readCardBack,
  readHomeTab,
  readName,
  readP2Name,
  readSave,
  readScorerState,
  readSort,
  readRecentGames,
  readSoundFont,
  readSoundState,
  soundEnabled,
  writeCardBack,
  writeHomeTab,
  writeName,
  writeP2Name,
  writePlayMode,
  writeSave,
  writeScorerState,
  writeSort,
  writeRecentGames,
  writeSoundFont,
  appendRecentGame,
  writeSoundState,
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
  {
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bob' },
    ],
    target: 100,
    dealer: 0,
  },
  mulberry32(1),
  () => 1_700_000_000_000,
);

describe('frozen constants', () => {
  test('the six kept legacy keys, the second name, the sort, the card pack, the sound font and the finished games, the tabs, modes, sound states and the name cap', () => {
    expect(ALL_KEYS).toEqual([
      'ginRummyMP_v1',
      'ginRummy_name',
      'ginRummy_p2Name',
      'ginRummy_homeTab',
      'ginRummy_playMode',
      'ginRummy_sound',
      'ginRummy_sort',
      'ginRummy_cardPack',
      'ginRummy_soundFont',
      'ginRummy_recentGames',
      'ginRummyScorerState_v2',
    ]);
    expect(HOME_TABS).toEqual(['play', 'rules', 'score', 'about']);
    expect(DEFAULT_HOME_TAB).toBe('play');
    expect(PLAY_MODES).toEqual(['online', 'local']);
    expect(DEFAULT_PLAY_MODE).toBe('online');
    expect(SOUND_STATES).toEqual(['on', 'off']);
    expect(SORT_MODES).toEqual(['suit', 'rank', 'manual']);
    expect(DEFAULT_SORT).toBe('suit');
    expect(CARD_BACKS).toEqual(['default', 'blue-stripe', 'yu-gi-oh', 'empty']);
    expect(DEFAULT_CARD_BACK).toBe('default');
    expect(SOUND_FONTS).toEqual(['default', 'felt', 'arcade']);
    expect(DEFAULT_SOUND_FONT).toBe('default');
    expect(NAME_MAX).toBe(20);
  });
});

describe('the sort preference', () => {
  test('round trip as a bare string; a missing or unknown value reads as an error', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(readSort(store).ok).toBe(false);
    expect(writeSort(store, 'suit').ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.sort)).toBe('suit');
    expect(readSort(store)).toEqual({ ok: true, value: 'suit' });
    s.setItem(STORAGE_KEYS.sort, 'colour');
    expect(readSort(store).ok).toBe(false);
  });
});

describe('the card pack preference and the retired card-back key', () => {
  test('round trip as a bare string under ginRummy_cardPack; a missing, an unknown and an Italian-only pack read as errors', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(readCardBack(store)).toEqual({
      ok: false,
      error: { kind: 'missing', key: STORAGE_KEYS.cardPack },
    });
    CARD_BACKS.forEach((back) => {
      expect(writeCardBack(store, back).ok).toBe(true);
      expect(s.map.get(STORAGE_KEYS.cardPack)).toBe(back);
      expect(readCardBack(store)).toEqual({ ok: true, value: back });
    });
    ['plaid', 'linea'].forEach((v) => {
      s.setItem(STORAGE_KEYS.cardPack, v);
      expect(readCardBack(store)).toEqual({
        ok: false,
        error: {
          kind: 'invalid',
          key: STORAGE_KEYS.cardPack,
          reason: '$: expected one of "default" | "blue-stripe" | "yu-gi-oh" | "empty"',
        },
      });
    });
    // The refusal line names this key (src/cardBack.ts spells it, the lint zones keeping it out of here).
    expect(badCardBackMsg('plaid').startsWith(`${STORAGE_KEYS.cardPack}: `)).toBe(true);
  });

  test('migrateCardBack: a preset under the retired key moves to the new key once; the retired key goes either way', () => {
    const s = fakeStorage();
    const store = createStore(s);
    // Nothing stored: nothing to do.
    expect(migrateCardBack(store)).toBeNull();
    expect(s.map.size).toBe(0);
    // A valid value moves.
    s.setItem(RETIRED_KEYS.cardBack, 'yu-gi-oh');
    expect(migrateCardBack(store)).toBeNull();
    expect(s.map.get(STORAGE_KEYS.cardPack)).toBe('yu-gi-oh');
    expect(s.map.has(RETIRED_KEYS.cardBack)).toBe(false);
    // The new key already holds a choice: the old one is dropped, not copied over it.
    s.setItem(RETIRED_KEYS.cardBack, 'blue-stripe');
    expect(migrateCardBack(store)).toBeNull();
    expect(s.map.get(STORAGE_KEYS.cardPack)).toBe('yu-gi-oh');
    expect(s.map.has(RETIRED_KEYS.cardBack)).toBe(false);
    // A stranger is returned for the boot to log, and dropped; the new key is untouched.
    s.setItem(RETIRED_KEYS.cardBack, 'tartan');
    expect(migrateCardBack(store)).toBe('tartan');
    expect(s.map.get(STORAGE_KEYS.cardPack)).toBe('yu-gi-oh');
    expect(s.map.has(RETIRED_KEYS.cardBack)).toBe(false);
    // The new key absent and the old one a stranger: nothing is written.
    s.map.clear();
    s.setItem(RETIRED_KEYS.cardBack, 'tartan');
    expect(migrateCardBack(store)).toBe('tartan');
    expect(s.map.size).toBe(0);
    expect(RETIRED_KEYS).toEqual({ cardBack: 'ginRummy_cardBack' });
  });
});

describe('the sound font preference', () => {
  test('round trip as a bare string; a missing or unknown value reads as an error', () => {
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
});

describe('the finished games (the owner`s history, 2026-09-25)', () => {
  test('a JSON list under the game`s own key, newest first; a missing or foreign value reads as none', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(STORAGE_KEYS.recentGames).toBe('ginRummy_recentGames');
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
  test('each role writes the persist() literal and reads back equal, whatever key order it had', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(writeSave(store, { game, role: 'local' })).toEqual({ ok: true, value: null });
    expect(s.map.get(STORAGE_KEYS.save)).toBe(JSON.stringify({ role: 'local', game }));
    expect(readSave(store)).toEqual({ ok: true, value: { role: 'local', game } });

    const host = {
      oppName: null,
      game: null,
      target: 75,
      myName: 'Ann',
      code: 'LRZL',
      role: 'host',
    } as const;
    expect(writeSave(store, host).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.save)).toBe(
      '{"role":"host","code":"LRZL","myName":"Ann","target":75,"game":null,"oppName":null}',
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
      target: 100,
      game,
      oppName: 'Jeff',
    } as const;
    expect(writeSave(store, save).ok).toBe(true);
    expect(readSave(store)).toEqual({ ok: true, value: save });
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

  test('the second name round-trips under its own key by the same rule; an empty stored value is refused', () => {
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
    s.setItem(STORAGE_KEYS.p2Name, '');
    expect(readP2Name(store)).toEqual({
      ok: false,
      error: { kind: 'invalid', key: STORAGE_KEYS.p2Name, reason: '$: expected a non-empty name' },
    });
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
    });
    s.setItem(STORAGE_KEYS.homeTab, 'Play');
    expect(readHomeTab(store).ok).toBe(false);
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
});

describe('the Score Counter', () => {
  const state = {
    players: [
      { id: 'x1', name: 'Ann' },
      { id: 'y2', name: 'Bob' },
    ],
    target: 100,
    rounds: [
      {
        deadwood: { x1: 5, y2: 20 },
        knockerId: 'x1',
        knockType: 'knock',
        scores: { x1: 15, y2: 0 },
        ts: 1_700_000_001_000,
      },
    ],
    startedAt: 1_700_000_000_000,
  } as const;

  test('the session writes JSON.stringify(state) in the legacy key order and reads back', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(writeScorerState(store, state).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.scorerState)).toBe(JSON.stringify(state));
    expect(readScorerState(store)).toEqual({ ok: true, value: state });
    expect(writeScorerState(store, null)).toEqual({ ok: true, value: null });
    expect(s.map.has(STORAGE_KEYS.scorerState)).toBe(false);
  });
});

describe('the handoff mark on a host save', () => {
  test('is written only when true, after the legacy keys, and reads back; a save without it is unchanged', () => {
    const s = fakeStorage();
    const store = createStore(s);
    const handed = {
      role: 'host',
      code: 'ABCD',
      myName: 'Ann',
      target: 100,
      game,
      oppName: 'Bob',
      handoff: true,
    } as const;
    expect(writeSave(store, handed).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.save)).toBe(
      `{"role":"host","code":"ABCD","myName":"Ann","target":100,"game":${JSON.stringify(game)},"oppName":"Bob","handoff":true}`,
    );
    expect(readSave(store)).toEqual({ ok: true, value: handed });
    // The legacy literal, byte for byte, when the mark is absent.
    const plain = {
      role: 'host',
      code: 'ABCD',
      myName: 'Ann',
      target: 100,
      game,
      oppName: 'Bob',
    } as const;
    expect(writeSave(store, plain).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.save)).toBe(
      `{"role":"host","code":"ABCD","myName":"Ann","target":100,"game":${JSON.stringify(game)},"oppName":"Bob"}`,
    );
    expect(readSave(store)).toEqual({ ok: true, value: plain });
    // Anything but `true` under the key is refused.
    s.map.set(
      STORAGE_KEYS.save,
      '{"role":"host","code":"ABCD","myName":"Ann","target":100,"game":null,"oppName":null,"handoff":false}',
    );
    expect(readSave(store)).toEqual({
      ok: false,
      error: { kind: 'invalid', key: STORAGE_KEYS.save, reason: '$.handoff: expected one of true' },
    });
  });
});
