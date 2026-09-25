import { describe, expect, test } from 'vitest';

import { integer, literal, object } from '../lib/json.ts';
import {
  NAME_MAX,
  PLAY_MODES,
  SOUND_STATES,
  cardPackPref,
  decodeCardPackFor,
  decodeName,
  decodePlayMode,
  decodeSoundFont,
  decodeSoundState,
  namePref,
  readTextWith,
  shellSave,
  shellStore,
  soundPref,
  textPref,
} from './prefs.ts';
import { createStore, unavailableStore, type StorageLike } from './storage.ts';

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

describe('the shared literals', () => {
  test("play modes, sound states and the name cap are gin's", () => {
    expect(PLAY_MODES).toEqual(['online', 'local']);
    expect(SOUND_STATES).toEqual(['on', 'off']);
    expect(NAME_MAX).toBe(20);
  });

  test("the decoders accept their literals and name the rejected value's expectation", () => {
    expect(decodeName('Ann')).toEqual({ ok: true, value: 'Ann' });
    expect(decodeName('')).toEqual({
      ok: false,
      error: { path: [], expected: 'a non-empty name' },
    });
    expect(decodePlayMode('local')).toEqual({ ok: true, value: 'local' });
    expect(decodePlayMode('bots').ok).toBe(false);
    expect(decodeSoundState('off')).toEqual({ ok: true, value: 'off' });
    expect(decodeSoundState('OFF').ok).toBe(false);
    expect(decodeSoundFont('felt')).toEqual({ ok: true, value: 'felt' });
    expect(decodeSoundFont('plaid')).toEqual({
      ok: false,
      error: { path: [], expected: 'one of "default" | "felt" | "arcade"' },
    });
  });

  test("the card-pack decoder is per deck kind: gin's four under french52, linea only for an Italian deck", () => {
    expect(decodeCardPackFor('french52')('yu-gi-oh')).toEqual({ ok: true, value: 'yu-gi-oh' });
    expect(decodeCardPackFor('french52')('linea')).toEqual({
      ok: false,
      error: { path: [], expected: 'one of "default" | "blue-stripe" | "yu-gi-oh" | "empty"' },
    });
    expect(decodeCardPackFor('italian40')('linea')).toEqual({ ok: true, value: 'linea' });
    expect(decodeCardPackFor('italian40')('plaid').ok).toBe(false);
  });
});

describe('cardPackPref', () => {
  test('round-trips a pack name as a bare string under the key and refuses a stranger to the deck kind', () => {
    const s = fakeStorage();
    const store = createStore(s);
    const pref = cardPackPref('briscola_cardPack', 'italian40');
    expect(pref.read(store)).toEqual({
      ok: false,
      error: { kind: 'missing', key: 'briscola_cardPack' },
    });
    expect(pref.write(store, 'linea')).toEqual({ ok: true, value: null });
    expect(s.map.get('briscola_cardPack')).toBe('linea');
    expect(pref.read(store)).toEqual({ ok: true, value: 'linea' });
    s.setItem('briscola_cardPack', 'tartan');
    expect(pref.read(store)).toEqual({
      ok: false,
      error: {
        kind: 'invalid',
        key: 'briscola_cardPack',
        reason:
          '$: expected one of "default" | "blue-stripe" | "yu-gi-oh" | "empty" | "linea" | "napoletane"',
      },
    });
  });
});

describe('readTextWith', () => {
  test('passes a missing or unavailable key through and reports a refused value as invalid', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(readTextWith(store, 'k', decodePlayMode)).toEqual({
      ok: false,
      error: { kind: 'missing', key: 'k' },
    });
    s.setItem('k', 'bots');
    expect(readTextWith(store, 'k', decodePlayMode)).toEqual({
      ok: false,
      error: { kind: 'invalid', key: 'k', reason: '$: expected one of "online" | "local"' },
    });
    s.setItem('k', 'online');
    expect(readTextWith(store, 'k', decodePlayMode)).toEqual({ ok: true, value: 'online' });
    expect(readTextWith(unavailableStore('private window'), 'k', decodePlayMode)).toEqual({
      ok: false,
      error: { kind: 'unavailable', key: 'k', reason: 'private window' },
    });
  });
});

describe('textPref', () => {
  test('writes the literal under its key and reads it back through its decoder', () => {
    const s = fakeStorage();
    const store = createStore(s);
    const mode = textPref('g_playMode', decodePlayMode);
    expect(mode.read(store)).toEqual({ ok: false, error: { kind: 'missing', key: 'g_playMode' } });
    PLAY_MODES.forEach((m) => {
      expect(mode.write(store, m)).toEqual({ ok: true, value: null });
      expect(s.map.get('g_playMode')).toBe(m);
      expect(mode.read(store)).toEqual({ ok: true, value: m });
    });
    expect([...s.map.keys()]).toEqual(['g_playMode']);
  });
});

