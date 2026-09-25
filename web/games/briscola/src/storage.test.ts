import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { CARD_PACKS, defaultPackFor, packsFor } from '../../../shared/lib/cards/packs.ts';
import { mulberry32 } from '../../../shared/lib/rng.ts';
import { createGame } from './engine/index.ts';
import {
  ALL_KEYS,
  DEFAULT_CARD_PACK,
  DEFAULT_LANG,
  LANGUAGE_PACKS,
  LANG_PREF,
  DEFAULT_HOME_TAB,
  DEFAULT_OPTS,
  DEFAULT_PLAY_MODE,
  DEFAULT_SOUND_FONT,
  HOME_TABS,
  NAME_MAX,
  PLAY_MODES,
  SOUND_FONTS,
  SOUND_STATES,
  STORAGE_KEYS,
  clearSave,
  readCardPack,
  readLang,
  readHomeTab,
  readName,
  readOpts,
  readP2Name,
  readP3Name,
  readP4Name,
  readPlayMode,
  readSave,
  readRecentGames,
  readSoundFont,
  readSoundState,
  soundEnabled,
  writeCardPack,
  writeLang,
  writeHomeTab,
  writeName,
  writeOpts,
  writeP2Name,
  writeP3Name,
  writeP4Name,
  writePlayMode,
  writeSave,
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

const NOW = (): number => 1_700_000_000_000;
const game = createGame(
  [
    { id: 'p1', name: 'Ann' },
    { id: 'p2', name: 'Bob' },
  ],
  { gamesToWin: 2 },
  mulberry32(1),
  NOW,
);
const OPTS = {
  seatCount: 2,
  gamesToWin: 2,
  removedTwo: 'C',
  exchange: false,
  scoperta: false,
  partnerPeek: false,
} as const;
const OPTS_JSON =
  '"seatCount":2,"gamesToWin":2,"removedTwo":"C","exchange":false,"scoperta":false,"partnerPeek":false';

describe('frozen constants', () => {
  test('the seventeen keys, the tabs, modes, sound states, the defaults and the name cap (design §5.8)', () => {
    expect(ALL_KEYS).toEqual([
      'briscolaMP_v1',
      'briscola_name',
      'briscola_p2Name',
      'briscola_p3Name',
      'briscola_p4Name',
      'briscola_homeTab',
      'briscola_playMode',
      'briscola_sound',
      'briscola_soundFont',
      'briscola_recentGames',
      'briscola_cardPack',
      'briscola_lang',
      'briscola_players',
      'briscola_match',
      'briscola_removedTwo',
      'briscola_exchange',
      'briscola_scoperta',
      'briscola_partnerPeek',
    ]);
    // Nothing of the other games': the games on one origin never read each other's keys.
    ALL_KEYS.forEach((key) => {
      expect(key.startsWith('briscola')).toBe(true);
    });
    expect(HOME_TABS).toEqual(['play', 'rules', 'about']);
    expect(DEFAULT_HOME_TAB).toBe('play');
    expect(PLAY_MODES).toEqual(['online', 'local']);
    expect(DEFAULT_PLAY_MODE).toBe('online');
    expect(SOUND_STATES).toEqual(['on', 'off']);
    expect(SOUND_FONTS).toEqual(['default', 'felt', 'arcade']);
    expect(DEFAULT_SOUND_FONT).toBe('default');
    expect(DEFAULT_OPTS).toEqual(OPTS);
    expect(DEFAULT_CARD_PACK).toBe(defaultPackFor('italian40'));
    expect(NAME_MAX).toBe(20);
  });
});

describe('the game save', () => {
  test('each role writes its literal and reads back equal, whatever key order it had; the host save carries the six options between myName and game', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(writeSave(store, { game, role: 'local' })).toEqual({ ok: true, value: null });
    expect(s.map.get(STORAGE_KEYS.save)).toBe(JSON.stringify({ role: 'local', game }));
    expect(readSave(store)).toEqual({ ok: true, value: { role: 'local', game } });

    const host = {
      oppName: null,
      game: null,
      ...OPTS,
      myName: 'Ann',
      code: 'LRZL',
      role: 'host',
    } as const;
    expect(writeSave(store, host).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.save)).toBe(
      `{"role":"host","code":"LRZL","myName":"Ann",${OPTS_JSON},"game":null,"oppName":null}`,
    );
    expect(readSave(store)).toEqual({ ok: true, value: host });

    expect(writeSave(store, { myName: 'Jeff', code: 'KQZM', role: 'guest' }).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.save)).toBe('{"role":"guest","code":"KQZM","myName":"Jeff"}');
    expect(clearSave(store)).toEqual({ ok: true, value: null });
    expect(readSave(store)).toEqual({
      ok: false,
      error: { kind: 'missing', key: STORAGE_KEYS.save },
    });
  });

  test('a host save with a game, an opponent and the handoff mark round-trips; the mark is written only when true', () => {
    const s = fakeStorage();
    const store = createStore(s);
    const handed = {
      role: 'host',
      code: 'ABCD',
      myName: 'Ann',
      ...OPTS,
      game,
      oppName: 'Bob',
      handoff: true,
    } as const;
    expect(writeSave(store, handed).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.save)).toBe(
      `{"role":"host","code":"ABCD","myName":"Ann",${OPTS_JSON},"game":${JSON.stringify(game)},"oppName":"Bob","handoff":true}`,
    );
    expect(readSave(store)).toEqual({ ok: true, value: handed });
    const plain = {
      role: 'host',
      code: 'ABCD',
      myName: 'Ann',
      ...OPTS,
      game,
      oppName: 'Bob',
    } as const;
    expect(writeSave(store, plain).ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.save)?.endsWith('"oppName":"Bob"}')).toBe(true);
    expect(readSave(store)).toEqual({ ok: true, value: plain });
  });

  test.each<[string, string, string]>([
    [
      'a malformed code',
      `{"role":"host","code":"AB1D","myName":"Ann",${OPTS_JSON},"game":null,"oppName":null}`,
      '$.code: expected a 4-letter room code',
    ],
    [
      'a seat count outside 2..4',
      `{"role":"host","code":"ABCD","myName":"Ann",${OPTS_JSON.replace('"seatCount":2', '"seatCount":5')},"game":null,"oppName":null}`,
      '$.seatCount: expected one of 2 | 3 | 4',
    ],
    [
      'scoperta at three players',
      `{"role":"host","code":"ABCD","myName":"Ann",${OPTS_JSON.replace('"seatCount":2', '"seatCount":3').replace('"scoperta":false', '"scoperta":true')},"game":null,"oppName":null}`,
      '$: expected scoperta at two players and the partner peek at four only',
    ],
    [
      "backgammon's fields in place of the options",
      '{"role":"host","code":"ABCD","myName":"Ann","matchLength":5,"variant":"portes","game":null,"oppName":null}',
      '$.seatCount: expected one of 2 | 3 | 4',
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
  test('the four names are stored cut to 20 under their own keys and removed when empty', () => {
    const s = fakeStorage();
    const store = createStore(s);
    const names = [
      [readName, writeName, STORAGE_KEYS.name],
      [readP2Name, writeP2Name, STORAGE_KEYS.p2Name],
      [readP3Name, writeP3Name, STORAGE_KEYS.p3Name],
      [readP4Name, writeP4Name, STORAGE_KEYS.p4Name],
    ] as const;
    names.forEach(([read, write, key], i) => {
      expect(write(store, `Name${String(i)}`)).toEqual({ ok: true, value: null });
      expect(s.map.get(key)).toBe(`Name${String(i)}`);
      expect(read(store)).toEqual({ ok: true, value: `Name${String(i)}` });
    });
    // Four keys, four values: the names are remembered apart.
    expect([...s.map.keys()].sort()).toEqual(
      [STORAGE_KEYS.name, STORAGE_KEYS.p2Name, STORAGE_KEYS.p3Name, STORAGE_KEYS.p4Name].sort(),
    );
    expect(writeP3Name(store, 'abcdefghijklmnopqrstuvwxyz').ok).toBe(true);
    expect(s.map.get(STORAGE_KEYS.p3Name)).toBe('abcdefghijklmnopqrst');
    expect(writeP4Name(store, '')).toEqual({ ok: true, value: null });
    expect(s.map.has(STORAGE_KEYS.p4Name)).toBe(false);
    s.setItem(STORAGE_KEYS.name, '');
    expect(readName(store)).toEqual({
      ok: false,
      error: { kind: 'invalid', key: STORAGE_KEYS.name, reason: '$: expected a non-empty name' },
    });
  });

  test('home tab, play mode, sound and the sound font write the literal and read back; garbage is refused', () => {
    const s = fakeStorage();
    const store = createStore(s);
    HOME_TABS.forEach((tab) => {
      expect(writeHomeTab(store, tab).ok).toBe(true);
      expect(readHomeTab(store)).toEqual({ ok: true, value: tab });
    });
    s.setItem(STORAGE_KEYS.homeTab, 'score');
    expect(readHomeTab(store)).toEqual({
      ok: false,
      error: {
        kind: 'invalid',
        key: STORAGE_KEYS.homeTab,
        reason: '$: expected one of "play" | "rules" | "about"',
      },
    });
    PLAY_MODES.forEach((mode) => {
      expect(writePlayMode(store, mode).ok).toBe(true);
      expect(readPlayMode(store)).toEqual({ ok: true, value: mode });
    });
    expect(soundEnabled(store)).toBe(true);
    expect(writeSoundState(store, 'off').ok).toBe(true);
    expect(readSoundState(store)).toEqual({ ok: true, value: 'off' });
    expect(soundEnabled(store)).toBe(false);
    s.setItem(STORAGE_KEYS.sound, 'OFF');
    expect(soundEnabled(store)).toBe(true);
    SOUND_FONTS.forEach((font) => {
      expect(writeSoundFont(store, font).ok).toBe(true);
      expect(readSoundFont(store)).toEqual({ ok: true, value: font });
    });
    s.setItem(STORAGE_KEYS.soundFont, 'plaid');
    expect(readSoundFont(store).ok).toBe(false);
  });

  test('the card pack round-trips over the packs that draw the Italian deck; any other pack and garbage are refused', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(readCardPack(store)).toEqual({
      ok: false,
      error: { kind: 'missing', key: STORAGE_KEYS.cardPack },
    });
    const italian = packsFor('italian40');
    expect(italian).toContain('linea');
    italian.forEach((pack) => {
      expect(writeCardPack(store, pack).ok).toBe(true);
      expect(s.map.get(STORAGE_KEYS.cardPack)).toBe(pack);
      expect(readCardPack(store)).toEqual({ ok: true, value: pack });
    });
    // A pack that draws the French deck alone (none on main today: every shipped pack draws both) and garbage.
    const french = CARD_PACKS.filter((p) => !(italian as ReadonlyArray<string>).includes(p));
    [...french, 'plaid', ''].forEach((bad) => {
      s.setItem(STORAGE_KEYS.cardPack, bad);
      expect(readCardPack(store)).toEqual({
        ok: false,
        error: {
          kind: 'invalid',
          key: STORAGE_KEYS.cardPack,
          reason: `$: expected one of ${italian.map((p) => `"${p}"`).join(' | ')}`,
        },
      });
    });
  });

  test('the language pack round-trips as a bare string under briscola_lang, refuses a stranger, and reads Italian by default', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(DEFAULT_LANG).toBe('it');
    expect(readLang(store)).toEqual({
      ok: false,
      error: { kind: 'missing', key: STORAGE_KEYS.lang },
    });
    expect(LANG_PREF.orDefault(store)).toBe('it');
    LANGUAGE_PACKS.forEach((name) => {
      expect(writeLang(store, name).ok).toBe(true);
      expect(s.map.get(STORAGE_KEYS.lang)).toBe(name);
      expect(readLang(store)).toEqual({ ok: true, value: name });
      expect(LANG_PREF.orDefault(store)).toBe(name);
    });
    ['fr', ''].forEach((bad) => {
      s.setItem(STORAGE_KEYS.lang, bad);
      expect(readLang(store)).toEqual({
        ok: false,
        error: {
          kind: 'invalid',
          key: STORAGE_KEYS.lang,
          reason: `$: expected one of ${LANGUAGE_PACKS.map((p) => `"${p}"`).join(' | ')}`,
        },
      });
      expect(LANG_PREF.orDefault(store)).toBe('it');
    });
  });
});

