// The shell reducer over a FAKE_GAME (docs/design/shared-shell.md §4.1 "shell.test.ts over a
// FAKE_GAME"; §5 C2): a three-line engine (a move flips the turn, `end` ends the game, `bad` and
// a move out of turn are refused), a `{ level }` room, one own tab, one own timer, one own cue,
// one own resume offer, one own home key, and a table whose hooks record what the shell asked of
// them (`marks`: every `reset` site, every `rendered` with the `prev` and `now` it was given,
// every `refuse`). It covers every flow both games' state.test.ts cover through their wrappers,
// and pins what the games' suites pin only by effect ORDER: `initHome` (scrollTop, fillName,
// fillP2Name, the tab applied without a write), `leave/confirmed` (the wake lock dropped, the
// network closed, then `leave/finish`) and `cancel` (the network closed, then `cancel/finish`).
// The store is a Map, so this zone imports nothing from web/shared/edge; the effect runner
// (shellEffects.ts) is exercised here too, which is what holds the `web/shared/ui/**` row at 100.
import { describe, expect, test } from 'vitest';

import { arrayOf, boolean, literal, number, object, pair, string } from '../lib/json.ts';
import type { RecentGame } from '../lib/recentGames.ts';
import { err, ok, type Result } from '../lib/result.ts';
import { mulberry32 } from '../lib/rng.ts';
import { SHELL_CUES } from '../lib/sound/cues.ts';
import { SOUND_FONTS } from '../lib/sound/fonts.ts';
import {
  CONNECTING_MSG,
  DEFAULT_LOCAL_NAMES,
  DISCONNECTED_MSG,
  EMPTY_SEAT,
  GONE_TOAST_MS,
  LONG_PRESS_MS,
  LOST_HOST_MSG,
  OPPONENT_LEFT_MSG,
  ROOM_FULL_MSG,
  SANDBOX_LOCAL_ONLY_MSG,
  SHELL_EFFECT_TYPES,
  SHELL_INTENT_TYPES,
  WAITING_FOR_GUEST_MSG,
  WAITING_RESUME_MS,
  badPositionMsg,
  broadcast,
  fresh,
  guestContextOf,
  guestGoneMsg,
  guestNameAmong,
  hostContextOf,
  hostDispatch,
  initialShell,
  isShellEffect,
  isShellIntent,
  joinedMsg,
  localBroadcast,
  localNameFor,
  localNamesOf,
  localPlayers,
  localSeated,
  localSeats,
  pure,
  readHome,
  reduceShell,
  resumeFor,
  roomSeatingOf,
  saveFor,
  startLocal,
  step,
  toast,
  userSeatOf,
  withShell,
  withTable,
  type CueMemory,
  type Effect,
  type HomeSnapshot,
  type HostFrameOf,
  type Intent,
  type Player,
  type Save,
  type Seat,
  type SeatOf,
  type SeatState,
  type ShellApp,
  type ShellConfig,
  type ShellState,
  type Step,
} from './shell.ts';
import { runShellEffect, type ShellEffectDeps } from './shellEffects.ts';

// ---- the fake game ------------------------------------------------------------------------------

type State = Readonly<{
  players: Readonly<[Player, Player]>;
  level: number;
  turn: Seat;
  moves: number;
  over: boolean;
}>;
type View = Readonly<{
  seat: Seat;
  turn: Seat;
  moves: number;
  over: boolean;
  isMyTurn: boolean;
  names: Readonly<[string, string]>;
}>;
type Action = Readonly<{ type: 'move' | 'end' | 'bad' }>;
type Opts = Readonly<{ level: number }>;
type Table = Readonly<{ curtain: Seat | null; marks: ReadonlyArray<string> }>;
type Cues = Readonly<{ seen: string | null }>;
type Store = Map<string, string>;
type OwnIntent = Readonly<{ type: 'own' }>;
type OwnEffect = Readonly<{ type: 'ownFx' }>;

type Fake = Readonly<{
  Opts: Opts;
  Raw: Readonly<{ level: string }>;
  State: State;
  View: View;
  Action: Action;
  Table: Table;
  Tab: 'about';
  Mode: 'online' | 'local';
  Screen: never;
  Timer: 'own';
  Cue: 'ding';
  Cues: Cues;
  Resume: Readonly<{ kind: 'extra'; note: string }>;
  Home: Readonly<{ colour: string }>;
  Intent: OwnIntent;
  Effect: OwnEffect;
  Store: Store;
}>;
type App = ShellApp<Fake>;
type Shell = ShellState<Fake>;
type FakeEffect = Effect<Fake>;
type FakeIntent = Intent<Fake>;
type FakeStep = Step<Fake>;
type Snapshot = HomeSnapshot<Fake>;

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
const viewFor = (game: State, seat: Seat): View => ({
  seat,
  turn: game.turn,
  moves: game.moves,
  over: game.over,
  isMyTurn: game.turn === seat,
  names: [game.players[0].name, game.players[1].name],
});
const apply = (game: State, seat: Seat, action: Action): Result<State, string> =>
  action.type === 'bad' || seat !== game.turn
    ? err('Not your turn.')
    : ok(
        action.type === 'end'
          ? { ...game, over: true }
          : { ...game, moves: game.moves + 1, turn: other(game.turn) },
      );

const KEYS = {
  save: 'fake_save',
  name: 'fake_name',
  p2Name: 'fake_p2Name',
  homeTab: 'fake_homeTab',
  playMode: 'fake_playMode',
  soundFont: 'fake_soundFont',
  recentGames: 'fake_recentGames',
  colour: 'fake_colour',
} as const;
const TABS = ['play', 'rules', 'about'] as const;

/** A bare-string preference over the Map, refusing values outside `allowed`; an empty write removes the key (the name rule). */
const pref = <T extends string>(key: string, allowed: ReadonlyArray<T> | null) => ({
  read: (store: Store): Result<T, string> => {
    const v = store.get(key);
    if (v === undefined) return err('missing');
    return allowed === null || (allowed as ReadonlyArray<string>).includes(v)
      ? ok(v as T)
      : err('invalid');
  },
  write: (store: Store, value: T): void => {
    if (value === '') store.delete(key);
    else store.set(key, value);
  },
});

const FAKE: ShellConfig<Fake> = {
  id: 'gin-rummy',
  names: { default: 'Ari' },
  tabs: { list: TABS, default: 'play' },
  modes: {
    default: 'online',
    // `secret` is shown, never stored, while the first player is named `open`; otherwise ignored.
    parse: (raw, shell) => {
      if (raw === 'secret')
        return shell.p1Name === 'open' ? { shown: 'local', stored: null } : null;
      const mode = raw === 'local' ? 'local' : 'online';
      return { shown: mode, stored: mode };
    },
  },
  copy: {
    leaveLocal: 'Leave the local game?',
    leaveOnline: 'Leave the room?',
    opening: 'Opening…',
    connecting: (code) => `Connecting ${code}`,
    handoff: (code, oppName) => `Handoff ${code} to ${oppName ?? '-'}`,
    hostRoom: (hostName, opts) => `${hostName}'s room at level ${String(opts.level)}`,
  },
  opts: {
    initial: { level: 1 },
    parse: (raw, current) => ({ level: raw.level === '' ? current.level : Number(raw.level) }),
    ofGame: (game) => ({ level: game.level }),
    pick: (from) => ({ level: from.level }),
  },
  engine: {
    create: (players, { level }) => ({ players, level, turn: 0, moves: 0, over: false }),
    apply,
    viewFor,
    over: (view) => view.over,
    finished: (game) => game.over,
    names: (game) => [game.players[0].name, game.players[1].name],
    renameGuest: (game, name) => ({
      ...game,
      players: [game.players[0], { ...game.players[1], name }],
    }),
    // The hand-made state a `position/load` carries, checked field by field as the games' save decoders check theirs.
    decodeState: object({
      players: pair(object({ id: string, name: string })),
      level: number,
      turn: literal(0, 1),
      moves: number,
      over: boolean,
    }),
  },
  // The finished game's record: the position is the game's identity (a re-sent frame shows the
  // same one), the score counts the moves, the ender wins unless nobody moved (a draw).
  result: {
    keyOf: (view) => `${String(view.moves)}:${String(view.turn)}`,
    playersOf: (view) => view.names,
    scoreOf: (view) => `${String(view.moves)} moves`,
    winnerOf: (view) => (view.over && view.moves > 0 ? view.turn : null),
  },
  frames: {
    lobby: (hostName, opts) => ({ t: 'lobby', hostName, ...opts }),
    state: (view) => ({ t: 'state', view }),
    toast: (msg) => ({ t: 'toast', msg }),
    action: (action) => ({ t: 'action', action }),
  },
  cues: { initial: { seen: null } },
  table: {
    initial: { curtain: null, marks: [] },
    reset: (table, at) => ({ ...table, marks: [...table.marks, at] }),
    // The screen by the view, one `ding` per new position once there is a `prev`, and a mark saying what it was given.
    rendered: (app, prev, ctx) => {
      const view = app.shell.view;
      if (view === null) return { app, effects: [] };
      const key = `${String(view.moves)}:${String(view.turn)}`;
      const fresh = prev !== null && key !== app.shell.cues.seen;
      return step(
        {
          shell: {
            ...app.shell,
            cues: { seen: key },
            screen: view.over ? 'endgameScreen' : 'tableScreen',
          },
          table: {
            ...app.table,
            marks: [
              ...app.table.marks,
              `rendered:${prev === null ? '-' : 'prev'}@${String(ctx.now())}`,
            ],
          },
        },
        ...(fresh ? [{ type: 'fx', cue: 'ding' } as const] : []),
        { type: 'scrollTop' },
      );
    },
    refuse: (app, message) =>
      step(
        { ...app, table: { ...app.table, marks: [...app.table.marks, 'refused'] } },
        toast(message),
      ),
  },
  local: {
    // The mover's view; the curtain up unless they lifted it; the game's own effect rides along.
    viewer: (app, game) => ({
      seat: game.turn,
      curtain: !game.over && app.shell.revealed !== game.turn ? game.turn : null,
      effects: [{ type: 'ownFx' }],
    }),
    revealer: (game) => ({ seat: game.turn, effects: [{ type: 'ownFx' }] }),
  },
  home: {
    read: (store) => ({ colour: store.get(KEYS.colour) ?? 'green' }),
    apply: (app, home) => ({
      ...app,
      table: { ...app.table, marks: [...app.table.marks, `colour:${home.colour}`] },
    }),
    // The game's own offer first (a gold colour), then the shell's three.
    resume: (home) =>
      home.colour === 'gold' ? { kind: 'extra', note: 'gold' } : resumeFor(home.save, FAKE),
    resumeExtra: (app, offer) => step(app, toast(`extra:${offer.note}`)),
  },
  prefs: {
    name: pref(KEYS.name, null),
    p2Name: pref(KEYS.p2Name, null),
    homeTab: pref(KEYS.homeTab, TABS),
    playMode: pref(KEYS.playMode, ['online', 'local']),
    soundFont: pref(KEYS.soundFont, SOUND_FONTS),
    recentGames: {
      read: (store) => JSON.parse(store.get(KEYS.recentGames) ?? '[]') as ReadonlyArray<RecentGame>,
      append: (store, game) =>
        store.set(
          KEYS.recentGames,
          JSON.stringify([game, ...(JSON.parse(store.get(KEYS.recentGames) ?? '[]') as unknown[])]),
        ),
    },
    save: {
      readSave: (store) => {
        const raw = store.get(KEYS.save);
        if (raw === undefined) return err('missing');
        try {
          return ok(JSON.parse(raw) as Save<Fake>);
        } catch {
          return err('invalid');
        }
      },
      writeSave: (store, save) => store.set(KEYS.save, JSON.stringify(save)),
      clearSave: (store) => store.delete(KEYS.save),
    },
  },
};

// ---- helpers -----------------------------------------------------------------------------------

const NOW = 1_700_000_000_000;
const ctx = { rng: mulberry32(7), now: () => NOW };
const initialApp: App = { shell: initialShell(FAKE), table: FAKE.table.initial };

/** Dispatch shell intents in turn, collecting every effect. */
const run = (app: App, ...intents: ReadonlyArray<FakeIntent>): FakeStep =>
  intents.reduce<FakeStep>(
    (s, intent) => {
      if (!isShellIntent(intent)) throw new Error(`not a shell intent: ${intent.type}`);
      const next = reduceShell(s.app, intent, ctx, FAKE);
      return { app: next.app, effects: [...s.effects, ...next.effects] };
    },
    { app, effects: [] },
  );
const kinds = (effects: ReadonlyArray<FakeEffect>): ReadonlyArray<string> =>
  effects.map((e) => e.type);
const toasts = (effects: ReadonlyArray<FakeEffect>): ReadonlyArray<unknown> =>
  effects.flatMap((e) => (e.type === 'toast' ? [[e.message, e.ms]] : []));
const marks = (app: App): ReadonlyArray<string> => app.table.marks;
const game = (app: App): State => {
  const g = app.shell.game;
  if (g === null) throw new Error('no game');
  return g;
};

const home: Snapshot = {
  name: null,
  p2Name: null,
  homeTab: 'play',
  playMode: 'online',
  soundFont: 'default',
  save: null,
  recentGames: [],
  colour: 'green',
};

const PLAYERS: Readonly<[Player, Player]> = [
  { id: 'host', name: 'Ann' },
  { id: 'guest', name: 'Jeff' },
];
const dealt: State = { players: PLAYERS, level: 3, turn: 0, moves: 0, over: false };
const over: State = { ...dealt, over: true };
/** One finished game as the shell records it: seat 0 ended `dealt` after two moves. */
const RECORD: RecentGame = {
  at: NOW,
  mode: 'online',
  players: ['Ann', 'Jeff'],
  score: '2 moves',
  winner: 0,
  outcome: 'win',
};

/** A host in the lobby with a connected guest named Jeff. */
const lobby = (): App =>
  run(
    initialApp,
    { type: 'home/init', home },
    { type: 'host/click', name: 'Ann', level: '3' },
    { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } },
  ).app;
/** A host mid-game: dealt, at move 0, the host to move. */
const hosting = (): App => run(lobby(), { type: 'host/deal' }).app;
/** A guest seated at the table with the host's view of `dealt`. */
const seated = (): App =>
  run(
    initialApp,
    { type: 'join/click', name: 'Bo', code: 'ABCD' },
    { type: 'guest/connected' },
    { type: 'guest/frame', frame: { t: 'state', view: viewFor(dealt, 1) } },
  ).app;
