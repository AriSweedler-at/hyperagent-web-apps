// The half of the shell config spelled from the engine, the protocol and storage alone
// (shellConfig.ts): the option parsers off raw inputs with their fallbacks and the engine's
// normalisation, `pickOpts` over a hostile frame, the copy, the mode parser, the engine adapters
// over a pair (create, apply, viewFor, over, finished, names, renameGuest, decodeState) and the
// home read over a store (defaults when unreadable, the pack and the extra names when set). The
// table hooks that complete it are ui/state.test.ts's.
import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../shared/lib/rng.ts';
import { applyAction, viewFor, type GameOptions, type Players } from './engine/index.ts';
import {
  BRISCOLA_SHELL,
  DEFAULT_NAME,
  DEFAULT_OPTS,
  LEAVE_LOCAL_MSG,
  LEAVE_ONLINE_MSG,
  hostRoomMsg,
  matchLabel,
  parseFlag,
  parseGamesToWin,
  parseOpts,
  parseSeatCount,
  parseSuit,
  pickOpts,
} from './shellConfig.ts';
import { DEFAULT_CARD_PACK, SHELL_STORE, STORAGE_KEYS } from './storage.ts';
import { initialShell } from './ui/state.ts';

const NOW = 1_700_000_000_000;
const PAIR: Players = [
  { id: 'h', name: 'Ann' },
  { id: 'g', name: 'Bob' },
];

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

describe('the copy', () => {
  test('the match badge, the guest status, the leave confirms, the default name', () => {
    expect([1, 2, 3].map((n) => matchLabel(n as 1 | 2 | 3))).toEqual([
      'one game',
      'best of 3',
      'best of 5',
    ]);
    expect(hostRoomMsg('Ann')).toBe('Connected — waiting for Ann to deal');
    expect(BRISCOLA_SHELL.copy.hostRoom('Bob', DEFAULT_OPTS)).toBe(hostRoomMsg('Bob'));
    expect(BRISCOLA_SHELL.copy.leaveLocal).toBe(LEAVE_LOCAL_MSG);
    expect(BRISCOLA_SHELL.copy.leaveOnline).toBe(LEAVE_ONLINE_MSG);
    expect(BRISCOLA_SHELL.names.default).toBe(DEFAULT_NAME);
    expect(BRISCOLA_SHELL.id).toBe('briscola');
    expect(BRISCOLA_SHELL.prefs).toBe(SHELL_STORE);
  });

  test('the play mode: local or online, anything else online', () => {
    expect(BRISCOLA_SHELL.modes.parse('local', initialShell)).toEqual({
      shown: 'local',
      stored: 'local',
    });
    expect(BRISCOLA_SHELL.modes.parse('online', initialShell)).toEqual({
      shown: 'online',
      stored: 'online',
    });
    expect(BRISCOLA_SHELL.modes.parse('sandbox', initialShell)).toEqual({
      shown: 'online',
      stored: 'online',
    });
  });
});

describe('the option parsers', () => {
  test("each raw value is one of the engine's, else the fallback; a flag is on for `on` or `true`, kept when absent", () => {
    expect(parseSeatCount('3', 2)).toBe(3);
    expect(parseSeatCount('9', 2)).toBe(2);
    expect(parseSeatCount(undefined, 4)).toBe(4);
    expect(parseGamesToWin('2', 1)).toBe(2);
    expect(parseGamesToWin('x', 3)).toBe(3);
    expect(parseSuit('D', 'C')).toBe('D');
    expect(parseSuit('Z', 'C')).toBe('C');
    expect(parseSuit(undefined, 'B')).toBe('B');
    expect(parseFlag(undefined, true)).toBe(true);
    expect(parseFlag('on', false)).toBe(true);
    expect(parseFlag('true', false)).toBe(true);
    expect(parseFlag('off', true)).toBe(false);
    expect(parseFlag('', true)).toBe(false);
  });

  test('parseOpts reads the online selects or their pass-and-play twins, falls back to the current room, and normalises (scoperta two-player, the peek four-player)', () => {
    expect(parseOpts({}, DEFAULT_OPTS)).toEqual(DEFAULT_OPTS);
    expect(
      parseOpts(
        {
          players: '2',
          match: '3',
          removedTwo: 'S',
          exchange: 'on',
          scoperta: 'on',
          partnerPeek: 'on',
        },
        DEFAULT_OPTS,
      ),
    ).toEqual({
      seatCount: 2,
      gamesToWin: 3,
      removedTwo: 'S',
      exchange: true,
      scoperta: true,
      partnerPeek: false,
    });
    expect(
      parseOpts(
        {
          localPlayers: '4',
          localMatch: '1',
          localRemovedTwo: 'D',
          localScoperta: 'on',
          localPartnerPeek: 'on',
        },
        DEFAULT_OPTS,
      ),
    ).toEqual({
      seatCount: 4,
      gamesToWin: 1,
      removedTwo: 'D',
      exchange: false,
      scoperta: false,
      partnerPeek: true,
    });
    // The online value wins over its twin when a click carries both; junk keeps the current room.
    const current: GameOptions = { ...DEFAULT_OPTS, seatCount: 3, exchange: true };
    expect(parseOpts({ players: '2', localPlayers: '4', match: 'nope' }, current)).toMatchObject({
      seatCount: 2,
      gamesToWin: current.gamesToWin,
      exchange: true,
    });
  });

  test('pickOpts keeps the six terms of a frame and normalises a hostile one', () => {
    const hostile: GameOptions = {
      seatCount: 4,
      gamesToWin: 3,
      removedTwo: 'B',
      exchange: true,
      scoperta: true,
      partnerPeek: true,
    };
    expect(pickOpts(hostile)).toEqual({ ...hostile, scoperta: false });
    expect(pickOpts({ ...hostile, seatCount: 2 })).toEqual({
      ...hostile,
      seatCount: 2,
      partnerPeek: false,
    });
    expect(BRISCOLA_SHELL.opts.pick).toBe(pickOpts);
    expect(BRISCOLA_SHELL.opts.parse).toBe(parseOpts);
    expect(BRISCOLA_SHELL.opts.initial).toBe(DEFAULT_OPTS);
  });
});

