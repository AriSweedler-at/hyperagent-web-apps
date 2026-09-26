// The half of the shell config spelled from the engine, the protocol and storage alone
// (shellConfig.ts): the option parsers off raw inputs with their fallbacks, the copy and its N-seat
// forms (the two-seat string at a table of two, the count past), the mode parser (Solo and Watch
// shown, never stored), the table (one to six, never fixed, the session's capacity the chairs), the
// seating (the host first or standing, the connected guests, the computers; the ids that meet the
// engine's chairs), the engine adapters (apply for a shell seat, viewFor's redaction, over,
// finished, names, renameGuest by seat, decodeState), the result record and the home read.
import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../shared/lib/rng.ts';
import { WAITING_MSG } from '../../../shared/net/host.ts';
import { OPPONENT_LEFT_MSG, guestGoneMsg, joinedMsg } from '../../../shared/ui/shell.ts';
import { HOST, apply } from './domain/game.ts';
import { lobby } from './protocol.ts';
import {
  DEFAULT_NAME,
  DEFAULT_OPTS,
  FIDICE_SHELL,
  LEAVE_LOCAL_MSG,
  LEAVE_ONLINE_MSG,
  NEED_PLAYERS_MSG,
  NOT_SEATED_MSG,
  TABLE_FULL_MSG,
  actorFor,
  engineSeatOf,
  hostRoomMsg,
  joinedText,
  parseOpts,
  pickOpts,
  seatGoneMsg,
  seatId,
  seatLeftMsg,
  seatTable,
  shellSeatOf,
  waitingMsg,
  withBotNames,
} from './shellConfig.ts';
import { SHELL_STORE, STORAGE_KEYS } from './storage.ts';
import { initialShell } from './ui/state.ts';

const NOW = 1_700_000_000_000;
const now = (): number => NOW;
const PAIR = [
  { id: 'host', name: 'Ann' },
  { id: 'guest', name: 'Bob' },
] as const;

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
  test('the guest status, the leave confirms, the default name, the id and the store', () => {
    expect(hostRoomMsg('Ann')).toBe('Connected — waiting for Ann to start');
    expect(hostRoomMsg('Ann', 3, 6)).toBe('Connected — 3 of 6 seated · waiting for Ann to start');
    expect(FIDICE_SHELL.copy.hostRoom('Bob', DEFAULT_OPTS, 2, 2)).toBe(hostRoomMsg('Bob'));
    expect(FIDICE_SHELL.copy.leaveLocal).toBe(LEAVE_LOCAL_MSG);
    expect(FIDICE_SHELL.copy.leaveOnline).toBe(LEAVE_ONLINE_MSG);
    expect(FIDICE_SHELL.names.default).toBe(DEFAULT_NAME);
    expect(FIDICE_SHELL.localNames).toEqual(['Ari', 'Lavi']);
    expect(FIDICE_SHELL.id).toBe('fidice');
    expect(FIDICE_SHELL.prefs).toBe(SHELL_STORE);
    expect(FIDICE_SHELL.tabs).toEqual({
      list: ['play', 'rules', 'ladder', 'about'],
      default: 'play',
    });
  });

  test('the N-seat forms: the two-seat string at a table of two, the count past (n-seat-sessions.md §7)', () => {
    expect(waitingMsg(2)).toBe(WAITING_MSG);
    expect(waitingMsg(6)).toBe('Waiting for players — 6 chairs at the table');
    expect(joinedText('Bo', 2, 2)).toBe(joinedMsg('Bo'));
    expect(joinedText('Bo', 2, 6)).toBe('Bo joined! 2 of 6 seated — start when ready.');
    expect(FIDICE_SHELL.copy.joined?.('Bo', ['Bo'], 4)).toBe(joinedText('Bo', 2, 6));
    expect(seatLeftMsg('Bo', 1, 1, 2)).toBe(OPPONENT_LEFT_MSG);
    expect(seatLeftMsg(null, 3, 2, 6)).toBe('Seat 4 left. 2 of 6 seated.');
    expect(seatGoneMsg('Bo', 'ABCDE', 1)).toBe(guestGoneMsg('Bo', 'ABCDE'));
    expect(seatGoneMsg(null, 'ABCDE', 2)).toBe(guestGoneMsg('Seat 3', 'ABCDE'));
    expect(FIDICE_SHELL.copy.notEnough?.(1, 1)).toBe(NEED_PLAYERS_MSG);
    expect(NEED_PLAYERS_MSG).toBe('Need at least 2 players.');
    expect(FIDICE_SHELL.copy.roomFull).toBe(TABLE_FULL_MSG);
  });

  test('the play mode: local and online stored; solo and watch shown only (plan §7 D9); anything else online', () => {
    expect(FIDICE_SHELL.modes.parse('local', initialShell)).toEqual({
      shown: 'local',
      stored: 'local',
    });
    expect(FIDICE_SHELL.modes.parse('online', initialShell)).toEqual({
      shown: 'online',
      stored: 'online',
    });
    expect(FIDICE_SHELL.modes.parse('solo', initialShell)).toEqual({ shown: 'solo', stored: null });
    expect(FIDICE_SHELL.modes.parse('watch', initialShell)).toEqual({
      shown: 'watch',
      stored: null,
    });
    expect(FIDICE_SHELL.modes.parse('sandbox', initialShell)).toEqual({
      shown: 'online',
      stored: 'online',
    });
  });
});

