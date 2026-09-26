// The half of the shell config spelled from the engine, the protocol and storage alone
// (shellConfig.ts): the seat count parser off raw inputs with its fallback and the fixed terms
// under the engine's normalisation, `pickOpts` over a hostile frame, the copy, the mode parser, the engine adapters
// over a pair and over three seats (create, apply, viewFor, over, finished, names, renameGuest by
// seat, decodeState), the N-seat table and its copy forms (docs/design/n-seat-sessions.md §7: the
// two-seat string at a table of two, the count past) and the home read over a store (defaults when
// unreadable, the pack and the extra names when set). The table hooks that complete it are
// ui/state.test.ts's.
import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../shared/lib/rng.ts';
import { WAITING_MSG } from '../../../shared/net/host.ts';
import {
  OPPONENT_LEFT_MSG,
  WAITING_FOR_GUEST_MSG,
  guestGoneMsg,
  joinedMsg,
} from '../../../shared/ui/shell.ts';
import { applyAction, viewFor, type GameOptions, type Players } from './engine/index.ts';
import {
  BRISCOLA_SHELL,
  DEFAULT_NAME,
  DEFAULT_OPTS,
  LEAVE_LOCAL_MSG,
  LEAVE_ONLINE_MSG,
  ONE_GAME,
  TABLE_FULL_MSG,
  TABLE_TERMS,
  emptySeatName,
  hostRoomMsg,
  joinedText,
  notEnoughMsg,
  parseOpts,
  parseSeatCount,
  pickOpts,
  seatGoneMsg,
  seatLeftMsg,
  seatPlayers,
  waitingMsg,
} from './shellConfig.ts';
import { lobby, welcome } from './protocol.ts';
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
  test('the guest status, the leave confirms (a game, never a match), the default name', () => {
    expect(hostRoomMsg('Ann')).toBe('Connected — waiting for Ann to deal');
    expect(LEAVE_LOCAL_MSG).toBe('End this game? The score will be cleared.');
    expect(LEAVE_ONLINE_MSG).toBe('Leave this game? The table will close.');
    expect(BRISCOLA_SHELL.copy.hostRoom('Bob', DEFAULT_OPTS, 2, 2)).toBe(hostRoomMsg('Bob'));
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

describe('the table (docs/design/n-seat-sessions.md §7)', () => {
  test("seats two to four, fixed (a room starts full); the session's capacity is the room's seat count; the lobby is protocol.ts's four-argument builder, the welcome the codec's", () => {
    expect(BRISCOLA_SHELL.seats).toEqual({ min: 2, max: 4, fixed: true });
    const { capacity } = BRISCOLA_SHELL.opts;
    if (capacity === undefined) throw new Error('no capacity reader');
    expect(capacity(DEFAULT_OPTS)).toBe(2);
    expect(capacity({ ...DEFAULT_OPTS, seatCount: 3 })).toBe(3);
    expect(capacity({ ...DEFAULT_OPTS, seatCount: 4 })).toBe(4);
    expect(BRISCOLA_SHELL.frames.lobby).toBe(lobby);
    expect('welcome' in BRISCOLA_SHELL.frames).toBe(false);
    // At two seats the frames are PR-4's, whatever table is passed; at three the table rides along.
    const table = [{ name: 'Bo', connected: true }];
    expect(lobby('Ann', DEFAULT_OPTS, table, 1)).toEqual({
      t: 'lobby',
      hostName: 'Ann',
      ...DEFAULT_OPTS,
    });
    const three = { ...DEFAULT_OPTS, seatCount: 3 as const };
    expect(welcome('Ann', three, [...table, { name: null, connected: false }], 2)).toEqual({
      t: 'welcome',
      hostName: 'Ann',
      ...three,
      seats: [...table, { name: null, connected: false }],
      you: 2,
    });
  });

  test('the N-seat copy is the shell`s two-seat string at a table of two, and counts past it', () => {
    const { copy } = BRISCOLA_SHELL;
    expect(copy.waiting?.(2)).toBe(WAITING_MSG);
    expect(waitingMsg(3)).toBe('Waiting for 2 players to join');
    expect(waitingMsg(4)).toBe('Waiting for 3 players to join');
    expect(copy.joined?.('Bob', ['Bob'], 0)).toBe(joinedMsg('Bob'));
    expect(joinedText('Bob', 2)).toBe('Bob joined! Waiting for 2 more.');
    expect(joinedText('Cara', 1)).toBe('Cara joined! Waiting for 1 more.');
    expect(copy.seatLeft?.('Bob', 1, 1, 2)).toBe(OPPONENT_LEFT_MSG);
    expect(seatLeftMsg('Bob', 1, 2, 3)).toBe('Bob left. 2 of 3 seated.');
    expect(seatLeftMsg(null, 2, 3, 4)).toBe('Seat 3 left. 3 of 4 seated.');
    expect(emptySeatName(0)).toBe('Seat 1');
    expect(copy.guestGone?.('Bob', 'ABCD', 1)).toBe(guestGoneMsg('Bob', 'ABCD'));
    expect(seatGoneMsg(null, 'ABCD', 2)).toBe(guestGoneMsg('Seat 3', 'ABCD'));
    expect(copy.notEnough?.(1, 2)).toBe(WAITING_FOR_GUEST_MSG);
    expect(notEnoughMsg(2, 3)).toBe('2 of 3 seated — waiting for 1 more.');
    expect(notEnoughMsg(2, 4)).toBe('2 of 4 seated — waiting for 2 more.');
    expect(copy.roomFull).toBe(TABLE_FULL_MSG);
    expect(copy.hostRoom('Ann', DEFAULT_OPTS, 3, 4)).toBe(
      'Connected — 3 of 4 seated · waiting for Ann to deal',
    );
    expect(hostRoomMsg('Ann', 2, 3)).toBe('Connected — 2 of 3 seated · waiting for Ann to deal');
  });

  test('seatPlayers: the engine`s tuple for the count, a missing seat named by its number; create deals to the list the shell seated', () => {
    const list = [
      { id: 'host', name: 'Ann' },
      { id: 'guest', name: 'Bob' },
      { id: 'guest2', name: 'Cara' },
    ];
    expect(seatPlayers(2, list)).toEqual(list.slice(0, 2));
    expect(seatPlayers(3, list)).toEqual(list);
    expect(seatPlayers(4, list)).toEqual([...list, { id: 'p4', name: 'Player 4' }]);
    const three = BRISCOLA_SHELL.engine.create(
      list,
      { ...DEFAULT_OPTS, seatCount: 3 },
      mulberry32(3),
      () => NOW,
    );
    expect(three.players).toEqual(list);
    expect(three.options.seatCount).toBe(3);
    expect(three.hands).toHaveLength(3);
    // A rejoin renames the seat the session reseated the name at.
    const renamed = BRISCOLA_SHELL.engine.renameGuest(three, 'Zed', 2);
    expect(renamed.players.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Zed']);
    expect(viewFor(renamed, 2).me.name).toBe('Zed');
  });
});

describe('the option parsers', () => {
  test("the seat count is one of the engine's, else the fallback; the fixed terms are one game on the engine's defaults", () => {
    expect(parseSeatCount('3', 2)).toBe(3);
    expect(parseSeatCount('9', 2)).toBe(2);
    expect(parseSeatCount(undefined, 4)).toBe(4);
    expect(ONE_GAME).toBe(1);
    expect(TABLE_TERMS).toEqual({ gamesToWin: 1 });
    expect(DEFAULT_OPTS).toEqual({
      seatCount: 2,
      gamesToWin: 1,
      removedTwo: 'C',
      exchange: false,
      scoperta: false,
      partnerPeek: false,
    });
  });

  test('parseOpts reads the online seat count or its pass-and-play twin, falls back to the current count, and puts it on the fixed terms whatever the current room carried', () => {
    expect(parseOpts({}, DEFAULT_OPTS)).toEqual(DEFAULT_OPTS);
    expect(parseOpts({ players: '3' }, DEFAULT_OPTS)).toEqual({ ...DEFAULT_OPTS, seatCount: 3 });
    expect(parseOpts({ localPlayers: '4' }, DEFAULT_OPTS)).toEqual({
      ...DEFAULT_OPTS,
      seatCount: 4,
    });
    // The online value wins over its twin when a click carries both; junk keeps the current count.
    const current: GameOptions = {
      ...DEFAULT_OPTS,
      seatCount: 3,
      gamesToWin: 3,
      removedTwo: 'S',
      exchange: true,
    };
    expect(parseOpts({ players: '2', localPlayers: '4' }, current)).toEqual({
      ...DEFAULT_OPTS,
      seatCount: 2,
    });
    // A resumed room may still hold a match and a house rule: a new room is dealt on the fixed terms.
    expect(parseOpts({ players: 'nope' }, current)).toEqual({ ...DEFAULT_OPTS, seatCount: 3 });
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
    // Over when the last trick is played, decided or drawn (one game per sitting); the match beneath is the engine's.
    const drawn = {
      ...game,
      phase: 'over' as const,
      match: { ...game.match, wins: [0, 0], draws: 1 },
    };
    expect(engine.finished(drawn)).toBe(true);
    expect(engine.over({ ...viewFor(game, 0), phase: 'over', matchOver: false })).toBe(true);
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

  test('the finished game`s record: the deal`s clock, every name, the points per side, the winning side (null for a draw)', () => {
    const { result } = BRISCOLA_SHELL;
    const v = viewFor(game, 0);
    expect(result.keyOf(v)).toBe(String(game.startedAt));
    expect(result.playersOf(v)).toEqual(['Ann', 'Bob']);
    expect(result.scoreOf(v)).toBe('0–0');
    expect(result.winnerOf(v)).toBeNull();
    const won = { ...v, result: { winner: 1 as const, totals: [49, 71], draw: false } };
    expect(result.scoreOf(won)).toBe('49–71');
    expect(result.winnerOf(won)).toBe(1);
    const drawn = { ...v, result: { winner: null, totals: [60, 60], draw: true } };
    expect(result.scoreOf(drawn)).toBe('60–60');
    expect(result.winnerOf(drawn)).toBeNull();
  });

  test('renameGuest renames the seat it is told alone; decodeState is the engine decoder', () => {
    const renamed = engine.renameGuest(game, 'Zed', 1);
    expect(renamed.players.map((p) => p.name)).toEqual(['Ann', 'Zed']);
    expect(renamed.players[0]).toBe(game.players[0]);
    expect(engine.decodeState(JSON.parse(JSON.stringify(game)))).toEqual({ ok: true, value: game });
    expect(engine.decodeState({ nope: 1 }).ok).toBe(false);
  });
});

describe('home.read', () => {
  test('defaults on an empty store; the pack, the language and the third and fourth names when stored', () => {
    const empty = createStore(fakeStorage());
    expect(BRISCOLA_SHELL.home.read(empty)).toEqual({
      opts: DEFAULT_OPTS,
      cardPack: DEFAULT_CARD_PACK,
      lang: 'it',
      speed: 'normal',
      p3Name: null,
      p4Name: null,
    });
    const storage = fakeStorage();
    storage.setItem(STORAGE_KEYS.speed, 'quick');
    storage.setItem(STORAGE_KEYS.cardPack, 'linea');
    storage.setItem(STORAGE_KEYS.lang, 'en');
    storage.setItem(STORAGE_KEYS.p3Name, 'Cara');
    storage.setItem(STORAGE_KEYS.p4Name, 'Dan');
    storage.setItem(STORAGE_KEYS.players, '4');
    expect(BRISCOLA_SHELL.home.read(createStore(storage))).toEqual({
      opts: { ...DEFAULT_OPTS, seatCount: 4 },
      cardPack: 'linea',
      lang: 'en',
      p3Name: 'Cara',
      p4Name: 'Dan',
      speed: 'quick',
    });
    expect(BRISCOLA_SHELL.tabs.list).toEqual(['play', 'rules', 'about']);
    expect(BRISCOLA_SHELL.cues.initial).toEqual({ key: null });
  });
});