/** A pass-and-play game between Ann and Bob at level 2. */
const local = (): App =>
  run(initialApp, { type: 'local/click', p1: 'Ann', p2: 'Bob', level: '2' }).app;

// ---- the same game at a table of four (docs/design/n-seat-sessions.md §7) ------------------------
//
// FAKE with `cfg.seats`: the room opens at `level` seats (here 4), every seat's view goes out on
// its own channel, a join fills the seat the session names, Start waits for the table, the lobby
// frame carries the seat list and the receiver's seat, the save carries the seat names.

type State4 = Readonly<{
  players: ReadonlyArray<Player>;
  level: number;
  turn: number;
  moves: number;
  over: boolean;
}>;
type View4 = Readonly<{
  seat: number;
  turn: number;
  moves: number;
  over: boolean;
  names: ReadonlyArray<string>;
}>;
/** The room frame past two seats: the options, the seat list and the receiver's seat. */
type Room4 = Readonly<{ seats?: ReadonlyArray<SeatState>; you?: number }>;
type Fake4 = Readonly<{
  Opts: Opts;
  Raw: Readonly<{ level: string }>;
  State: State4;
  View: View4;
  Action: Action;
  Seat: 2 | 3;
  Table: Table;
  Tab: 'about';
  Mode: 'online' | 'local';
  Screen: never;
  Timer: 'own';
  Cue: 'ding';
  Cues: Cues;
  Resume: Readonly<{ kind: 'extra'; note: string }>;
  Home: Readonly<{ colour: string }>;
  Intent: OwnIntent;
  Effect: OwnEffect;
  Store: Store;
}>;
type App4 = ShellApp<Fake4>;
type Seat4 = SeatOf<Fake4>;

const viewFor4 = (game: State4, seat: number): View4 => ({
  seat,
  turn: game.turn,
  moves: game.moves,
  over: game.over,
  names: game.players.map((p) => p.name),
});
/** A room frame past two seats: the options, then the seat list and the receiver's seat (D3), as a game's protocol builds it. */
const roomFrame4 = (
  t: 'welcome' | 'lobby',
  hostName: string,
  opts: Opts,
  seats: ReadonlyArray<SeatState>,
  you: number,
): HostFrameOf<Fake4> => {
  const frame: Readonly<{ t: 'welcome' | 'lobby'; hostName: string }> & Opts & Room4 = {
    t,
    hostName,
    ...opts,
    seats,
    you,
  };
  return frame;
};
const lobby4 = (
  hostName: string,
  opts: Opts,
  seats: ReadonlyArray<SeatState>,
  you: number,
): HostFrameOf<Fake4> => roomFrame4('lobby', hostName, opts, seats, you);

const FAKE4: ShellConfig<Fake4> = {
  id: 'gin-rummy',
  names: FAKE.names,
  tabs: FAKE.tabs,
  modes: {
    default: 'online',
    parse: (raw) => ({
      shown: raw === 'local' ? 'local' : 'online',
      stored: raw === 'local' ? 'local' : 'online',
    }),
  },
  copy: {
    ...FAKE.copy,
    hostRoom: (hostName, opts, seated, capacity) =>
      `${hostName}'s table at level ${String(opts.level)}: ${String(seated)} of ${String(capacity)} seated`,
    waiting: (capacity) => `Waiting for ${String(capacity - 1)} players to join…`,
    joined: (name, names, remaining) =>
      remaining === 0
        ? `Everyone's here (${names.join(', ')}). Ready when you are.`
        : `${name} joined! ${String(remaining)} seats left.`,
    seatLeft: (name, seat, seated, capacity) =>
      `${name ?? 'Someone'} left seat ${String(seat)}. ${String(seated)} of ${String(capacity)} seated.`,
    guestGone: (name, code, seat) =>
      `${name ?? 'Seat ' + String(seat)} dropped — rejoin with code ${String(code)}.`,
    roomFull: 'That table is full.',
    notEnough: (seated, min) => `${String(seated)} of ${String(min)} seated.`,
  },
  // A table of four exactly; the room's capacity is the terms' `level`.
  seats: { min: 4, max: 4 },
  opts: {
    ...FAKE.opts,
    ofGame: (game) => ({ level: game.level }),
    capacity: (opts) => opts.level,
  },
  engine: {
    // The deal over every seat in order (the bag names seats past `0 | 1`, so `players` is the list).
    create: (players, { level }) => ({ players, level, turn: 0, moves: 0, over: false }),
    // A move passes the turn round the table; `end` ends the game; `bad` and a move out of turn are refused.
    apply: (game, seat, action) =>
      action.type === 'bad' || seat !== game.turn
        ? err('Not your turn.')
        : ok(
            action.type === 'end'
              ? { ...game, over: true }
              : { ...game, moves: game.moves + 1, turn: (game.turn + 1) % game.players.length },
          ),
    viewFor: viewFor4,
    over: (view) => view.over,
    finished: (game) => game.over,
    names: (game) => [game.players[0]?.name ?? '', game.players[1]?.name ?? ''],
    // The rejoining seat renamed, whichever it is.
    renameGuest: (game, name, seat) => ({
      ...game,
      players: game.players.map((p, i) => (i === seat ? { ...p, name } : p)),
    }),
    decodeState: object({
      players: arrayOf(object({ id: string, name: string })),
      level: number,
      turn: number,
      moves: number,
      over: boolean,
    }),
  },
  result: {
    keyOf: (view) => `${String(view.moves)}:${String(view.turn)}`,
    playersOf: (view) => view.names,
    scoreOf: (view) => `${String(view.moves)} moves`,
    winnerOf: (view) => (view.over && view.moves > 0 ? (view.turn as Seat4) : null),
  },
  frames: {
    lobby: lobby4,
    state: (view) => ({ t: 'state', view }),
    toast: (msg) => ({ t: 'toast', msg }),
    action: (action) => ({ t: 'action', action }),
  },
  cues: { initial: { seen: null } },
  table: {
    initial: { curtain: null, marks: [] },
    reset: (table, at) => ({ ...table, marks: [...table.marks, at] }),
    rendered: (app) => {
      const view = app.shell.view;
      return view === null
        ? { app, effects: [] }
        : pure(withShell(app, { screen: view.over ? 'endgameScreen' : 'tableScreen' }));
    },
    refuse: (app, message) => step(app, toast(message)),
  },
  local: {
    viewer: (_app, game) => ({ seat: game.turn as Seat4, curtain: null, effects: [] }),
    revealer: (game) => ({ seat: game.turn as Seat4, effects: [] }),
  },
  home: {
    read: FAKE.home.read,
    apply: (app) => app,
    resume: (home) => resumeFor(home.save, FAKE4),
    resumeExtra: (app) => pure(app),
  },
  // The store is never read by these tests; the two-seat prefs stand in for the type.
  prefs: FAKE.prefs as unknown as ShellConfig<Fake4>['prefs'],
};

const initialApp4: App4 = { shell: initialShell(FAKE4), table: FAKE4.table.initial };
/** Dispatch shell intents at the four-seat table, collecting every effect. */
const run4 = (app: App4, ...intents: ReadonlyArray<Intent<Fake4>>): Step<Fake4> =>
  intents.reduce<Step<Fake4>>(
    (s, intent) => {
      if (!isShellIntent(intent)) throw new Error(`not a shell intent: ${intent.type}`);
      const next = reduceShell(s.app, intent, ctx, FAKE4);
      return { app: next.app, effects: [...s.effects, ...next.effects] };
    },
    { app, effects: [] },
  );
const join4 = (name: string, seat: Seat4): Intent<Fake4> => ({
  type: 'host/frame',
  frame: { t: 'join', name },
  seat,
});
/** Ann's table of four, opened at level 4. */
const opened4 = (): App4 =>
  run4(initialApp4, { type: 'home/init', home }, { type: 'host/click', name: 'Ann', level: '4' })
    .app;
/** The table full: Bo, Cy and Di seated in order. */
const full4 = (): App4 => run4(opened4(), join4('Bo', 1), join4('Cy', 2), join4('Di', 3)).app;
/** The table dealt. */
const dealt4 = (): App4 => run4(full4(), { type: 'host/deal' }).app;
const game4 = (app: App4): State4 => {
  const g = app.shell.game;
  if (g === null) throw new Error('no game');
  return g;
};