describe('the options', () => {
  test('parseOpts: each select or the current term; the difficulty maps to its strategy, an exact choice wins; watch is left alone', () => {
    expect(parseOpts({}, DEFAULT_OPTS)).toEqual(DEFAULT_OPTS);
    expect(
      parseOpts({ lives: '3', seats: '4', bots: '2', difficulty: 'hard' }, DEFAULT_OPTS),
    ).toEqual({
      lives: 3,
      seatCount: 4,
      bots: 2,
      botChoice: 'gambler',
      watch: false,
    });
    expect(parseOpts({ difficulty: 'easy' }, DEFAULT_OPTS).botChoice).toBe('pressure');
    expect(parseOpts({ difficulty: 'nope' }, DEFAULT_OPTS).botChoice).toBe('profiler');
    expect(
      parseOpts({ difficulty: 'hard', botChoice: 'learner-100' }, DEFAULT_OPTS).botChoice,
    ).toBe('learner-100');
    expect(
      parseOpts({ lives: '-1', seats: '7', bots: '9' }, { ...DEFAULT_OPTS, watch: true }),
    ).toEqual({
      ...DEFAULT_OPTS,
      watch: true,
    });
    expect(pickOpts({ ...DEFAULT_OPTS, lives: 2, extra: 1 } as never)).toEqual({
      ...DEFAULT_OPTS,
      lives: 2,
    });
    expect(Object.keys(pickOpts(DEFAULT_OPTS))).toEqual([
      'lives',
      'seatCount',
      'bots',
      'botChoice',
      'watch',
    ]);
  });

  test('the table: one to six, never fixed; the session hosts the chairs; the lobby is protocol.ts`s builder', () => {
    expect(FIDICE_SHELL.seats).toEqual({ min: 1, max: 6 });
    const { capacity } = FIDICE_SHELL.opts;
    if (capacity === undefined) throw new Error('no capacity reader');
    expect(capacity(DEFAULT_OPTS)).toBe(6);
    expect(capacity({ ...DEFAULT_OPTS, seatCount: 3 })).toBe(3);
    expect(FIDICE_SHELL.frames.lobby).toBe(lobby);
    expect('welcome' in FIDICE_SHELL.frames).toBe(false);
  });
});