describe('the engine adapters over a pair', () => {
  const { engine } = BRISCOLA_SHELL;
  const game = engine.create(PAIR, DEFAULT_OPTS, mulberry32(3), () => NOW);

  test("create deals the pair; the options come off the game; apply and viewFor are the engine's", () => {
    expect(BRISCOLA_SHELL.opts.ofGame(game)).toEqual(DEFAULT_OPTS);
    expect(engine.names(game)).toEqual(['Ann', 'Bob']);
    expect(engine.finished(game)).toBe(false);
    expect(engine.over(viewFor(game, 0))).toBe(false);
    expect(engine.apply).toBe(applyAction);
    expect(engine.viewFor).toBe(viewFor);
    const actor = engine.viewFor(game, game.turn);
    const card = actor.legal[0];
    if (card === undefined) throw new Error('no legal card for the actor');
    const played = engine.apply(
      game,
      game.turn,
      { type: 'play', cardId: card },
      mulberry32(3),
      () => NOW,
    );
    expect(played.ok).toBe(true);
    if (played.ok) expect(played.value.trick).toHaveLength(1);
  });

  test('the finished match`s record: the deal`s clock, every name, the games won per side, the winning side', () => {
    const { result } = BRISCOLA_SHELL;
    const v = viewFor(game, 0);
    expect(result.keyOf(v)).toBe(String(game.startedAt));
    expect(result.playersOf(v)).toEqual(['Ann', 'Bob']);
    expect(result.scoreOf(v)).toBe('0–0');
    expect(result.winnerOf(v)).toBeNull();
    const won = { ...v, match: { ...v.match, wins: [1, 2] }, matchOver: true };
    expect(result.scoreOf(won)).toBe('1–2');
    expect(result.winnerOf(won)).toBe(1);
  });

  test('renameGuest renames seat 1 alone; decodeState is the engine decoder', () => {
    const renamed = engine.renameGuest(game, 'Zed');
    expect(renamed.players.map((p) => p.name)).toEqual(['Ann', 'Zed']);
    expect(renamed.players[0]).toBe(game.players[0]);
    expect(engine.decodeState(JSON.parse(JSON.stringify(game)))).toEqual({ ok: true, value: game });
    expect(engine.decodeState({ nope: 1 }).ok).toBe(false);
  });
});

describe('home.read', () => {
  test('defaults on an empty store; the pack and the third and fourth names when stored', () => {
    const empty = createStore(fakeStorage());
    expect(BRISCOLA_SHELL.home.read(empty)).toEqual({
      opts: DEFAULT_OPTS,
      cardPack: DEFAULT_CARD_PACK,
      p3Name: null,
      p4Name: null,
    });
    const storage = fakeStorage();
    storage.setItem(STORAGE_KEYS.cardPack, 'linea');
    storage.setItem(STORAGE_KEYS.p3Name, 'Cara');
    storage.setItem(STORAGE_KEYS.p4Name, 'Dan');
    storage.setItem(STORAGE_KEYS.players, '4');
    expect(BRISCOLA_SHELL.home.read(createStore(storage))).toEqual({
      opts: { ...DEFAULT_OPTS, seatCount: 4 },
      cardPack: 'linea',
      p3Name: 'Cara',
      p4Name: 'Dan',
    });
    expect(BRISCOLA_SHELL.tabs.list).toEqual(['play', 'rules', 'about']);
    expect(BRISCOLA_SHELL.cues.initial).toEqual({ key: null });
  });
});