describe('a table of four (FAKE4: cfg.seats)', () => {
  test('host/click opens the room at the terms` capacity: three empty seats, the session told the capacity and the waiting copy, seat 1 mirrored into the legacy pair', () => {
    const { app, effects } = run4(initialApp4, { type: 'host/click', name: 'Ann', level: '4' });
    expect(app.shell).toMatchObject({
      role: 'host',
      mySeat: 0,
      seats: [EMPTY_SEAT, EMPTY_SEAT, EMPTY_SEAT],
      oppName: null,
      oppConnected: false,
      startGameVisible: false,
    });
    expect(effects).toEqual([
      { type: 'scrollTop' },
      {
        type: 'startHost',
        code: app.shell.code,
        attempt: 1,
        resume: false,
        capacity: 4,
        waiting: 'Waiting for 3 players to join…',
      },
    ]);
    // A capacity below two is read as two, as the session reads it.
    expect(
      run4(initialApp4, { type: 'host/click', name: 'Ann', level: '1' }).app.shell.seats,
    ).toEqual([EMPTY_SEAT]);
  });

  test('a join fills the seat the session names; names are deduped against the host and every other seat; the lobby goes to each connected seat with its own `you`; Start waits for the table', () => {
    const one = run4(opened4(), join4(' ann ', 1));
    expect(one.app.shell).toMatchObject({
      seats: [{ name: 'ann 2', connected: true }, EMPTY_SEAT, EMPTY_SEAT],
      oppName: 'ann 2',
      oppConnected: true,
      startGameVisible: false,
      hostStatus: { text: 'ann 2 joined! 2 seats left.' },
    });
    expect(one.effects).toEqual([
      { type: 'send', frame: lobby4('Ann', { level: 4 }, one.app.shell.seats, 1), seat: 1 },
    ]);
    // A third `Ann` takes the next free suffix; the lobby is repeated to seat 1 and to the newcomer.
    const two = run4(one.app, join4('Ann', 2));
    expect(two.app.shell.seats.map((s) => s.name)).toEqual(['ann 2', 'Ann 3', null]);
    expect(two.effects.map((e) => (e.type === 'send' ? e.seat : e.type))).toEqual([1, 2]);
    expect(two.app.shell.startGameVisible).toBe(false);
    const three = run4(two.app, join4('Di', 3));
    expect(three.app.shell).toMatchObject({
      startGameVisible: true,
      hostStatus: { text: "Everyone's here (ann 2, Ann 3, Di). Ready when you are." },
    });
    expect(three.effects.map((e) => (e.type === 'send' ? e.seat : e.type))).toEqual([1, 2, 3]);
    // A join with no seat is seat 1's (the two-seat adapter's object).
    expect(
      run4(opened4(), { type: 'host/frame', frame: { t: 'join', name: 'Bo' } }).app.shell.seats[0],
    ).toEqual({ name: 'Bo', connected: true });
    expect(guestNameAmong('Ann', ['ann', 'Ann 2', 'ANN 3'])).toBe('Ann 4');
    expect(guestNameAmong('', ['Ann'])).toBe('Jeff');
  });

  test('host/deal: refused below the table`s min with the count; else every seat dealt in order and each connected seat sent its own view', () => {
    const short = run4(opened4(), join4('Bo', 1), join4('Cy', 2));
    expect(run4(short.app, { type: 'host/deal' }).effects).toEqual([
      { type: 'toast', message: '3 of 4 seated.', ms: null },
    ]);
    const { app, effects } = run4(full4(), { type: 'host/deal' });
    expect(game4(app).players).toEqual([
      { id: 'host', name: 'Ann' },
      { id: 'guest', name: 'Bo' },
      { id: 'guest2', name: 'Cy' },
      { id: 'guest3', name: 'Di' },
    ]);
    expect(app.shell.view).toEqual(viewFor4(game4(app), 0));
    expect(effects).toEqual([
      { type: 'send', frame: { t: 'state', view: viewFor4(game4(app), 1) }, seat: 1 },
      { type: 'send', frame: { t: 'state', view: viewFor4(game4(app), 2) }, seat: 2 },
      { type: 'send', frame: { t: 'state', view: viewFor4(game4(app), 3) }, seat: 3 },
      { type: 'persist' },
    ]);
  });

  test('an action is applied as the seat it came in on; a refusal is a toast frame to that seat alone; a seat that is down is not sent to', () => {
    const app = dealt4();
    const wrong = run4(app, {
      type: 'host/frame',
      frame: { t: 'action', action: { type: 'move' } },
      seat: 2,
    });
    expect(wrong.app).toBe(app);
    expect(wrong.effects).toEqual([
      { type: 'send', frame: { t: 'toast', msg: 'Not your turn.' }, seat: 2 },
    ]);
    const mine = hostDispatch(app, 0, { type: 'move' }, ctx, FAKE4);
    expect(game4(mine.app)).toMatchObject({ moves: 1, turn: 1 });
    const theirs = run4(mine.app, {
      type: 'host/frame',
      frame: { t: 'action', action: { type: 'move' } },
      seat: 1,
    });
    expect(game4(theirs.app)).toMatchObject({ moves: 2, turn: 2 });
    // Seat 3 drops mid-game: its name is kept, the toast names it and the seat, and the next broadcast skips its channel.
    const down = run4(theirs.app, { type: 'host/guestGone', iceFailed: null, seat: 3 });
    expect(down.app.shell.seats[2]).toEqual({ name: 'Di', connected: false });
    expect(down.effects).toEqual([
      {
        type: 'toast',
        message: `Di dropped — rejoin with code ${String(app.shell.code)}.`,
        ms: GONE_TOAST_MS,
      },
    ]);
    const next = run4(down.app, {
      type: 'host/frame',
      frame: { t: 'action', action: { type: 'move' } },
      seat: 2,
    });
    expect(next.effects.map((e) => (e.type === 'send' ? e.seat : e.type))).toEqual([
      1,
      2,
      'persist',
    ]);
    // Di rejoins by seat: renamed at seat 3 through `cfg.seats.rename`, reconnected, everyone re-sent.
    const back = run4(next.app, join4('Diana', 3));
    expect(game4(back.app).players[3]).toEqual({ id: 'guest3', name: 'Diana' });
    expect(back.app.shell.seats[2]).toEqual({ name: 'Diana', connected: true });
    expect(back.effects.map((e) => (e.type === 'send' ? e.seat : e.type))).toEqual([
      1,
      2,
      3,
      'persist',
    ]);
  });

  test('a seat leaving the lobby reads empty again, Start follows the count, the others learn the new lobby; ICE failed is the status alone', () => {
    const left = run4(full4(), { type: 'host/guestGone', iceFailed: null, seat: 2 });
    expect(left.app.shell).toMatchObject({
      seats: [{ name: 'Bo', connected: true }, EMPTY_SEAT, { name: 'Di', connected: true }],
      startGameVisible: false,
      hostStatus: { text: 'Cy left seat 2. 3 of 4 seated.' },
    });
    expect(left.effects.map((e) => (e.type === 'send' ? e.seat : e.type))).toEqual([1, 3]);
    // Seat 1 leaving: the legacy pair follows the mirror.
    const first = run4(full4(), { type: 'host/guestGone', iceFailed: null, seat: 1 });
    expect(first.app.shell).toMatchObject({ oppName: null, oppConnected: false });
    const ice = run4(full4(), { type: 'host/guestGone', iceFailed: 'no route', seat: 3 });
    expect(ice.app.shell).toMatchObject({
      seats: [
        { name: 'Bo', connected: true },
        { name: 'Cy', connected: true },
        { name: 'Di', connected: false },
      ],
      hostStatus: { text: 'no route' },
      startGameVisible: true,
    });
    expect(ice.effects).toEqual([]);
  });

  test('the save carries the seat names; the offer keeps them; resume reopens the table at its capacity with every seat named and down, and each guest lands back in its seat by name', () => {
    const h = dealt4();
    const save = saveFor(h.shell);
    expect(save).toMatchObject({ role: 'host', oppName: 'Bo', seatNames: ['Bo', 'Cy', 'Di'] });
    if (save?.role !== 'host') throw new Error('no host save');
    expect(Object.keys(save)).toEqual([
      'role',
      'code',
      'myName',
      'level',
      'game',
      'oppName',
      'seatNames',
    ]);
    const offer = resumeFor(save, FAKE4);
    expect(offer).toMatchObject({ kind: 'host', seatNames: ['Bo', 'Cy', 'Di'] });
    const resumed = run4(withShell(initialApp4, { resume: offer }), { type: 'resume/click' });
    expect(resumed.app.shell).toMatchObject({
      role: 'host',
      code: h.shell.code,
      mySeat: 0,
      seats: [
        { name: 'Bo', connected: false },
        { name: 'Cy', connected: false },
        { name: 'Di', connected: false },
      ],
      oppName: 'Bo',
      oppConnected: false,
      game: game4(h),
    });
    expect(resumed.effects.at(-1)).toMatchObject({ type: 'startHost', resume: true, capacity: 4 });
    // Cy is back (the session reseated the name at 2): the seat keeps its name, no ` 2` suffix, and the table is re-sent to Cy alone.
    const back = run4(resumed.app, join4('Cy', 2));
    expect(back.app.shell.seats[1]).toEqual({ name: 'Cy', connected: true });
    expect(back.effects.map((e) => (e.type === 'send' ? e.seat : e.type))).toEqual([2, 'persist']);
    // A save with no seat names (a two-seat room, or one from before) resumes with seat 1 named as `oppName`.
    const legacy: Save<Fake4> = {
      role: 'host',
      code: save.code,
      myName: 'Ann',
      level: 4,
      game: game4(h),
      oppName: 'Bo',
    };
    const pair = run4(withShell(initialApp4, { resume: resumeFor(legacy, FAKE4) }), {
      type: 'resume/click',
    });
    expect(pair.app.shell.seats).toEqual([
      { name: 'Bo', connected: false },
      EMPTY_SEAT,
      EMPTY_SEAT,
    ]);
  });

  test('the guest: welcome and lobby name my seat and list the table; the status counts the seated; full uses the game`s copy; the record reads my seat', () => {
    const seats: ReadonlyArray<SeatState> = [
      { name: 'Bo', connected: true },
      { name: 'Cy', connected: true },
      EMPTY_SEAT,
    ];
    const joined = run4(initialApp4, { type: 'join/click', name: 'Cy', code: 'ABCD' }).app;
    expect(joined.shell).toMatchObject({ mySeat: 1, seats: [] });
    const welcomed = run4(joined, {
      type: 'guest/frame',
      frame: roomFrame4('welcome', 'Ann', { level: 4 }, seats, 2),
    });
    expect(welcomed.app.shell).toMatchObject({
      oppName: 'Ann',
      mySeat: 2,
      seats,
      guestStatus: { text: "Ann's table at level 4: 3 of 4 seated" },
    });
    // A room frame with no seat list (a two-seat game's) leaves my seat and the list alone.
    expect(
      run4(joined, { type: 'guest/frame', frame: { t: 'lobby', hostName: 'Ann', level: 4 } }).app
        .shell,
    ).toMatchObject({
      mySeat: 1,
      seats: [],
      guestStatus: { text: "Ann's table at level 4: 2 of 2 seated" },
    });
    // The seating read off the frame: a `you` past the list or not a whole seat reads as no seating.
    expect(roomSeatingOf<Fake4>(roomFrame4('lobby', 'Ann', { level: 4 }, seats, 3))).toEqual({
      you: 3,
      seats,
    });
    expect(roomSeatingOf<Fake4>(roomFrame4('lobby', 'Ann', { level: 4 }, seats, 4))).toBeNull();
    expect(roomSeatingOf<Fake4>(roomFrame4('lobby', 'Ann', { level: 4 }, seats, 1.5))).toBeNull();
    expect(roomSeatingOf<Fake4>({ t: 'welcome', hostName: 'Ann', level: 4 })).toBeNull();
    expect(
      run4(joined, { type: 'guest/frame', frame: { t: 'full' } }).app.shell.guestStatus.text,
    ).toBe('That table is full.');
    // The game ends with seat 2 (me) to move after two moves: the record is a win from my seat.
    const overAt2: State4 = {
      players: game4(dealt4()).players,
      level: 4,
      turn: 2,
      moves: 2,
      over: true,
    };
    const ended = run4(welcomed.app, {
      type: 'guest/frame',
      frame: { t: 'state', view: viewFor4(overAt2, 2) },
    });
    expect(ended.effects.find((e) => e.type === 'recordGame')).toMatchObject({
      game: { winner: 2, outcome: 'win', players: ['Ann', 'Bo', 'Cy', 'Di'] },
    });
  });
});

describe('the initial shell and the partitions', () => {
  test('initialShell is the legacy `app` literal plus the DOM state, from the config', () => {
    expect(initialApp.shell).toEqual({
      role: null,
      code: null,
      myName: 'Ari',
      opts: { level: 1 },
      game: null,
      view: null,
      oppName: null,
      oppConnected: false,
      seats: [],
      mySeat: 0,
      localNames: [],
      localSeats: [],
      nameTouched: false,
      revealed: null,
      homeTab: 'play',
      playMode: 'online',
      p1Name: '',
      p2Name: '',
      screen: 'homeScreen',
      netAttempt: 0,
      hostStatus: { text: 'Opening…', pulse: true },
      guestStatus: { text: CONNECTING_MSG, pulse: true },
      startGameVisible: false,
      handoff: false,
      savedName: null,
      resume: null,
      openedAt: null,
      rulesOpen: false,
      cues: { seen: null },
      submenuOpen: false,
      longPressed: false,
      codeDraft: '',
      soundFont: 'default',
      recentGames: [],
      recorded: null,
    });
  });

  test('the 45 shell intents and 29 shell effects are listed once; the guards partition a game`s unions', () => {
    expect(SHELL_INTENT_TYPES).toHaveLength(45);
    expect(new Set(SHELL_INTENT_TYPES).size).toBe(45);
    expect(SHELL_INTENT_TYPES).toContain('resume/auto');
    expect(SHELL_INTENT_TYPES).toContain('curtain/reveal');
    expect(SHELL_INTENT_TYPES).toContain('position/load');
    expect(SHELL_INTENT_TYPES).toContain('persist');
    expect(SHELL_EFFECT_TYPES).toHaveLength(29);
    expect(new Set(SHELL_EFFECT_TYPES).size).toBe(29);
    expect(SHELL_EFFECT_TYPES).toContain('phrases');
    expect(SHELL_EFFECT_TYPES).toContain('recordGame');
    expect(isShellIntent<Fake>({ type: 'home/init', home })).toBe(true);
    expect(isShellIntent<Fake>({ type: 'own' })).toBe(false);
    expect(isShellEffect<Fake>({ type: 'persist' })).toBe(true);
    expect(isShellEffect<Fake>({ type: 'ownFx' })).toBe(false);
  });
});