describe('the seating (the shell`s channels and the engine`s chairs)', () => {
  test('seatId and shellSeatOf are inverses over the six seats; a computer names none', () => {
    expect([0, 1, 2, 3, 4, 5].map(seatId)).toEqual([
      'host',
      'guest',
      'guest2',
      'guest3',
      'guest4',
      'guest5',
    ]);
    expect(['host', 'guest', 'guest2', 'guest5', 'bot0', 'p1'].map(shellSeatOf)).toEqual([
      0,
      1,
      2,
      5,
      null,
      null,
    ]);
  });

  test('seatTable: the host first, the connected guests in order, the computers after; a watching host stands; a chair too many is skipped', () => {
    const table = seatTable(
      'ABCDE',
      [PAIR[0], { id: 'guest3', name: 'Dee' }],
      { ...DEFAULT_OPTS, bots: 2, lives: 3 },
      mulberry32(1),
    );
    expect(table.phase).toBe('lobby');
    expect(table.code).toBe('ABCDE');
    expect(table.lives).toBe(3);
    expect(table.hostSeat).toBe(0);
    expect(table.players.map((p) => [p.id, p.name, p.bot?.strategy ?? null, p.lives])).toEqual([
      ['host', 'Ann', null, 3],
      ['guest3', 'Dee', null, 3],
      ['bot0', 'Loon', 'profiler', 3],
      ['bot1', 'Moose', 'profiler', 3],
    ]);
    expect(engineSeatOf(table, 3)).toBe(1);
    expect(engineSeatOf(table, 1)).toBeNull();
    expect(actorFor(table, 3)).toEqual({ kind: 'seat', seat: 1 });
    expect(actorFor(table, 1)).toBeNull();
    expect(actorFor(table, 0)).toEqual({ kind: 'seat', seat: 0 });
    const watching = seatTable(
      '',
      [PAIR[0], PAIR[1]],
      { ...DEFAULT_OPTS, watch: true, bots: 4 },
      mulberry32(1),
    );
    expect(watching.hostSeat).toBeNull();
    expect(watching.players.map((p) => p.id)).toEqual(['guest', 'bot0', 'bot1', 'bot2', 'bot3']);
    expect(actorFor(watching, 0)).toBe(HOST);
    expect(engineSeatOf(watching, 1)).toBe(0);
    // Seven would sit: the sixth chair is the last (lobby.ts `seatPlayer` refuses, the state is kept).
    const full = seatTable('', [PAIR[0], PAIR[1]], { ...DEFAULT_OPTS, bots: 5 }, mulberry32(1));
    expect(full.players).toHaveLength(6);
    // `random` draws each computer's strategy from the shipped three with the rng.
    const drawn = seatTable(
      '',
      [PAIR[0]],
      { ...DEFAULT_OPTS, bots: 3, botChoice: 'random' },
      mulberry32(2),
    );
    expect(drawn.players.slice(1).every((p) => p.bot?.random === true)).toBe(true);
    expect(withBotNames(table, ['Rex', null]).players.map((p) => p.name)).toEqual([
      'Ann',
      'Dee',
      'Rex',
      'Moose',
    ]);
  });
});

