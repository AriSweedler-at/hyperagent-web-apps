// The keys, the literals and the readers (docs/design/fidice-shell-adoption.md §3 "Storage", §6
// risk 14): every key pinned under `fidice_*` and `fidiceMP_v1`, the host save's literal with the
// five terms between `myName` and `game`, each role read back equal whatever key order it had, the
// bare-string preferences with their defaults when unreadable, the host card's terms as digits, the
// shell flag, and the one thing this module does NOT do: read the legacy `fidice-name` (M4's
// `hooks.home` copies it; M6 removes it).
import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../shared/lib/rng.ts';
import { HOST, apply } from './domain/game.ts';
import { seatTable } from './shellConfig.ts';
import {
  ALL_KEYS,
  DEFAULT_BOT_CHOICE,
  DEFAULT_HOME_TAB,
  DEFAULT_OPTS,
  DEFAULT_PLAY_MODE,
  DEFAULT_SOUND_FONT,
  HOME_TABS,
  NAME_MAX,
  PLAY_MODES,
  SOUND_STATES,
  STORAGE_KEYS,
  clearSave,
  readHomeTab,
  readName,
  readOpts,
  readP2Name,
  readP3Name,
  readP6Name,
  readPlayMode,
  readRecentGames,
  readSave,
  readShellFlag,
  readSoundFont,
  readSoundState,
  soundEnabled,
  writeHomeTab,
  writeName,
  writeOpts,
  writeP2Name,
  writeP3Name,
  writePlayMode,
  writeSave,
  writeShellFlag,
  writeSoundFont,
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

const table = seatTable(
  'ABCDE',
  [
    { id: 'host', name: 'Ann' },
    { id: 'guest', name: 'Bob' },
  ],
  DEFAULT_OPTS,
  mulberry32(1),
);
const started = apply(table, HOST, { type: 'start' }, mulberry32(1));
if (!started.ok) throw new Error(started.error);
const game = started.value;
const OPTS_JSON = '"lives":0,"seatCount":6,"bots":0,"botChoice":"profiler","watch":false';

describe('frozen constants', () => {
  test('the nineteen keys under fidice_, the tabs in the composed page`s order, the modes, the defaults, the name cap', () => {
    expect(ALL_KEYS).toEqual([
      'fidiceMP_v1',
      'fidice_name',
      'fidice_p2Name',
      'fidice_p3Name',
      'fidice_p4Name',
      'fidice_p5Name',
      'fidice_p6Name',
      'fidice_homeTab',
      'fidice_playMode',
      'fidice_sound',
      'fidice_soundFont',
      'fidice_recentGames',
      'fidice_lives',
      'fidice_seats',
      'fidice_bots',
      'fidice_botChoice',
      'fidice_shell',
    ]);
    ALL_KEYS.forEach((key) => {
      expect(key.startsWith('fidice')).toBe(true);
    });
    expect(HOME_TABS).toEqual(['play', 'rules', 'ladder', 'about']);
    expect(DEFAULT_HOME_TAB).toBe('play');
    expect(PLAY_MODES).toEqual(['online', 'local']);
    expect(DEFAULT_PLAY_MODE).toBe('online');
    expect(SOUND_STATES).toEqual(['on', 'off']);
    expect(DEFAULT_SOUND_FONT).toBe('default');
    expect(DEFAULT_BOT_CHOICE).toBe('profiler');
    expect(DEFAULT_OPTS).toEqual({
      lives: 0,
      seatCount: 6,
      bots: 0,
      botChoice: 'profiler',
      watch: false,
    });
    expect(NAME_MAX).toBe(20);
  });
});

describe('the game save', () => {
  test('each role writes its literal and reads back equal, whatever key order it had; the host save carries the five terms between myName and game', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(writeSave(store, { game, role: 'local' })).toEqual({ ok: true, value: null });
    expect(s.map.get(STORAGE_KEYS.save)).toBe(JSON.stringify({ role: 'local', game }));
    expect(readSave(store)).toEqual({ ok: true, value: { role: 'local', game } });

    const host = {
      oppName: null,
      game: null,
      ...DEFAULT_OPTS,
      myName: 'Ann',
      code: 'ABCDE',
      role: 'host',
    } as const;
    writeSave(store, host);
    expect(s.map.get(STORAGE_KEYS.save)).toBe(
      `{"role":"host","code":"ABCDE","myName":"Ann",${OPTS_JSON},"game":null,"oppName":null}`,
    );
    expect(readSave(store)).toEqual({ ok: true, value: host });

    // A six-seat room mid-game: the seat names, the handoff mark and the stamp ride only when set.
    const wide = {
      ...host,
      game,
      oppName: 'Bob',
      seatNames: ['Bob', null, 'Dee', null, null],
      at: 5,
    } as const;
    writeSave(store, wide);
    const stored = s.map.get(STORAGE_KEYS.save) ?? '';
    expect(
      stored.startsWith(`{"role":"host","code":"ABCDE","myName":"Ann",${OPTS_JSON},"game":{`),
    ).toBe(true);
    expect(
      stored.endsWith(',"oppName":"Bob","seatNames":["Bob",null,"Dee",null,null],"at":5}'),
    ).toBe(true);
    expect(readSave(store)).toEqual({ ok: true, value: wide });

    writeSave(store, { role: 'guest', code: 'ABCDE', myName: 'Zoë' });
    expect(s.map.get(STORAGE_KEYS.save)).toBe('{"role":"guest","code":"ABCDE","myName":"Zoë"}');
    clearSave(store);
    expect(s.map.has(STORAGE_KEYS.save)).toBe(false);
    expect(readSave(store).ok).toBe(false);
  });

  test('a save with a four-letter code, a stranger role, a bad term or a bad game is refused by its path', () => {
    const store = createStore(fakeStorage());
    const bad = (value: unknown): string => {
      store.writeJson(STORAGE_KEYS.save, value);
      const r = readSave(store);
      return r.ok ? 'ok' : r.error.kind === 'invalid' ? r.error.reason : r.error.kind;
    };
    expect(
      bad({
        role: 'host',
        code: 'ABCD',
        myName: 'Ann',
        ...DEFAULT_OPTS,
        game: null,
        oppName: null,
      }),
    ).toBe('$.code: expected a 5-letter room code');
    expect(bad({ role: 'spectator' })).toBe('$.role: expected one of "local" | "host" | "guest"');
    expect(
      bad({
        role: 'host',
        code: 'ABCDE',
        myName: 'Ann',
        ...DEFAULT_OPTS,
        bots: 9,
        game: null,
        oppName: null,
      }),
    ).toBe('$.bots: expected integer in [0, 5]');
    expect(bad({ role: 'local', game: { ...game, hostSeat: 7 } })).toBe(
      '$.game.hostSeat: expected one of 0 | 1 | 2 | 3 | 4 | 5',
    );
    expect(
      bad({
        role: 'local',
        game: { ...game, round: { ...game.round, dice: [{ value: 7, inCup: true }] } },
      }),
    ).toBe('$.game.round.dice[0].value: expected one of 1 | 2 | 3 | 4 | 5 | 6');
  });
});