describe('home', () => {
  test('home/init: the screen, the names into the shell and the inputs (in that order), the game`s part, the tab without a write, the offer', () => {
    const { app, effects } = run(
      { ...initialApp, shell: { ...initialApp.shell, screen: 'tableScreen' } },
      {
        type: 'home/init',
        home: {
          ...home,
          name: 'Ann',
          p2Name: 'Bob',
          homeTab: 'about',
          playMode: 'local',
          soundFont: 'felt',
          colour: 'red',
        },
      },
    );
    expect(app.shell).toMatchObject({
      screen: 'homeScreen',
      savedName: 'Ann',
      p1Name: 'Ann',
      p2Name: 'Bob',
      nameTouched: true,
      homeTab: 'about',
      playMode: 'local',
      soundFont: 'felt',
      resume: null,
    });
    expect(marks(app)).toEqual(['colour:red']);
    // The pinned order: scroll, the first name, the second, and no writeHomeTab (`{ persist: false }`).
    expect(effects).toEqual([
      { type: 'scrollTop' },
      { type: 'fillName', name: 'Ann' },
      { type: 'fillP2Name', name: 'Bob' },
    ]);
    // Nothing saved: the inputs are filled with the defaults (the owner's names, 2026-09-25) and the
    // shell's state keeps none of them, nameTouched untouched, an unknown tab falls back to the default.
    const plain = run(initialApp, {
      type: 'home/init',
      home: { ...home, homeTab: 'score' as 'play' },
    });
    expect(plain.app.shell).toMatchObject({
      nameTouched: false,
      savedName: null,
      p1Name: '',
      p2Name: '',
      homeTab: 'play',
    });
    expect(DEFAULT_LOCAL_NAMES).toEqual(['Ari', 'Lavi']);
    // A default fill is marked, so the page clears it on its first tap (the owner, 2026-09-25).
    expect(plain.effects).toEqual([
      { type: 'scrollTop' },
      { type: 'fillName', name: 'Ari', default: true },
      { type: 'fillP2Name', name: 'Lavi', default: true },
    ]);
    // A saved second name wins over its default and carries no mark; the first seat still shows its default.
    const savedP2 = run(initialApp, { type: 'home/init', home: { ...home, p2Name: 'Bob' } });
    expect(savedP2.app.shell).toMatchObject({ nameTouched: false, savedName: null, p2Name: 'Bob' });
    expect(savedP2.effects).toEqual([
      { type: 'scrollTop' },
      { type: 'fillName', name: 'Ari', default: true },
      { type: 'fillP2Name', name: 'Bob' },
    ]);
    // A game naming its own seats (backgammon's "Ari and Ethan") fills those; a seat past its
    // list is `Player N`; without a list the shell's two stand.
    const named = { ...FAKE, localNames: ['Eve', 'Ron'] };
    expect(reduceShell(initialApp, { type: 'home/init', home }, ctx, named).effects).toEqual([
      { type: 'scrollTop' },
      { type: 'fillName', name: 'Eve', default: true },
      { type: 'fillP2Name', name: 'Ron', default: true },
    ]);
    const short = { ...FAKE, localNames: ['Eve'] };
    expect(reduceShell(initialApp, { type: 'home/init', home }, ctx, short).effects).toEqual([
      { type: 'scrollTop' },
      { type: 'fillName', name: 'Eve', default: true },
      { type: 'fillP2Name', name: 'Player 2', default: true },
    ]);
    expect(localNamesOf(FAKE)).toBe(DEFAULT_LOCAL_NAMES);
    expect(localNamesOf(named)).toEqual(['Eve', 'Ron']);
    expect(localNameFor(['Eve', 'Ron', 'Sal', 'Gus'], 3)).toBe('Gus');
    expect(localNameFor(['Eve', 'Ron'], 2)).toBe('Player 3');
    // The offer: the shell's three from the save, the game's own first.
    expect(
      run(initialApp, {
        type: 'home/init',
        home: { ...home, save: { role: 'local', game: dealt } },
      }).app.shell.resume,
    ).toEqual({ kind: 'local', game: dealt });
    expect(
      run(initialApp, { type: 'home/init', home: { ...home, colour: 'gold' } }).app.shell.resume,
    ).toEqual({ kind: 'extra', note: 'gold' });
  });

  test('typing a name remembers it trimmed and echoes it as typed; the online input marks the name touched', () => {
    expect(run(initialApp, { type: 'name/typed', value: '  Zoë ' })).toEqual({
      app: withShell(initialApp, { nameTouched: true, p1Name: '  Zoë ' }),
      effects: [
        { type: 'rememberName', name: 'Zoë' },
        { type: 'fillName', name: '  Zoë ' },
      ],
    });
    expect(run(initialApp, { type: 'p1name/typed', value: 'Zed' })).toEqual({
      app: withShell(initialApp, { p1Name: 'Zed' }),
      effects: [
        { type: 'rememberName', name: 'Zed' },
        { type: 'fillName', name: 'Zed' },
      ],
    });
    expect(run(initialApp, { type: 'p2name/typed', value: ' Bob ' })).toEqual({
      app: withShell(initialApp, { p2Name: ' Bob ' }),
      effects: [
        { type: 'rememberP2Name', name: 'Bob' },
        { type: 'fillP2Name', name: ' Bob ' },
      ],
    });
  });

  test('tab/set persists a known tab, maps an unknown one to the default, and stays quiet when told', () => {
    expect(run(initialApp, { type: 'tab/set', tab: 'rules' })).toEqual({
      app: withShell(initialApp, { homeTab: 'rules' }),
      effects: [{ type: 'writeHomeTab', tab: 'rules' }],
    });
    expect(run(initialApp, { type: 'tab/set', tab: 'settings' }).effects).toEqual([
      { type: 'writeHomeTab', tab: 'play' },
    ]);
    expect(run(initialApp, { type: 'tab/set', tab: 'about', persist: false })).toEqual({
      app: withShell(initialApp, { homeTab: 'about' }),
      effects: [],
    });
  });

  test('rules/show: the Rules tab (persisted) and the home list on the home screen; the overlay and its list anywhere else', () => {
    const fromHome = run(initialApp, { type: 'rules/show', rule: 'knock' });
    expect(fromHome.app.shell).toMatchObject({ homeTab: 'rules', rulesOpen: false });
    expect(fromHome.effects).toEqual([
      { type: 'writeHomeTab', tab: 'rules' },
      { type: 'revealRule', slot: 'rulesList', rule: 'knock' },
    ]);
    const fromTable = run(withShell(initialApp, { screen: 'tableScreen' }), {
      type: 'rules/show',
      rule: 'gin',
    });
    expect(fromTable.app.shell).toMatchObject({ homeTab: 'play', rulesOpen: true });
    expect(fromTable.effects).toEqual([
      { type: 'revealRule', slot: 'rulesOverlayList', rule: 'gin' },
    ]);
  });

  test('mode/set: a stored mode is shown and written, a shown-only mode is shown alone, an unknown one is ignored', () => {
    expect(run(initialApp, { type: 'mode/set', mode: 'local' })).toEqual({
      app: withShell(initialApp, { playMode: 'local' }),
      effects: [{ type: 'writePlayMode', mode: 'local' }],
    });
    expect(run(initialApp, { type: 'mode/set', mode: 'bots' }).app.shell.playMode).toBe('online');
    expect(run(initialApp, { type: 'mode/set', mode: 'secret' })).toEqual({
      app: initialApp,
      effects: [],
    });
    const open = withShell(initialApp, { p1Name: 'open' });
    expect(run(open, { type: 'mode/set', mode: 'secret' })).toEqual({
      app: withShell(open, { playMode: 'local' }),
      effects: [],
    });
  });

  test('the Play tab: a tap switches tabs; a long press opens the submenu and swallows the click that follows; a pick sets the mode', () => {
    const pressed = run(withShell(initialApp, { homeTab: 'rules' }), { type: 'submenu/press' });
    expect(pressed.app.shell.longPressed).toBe(false);
    expect(pressed.effects).toEqual([
      {
        type: 'startTimer',
        id: 'longPress',
        ms: LONG_PRESS_MS,
        then: { type: 'submenu/longPress' },
      },
    ]);
    const tapped = run(pressed.app, { type: 'submenu/release' }, { type: 'tab/playClick' });
    expect(tapped.app.shell).toMatchObject({
      homeTab: 'play',
      submenuOpen: false,
      longPressed: false,
    });
    expect(tapped.effects).toEqual([
      { type: 'cancelTimer', id: 'longPress' },
      { type: 'writeHomeTab', tab: 'play' },
    ]);
    const held = run(pressed.app, { type: 'submenu/longPress' });
    expect(held.app.shell).toMatchObject({
      submenuOpen: true,
      longPressed: true,
      homeTab: 'rules',
    });
    expect(held.effects).toEqual([{ type: 'fx', cue: 'tap' }]);
    const swallowed = run(held.app, { type: 'tab/playClick' });
    expect(swallowed.app.shell).toMatchObject({
      submenuOpen: true,
      longPressed: false,
      homeTab: 'rules',
    });
    expect(swallowed.effects).toEqual([]);
    const picked = run(held.app, { type: 'submenu/pick', mode: 'local' });
    expect(picked.app.shell).toMatchObject({
      playMode: 'local',
      homeTab: 'play',
      submenuOpen: false,
    });
    expect(picked.effects).toEqual([
      { type: 'writePlayMode', mode: 'local' },
      { type: 'writeHomeTab', tab: 'play' },
    ]);
    expect(run(held.app, { type: 'submenu/dismiss' }).app.shell.submenuOpen).toBe(false);
  });

  test('the code input keeps the game`s letters, four at most, and reverts a keyboard replacement; join/link fills the form', () => {
    const typed = run(initialApp, { type: 'code/typed', value: 'ab1c', inputType: 'insertText' });
    expect(typed.app.shell.codeDraft).toBe('ABC');
    expect(typed.effects).toEqual([{ type: 'setCode', value: 'ABC' }]);
    const swapped = run(typed.app, {
      type: 'code/typed',
      value: 'XYZW',
      inputType: 'insertReplacementText',
    });
    expect(swapped.app.shell.codeDraft).toBe('ABC');
    expect(swapped.effects).toEqual([{ type: 'setCode', value: 'ABC' }]);
    const linked = run(withShell(initialApp, { homeTab: 'rules', playMode: 'local' }), {
      type: 'join/link',
      code: 'kqzm9',
    });
    expect(linked.app.shell).toMatchObject({
      codeDraft: 'KQZM',
      homeTab: 'play',
      playMode: 'online',
    });
    expect(linked.effects[0]).toEqual({ type: 'setCode', value: 'KQZM' });
  });

  test('join/link sits the guest down as the tap on #joinBtn would: the same state and effects after the form is filled, under the remembered name or the default; a bad code is the tap`s toast over the filled form; nothing while seated', () => {
    // Nothing remembered: the input shows the game's first default, which the tap reads as untouched.
    const linked = run(withShell(initialApp, { homeTab: 'rules', playMode: 'local' }), {
      type: 'join/link',
      code: 'kqzm9',
    });
    const filled = run(withShell(initialApp, { homeTab: 'rules', playMode: 'local' }), {
      type: 'tab/set',
      tab: 'play',
    }).app;
    const tapped = run(withShell(filled, { playMode: 'online', codeDraft: 'KQZM' }), {
      type: 'join/click',
      name: 'Ari',
      code: 'KQZM',
    });
    expect(linked.app).toEqual(tapped.app);
    expect(linked.app.shell).toMatchObject({
      role: 'guest',
      code: 'KQZM',
      myName: 'Jeff',
      netAttempt: 1,
      screen: 'guestWaitScreen',
      guestStatus: { text: 'Connecting KQZM', pulse: true },
      codeDraft: 'KQZM',
      homeTab: 'play',
      playMode: 'online',
    });
    expect(linked.effects).toEqual([{ type: 'setCode', value: 'KQZM' }, ...tapped.effects]);
    expect(tapped.effects).toEqual([
      { type: 'scrollTop' },
      { type: 'startGuest', code: 'KQZM', attempt: 1 },
    ]);
    // A remembered name (home/init put it in the input and marked the name touched) joins as itself.
    const remembered = run(
      initialApp,
      { type: 'home/init', home: { ...home, name: 'Zoë' } },
      { type: 'join/link', code: 'KQZM' },
    );
    expect(remembered.app.shell).toMatchObject({
      role: 'guest',
      myName: 'Zoë',
      screen: 'guestWaitScreen',
    });
    expect(remembered.effects.at(-1)).toEqual({ type: 'startGuest', code: 'KQZM', attempt: 1 });
    // A name typed since joins too, trimmed as the tap trims it.
    const typed = run(
      initialApp,
      { type: 'name/typed', value: ' Eve ' },
      { type: 'join/link', code: 'KQZM' },
    );
    expect(typed.app.shell.myName).toBe('Eve');
    // A bad code: the form is filled and the tap's toast shows; nobody is seated.
    const bad = run(withShell(initialApp, { homeTab: 'rules' }), { type: 'join/link', code: 'ab' });
    expect(bad.app.shell).toMatchObject({
      role: null,
      screen: 'homeScreen',
      codeDraft: 'AB',
      homeTab: 'play',
      playMode: 'online',
    });
    expect(bad.effects).toEqual([
      { type: 'setCode', value: 'AB' },
      { type: 'toast', message: 'Enter the 4-letter room code.', ms: null },
    ]);
    // Seated already (a link followed again, the same room or another): nothing.
    const seatedGuest = linked.app;
    expect(run(seatedGuest, { type: 'join/link', code: 'KQZM' })).toEqual({
      app: seatedGuest,
      effects: [],
    });
    expect(run(seatedGuest, { type: 'join/link', code: 'WXYZ' })).toEqual({
      app: seatedGuest,
      effects: [],
    });
    expect(run(seated(), { type: 'join/link', code: 'KQZM' })).toEqual({
      app: seated(),
      effects: [],
    });
  });

  test('screen/show, sound/toggle, soundFont/set and share/click', () => {
    expect(run(initialApp, { type: 'screen/show', screen: 'endgameScreen' })).toEqual({
      app: withShell(initialApp, { screen: 'endgameScreen' }),
      effects: [{ type: 'scrollTop' }],
    });
    expect(run(initialApp, { type: 'sound/toggle' })).toEqual({
      app: initialApp,
      effects: [{ type: 'toggleSound' }],
    });
    expect(run(initialApp, { type: 'soundFont/set', font: 'arcade' })).toEqual({
      app: withShell(initialApp, { soundFont: 'arcade' }),
      effects: [{ type: 'writeSoundFont', font: 'arcade' }],
    });
    expect(run(initialApp, { type: 'share/click' }).effects).toEqual([]);
    expect(run(withShell(initialApp, { code: 'ABCD' }), { type: 'share/click' }).effects).toEqual([
      { type: 'share', code: 'ABCD' },
    ]);
  });
});