describe('namePref', () => {
  test('stores a name cut to NAME_MAX, removes the key for an empty one, refuses an empty stored name', () => {
    const s = fakeStorage();
    const store = createStore(s);
    const name = namePref('g_name');
    expect(name.write(store, 'Ann')).toEqual({ ok: true, value: null });
    expect(s.map.get('g_name')).toBe('Ann');
    expect(name.read(store)).toEqual({ ok: true, value: 'Ann' });
    expect(name.write(store, 'abcdefghijklmnopqrstuvwxyz').ok).toBe(true);
    expect(s.map.get('g_name')).toBe('abcdefghijklmnopqrst');
    expect(name.write(store, '')).toEqual({ ok: true, value: null });
    expect(s.map.has('g_name')).toBe(false);
    s.setItem('g_name', '');
    expect(name.read(store)).toEqual({
      ok: false,
      error: { kind: 'invalid', key: 'g_name', reason: '$: expected a non-empty name' },
    });
  });
});

describe('soundPref', () => {
  test('is on unless the key says off: missing, garbage and "on" all count as on', () => {
    const s = fakeStorage();
    const store = createStore(s);
    const sound = soundPref('g_sound');
    expect(sound.enabled(store)).toBe(true);
    expect(sound.write(store, 'off')).toEqual({ ok: true, value: null });
    expect(s.map.get('g_sound')).toBe('off');
    expect(sound.read(store)).toEqual({ ok: true, value: 'off' });
    expect(sound.enabled(store)).toBe(false);
    expect(sound.write(store, 'on').ok).toBe(true);
    expect(sound.enabled(store)).toBe(true);
    s.setItem('g_sound', 'OFF');
    expect(sound.read(store).ok).toBe(false);
    expect(sound.enabled(store)).toBe(true);
  });
});

describe('shellSave', () => {
  // A toy engine: the state is `{ n }`, the host save's own field a `target` between `myName`
  // and `game`, as gin's is.
  type Toy = Readonly<{ n: number }>;
  type Extra = Readonly<{ target: number }>;
  const toy = object({ n: integer(0) });
  const { decodeSave, readSave, writeSave, clearSave } = shellSave<Toy, Extra>({
    key: 'toyMP_v1',
    game: 'gin-rummy',
    decodeGame: toy,
    hostExtra: {
      decode: object({ target: integer(1) }),
      literal: (save) => ({ target: save.target }),
    },
  });

  test('each role writes its literal in the legacy order, whatever order the caller had, and reads back', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(writeSave(store, { game: { n: 3 }, role: 'local' })).toEqual({ ok: true, value: null });
    expect(s.map.get('toyMP_v1')).toBe('{"role":"local","game":{"n":3}}');
    expect(readSave(store)).toEqual({ ok: true, value: { role: 'local', game: { n: 3 } } });

    const host = {
      oppName: null,
      game: null,
      target: 75,
      myName: 'Ann',
      code: 'LRZL',
      role: 'host',
    } as const;
    expect(writeSave(store, host).ok).toBe(true);
    expect(s.map.get('toyMP_v1')).toBe(
      '{"role":"host","code":"LRZL","myName":"Ann","target":75,"game":null,"oppName":null}',
    );
    expect(readSave(store)).toEqual({ ok: true, value: host });

    expect(writeSave(store, { myName: 'Jeff', code: 'KQZM', role: 'guest' }).ok).toBe(true);
    expect(s.map.get('toyMP_v1')).toBe('{"role":"guest","code":"KQZM","myName":"Jeff"}');
    expect(readSave(store)).toEqual({
      ok: true,
      value: { role: 'guest', code: 'KQZM', myName: 'Jeff' },
    });

    expect(clearSave(store)).toEqual({ ok: true, value: null });
    expect(readSave(store)).toEqual({ ok: false, error: { kind: 'missing', key: 'toyMP_v1' } });
    expect([...s.map.keys()]).toEqual([]);
  });

  test('the handoff mark is written only when true, last, and anything else under it is refused', () => {
    const s = fakeStorage();
    const store = createStore(s);
    const handed = {
      role: 'host',
      code: 'ABCD',
      myName: 'Ann',
      target: 100,
      game: { n: 1 },
      oppName: 'Bob',
      handoff: true,
    } as const;
    expect(writeSave(store, handed).ok).toBe(true);
    expect(s.map.get('toyMP_v1')).toBe(
      '{"role":"host","code":"ABCD","myName":"Ann","target":100,"game":{"n":1},"oppName":"Bob","handoff":true}',
    );
    expect(readSave(store)).toEqual({ ok: true, value: handed });
    s.setItem(
      'toyMP_v1',
      '{"role":"host","code":"ABCD","myName":"Ann","target":100,"game":null,"oppName":null,"handoff":false}',
    );
    expect(readSave(store)).toEqual({
      ok: false,
      error: { kind: 'invalid', key: 'toyMP_v1', reason: '$.handoff: expected one of true' },
    });
  });

  test.each<[string, string, string]>([
    [
      'an unknown role',
      '{"role":"spectator"}',
      '$.role: expected one of "local" | "host" | "guest"',
    ],
    ['a local save without a game', '{"role":"local"}', '$.game: expected object'],
    [
      'a local save with a broken game',
      '{"role":"local","game":{"n":-1}}',
      '$.game.n: expected integer in [0,',
    ],
    [
      "a host save whose code is not the game's",
      '{"role":"host","code":"AB1D","myName":"Ann","target":5,"game":null,"oppName":null}',
      '$.code: expected a 4-letter room code',
    ],
    [
      'a host save missing its own field, reported before the game',
      '{"role":"host","code":"ABCD","myName":"Ann","game":"junk","oppName":null}',
      '$.target: expected integer in [1,',
    ],
    [
      'a host save with a broken game, reported after its own field',
      '{"role":"host","code":"ABCD","myName":"Ann","target":5,"game":"junk","oppName":null}',
      '$.game: expected object',
    ],
    ['a guest save without a name', '{"role":"guest","code":"ABCD"}', '$.myName: expected string'],
  ])('refuses %s', (_label, text, reason) => {
    const s = fakeStorage();
    s.setItem('toyMP_v1', text);
    const read = readSave(createStore(s));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error).toMatchObject({ kind: 'invalid', key: 'toyMP_v1' });
    expect((read.error as { reason: string }).reason).toContain(reason);
  });

  test("decodeSave is the reader's decoder, over a parsed value", () => {
    expect(decodeSave({ role: 'guest', code: 'ABCD', myName: 'Ann', extra: 1 })).toEqual({
      ok: true,
      value: { role: 'guest', code: 'ABCD', myName: 'Ann' },
    });
    expect(decodeSave('not an object')).toEqual({
      ok: false,
      error: { path: [], expected: 'object' },
    });
  });

  test("the code's length in the message follows the game's room-code spec", () => {
    const fidice = shellSave<Toy, Extra>({
      key: 'k',
      game: 'fidice',
      decodeGame: toy,
      hostExtra: {
        decode: object({ target: integer(1) }),
        literal: (save) => ({ target: save.target }),
      },
    });
    expect(fidice.decodeSave({ role: 'guest', code: 'ABCD', myName: 'Ann' })).toEqual({
      ok: false,
      error: { path: ['code'], expected: 'a 5-letter room code' },
    });
  });
});

