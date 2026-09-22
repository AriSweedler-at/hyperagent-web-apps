import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../shared/lib/rng.ts';
import { createGame } from './engine/index.ts';
import {
  ALL_KEYS,
  DEFAULT_HOME_TAB,
  DEFAULT_PLAY_MODE,
  HOME_TABS,
  NAME_MAX,
  PLAY_MODES,
  SOUND_STATES,
  STORAGE_KEYS,
  clearSave,
  readHomeTab,
  readName,
  readP2Name,
  readSave,
  readScorerNames,
  readScorerState,
  readSoundState,
  soundEnabled,
  writeHomeTab,
  writeName,
  writeP2Name,
  writePlayMode,
  writeSave,
  writeScorerNames,
  writeScorerState,
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
  test('the seven legacy keys and the second name, the tabs, modes, sound states and the name cap', () => {
    expect(ALL_KEYS).toEqual([
      'ginRummyMP_v1',
      'ginRummy_name',
      'ginRummy_p2Name',
      'ginRummy_homeTab',
      'ginRummy_playMode',
      'ginRummy_sound',
      'ginRummyScorerState_v2',
      'ginRummy_scorerNames',
    ]);
    expect(HOME_TABS).toEqual(['play', 'rules', 'score']);
    expect(DEFAULT_HOME_TAB).toBe('play');
    expect(PLAY_MODES).toEqual(['online', 'local']);
    expect(DEFAULT_PLAY_MODE).toBe('online');
    expect(SOUND_STATES).toEqual(['on', 'off']);
    expect(NAME_MAX).toBe(20);
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

  test('the names array round-trips; fewer than two names are refused', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(writeScorerNames(store, ['Ann', 'Bob', 'Cy']).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.scorerNames)).toBe('["Ann","Bob","Cy"]');
    expect(readScorerNames(store)).toEqual({ ok: true, value: ['Ann', 'Bob', 'Cy'] });
    s.setItem(STORAGE_KEYS.scorerNames, '["Ann"]');
    expect(readScorerNames(store)).toEqual({
      ok: false,
      error: {
        kind: 'invalid',
        key: STORAGE_KEYS.scorerNames,
        reason: '$: expected at least two names',
      },
    });
  });
});