describe('hosting', () => {
  test('host/click: the name rules, the options parsed against the shell`s, a fresh code, the wait screen, the session', () => {
    const { app, effects } = run(withShell(initialApp, { game: dealt, view: viewFor(dealt, 0) }), {
      type: 'host/click',
      name: '  Ann  ',
      level: '4',
    });
    expect(app.shell).toMatchObject({
      role: 'host',
      myName: 'Ann',
      opts: { level: 4 },
      game: null,
      view: null,
      oppName: null,
      oppConnected: false,
      netAttempt: 1,
      screen: 'hostWaitScreen',
      hostStatus: { text: 'Opening…', pulse: true },
      startGameVisible: false,
    });
    expect(app.shell.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    expect(effects).toEqual([
      { type: 'scrollTop' },
      { type: 'startHost', code: app.shell.code, attempt: 1, resume: false },
    ]);
    // An empty name is the default, a long one is cut to 20; a missing option keeps the shell's.
    const defaults = run(withShell(initialApp, { opts: { level: 7 } }), {
      type: 'host/click',
      name: '',
      level: '',
    }).app;
    expect(defaults.shell).toMatchObject({ myName: 'Ari', opts: { level: 7 } });
    expect(
      run(initialApp, { type: 'host/click', name: 'A'.repeat(25), level: '1' }).app.shell.myName,
    ).toBe('A'.repeat(20));
  });

  test('host/start with a code keeps it (a resume or a busy retry); null draws another; host/status writes the wait status', () => {
    const resumed = run(withShell(initialApp, { netAttempt: 4 }), {
      type: 'host/start',
      code: 'LRZL',
    });
    expect(resumed.app.shell).toMatchObject({ role: 'host', code: 'LRZL', netAttempt: 5 });
    expect(resumed.effects).toEqual([
      { type: 'scrollTop' },
      { type: 'startHost', code: 'LRZL', attempt: 5, resume: true },
    ]);
    const fresh = run(resumed.app, { type: 'host/start', code: null });
    expect(fresh.app.shell.code).not.toBe('LRZL');
    expect(fresh.effects.at(-1)).toMatchObject({ type: 'startHost', attempt: 6, resume: false });
    const a = run(initialApp, { type: 'host/status', text: 'Waiting…', stopPulse: false }).app;
    expect(a.shell.hostStatus).toEqual({ text: 'Waiting…', pulse: true });
    const b = run(a, { type: 'host/status', text: 'boom', stopPulse: true }).app;
    expect(b.shell.hostStatus).toEqual({ text: 'boom', pulse: false });
    expect(
      run(b, { type: 'host/status', text: 'again', stopPulse: false }).app.shell.hostStatus,
    ).toEqual({ text: 'again', pulse: false });
  });

  test('a join in the lobby names the guest (normalised against the host) and answers with the lobby frame; an action before the deal is ignored', () => {
    const started = run(initialApp, { type: 'host/click', name: 'Ann', level: '3' }).app;
    const { app, effects } = run(started, {
      type: 'host/frame',
      frame: { t: 'join', name: ' ann ' },
    });
    expect(app.shell).toMatchObject({
      oppConnected: true,
      oppName: 'ann 2',
      handoff: false,
      startGameVisible: true,
      hostStatus: { text: joinedMsg('ann 2'), pulse: true },
    });
    expect(effects).toEqual([{ type: 'send', frame: { t: 'lobby', hostName: 'Ann', level: 3 } }]);
    expect(
      run(started, { type: 'host/frame', frame: { t: 'join', name: '' } }).app.shell.oppName,
    ).toBe('Jeff');
    const idle = lobby();
    expect(
      run(idle, { type: 'host/frame', frame: { t: 'action', action: { type: 'move' } } }),
    ).toEqual({ app: idle, effects: [] });
  });

  test('host/deal: refused without a guest; else the engine`s game for host and guest, the table reset for the deal, the broadcast', () => {
    const alone = run(initialApp, { type: 'host/click', name: 'Ann', level: '3' }).app;
    expect(run(alone, { type: 'host/deal' })).toEqual({
      app: alone,
      effects: [{ type: 'toast', message: WAITING_FOR_GUEST_MSG, ms: null }],
    });
    const { app, effects } = run(lobby(), { type: 'host/deal' });
    expect(game(app)).toEqual({ players: PLAYERS, level: 3, turn: 0, moves: 0, over: false });
    expect(app.shell).toMatchObject({ view: viewFor(game(app), 0), screen: 'tableScreen' });
    // The deal's reset, then broadcast's per-view reset, then the paint (no `prev` yet: nothing to ding for).
    expect(marks(app).slice(-3)).toEqual(['deal', 'view', `rendered:-@${String(NOW)}`]);
    expect(effects).toEqual([
      { type: 'send', frame: { t: 'state', view: viewFor(game(app), 1) } },
      { type: 'persist' },
      { type: 'scrollTop' },
    ]);
    // A connected guest with no name yet gets the wire's default seat name.
    const nameless = run(withShell(lobby(), { oppName: null }), { type: 'host/deal' }).app;
    expect(game(nameless).players[1]).toEqual({ id: 'guest', name: 'Jeff' });
  });

  test('hostDispatch: the guest`s actions are applied for seat 1 and broadcast; a refusal goes back as a toast frame; the host`s own refusal is the refuse hook', () => {
    const app = hosting();
    const wrong = run(app, {
      type: 'host/frame',
      frame: { t: 'action', action: { type: 'move' } },
    });
    expect(wrong.app).toBe(app);
    expect(wrong.effects).toEqual([{ type: 'send', frame: { t: 'toast', msg: 'Not your turn.' } }]);
    const mine = hostDispatch(app, 0, { type: 'move' }, ctx, FAKE);
    expect(game(mine.app)).toMatchObject({ moves: 1, turn: 1 });
    expect(marks(mine.app).slice(-3)).toEqual(['applied', 'view', `rendered:prev@${String(NOW)}`]);
    expect(kinds(mine.effects)).toEqual(['send', 'persist', 'fx', 'scrollTop']);
    expect(mine.effects[2]).toEqual({ type: 'fx', cue: 'ding' });
    const theirs = run(mine.app, {
      type: 'host/frame',
      frame: { t: 'action', action: { type: 'move' } },
    });
    expect(game(theirs.app)).toMatchObject({ moves: 2, turn: 0 });
    expect(theirs.effects[0]).toEqual({
      type: 'send',
      frame: { t: 'state', view: viewFor(game(theirs.app), 1) },
    });
    const refused = hostDispatch(app, 0, { type: 'bad' }, ctx, FAKE);
    expect(marks(refused.app).at(-1)).toBe('refused');
    expect(refused.effects).toEqual([{ type: 'toast', message: 'Not your turn.', ms: null }]);
    // No game: nothing to apply.
    expect(hostDispatch(initialApp, 0, { type: 'move' }, ctx, FAKE)).toEqual({
      app: initialApp,
      effects: [],
    });
    expect(broadcast(initialApp, ctx, FAKE)).toEqual({ app: initialApp, effects: [] });
  });

  test('a rejoin mid-game renames seat 1 and broadcasts; the handoff is over', () => {
    const gone = withShell(hosting(), { oppConnected: false, handoff: true });
    const { app, effects } = run(gone, {
      type: 'host/frame',
      frame: { t: 'join', name: 'Jeffrey' },
    });
    expect(app.shell).toMatchObject({ oppConnected: true, oppName: 'Jeffrey', handoff: false });
    expect(game(app).players[1]).toEqual({ id: 'guest', name: 'Jeffrey' });
    expect(kinds(effects)).toEqual(['send', 'persist', 'scrollTop']);
  });

  test('the guest going: during a handoff the invite text; mid-game a re-render and a toast with the code; in the lobby the status and no deal button; over, nothing; ICE failed, its text', () => {
    const handed = withShell(hosting(), { handoff: true, code: 'ABCD' });
    const waiting = run(handed, { type: 'host/guestGone', iceFailed: null });
    expect(waiting.app.shell).toMatchObject({
      oppConnected: false,
      hostStatus: { text: 'Handoff ABCD to Jeff' },
    });
    expect(waiting.effects).toEqual([]);
    expect(
      run(withShell(handed, { code: null }), { type: 'host/guestGone', iceFailed: null }).app.shell
        .hostStatus.text,
    ).toBe('Handoff  to Jeff');
    const midGame = run(hosting(), { type: 'host/guestGone', iceFailed: null });
    expect(midGame.app.shell.oppConnected).toBe(false);
    expect(marks(midGame.app).at(-1)).toBe(`rendered:prev@${String(NOW)}`);
    expect(midGame.effects).toEqual([
      { type: 'scrollTop' },
      { type: 'toast', message: guestGoneMsg('Jeff', midGame.app.shell.code), ms: GONE_TOAST_MS },
    ]);
    expect(guestGoneMsg(null, 'ABCD')).toBe(
      'Opponent disconnected — they can rejoin with code ABCD.',
    );
    const inLobby = run(lobby(), { type: 'host/guestGone', iceFailed: null });
    expect(inLobby.app.shell).toMatchObject({
      oppConnected: false,
      startGameVisible: false,
      hostStatus: { text: OPPONENT_LEFT_MSG },
    });
    expect(inLobby.effects).toEqual([]);
    const done = withShell(hosting(), { game: over, view: viewFor(over, 0) });
    expect(run(done, { type: 'host/guestGone', iceFailed: null })).toEqual({
      // The seat mirror follows the two legacy fields: seat 1 down, its name kept.
      app: withShell(done, { oppConnected: false, seats: [{ name: 'Jeff', connected: false }] }),
      effects: [],
    });
    const ice = run(lobby(), { type: 'host/guestGone', iceFailed: 'no route' });
    expect(ice.app.shell).toMatchObject({
      hostStatus: { text: 'no route' },
      startGameVisible: true,
    });
  });
});

describe('joining', () => {
  test('join/click: a well-formed code (else the toast), the name rules, the wait screen, the session; guest/start and guest/status', () => {
    const bad = run(initialApp, { type: 'join/click', name: 'Zoë', code: 'AB' });
    expect(bad.app).toBe(initialApp);
    expect(toasts(bad.effects)).toEqual([['Enter the 4-letter room code.', null]]);
    const { app, effects } = run(initialApp, { type: 'join/click', name: 'Zoë', code: ' kqzm ' });
    expect(app.shell).toMatchObject({
      role: 'guest',
      code: 'KQZM',
      myName: 'Zoë',
      netAttempt: 1,
      screen: 'guestWaitScreen',
      guestStatus: { text: 'Connecting KQZM', pulse: true },
    });
    expect(effects).toEqual([
      { type: 'scrollTop' },
      { type: 'startGuest', code: 'KQZM', attempt: 1 },
    ]);
    // The untouched default host name joins as the wire's guest default; a touched one keeps it; empty is the default; long is cut.
    expect(
      run(initialApp, { type: 'join/click', name: 'Ari', code: 'KQZM' }).app.shell.myName,
    ).toBe('Jeff');
    expect(
      run(withShell(initialApp, { nameTouched: true }), {
        type: 'join/click',
        name: 'Ari',
        code: 'KQZM',
      }).app.shell.myName,
    ).toBe('Ari');
    expect(run(initialApp, { type: 'join/click', name: '  ', code: 'KQZM' }).app.shell.myName).toBe(
      'Jeff',
    );
    expect(
      run(initialApp, { type: 'join/click', name: 'B'.repeat(25), code: 'KQZM' }).app.shell.myName,
    ).toBe('B'.repeat(20));
    const again = run(app, { type: 'guest/start', code: 'WXYZ' });
    expect(again.app.shell).toMatchObject({
      code: 'WXYZ',
      netAttempt: 2,
      guestStatus: { text: 'Connecting WXYZ' },
    });
    expect(again.effects.at(-1)).toEqual({ type: 'startGuest', code: 'WXYZ', attempt: 2 });
    const status = run(app, { type: 'guest/status', text: 'Found', stopPulse: true }).app;
    expect(status.shell.guestStatus).toEqual({ text: 'Found', pulse: false });
    expect(run(initialApp, { type: 'guest/connected' }).app.shell.oppConnected).toBe(true);
  });

  test('the host`s frames: welcome and lobby name the room with its terms, full says so, toast is the refuse hook, state renders the table', () => {
    const joined = run(
      initialApp,
      { type: 'join/click', name: 'Bo', code: 'ABCD' },
      { type: 'guest/connected' },
    ).app;
    const welcomed = run(joined, {
      type: 'guest/frame',
      frame: { t: 'welcome', hostName: 'Ann', level: 5 },
    });
    expect(welcomed.app.shell).toMatchObject({
      oppName: 'Ann',
      opts: { level: 5 },
      guestStatus: { text: "Ann's room at level 5", pulse: true },
    });
    expect(welcomed.effects).toEqual([]);
    expect(
      run(joined, { type: 'guest/frame', frame: { t: 'lobby', hostName: 'Bo', level: 2 } }).app
        .shell.guestStatus.text,
    ).toBe("Bo's room at level 2");
    expect(
      run(joined, { type: 'guest/frame', frame: { t: 'full' } }).app.shell.guestStatus.text,
    ).toBe(ROOM_FULL_MSG);
    const refused = run(joined, { type: 'guest/frame', frame: { t: 'toast', msg: 'No.' } });
    expect(marks(refused.app)).toEqual(['refused']);
    expect(refused.effects).toEqual([{ type: 'toast', message: 'No.', ms: null }]);
    const view = viewFor(dealt, 1);
    const shown = run(withShell(joined, { oppConnected: false }), {
      type: 'guest/frame',
      frame: { t: 'state', view },
    });
    expect(shown.app.shell).toMatchObject({ view, oppConnected: true, screen: 'tableScreen' });
    expect(marks(shown.app)).toEqual(['frame', `rendered:-@${String(NOW)}`]);
    expect(shown.effects).toEqual([{ type: 'scrollTop' }]);
    // The next frame is rendered against the one before, so the position's cue plays once.
    const moved = { ...dealt, moves: 1, turn: 1 as const };
    const next = run(shown.app, {
      type: 'guest/frame',
      frame: { t: 'state', view: viewFor(moved, 1) },
    });
    expect(marks(next.app).at(-1)).toBe(`rendered:prev@${String(NOW)}`);
    expect(next.effects).toEqual([{ type: 'fx', cue: 'ding' }, { type: 'scrollTop' }]);
    expect(
      run(next.app, { type: 'guest/frame', frame: { t: 'state', view: viewFor(moved, 1) } })
        .effects,
    ).toEqual([{ type: 'scrollTop' }]);
  });

  test('losing the host: mid-game the table is reset for the loss, re-rendered and toasted; before a view, or once the game is over, the wait screen says so', () => {
    const inGame = run(seated(), { type: 'guest/lost' });
    expect(inGame.app.shell).toMatchObject({ oppConnected: false, screen: 'tableScreen' });
    expect(marks(inGame.app).slice(-2)).toEqual(['lost', `rendered:prev@${String(NOW)}`]);
    expect(inGame.effects).toEqual([
      { type: 'scrollTop' },
      { type: 'toast', message: LOST_HOST_MSG, ms: GONE_TOAST_MS },
    ]);
    const waiting = run(run(initialApp, { type: 'join/click', name: 'Bo', code: 'ABCD' }).app, {
      type: 'guest/lost',
    });
    expect(waiting.app.shell).toMatchObject({
      oppConnected: false,
      screen: 'guestWaitScreen',
      guestStatus: { text: DISCONNECTED_MSG },
    });
    expect(marks(waiting.app)).toEqual(['lost']);
    expect(waiting.effects).toEqual([{ type: 'scrollTop' }]);
    const done = run(withShell(seated(), { view: viewFor(over, 1) }), { type: 'guest/lost' });
    expect(done.app.shell.screen).toBe('guestWaitScreen');
  });
});

describe('pass and play', () => {
  test('local/click: names with defaults and the " 2" suffix, the options into the shell, the wake lock first, the table reset, the curtain for the starter', () => {
    const { app, effects } = run(initialApp, {
      type: 'local/click',
      p1: ' ann ',
      p2: 'ANN',
      level: '2',
    });
    const g = game(app);
    expect(g).toEqual({
      players: [
        { id: 'p1', name: 'ann' },
        { id: 'p2', name: 'ANN 2' },
      ],
      level: 2,
      turn: 0,
      moves: 0,
      over: false,
    });
    expect(app.shell).toMatchObject({
      role: 'local',
      code: null,
      oppConnected: true,
      revealed: null,
      opts: { level: 2 },
      view: viewFor(g, 0),
      screen: 'tableScreen',
    });
    expect(app.table.curtain).toBe(0);
    expect(marks(app)).toEqual(['startLocal', 'view', `rendered:-@${String(NOW)}`]);
    // Initial: no "your turn" chime with the first curtain; the viewer's own effect rides after the save.
    expect(effects).toEqual([
      { type: 'wakeLock', hold: true },
      { type: 'persist' },
      { type: 'ownFx' },
      { type: 'scrollTop' },
    ]);
    // Empty inputs seat the game's defaults (the owner's names, 2026-09-25), on the table too.
    expect(localPlayers('', '', DEFAULT_LOCAL_NAMES)).toEqual([
      { id: 'p1', name: 'Ari' },
      { id: 'p2', name: 'Lavi' },
    ]);
    expect(localPlayers(' ', 'lavi', DEFAULT_LOCAL_NAMES)).toEqual([
      { id: 'p1', name: 'Ari' },
      { id: 'p2', name: 'lavi' },
    ]);
    expect(localPlayers('', '', ['Eve', 'Ron'])).toEqual([
      { id: 'p1', name: 'Eve' },
      { id: 'p2', name: 'Ron' },
    ]);
    expect(localPlayers('', '', [])).toEqual([
      { id: 'p1', name: 'Player 1' },
      { id: 'p2', name: 'Player 2' },
    ]);
    const empty = run(initialApp, { type: 'local/click', p1: '', p2: '', level: '1' });
    expect(game(empty.app).players).toEqual([
      { id: 'p1', name: 'Ari' },
      { id: 'p2', name: 'Lavi' },
    ]);
    expect(empty.app.shell.screen).toBe('tableScreen');
    // A game's own seats reach the table the same way.
    const namedStart = reduceShell(
      initialApp,
      { type: 'local/click', p1: '', p2: '', level: '1' },
      ctx,
      { ...FAKE, localNames: ['Eve', 'Ron'] },
    );
    expect(game(namedStart.app).players.map((p) => p.name)).toEqual(['Eve', 'Ron']);
    expect(localPlayers('A'.repeat(25), 'b', DEFAULT_LOCAL_NAMES)[0].name).toBe('A'.repeat(20));
    // The two halves the sandbox composes: the seat and the broadcast.
    expect(localSeated(initialApp, dealt, FAKE)).toEqual({
      shell: {
        ...initialApp.shell,
        role: 'local',
        code: null,
        oppConnected: true,
        game: dealt,
        revealed: null,
        // Every seat is played here: the names off seat 0's view, the seats in order, mine the first.
        mySeat: 0,
        localNames: ['Ann', 'Jeff'],
        localSeats: [0, 1],
      },
      table: { curtain: null, marks: ['startLocal'] },
    });
    expect(startLocal(initialApp, dealt, ctx, FAKE).effects.map((e) => e.type)).toEqual([
      'wakeLock',
      'persist',
      'ownFx',
      'scrollTop',
    ]);
    expect(localBroadcast(initialApp, true, ctx, FAKE)).toEqual({ app: initialApp, effects: [] });
    // The table helper the games' own cases use beside the shell's.
    expect(withTable(initialApp, { curtain: 1 })).toEqual({
      shell: initialApp.shell,
      table: { curtain: 1, marks: [] },
    });
  });

  test('localSeats: the same names as localPlayers at two seats, and the rule carried to three and four', () => {
    // The two-seat pairs, by both helpers.
    [
      ['ann', 'bob'],
      [' ann ', 'ANN'],
      ['', ''],
      ['A'.repeat(25), 'b'],
      ['Player 2', ''],
    ].forEach(([p1, p2]) => {
      expect(localSeats([p1 ?? '', p2 ?? ''], DEFAULT_LOCAL_NAMES)).toEqual(
        localPlayers(p1 ?? '', p2 ?? '', DEFAULT_LOCAL_NAMES),
      );
    });
    // Three and four: the game's names default the empty seats as far as they go (the owner's
    // "briscola is Ari and Lavi (with p3 Sandro and p4 Grant)"), `Player N` beyond, ids by seat, a
    // clash with any earlier seat suffixed by its number.
    expect(localSeats(['Ann', '', 'Cara'], DEFAULT_LOCAL_NAMES)).toEqual([
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: DEFAULT_LOCAL_NAMES[1] },
      { id: 'p3', name: 'Cara' },
    ]);
    expect(localSeats(['', '', '', ''], ['Ari', 'Lavi', 'Sandro', 'Grant'])).toEqual([
      { id: 'p1', name: 'Ari' },
      { id: 'p2', name: 'Lavi' },
      { id: 'p3', name: 'Sandro' },
      { id: 'p4', name: 'Grant' },
    ]);
    expect(
      localSeats(['Ann', '', '', 'sandro'], ['Ari', 'Lavi', 'Sandro']).map((p) => p.name),
    ).toEqual(['Ann', 'Lavi', 'Sandro', 'sandro 4']);
    expect(localSeats(['Ann', 'ann', 'Bob', 'ANN'], DEFAULT_LOCAL_NAMES)).toEqual([
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'ann 2' },
      { id: 'p3', name: 'Bob' },
      { id: 'p4', name: 'ANN 4' },
    ]);
    expect(localSeats(['', '', ''], DEFAULT_LOCAL_NAMES).map((p) => p.name)).toEqual([
      'Ari',
      'Lavi',
      'Player 3',
    ]);
    expect(localSeats([], DEFAULT_LOCAL_NAMES)).toEqual([]);
  });

  test('SeatOf: the two seats for a bag that names none, the game`s own added for one that does', () => {
    // Compile-time: `Fake` names no extra seat, so its seats are 0 | 1; a bag with `Seat: 2 | 3` seats four.
    type Wide = Fake & Readonly<{ Seat: 2 | 3 }>;
    const two: ReadonlyArray<SeatOf<Fake>> = [0, 1];
    const four: ReadonlyArray<SeatOf<Wide>> = [0, 1, 2, 3];
    // @ts-expect-error a third seat is not one of the two-seat game's
    const third: SeatOf<Fake> = 2;
    expect([two, four, third]).toEqual([[0, 1], [0, 1, 2, 3], 2]);
  });

  test('the curtain reveal shows the mover and hides the curtain, telling them what the revealer says; a move hands the phone over with the chime', () => {
    const start = local();
    const revealed = run(start, { type: 'curtain/reveal' });
    expect(revealed.app.shell.revealed).toBe(0);
    expect(revealed.app.table.curtain).toBeNull();
    // The tap, the revealer's own effect, then the broadcast: saved, the viewer's own effect, painted against the view before.
    expect(revealed.effects).toEqual([
      { type: 'fx', cue: 'tap' },
      { type: 'ownFx' },
      { type: 'persist' },
      { type: 'ownFx' },
      { type: 'scrollTop' },
    ]);
    expect(marks(revealed.app).at(-1)).toBe(`rendered:prev@${String(NOW)}`);
    // A move by the game (not the shell's to make): the turn flips, the curtain is up for the new mover and chimes.
    const moved = apply(game(revealed.app), 0, { type: 'move' });
    if (!moved.ok) throw new Error(moved.error);
    const passed = localBroadcast(withShell(revealed.app, { game: moved.value }), false, ctx, FAKE);
    expect(passed.app.table.curtain).toBe(1);
    expect(passed.app.shell.view).toEqual(viewFor(moved.value, 1));
    expect(kinds(passed.effects)).toEqual(['persist', 'fx', 'ownFx', 'fx', 'scrollTop']);
    expect(passed.effects[1]).toEqual({ type: 'fx', cue: 'yourTurn' });
    // Reveal with no game is a no-op.
    expect(run(initialApp, { type: 'curtain/reveal' })).toEqual({ app: initialApp, effects: [] });
  });

  test('position/load: the decoded state replaces the pass-and-play game, the phone with whoever must act and no curtain; refused in any other role and for a state the decoder refuses', () => {
    const start = local();
    const next: State = { ...game(start), turn: 1, moves: 4 };
    const { app, effects } = run(start, { type: 'position/load', state: next });
    expect(game(app)).toEqual(next);
    // The revealer's seat (the mover) holds the phone, so the viewer raises no curtain.
    expect(app.shell).toMatchObject({ revealed: 1, view: viewFor(next, 1), screen: 'tableScreen' });
    expect(app.table.curtain).toBeNull();
    // Reset as a start resets, the new view, painted against the view before; initial, so no
    // "your turn" chime: the game's own cue for the new position plays after the save and the viewer's effect.
    expect(marks(app).slice(-3)).toEqual(['startLocal', 'view', `rendered:prev@${String(NOW)}`]);
    expect(effects).toEqual([
      { type: 'persist' },
      { type: 'ownFx' },
      { type: 'fx', cue: 'ding' },
      { type: 'scrollTop' },
    ]);
    // A state the decoder refuses: the toast names the path; nothing else changes.
    const junk = run(start, { type: 'position/load', state: { nope: true } });
    expect(junk.app).toBe(start);
    expect(junk.effects).toEqual([toast(badPositionMsg('$.players: expected array'))]);
    // Any other role, and the home screen: refused with the one toast, the App untouched.
    const refused = [toast(SANDBOX_LOCAL_ONLY_MSG)];
    expect(run(hosting(), { type: 'position/load', state: next }).effects).toEqual(refused);
    expect(run(seated(), { type: 'position/load', state: next }).effects).toEqual(refused);
    const home = run(initialApp, { type: 'position/load', state: next });
    expect(home).toEqual({ app: initialApp, effects: refused });
  });
});