describe('the room options', () => {
  test('readOpts: the defaults on an empty store; writeOpts stores digits, a suit letter and on/off, read back whole', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(readOpts(store)).toEqual(OPTS);
    const chosen = {
      seatCount: 3,
      gamesToWin: 3,
      removedTwo: 'D',
      exchange: true,
      scoperta: false,
      partnerPeek: false,
    } as const;
    writeOpts(store, chosen);
    expect(s.map.get(STORAGE_KEYS.players)).toBe('3');
    expect(s.map.get(STORAGE_KEYS.match)).toBe('3');
    expect(s.map.get(STORAGE_KEYS.removedTwo)).toBe('D');
    expect(s.map.get(STORAGE_KEYS.exchange)).toBe('on');
    expect(s.map.get(STORAGE_KEYS.scoperta)).toBe('off');
    expect(s.map.get(STORAGE_KEYS.partnerPeek)).toBe('off');
    expect(readOpts(store)).toEqual(chosen);
    const four = { ...chosen, seatCount: 4, partnerPeek: true } as const;
    writeOpts(store, four);
    expect(readOpts(store)).toEqual(four);
    const open = { ...chosen, seatCount: 2, partnerPeek: false, scoperta: true } as const;
    writeOpts(store, open);
    expect(s.map.get(STORAGE_KEYS.scoperta)).toBe('on');
    expect(readOpts(store)).toEqual(open);
  });

  test('a garbage key falls back to its default alone, and a stored pair the rules refuse is normalised (scoperta at three, the peek at two)', () => {
    const s = fakeStorage();
    const store = createStore(s);
    writeOpts(store, { ...OPTS, seatCount: 4, gamesToWin: 3, removedTwo: 'B', exchange: true });
    s.setItem(STORAGE_KEYS.match, '5');
    s.setItem(STORAGE_KEYS.removedTwo, 'coppe');
    s.setItem(STORAGE_KEYS.exchange, 'yes');
    expect(readOpts(store)).toEqual({
      ...OPTS,
      seatCount: 4,
      gamesToWin: 2,
      removedTwo: 'C',
      exchange: false,
    });
    s.setItem(STORAGE_KEYS.players, '3');
    s.setItem(STORAGE_KEYS.scoperta, 'on');
    s.setItem(STORAGE_KEYS.partnerPeek, 'on');
    expect(readOpts(store)).toEqual({ ...OPTS, seatCount: 3 });
    s.setItem(STORAGE_KEYS.players, '2');
    expect(readOpts(store)).toEqual({ ...OPTS, scoperta: true });
    s.setItem(STORAGE_KEYS.players, '4');
    expect(readOpts(store)).toEqual({ ...OPTS, seatCount: 4, partnerPeek: true });
  });
});

describe('the finished matches (the owner`s history, 2026-09-25)', () => {
  test('a JSON list under the game`s own key, newest first; a missing or foreign value reads as none', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(STORAGE_KEYS.recentGames).toBe('briscola_recentGames');
    expect(readRecentGames(store)).toEqual([]);
    const first = {
      at: 1_700_000_000_000,
      mode: 'local' as const,
      players: ['Ann', 'Bob', 'Cara', 'Dan'],
      score: '2–0',
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
