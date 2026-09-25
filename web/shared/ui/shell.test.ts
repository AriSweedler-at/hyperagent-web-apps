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

import { boolean, literal, number, object, pair, string } from '../lib/json.ts';
import { err, ok, type Result } from '../lib/result.ts';
import { mulberry32 } from '../lib/rng.ts';
import { SHELL_CUES } from '../lib/sound/cues.ts';
import { SOUND_FONTS } from '../lib/sound/fonts.ts';
import {
  CONNECTING_MSG,
  DISCONNECTED_MSG,
  GONE_TOAST_MS,
  LONG_PRESS_MS,
  LOST_HOST_MSG,
  OPPONENT_LEFT_MSG,
  ROOM_FULL_MSG,
  SANDBOX_LOCAL_ONLY_MSG,
  SHELL_EFFECT_TYPES,
  SHELL_INTENT_TYPES,
  WAITING_FOR_GUEST_MSG,
  badPositionMsg,
  broadcast,
  fresh,
  guestContextOf,
  guestGoneMsg,
  hostContextOf,
  hostDispatch,
  initialShell,
  isShellEffect,
  isShellIntent,
  joinedMsg,
  localBroadcast,
  localPlayers,
  localSeated,
  readHome,
  reduceShell,
  resumeFor,
  saveFor,
  startLocal,
  step,
  toast,
  withShell,
  withTable,
  type CueMemory,
  type Effect,
  type HomeSnapshot,
  type Intent,
  type Player,
  type Save,
  type Seat,
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
type View = Readonly<{ seat: Seat; turn: Seat; moves: number; over: boolean; isMyTurn: boolean }>;
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
  colour: 'green',
};

const PLAYERS: Readonly<[Player, Player]> = [
  { id: 'host', name: 'Ann' },
  { id: 'guest', name: 'Jeff' },
];
const dealt: State = { players: PLAYERS, level: 3, turn: 0, moves: 0, over: false };
const over: State = { ...dealt, over: true };

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
      rulesOpen: false,
      cues: { seen: null },
      submenuOpen: false,
      longPressed: false,
      codeDraft: '',
      soundFont: 'default',
    });
  });

  test('the 44 shell intents and 28 shell effects are listed once; the guards partition a game`s unions', () => {
    expect(SHELL_INTENT_TYPES).toHaveLength(44);
    expect(new Set(SHELL_INTENT_TYPES).size).toBe(44);
    expect(SHELL_INTENT_TYPES).toContain('curtain/reveal');
    expect(SHELL_INTENT_TYPES).toContain('position/load');
    expect(SHELL_INTENT_TYPES).toContain('persist');
    expect(SHELL_EFFECT_TYPES).toHaveLength(28);
    expect(new Set(SHELL_EFFECT_TYPES).size).toBe(28);
    expect(SHELL_EFFECT_TYPES).toContain('phrases');
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
    // Nothing saved: no fills, nameTouched untouched, an unknown tab falls back to the default.
    const plain = run(initialApp, {
      type: 'home/init',
      home: { ...home, homeTab: 'score' as 'play' },
    });
    expect(plain.app.shell).toMatchObject({ nameTouched: false, savedName: null, homeTab: 'play' });
    expect(plain.effects).toEqual([{ type: 'scrollTop' }]);
    // A saved second name alone fills its input and nothing else.
    expect(run(initialApp, { type: 'home/init', home: { ...home, p2Name: 'Bob' } })).toMatchObject({
      app: { shell: { nameTouched: false, savedName: null, p2Name: 'Bob' } },
      effects: [{ type: 'scrollTop' }, { type: 'fillP2Name', name: 'Bob' }],
    });
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
    expect(linked.effects).toEqual([{ type: 'setCode', value: 'KQZM' }]);
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
      app: withShell(done, { oppConnected: false }),
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
    expect(localPlayers('', '')).toEqual([
      { id: 'p1', name: 'Player 1' },
      { id: 'p2', name: 'Player 2' },
    ]);
    expect(localPlayers('A'.repeat(25), 'b')[0].name).toBe('A'.repeat(20));
    // The two halves the sandbox composes: the seat and the broadcast.
    expect(localSeated(initialApp, dealt, FAKE)).toEqual({
      shell: {
        ...initialApp.shell,
        role: 'local',
        code: null,
        oppConnected: true,
        game: dealt,
        revealed: null,
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
    });
    expect(resumeFor({ ...hostSave, handoff: true }, FAKE)).toMatchObject({ handoff: true });
    expect(resumeFor({ ...hostSave, game: null }, FAKE)).toBeNull();
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
    expect(kinds(localGame.effects)).toEqual([
      'scrollTop',
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
    store.set(KEYS.colour, 'red');
    expect(readHome(store, FAKE)).toEqual({
      name: 'Ann',
      p2Name: 'Bob',
      homeTab: 'about',
      playMode: 'local',
      soundFont: 'arcade',
      save: { role: 'guest', code: 'KQZM', myName: 'Jeff' },
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
    expect([...store.entries()].filter(([k]) => k !== KEYS.save)).toEqual([
      [KEYS.name, 'Ann'],
      [KEYS.p2Name, 'Bob'],
      [KEYS.homeTab, 'about'],
      [KEYS.playMode, 'local'],
      [KEYS.soundFont, 'felt'],
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
      ['page.fillName', 'Ann'],
      ['page.fillP2Name', 'Bob'],
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