describe('the ephemeral lane (docs/design/briscola-battle.md §4.5)', () => {
  type IntentFrame = Readonly<{ t: 'intent'; slot: number | null }>;
  /** The fake with a lane declared: the same game, one more member in its bag. */
  type Lane = Fake & Readonly<{ Ephemeral: IntentFrame }>;
  type LaneApp = ShellApp<Lane>;
  const seen: (readonly [IntentFrame, SeatOf<Lane>, number])[] = [];
  const LANE: ShellConfig<Lane> = {
    ...FAKE,
    table: {
      ...FAKE.table,
      ephemeral: (app, frame, seat, c) => {
        seen.push([frame, seat, c.now()]);
        return step(app, toast(`intent:${String(seat)}:${String(frame.slot)}`));
      },
    },
  };
  /** The same bag with no hook: what the shell does on its own with the frame. */
  const BARE: ShellConfig<Lane> = {
    ...FAKE,
    table: {
      initial: FAKE.table.initial,
      reset: FAKE.table.reset,
      rendered: FAKE.table.rendered,
      refuse: FAKE.table.refuse,
    },
  };
  const frame: IntentFrame = { t: 'intent', slot: 2 };
  const hosting: LaneApp = withShell(initialApp, {
    role: 'host',
    game: dealt,
    view: viewFor(dealt, 0),
  });
  const joined: LaneApp = withShell(initialApp, { role: 'guest', view: viewFor(dealt, 1) });

  test('host/frame hands the guest`s frame to the hook as seat 1 with the clock; guest/frame the host`s as seat 0', () => {
    seen.length = 0;
    const atHost = reduceShell(hosting, { type: 'host/frame', frame }, ctx, LANE);
    expect(atHost.app).toBe(hosting);
    expect(atHost.effects).toEqual([{ type: 'toast', message: 'intent:1:2', ms: null }]);
    const atGuest = reduceShell(joined, { type: 'guest/frame', frame }, ctx, LANE);
    expect(atGuest.app).toBe(joined);
    expect(atGuest.effects).toEqual([{ type: 'toast', message: 'intent:0:2', ms: null }]);
    expect(seen).toEqual([
      [frame, 1, NOW],
      [frame, 0, NOW],
    ]);
  });

  test('without the hook the frame is dropped on both sides: the App is the same record and nothing is emitted', () => {
    expect(reduceShell(hosting, { type: 'host/frame', frame }, ctx, BARE)).toEqual({
      app: hosting,
      effects: [],
    });
    expect(reduceShell(joined, { type: 'guest/frame', frame }, ctx, BARE)).toEqual({
      app: joined,
      effects: [],
    });
  });

  test('the seven frames still take their own routes beside the lane (a join is welcomed, a state is painted)', () => {
    const welcomed = reduceShell(
      withShell(initialApp, { role: 'host', myName: 'Ann' }),
      { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } },
      ctx,
      LANE,
    );
    expect(welcomed.app.shell).toMatchObject({ oppName: 'Jeff', oppConnected: true });
    expect(welcomed.effects.map((e) => e.type)).toEqual(['send']);
    const painted = reduceShell(
      joined,
      { type: 'guest/frame', frame: { t: 'state', view: viewFor(dealt, 1) } },
      ctx,
      LANE,
    );
    expect(marks(painted.app)).toEqual(['frame', `rendered:prev@${String(NOW)}`]);
    expect(seen.length).toBe(2);
  });
});

describe('the finished game`s record (the owner, 2026-09-25)', () => {
  const records = (effects: ReadonlyArray<FakeEffect>): ReadonlyArray<RecentGame> =>
    effects.flatMap((e) => (e.type === 'recordGame' ? [e.game] : []));
  /** The engine's `end` for the seat whose turn it is, through the shell's pass-and-play position load. */
  const ended = (start: App, moves: number, ender: Seat): FakeStep => {
    const g = game(start);
    return run(start, {
      type: 'position/load',
      state: { ...g, moves, turn: ender, over: true },
    });
  };

  test('the user`s seat: the first name and the host are seat 0, the guest seat 1, nobody at home', () => {
    expect(userSeatOf('local')).toBe(0);
    expect(userSeatOf('host')).toBe(0);
    expect(userSeatOf('guest')).toBe(1);
    expect(userSeatOf(null)).toBeNull();
  });

  test('pass and play: the game`s end records it once, first in the shell and as the effect; a repaint, a re-render and the same position again record nothing', () => {
    const start = local();
    expect(start.shell.recentGames).toEqual([]);
    // Seat 0 moves, seat 1 moves, seat 0 ends: seat 0 (the device's user) wins 2–0.
    const done = ended(start, 2, 0);
    const record: RecentGame = {
      at: NOW,
      mode: 'local',
      players: ['Ann', 'Bob'],
      score: '2 moves',
      winner: 0,
      outcome: 'win',
    };
    expect(records(done.effects)).toEqual([record]);
    expect(done.app.shell.recentGames).toEqual([record]);
    expect(done.app.shell.recorded).toBe('2:0');
    expect(done.app.shell.screen).toBe('endgameScreen');
    // The effect follows the paint's own (the mark says the game was rendered first).
    expect(kinds(done.effects).indexOf('recordGame')).toBeGreaterThan(
      kinds(done.effects).indexOf('persist'),
    );
    const again = run(done.app, { type: 'render' }, { type: 'render' });
    expect(records(again.effects)).toEqual([]);
    expect(again.app.shell.recentGames).toEqual([record]);
    const reloaded = run(done.app, { type: 'position/load', state: { ...game(done.app) } });
    expect(records(reloaded.effects)).toEqual([]);
  });

  test('the outcome is the first seat`s: a loss when seat 1 ends it, a draw when nobody moved', () => {
    const lost = ended(local(), 1, 1);
    expect(records(lost.effects)).toEqual([
      {
        at: NOW,
        mode: 'local',
        players: ['Ann', 'Bob'],
        score: '1 moves',
        winner: 1,
        outcome: 'loss',
      },
    ]);
    const drawn = ended(local(), 0, 0);
    expect(records(drawn.effects)).toEqual([
      {
        at: NOW,
        mode: 'local',
        players: ['Ann', 'Bob'],
        score: '0 moves',
        winner: null,
        outcome: 'draw',
      },
    ]);
  });

  test('a second game after a leave is recorded too, newest first, and the leave forgets the key', () => {
    const first = ended(local(), 2, 0);
    const left = run(first.app, { type: 'leave/finish' }).app;
    expect(left.shell.recorded).toBeNull();
    expect(left.shell.recentGames).toEqual(first.app.shell.recentGames);
    const second = ended(
      run(left, { type: 'local/click', p1: 'Cy', p2: 'Di', level: '1' }).app,
      2,
      0,
    );
    expect(records(second.effects)).toHaveLength(1);
    expect(second.app.shell.recentGames.map((g) => g.players)).toEqual([
      ['Cy', 'Di'],
      ['Ann', 'Bob'],
    ]);
    // `home/init` reads the stored list into the shell.
    expect(
      run(initialApp, { type: 'home/init', home: { ...home, recentGames: [RECORD] } }).app.shell
        .recentGames,
    ).toEqual([RECORD]);
  });

  test('online, the host: the guest`s winning move records a loss for the host once; the guest, from the same frame, a win once', () => {
    const h = hosting();
    const moved = hostDispatch(h, 0, { type: 'move' }, ctx, FAKE);
    const guestMoved = hostDispatch(moved.app, 1, { type: 'move' }, ctx, FAKE);
    const hostEnded = hostDispatch(guestMoved.app, 0, { type: 'move' }, ctx, FAKE);
    expect(records([...moved.effects, ...guestMoved.effects, ...hostEnded.effects])).toEqual([]);
    const won = hostDispatch(hostEnded.app, 1, { type: 'end' }, ctx, FAKE);
    expect(records(won.effects)).toEqual([
      {
        at: NOW,
        mode: 'online',
        players: ['Ann', 'Jeff'],
        score: '3 moves',
        winner: 1,
        outcome: 'loss',
      },
    ]);
    expect(won.app.shell.recorded).toBe('3:1');
    // The host re-broadcasts (a rejoin): nothing more.
    expect(records(broadcast(won.app, ctx, FAKE).effects)).toEqual([]);
    // The guest: the host's state frame of the finished game (the names are the frame's: the
    // host's game seats Ann and Jeff), then the same frame re-sent.
    const g = seated();
    const frame = { t: 'state', view: viewFor(game(won.app), 1) } as const;
    const got = run(g, { type: 'guest/frame', frame });
    expect(records(got.effects)).toEqual([
      {
        at: NOW,
        mode: 'online',
        players: ['Ann', 'Jeff'],
        score: '3 moves',
        winner: 1,
        outcome: 'win',
      },
    ]);
    expect(got.app.shell.recentGames).toHaveLength(1);
    const resent = run(got.app, { type: 'guest/frame', frame }, { type: 'render' });
    expect(records(resent.effects)).toEqual([]);
  });

  test('a game still on records nothing, whatever the paint', () => {
    expect(records(run(local(), { type: 'render' }).effects)).toEqual([]);
    expect(records(run(hosting(), { type: 'render' }).effects)).toEqual([]);
    expect(records(run(seated(), { type: 'guest/lost' }).effects)).toEqual([]);
  });
});