describe('the engine adapters', () => {
  const rng = mulberry32(5);
  const started = apply(
    seatTable('ABCDE', [PAIR[0], PAIR[1]], DEFAULT_OPTS, rng),
    HOST,
    { type: 'start' },
    rng,
  );
  if (!started.ok) throw new Error(started.error);
  const game = started.value;

  test('apply for a shell seat: its chair`s action with the log stamped; the HOST for a standing host; an empty seat refused', () => {
    const peeked = FIDICE_SHELL.engine.apply(game, 0, { type: 'peek' }, rng, now);
    if (!peeked.ok) throw new Error(peeked.error);
    expect(peeked.value.round?.touched).toBe(true);
    expect(peeked.value.log.every((e) => e.at === NOW)).toBe(true);
    expect(FIDICE_SHELL.engine.apply(game, 1, { type: 'peek' }, rng, now)).toEqual({
      ok: false,
      error: "It's not your turn.",
    });
    expect(FIDICE_SHELL.engine.apply(game, 3, { type: 'peek' }, rng, now)).toEqual({
      ok: false,
      error: NOT_SEATED_MSG,
    });
    const watching = seatTable(
      '',
      [PAIR[0], PAIR[1]],
      { ...DEFAULT_OPTS, watch: true, bots: 1 },
      rng,
    );
    const begun = FIDICE_SHELL.engine.apply(watching, 0, { type: 'start' }, rng, now);
    expect(begun.ok).toBe(true);
  });

  test('viewFor redacts for the chair; a seat with no chair sees as a spectator; over, finished, names, renameGuest, decodeState', () => {
    const peeked = FIDICE_SHELL.engine.apply(game, 0, { type: 'peek' }, rng, now);
    if (!peeked.ok) throw new Error(peeked.error);
    const holder = FIDICE_SHELL.engine.viewFor(peeked.value, 0);
    const other = FIDICE_SHELL.engine.viewFor(peeked.value, 1);
    const stranger = FIDICE_SHELL.engine.viewFor(peeked.value, 4);
    expect(holder.round?.dice.every((d) => d.value !== null)).toBe(true);
    expect(other.round?.dice.every((d) => d.value === null)).toBe(true);
    expect(stranger.round?.dice.every((d) => d.value !== null)).toBe(true);
    expect(FIDICE_SHELL.engine.over(holder)).toBe(false);
    expect(FIDICE_SHELL.engine.finished(game)).toBe(false);
    expect(FIDICE_SHELL.engine.finished({ ...game, phase: 'over' })).toBe(true);
    expect(FIDICE_SHELL.engine.names(game)).toEqual(['Ann', 'Bob']);
    const renamed = FIDICE_SHELL.engine.renameGuest(
      { ...game, players: game.players.map((p, i) => (i === 1 ? { ...p, connected: false } : p)) },
      '  Robert Longname Here ',
      1,
    );
    expect(renamed.players[1]).toMatchObject({ name: 'Robert Longname ', connected: true });
    expect(renamed.log.at(-1)?.text).toBe('Robert Longname  is back at the table.');
    expect(FIDICE_SHELL.engine.decodeState(JSON.parse(JSON.stringify(game)))).toEqual({
      ok: true,
      value: game,
    });
    expect(FIDICE_SHELL.engine.decodeState({ ...game, phase: 'paused' }).ok).toBe(false);
  });

  test('the result: the room and the deal`s clock, every chair`s name, the score as kept, the winner`s shell seat', () => {
    const stamped = { ...game, log: game.log.map((e) => ({ ...e, at: NOW })) };
    const view = FIDICE_SHELL.engine.viewFor(stamped, 0);
    expect(FIDICE_SHELL.result.keyOf(view)).toBe(`ABCDE@${String(NOW)}`);
    expect(FIDICE_SHELL.result.playersOf(view)).toEqual(['Ann', 'Bob']);
    expect(FIDICE_SHELL.result.scoreOf(view)).toBe('0–0');
    expect(
      FIDICE_SHELL.result.scoreOf({
        ...view,
        lives: 3,
        players: view.players.map((p, i) => ({ ...p, lives: 3 - i })),
      }),
    ).toBe('3–2');
    expect(FIDICE_SHELL.result.winnerOf(view)).toBeNull();
    expect(FIDICE_SHELL.result.winnerOf({ ...view, winner: 1 })).toBe(1);
    const shifted = {
      ...view,
      players: [{ ...view.players[1], id: 'guest3' }, view.players[0]],
    } as typeof view;
    expect(FIDICE_SHELL.result.winnerOf({ ...shifted, winner: 0 })).toBe(3);
  });
});

describe('home.read', () => {
  test('the terms (defaults when unreadable) and the third to sixth names (null when none)', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(FIDICE_SHELL.home.read(store)).toEqual({
      opts: DEFAULT_OPTS,
      extraNames: { 2: null, 3: null, 4: null, 5: null },
    });
    s.map.set(STORAGE_KEYS.lives, '2');
    s.map.set(STORAGE_KEYS.p4Name, 'Grant');
    expect(FIDICE_SHELL.home.read(store)).toEqual({
      opts: { ...DEFAULT_OPTS, lives: 2 },
      extraNames: { 2: null, 3: 'Grant', 4: null, 5: null },
    });
  });
});