describe('the bare-string preferences', () => {
  test('the names: stored cut to 20, an empty one removes the key; the legacy fidice-name is NOT read here (M4`s hooks.home copies it)', () => {
    const s = fakeStorage();
    const store = createStore(s);
    writeName(store, 'x'.repeat(30));
    expect(s.map.get(STORAGE_KEYS.name)).toBe('x'.repeat(20));
    expect(readName(store)).toEqual({ ok: true, value: 'x'.repeat(20) });
    writeName(store, '');
    expect(s.map.has(STORAGE_KEYS.name)).toBe(false);
    s.map.set('fidice-name', 'Legacy');
    expect(readName(store).ok).toBe(false);
    writeP2Name(store, 'Lavi');
    writeP3Name(store, 'Sandro');
    expect(readP2Name(store)).toEqual({ ok: true, value: 'Lavi' });
    expect(readP3Name(store)).toEqual({ ok: true, value: 'Sandro' });
    expect(readP6Name(store).ok).toBe(false);
  });

  test('the tab, the mode, the sound, the font and the finished games', () => {
    const s = fakeStorage();
    const store = createStore(s);
    writeHomeTab(store, 'ladder');
    expect(s.map.get(STORAGE_KEYS.homeTab)).toBe('ladder');
    expect(readHomeTab(store)).toEqual({ ok: true, value: 'ladder' });
    s.map.set(STORAGE_KEYS.homeTab, 'spec');
    expect(readHomeTab(store).ok).toBe(false);
    writePlayMode(store, 'local');
    expect(readPlayMode(store)).toEqual({ ok: true, value: 'local' });
    expect(soundEnabled(store)).toBe(true);
    expect(soundEnabled(store, false)).toBe(false);
    writeSoundState(store, 'off');
    expect(readSoundState(store)).toEqual({ ok: true, value: 'off' });
    expect(soundEnabled(store)).toBe(false);
    writeSoundFont(store, 'felt');
    expect(readSoundFont(store)).toEqual({ ok: true, value: 'felt' });
    expect(readRecentGames(store)).toEqual([]);
  });

  test('the host card`s terms: each as its digits (the choice as is), the defaults when missing or unreadable, `watch` never stored', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(readOpts(store)).toEqual(DEFAULT_OPTS);
    writeOpts(store, { lives: 3, seatCount: 4, bots: 2, botChoice: 'gambler', watch: true });
    expect([...s.map.entries()]).toEqual([
      ['fidice_lives', '3'],
      ['fidice_seats', '4'],
      ['fidice_bots', '2'],
      ['fidice_botChoice', 'gambler'],
    ]);
    expect(readOpts(store)).toEqual({
      lives: 3,
      seatCount: 4,
      bots: 2,
      botChoice: 'gambler',
      watch: false,
    });
    s.map.set('fidice_seats', '7');
    s.map.set('fidice_bots', '-1');
    s.map.set('fidice_lives', 'many');
    expect(readOpts(store)).toEqual({ ...DEFAULT_OPTS, botChoice: 'gambler' });
  });

  test('the shell flag (M4): `1` on, the key removed when off', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(readShellFlag(store)).toBe(false);
    writeShellFlag(store, true);
    expect(s.map.get(STORAGE_KEYS.shell)).toBe('1');
    expect(readShellFlag(store)).toBe(true);
    writeShellFlag(store, false);
    expect(s.map.has(STORAGE_KEYS.shell)).toBe(false);
  });
});