describe('the cue memory', () => {
  test('fresh: a key not yet played for is fresh and remembered, the same key again is not, a new key is fresh again', () => {
    const first = fresh({ key: null }, 'round:1');
    expect(first).toEqual({ mem: { key: 'round:1' }, fresh: true });
    expect(fresh(first.mem, 'round:1')).toEqual({ mem: { key: 'round:1' }, fresh: false });
    expect(fresh(first.mem, 'round:2')).toEqual({ mem: { key: 'round:2' }, fresh: true });
    // A memory extending the record (gin's `turnKey`) passes as it is; the result carries the key alone.
    const extended: CueMemory & Readonly<{ turnKey: string }> = { key: 'a', turnKey: 'x' };
    expect(fresh(extended, 'a')).toEqual({ mem: { key: 'a' }, fresh: false });
  });
});

describe('resume and the handoff', () => {
  const hostSave = {
    role: 'host',
    code: 'LRZL',
    myName: 'Ann',
    level: 3,
    game: dealt,
    oppName: 'Jeff',
  } as const;

  test('resumeFor: a live local or host game, never a finished one or an empty room, a guest room; the offer keeps the save`s terms and mark', () => {
    expect(resumeFor(null, FAKE)).toBeNull();
    expect(resumeFor({ role: 'local', game: dealt }, FAKE)).toEqual({ kind: 'local', game: dealt });
    expect(resumeFor({ role: 'local', game: over }, FAKE)).toBeNull();
    expect(resumeFor(hostSave, FAKE)).toEqual({
      kind: 'host',
      code: 'LRZL',
      myName: 'Ann',
      level: 3,
      game: dealt,
      oppName: 'Jeff',
      handoff: false,
      at: null,
    });
    expect(resumeFor({ ...hostSave, handoff: true }, FAKE)).toMatchObject({ handoff: true });
    // A room still waiting for its first guest is offered too (lobby-resume.md D3), with its stamp
    // when the save carries one, so the boot can tell a moment ago from last week.
    expect(resumeFor({ ...hostSave, game: null }, FAKE)).toEqual({
      kind: 'host',
      code: 'LRZL',
      myName: 'Ann',
      level: 3,
      game: null,
      oppName: 'Jeff',
      handoff: false,
      at: null,
    });
    expect(resumeFor({ ...hostSave, game: null, at: NOW - 5 }, FAKE)).toMatchObject({
      game: null,
      at: NOW - 5,
    });
    expect(resumeFor({ ...hostSave, game: over }, FAKE)).toBeNull();
    expect(resumeFor({ role: 'guest', code: 'KQZM', myName: 'Jeff' }, FAKE)).toEqual({
      kind: 'guest',
      code: 'KQZM',
      myName: 'Jeff',
    });
  });

  test('resume/click: nothing to resume, a local game, a hosted room under its code and terms, a guest room, the game`s own offer', () => {
    expect(run(initialApp, { type: 'resume/click' })).toEqual({ app: initialApp, effects: [] });
    const localGame = run(
      initialApp,
      { type: 'home/init', home: { ...home, save: { role: 'local', game: dealt } } },
      { type: 'resume/click' },
    );
    expect(localGame.app.shell).toMatchObject({
      role: 'local',
      game: dealt,
      screen: 'tableScreen',
    });
    // The home read fills the two seats with their defaults (nothing saved) before the game resumes.
    expect(kinds(localGame.effects)).toEqual([
      'scrollTop',
      'fillName',
      'fillP2Name',
      'wakeLock',
      'persist',
      'ownFx',
      'scrollTop',
    ]);
    const host = run(
      initialApp,
      { type: 'home/init', home: { ...home, save: { ...hostSave, handoff: true } } },
      { type: 'resume/click' },
    );
    expect(host.app.shell).toMatchObject({
      role: 'host',
      code: 'LRZL',
      myName: 'Ann',
      opts: { level: 3 },
      game: dealt,
      oppName: 'Jeff',
      view: viewFor(dealt, 0),
      handoff: true,
      screen: 'hostWaitScreen',
    });
    expect(host.effects.at(-1)).toEqual({
      type: 'startHost',
      code: 'LRZL',
      attempt: 1,
      resume: true,
    });
    const guest = run(
      initialApp,
      { type: 'home/init', home: { ...home, save: { role: 'guest', code: 'KQZM', myName: 'Jo' } } },
      { type: 'resume/click' },
    );
    expect(guest.app.shell).toMatchObject({ role: 'guest', code: 'KQZM', myName: 'Jo' });
    expect(guest.effects.at(-1)).toEqual({ type: 'startGuest', code: 'KQZM', attempt: 1 });
    const extra = run(
      initialApp,
      { type: 'home/init', home: { ...home, colour: 'gold' } },
      { type: 'resume/click' },
    );
    expect(extra.effects.at(-1)).toEqual({ type: 'toast', message: 'extra:gold', ms: null });
  });

  const offered = (): App =>
    run(initialApp, { type: 'home/init', home: { ...home, save: { role: 'local', game: dealt } } })
      .app;
  /** The pass-and-play offer, for the tests below where `offered` is a step. */
  const offered_ = offered;

  test('handoff/click: nothing without a pass-and-play offer or game; seat 0 hosts the game as it stands under a fresh code, its terms and the table reset for the handoff', () => {
    expect(run(initialApp, { type: 'handoff/click' })).toEqual({ app: initialApp, effects: [] });
    const hostOffer = run(initialApp, { type: 'home/init', home: { ...home, save: hostSave } }).app;
    expect(run(hostOffer, { type: 'handoff/click' })).toEqual({ app: hostOffer, effects: [] });
    const goldOffer = run(initialApp, { type: 'home/init', home: { ...home, colour: 'gold' } }).app;
    expect(run(goldOffer, { type: 'handoff/click' })).toEqual({ app: goldOffer, effects: [] });
    const online = hosting();
    expect(run(online, { type: 'handoff/click' })).toEqual({ app: online, effects: [] });
    const handed = run(offered(), { type: 'handoff/click' });
    expect(handed.app.shell).toMatchObject({
      role: 'host',
      myName: 'Ann',
      opts: { level: 3 },
      game: dealt,
      oppName: 'Jeff',
      oppConnected: false,
      view: viewFor(dealt, 0),
      revealed: null,
      handoff: true,
      screen: 'hostWaitScreen',
    });
    expect(handed.app.shell.code).toMatch(/^[A-Z]{4}$/);
    expect(marks(handed.app).at(-1)).toBe('handoff');
    expect(handed.effects.at(-1)).toEqual({
      type: 'startHost',
      code: handed.app.shell.code,
      attempt: 1,
      resume: false,
    });
    expect(saveFor(handed.app.shell)).toEqual({
      role: 'host',
      code: handed.app.shell.code,
      myName: 'Ann',
      level: 3,
      game: dealt,
      oppName: 'Jeff',
      handoff: true,
    });
    // From the pass-and-play table: the game in play goes online.
    const fromTable = run(local(), { type: 'handoff/click' });
    expect(fromTable.app.shell).toMatchObject({
      role: 'host',
      myName: 'Ann',
      oppName: 'Bob',
      handoff: true,
      opts: { level: 2 },
    });
    expect(marks(fromTable.app).at(-1)).toBe('handoff');
  });
  const waitingSave = { ...hostSave, game: null, oppName: null, at: NOW - 60_000 } as const;

  test('a waiting room comes back: resume/click reopens its code with no game and no view; the boot`s resume/auto does so by itself within WAITING_RESUME_MS and leaves an older, unstamped, mid-game, local or guest offer for the tap; nothing while seated', () => {
    const offered = run(initialApp, { type: 'home/init', home: { ...home, save: waitingSave } });
    expect(offered.app.shell.resume).toEqual({
      kind: 'host',
      code: 'LRZL',
      myName: 'Ann',
      level: 3,
      game: null,
      oppName: null,
      handoff: false,
      at: NOW - 60_000,
    });
    const clicked = run(offered.app, { type: 'resume/click' });
    expect(clicked.app.shell).toMatchObject({
      role: 'host',
      code: 'LRZL',
      myName: 'Ann',
      opts: { level: 3 },
      game: null,
      view: null,
      oppName: null,
      handoff: false,
      openedAt: NOW,
      screen: 'hostWaitScreen',
    });
    expect(clicked.effects).toEqual([
      { type: 'scrollTop' },
      { type: 'startHost', code: 'LRZL', attempt: 1, resume: true },
    ]);
    // The boot's own resume is the tap, with nobody tapping (the owner, 2026-09-25).
    expect(run(offered.app, { type: 'resume/auto' })).toEqual(clicked);
    expect(WAITING_RESUME_MS).toBe(30 * 60_000);
    const edge = run(
      initialApp,
      {
        type: 'home/init',
        home: { ...home, save: { ...waitingSave, at: NOW - WAITING_RESUME_MS } },
      },
      { type: 'resume/auto' },
    );
    expect(edge.app.shell.role).toBe('host');
    // Older: the offer stands and nothing else happens.
    const stale = run(initialApp, {
      type: 'home/init',
      home: { ...home, save: { ...waitingSave, at: NOW - WAITING_RESUME_MS - 1 } },
    }).app;
    expect(run(stale, { type: 'resume/auto' })).toEqual({ app: stale, effects: [] });
    expect(stale.shell.resume).toMatchObject({ kind: 'host', game: null });
    // A save from before the stamp, a game in play, a pass-and-play game, a guest room: the tap's.
    const unstamped = run(initialApp, {
      type: 'home/init',
      home: { ...home, save: { ...hostSave, game: null, oppName: null } },
    }).app;
    expect(unstamped.shell.resume).toMatchObject({ kind: 'host', game: null, at: null });
    expect(run(unstamped, { type: 'resume/auto' })).toEqual({ app: unstamped, effects: [] });
    const midGame = run(initialApp, { type: 'home/init', home: { ...home, save: hostSave } }).app;
    expect(run(midGame, { type: 'resume/auto' })).toEqual({ app: midGame, effects: [] });
    expect(run(offered_(), { type: 'resume/auto' })).toEqual({ app: offered_(), effects: [] });
    const guestOffer = run(initialApp, {
      type: 'home/init',
      home: { ...home, save: { role: 'guest', code: 'KQZM', myName: 'Jo' } },
    }).app;
    expect(run(guestOffer, { type: 'resume/auto' })).toEqual({ app: guestOffer, effects: [] });
    // Seated already (an invite link took the device into another room first): nothing.
    const joined = run(offered.app, { type: 'join/link', code: 'KQZM' }).app;
    expect(joined.shell).toMatchObject({ role: 'guest', code: 'KQZM' });
    expect(run(joined, { type: 'resume/auto' })).toEqual({ app: joined, effects: [] });
    expect(run(initialApp, { type: 'resume/auto' })).toEqual({ app: initialApp, effects: [] });
  });

  test('the device`s own invite link resumes hosting instead of joining: the waiting room at any age, the game in play too; another code, or a guest save under this one, joins as before', () => {
    const stale = run(initialApp, {
      type: 'home/init',
      home: { ...home, save: { ...waitingSave, at: NOW - 3 * WAITING_RESUME_MS } },
    }).app;
    const own = run(stale, { type: 'join/link', code: 'lrzl' });
    expect(own.app).toEqual(run(stale, { type: 'resume/click' }).app);
    expect(own.app.shell).toMatchObject({
      role: 'host',
      code: 'LRZL',
      game: null,
      screen: 'hostWaitScreen',
      codeDraft: '',
    });
    expect(own.effects).toEqual([
      { type: 'scrollTop' },
      { type: 'startHost', code: 'LRZL', attempt: 1, resume: true },
    ]);
    const midGame = run(initialApp, { type: 'home/init', home: { ...home, save: hostSave } }).app;
    expect(run(midGame, { type: 'join/link', code: 'LRZL' }).app.shell).toMatchObject({
      role: 'host',
      code: 'LRZL',
      game: dealt,
      view: viewFor(dealt, 0),
    });
    // Another room's link: the guest's path, the code in the form.
    const other = run(stale, { type: 'join/link', code: 'KQZM' });
    expect(other.app.shell).toMatchObject({ role: 'guest', code: 'KQZM', codeDraft: 'KQZM' });
    expect(other.effects.at(-1)).toEqual({ type: 'startGuest', code: 'KQZM', attempt: 1 });
    // A guest save under the same code is not a room this device hosts: the link joins.
    const guestSaved = run(initialApp, {
      type: 'home/init',
      home: { ...home, save: { role: 'guest', code: 'LRZL', myName: 'Jo' } },
    }).app;
    expect(run(guestSaved, { type: 'join/link', code: 'LRZL' }).app.shell.role).toBe('guest');
  });
});