describe('shellStore', () => {
  test('groups the seven preferences and the save over one game`s keys, each under its own key, for the shell config to carry', () => {
    const storage = fakeStorage();
    const store = createStore(storage);
    const keys = {
      save: 'g_save',
      name: 'g_name',
      p2Name: 'g_p2Name',
      homeTab: 'g_homeTab',
      playMode: 'g_playMode',
      sound: 'g_sound',
      soundFont: 'g_soundFont',
      extra: 'g_extra',
    } as const;
    const shell = shellStore<
      Readonly<{ n: number }>,
      Readonly<{ level: number }>,
      'play' | 'rules'
    >(keys, {
      game: 'gin-rummy',
      decodeGame: object({ n: integer() }),
      hostExtra: {
        decode: object({ level: integer(1) }),
        literal: (save) => ({ level: save.level }),
      },
      decodeHomeTab: literal('play', 'rules'),
    });
    shell.name.write(store, 'Ann');
    shell.p2Name.write(store, 'Bob');
    shell.homeTab.write(store, 'rules');
    shell.playMode.write(store, 'local');
    shell.sound.write(store, 'off');
    shell.soundFont.write(store, 'felt');
    shell.save.writeSave(store, {
      role: 'host',
      code: 'ABCD',
      myName: 'Ann',
      level: 3,
      game: { n: 1 },
      oppName: null,
    });
    expect([...storage.map.entries()]).toEqual([
      ['g_name', 'Ann'],
      ['g_p2Name', 'Bob'],
      ['g_homeTab', 'rules'],
      ['g_playMode', 'local'],
      ['g_sound', 'off'],
      ['g_soundFont', 'felt'],
      [
        'g_save',
        '{"role":"host","code":"ABCD","myName":"Ann","level":3,"game":{"n":1},"oppName":null}',
      ],
    ]);
    expect(shell.name.read(store)).toEqual({ ok: true, value: 'Ann' });
    expect(shell.homeTab.read(store)).toEqual({ ok: true, value: 'rules' });
    expect(shell.sound.enabled(store)).toBe(false);
    expect(shell.save.readSave(store)).toMatchObject({
      ok: true,
      value: { role: 'host', level: 3 },
    });
    shell.save.clearSave(store);
    expect(storage.map.has('g_save')).toBe(false);
  });
});