describe('leaving and cancelling', () => {
  test('leave/request confirms with the role`s copy; leave/confirmed drops the wake lock, closes the network, then finishes (in that order); leave/finish resets the shell, the cue memory and the table, then goes home', () => {
    expect(run(local(), { type: 'leave/request' }).effects).toEqual([
      { type: 'confirm', message: 'Leave the local game?', then: { type: 'leave/confirmed' } },
    ]);
    const h = hosting();
    expect(run(h, { type: 'leave/request' }).effects).toEqual([
      { type: 'confirm', message: 'Leave the room?', then: { type: 'leave/confirmed' } },
    ]);
    const confirmed = run(h, { type: 'leave/confirmed' });
    expect(confirmed.app).toBe(h);
    expect(confirmed.effects).toEqual([
      { type: 'wakeLock', hold: false },
      { type: 'closeNet' },
      { type: 'then', intent: { type: 'leave/finish' } },
    ]);
    const finished = run(withShell(h, { revealed: 1, handoff: true }), { type: 'leave/finish' });
    expect(finished.app.shell).toMatchObject({
      role: null,
      game: null,
      view: null,
      oppConnected: false,
      code: null,
      revealed: null,
      handoff: false,
      cues: { seen: null },
      netAttempt: h.shell.netAttempt + 1,
    });
    expect(marks(finished.app).at(-1)).toBe('leave');
    expect(finished.effects).toEqual([{ type: 'clearSave' }, { type: 'initHome' }]);
  });

  test('cancel closes the network, then finishes: the role dropped, the ticket bumped, the save cleared, or a handed-off game given back to pass-and-play', () => {
    const waiting = run(initialApp, { type: 'host/click', name: 'Ann', level: '3' }).app;
    const cancelled = run(waiting, { type: 'cancel' });
    expect(cancelled.app).toBe(waiting);
    expect(cancelled.effects).toEqual([
      { type: 'closeNet' },
      { type: 'then', intent: { type: 'cancel/finish' } },
    ]);
    const finished = run(waiting, { type: 'cancel/finish' });
    expect(finished.app.shell).toMatchObject({
      role: null,
      netAttempt: 2,
      handoff: false,
      code: waiting.shell.code,
    });
    expect(finished.effects).toEqual([{ type: 'clearSave' }, { type: 'initHome' }]);
    const handed = run(local(), { type: 'handoff/click' }).app;
    expect(run(handed, { type: 'cancel/finish' }).effects).toEqual([
      { type: 'saveLocal', game: game(handed) },
      { type: 'initHome' },
    ]);
    // A handoff mark without a game (nothing to give back) clears the save as any room does.
    expect(
      run(withShell(waiting, { handoff: true }), { type: 'cancel/finish' }).effects[0],
    ).toEqual({ type: 'clearSave' });
  });

  test('visible takes the wake lock again only in a game; render paints against the current view and the clock; persist persists', () => {
    expect(run(initialApp, { type: 'visible' }).effects).toEqual([]);
    expect(run(hosting(), { type: 'visible' }).effects).toEqual([{ type: 'wakeLock', hold: true }]);
    expect(run(initialApp, { type: 'render' })).toEqual({ app: initialApp, effects: [] });
    const again = run(hosting(), { type: 'render' });
    expect(marks(again.app).at(-1)).toBe(`rendered:prev@${String(NOW)}`);
    expect(again.effects).toEqual([{ type: 'scrollTop' }]);
    expect(run(hosting(), { type: 'persist' }).effects).toEqual([{ type: 'persist' }]);
  });
});

describe('storage and what the sessions read back', () => {
  test('saveFor is the persist() literal per role, the handoff mark only when set, null at home or with no local game', () => {
    expect(saveFor(initialApp.shell)).toBeNull();
    const h = hosting();
    expect(saveFor(h.shell)).toEqual({
      role: 'host',
      code: h.shell.code,
      myName: 'Ann',
      level: 3,
      game: game(h),
      oppName: 'Jeff',
    });
    expect(saveFor(withShell(h, { code: null }).shell)).toMatchObject({ code: '' });
    // The waiting room's save carries the stamp of its opening (`openedAt`, the clock at
    // `startHost`); a game's save never does (docs/design/lobby-resume.md D1).
    const waiting = run(initialApp, { type: 'host/click', name: 'Ann', level: '3' }).app;
    expect(waiting.shell.openedAt).toBe(NOW);
    expect(saveFor(waiting.shell)).toEqual({
      role: 'host',
      code: waiting.shell.code,
      myName: 'Ann',
      level: 3,
      game: null,
      oppName: null,
      at: NOW,
    });
    expect(saveFor(withShell(waiting, { openedAt: null }).shell)).not.toHaveProperty('at');
    expect(h.shell.openedAt).toBe(NOW);
    expect(saveFor(h.shell)).not.toHaveProperty('at');
    const guest = run(initialApp, { type: 'join/click', name: 'Jeff', code: 'KQZM' }).app;
    expect(saveFor(guest.shell)).toEqual({ role: 'guest', code: 'KQZM', myName: 'Jeff' });
    expect(saveFor(withShell(guest, { code: null }).shell)).toMatchObject({ code: '' });
    const l = local();
    expect(saveFor(l.shell)).toEqual({ role: 'local', game: game(l) });
    expect(saveFor(withShell(l, { game: null }).shell)).toBeNull();
  });

  test('readHome: the defaults when nothing is stored (or garbage is), the values when they are, the game`s own key beside them', () => {
    const store: Store = new Map();
    expect(readHome(store, FAKE)).toEqual(home);
    store.set(KEYS.name, 'Ann');
    store.set(KEYS.p2Name, 'Bob');
    store.set(KEYS.homeTab, 'about');
    store.set(KEYS.playMode, 'local');
    store.set(KEYS.soundFont, 'arcade');
    store.set(KEYS.save, JSON.stringify({ role: 'guest', code: 'KQZM', myName: 'Jeff' }));
    store.set(KEYS.recentGames, JSON.stringify([RECORD]));
    store.set(KEYS.colour, 'red');
    expect(readHome(store, FAKE)).toEqual({
      name: 'Ann',
      p2Name: 'Bob',
      homeTab: 'about',
      playMode: 'local',
      soundFont: 'arcade',
      save: { role: 'guest', code: 'KQZM', myName: 'Jeff' },
      recentGames: [RECORD],
      colour: 'red',
    });
    store.set(KEYS.homeTab, 'settings');
    store.set(KEYS.playMode, 'bots');
    store.set(KEYS.soundFont, 'plaid');
    store.set(KEYS.save, 'not json');
    expect(readHome(store, FAKE)).toMatchObject({
      homeTab: 'play',
      playMode: 'online',
      soundFont: 'default',
      save: null,
    });
  });

  test('hostContextOf and guestContextOf pick the fields the sessions read, the room`s terms among them', () => {
    const h = hosting();
    expect(hostContextOf(h.shell)).toEqual({
      attempt: 1,
      role: 'host',
      code: h.shell.code,
      myName: 'Ann',
      level: 3,
      hasGame: true,
      handoff: false,
      oppName: 'Jeff',
      oppConnected: true,
    });
    expect(guestContextOf(h.shell)).toEqual({
      attempt: 1,
      role: 'host',
      code: h.shell.code,
      myName: 'Ann',
      oppConnected: true,
    });
  });
});

describe('runShellEffect', () => {
  const recorded = (): Readonly<{
    deps: ShellEffectDeps<Fake>;
    log: unknown[][];
    store: Store;
    answer: { yes: boolean };
  }> => {
    const log: unknown[][] = [];
    const store: Store = new Map();
    const answer = { yes: true };
    const note =
      (name: string) =>
      (...args: unknown[]): void => {
        log.push([name, ...args]);
      };
    const deps: ShellEffectDeps<Fake> = {
      store,
      toast: note('toast'),
      fx: note('fx'),
      wakeLock: note('wakeLock'),
      net: {
        startHost: note('startHost'),
        startGuest: note('startGuest'),
        send: note('send'),
        close: note('close'),
      },
      confirm: (message) => {
        log.push(['confirm', message]);
        return answer.yes;
      },
      scrollTop: note('scrollTop'),
      timers: { start: note('timers.start'), cancel: note('timers.cancel') },
      toggleSound: note('toggleSound'),
      share: note('share'),
      revealRule: note('revealRule'),
      page: {
        fillName: note('page.fillName'),
        fillP2Name: note('page.fillP2Name'),
        setCode: note('page.setCode'),
      },
      dispatch: note('dispatch'),
    };
    return { deps, log, store, answer };
  };
  const shell: Shell = initialApp.shell;

  test('the storage effects write through the config`s prefs; persist writes the role`s save or nothing', () => {
    const { deps, store } = recorded();
    const h = hosting();
    runShellEffect(h.shell, { type: 'persist' }, deps, FAKE);
    expect(store.get(KEYS.save)).toBe(JSON.stringify(saveFor(h.shell)));
    runShellEffect(shell, { type: 'persist' }, deps, FAKE);
    expect(store.has(KEYS.save)).toBe(true);
    runShellEffect(shell, { type: 'clearSave' }, deps, FAKE);
    expect(store.has(KEYS.save)).toBe(false);
    runShellEffect(shell, { type: 'saveLocal', game: dealt }, deps, FAKE);
    expect(store.get(KEYS.save)).toBe(JSON.stringify({ role: 'local', game: dealt }));
    runShellEffect(shell, { type: 'rememberName', name: 'Ann' }, deps, FAKE);
    runShellEffect(shell, { type: 'rememberP2Name', name: 'Bob' }, deps, FAKE);
    runShellEffect(shell, { type: 'writeHomeTab', tab: 'about' }, deps, FAKE);
    runShellEffect(shell, { type: 'writePlayMode', mode: 'local' }, deps, FAKE);
    runShellEffect(shell, { type: 'writeSoundFont', font: 'felt' }, deps, FAKE);
    runShellEffect(shell, { type: 'recordGame', game: RECORD }, deps, FAKE);
    runShellEffect(shell, { type: 'recordGame', game: { ...RECORD, at: NOW + 1 } }, deps, FAKE);
    expect([...store.entries()].filter(([k]) => k !== KEYS.save)).toEqual([
      [KEYS.name, 'Ann'],
      [KEYS.p2Name, 'Bob'],
      [KEYS.homeTab, 'about'],
      [KEYS.playMode, 'local'],
      [KEYS.soundFont, 'felt'],
      [KEYS.recentGames, JSON.stringify([{ ...RECORD, at: NOW + 1 }, RECORD])],
    ]);
    runShellEffect(shell, { type: 'rememberName', name: '' }, deps, FAKE);
    expect(store.has(KEYS.name)).toBe(false);
  });

  test('every other effect reaches its adapter with its arguments; fx plays in the shell`s font; confirm dispatches only on yes; initHome re-reads the store', () => {
    const { deps, log, answer, store } = recorded();
    const effects: ReadonlyArray<FakeEffect> = [
      { type: 'toast', message: 'hi', ms: 4000 },
      { type: 'send', frame: { t: 'full' } },
      { type: 'fx', cue: 'ding' },
      { type: 'phrases', phrases: [SHELL_CUES.win, { steps: [{ cue: 'good.trick' }], buzz: 9 }] },
      { type: 'wakeLock', hold: true },
      { type: 'startHost', code: 'ABCD', attempt: 2, resume: false },
      { type: 'startGuest', code: 'ABCD', attempt: 3 },
      { type: 'closeNet' },
      { type: 'confirm', message: 'sure?', then: { type: 'leave/confirmed' } },
      { type: 'then', intent: { type: 'cancel/finish' } },
      { type: 'scrollTop' },
      { type: 'startTimer', id: 'own', ms: 450, then: { type: 'own' } },
      { type: 'cancelTimer', id: 'longPress' },
      { type: 'toggleSound' },
      { type: 'share', code: 'ABCD' },
      { type: 'revealRule', slot: 'rulesList', rule: 'knock' },
      { type: 'fillName', name: 'Ann' },
      { type: 'fillP2Name', name: 'Bob' },
      // The default mark travels to the page as a flag (home.ts paints it as `data-default`).
      { type: 'fillName', name: 'Ari', default: true },
      { type: 'fillP2Name', name: 'Lavi', default: true },
      { type: 'setCode', value: 'AB' },
      { type: 'initHome' },
    ];
    effects.forEach((e) => {
      if (!isShellEffect(e)) throw new Error('not a shell effect');
      runShellEffect({ ...shell, soundFont: 'felt' }, e, deps, FAKE);
    });
    expect(log).toEqual([
      ['toast', 'hi', 4000],
      ['send', { t: 'full' }],
      ['fx', 'ding', 'felt'],
      ['fx', [SHELL_CUES.win, { steps: [{ cue: 'good.trick' }], buzz: 9 }], 'felt'],
      ['wakeLock', true],
      ['startHost', 'ABCD', 2, false],
      ['startGuest', 'ABCD', 3],
      ['close'],
      ['confirm', 'sure?'],
      ['dispatch', { type: 'leave/confirmed' }],
      ['dispatch', { type: 'cancel/finish' }],
      ['scrollTop'],
      ['timers.start', 'own', 450, { type: 'own' }],
      ['timers.cancel', 'longPress'],
      ['toggleSound'],
      ['share', 'ABCD'],
      ['revealRule', 'rulesList', 'knock'],
      ['page.fillName', 'Ann', false],
      ['page.fillP2Name', 'Bob', false],
      ['page.fillName', 'Ari', true],
      ['page.fillP2Name', 'Lavi', true],
      ['page.setCode', 'AB'],
      ['dispatch', { type: 'home/init', home: readHome(store, FAKE) }],
    ]);
    answer.yes = false;
    log.length = 0;
    runShellEffect(
      shell,
      { type: 'confirm', message: 'sure?', then: { type: 'leave/confirmed' } },
      deps,
      FAKE,
    );
    expect(log).toEqual([['confirm', 'sure?']]);
  });
});
