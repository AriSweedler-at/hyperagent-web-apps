// The reducer alone (docs/design/backgammon-board.md §4, §5; gin's state.test.ts shape): every intent
// once, the flows that matter (a pass-and-play match driven through taps with a seeded rng, a
// hosted match against a fake guest frame stream, the resume snapshot, the die-chip tray and the
// R14 beat), the effects as data, and `runEffect` against recorded adapters.
import { describe, expect, test } from 'vitest';

import { NOW, runIntents } from '../../../../../test/shared/engine-helpers.ts';
import { createStore, type StorageLike } from '../../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { DEFAULT_LOCAL_NAMES } from '../../../../shared/ui/shell.ts';
import { actorOf, applyAction, MESSAGES, viewFor, withPosition } from '../engine/index.ts';
import type { Dice, Seat, State, View } from '../engine/index.ts';
import { connectingMsg } from '../net/guest.ts';
import { OPENING_MSG, handoffMsg } from '../net/host.ts';
import {
  action as actionFrame,
  lobby,
  state as stateFrame,
  toast as toastFrame,
} from '../protocol.ts';
import { pos, scripted } from '../engine/test-helpers.ts';
import { DEFAULT_NAME, LOCAL_NAMES } from '../shellConfig.ts';
import { STORAGE_KEYS } from '../storage.ts';
import { effectiveSelection, sourcesOf, targetsOf } from './board.ts';
import { CUES } from './sound.ts';
import {
  DEFAULT_PLAY_MODE,
  DISCONNECTED_MSG,
  GONE_TOAST_MS,
  LEAVE_LOCAL_MSG,
  LEAVE_ONLINE_MSG,
  LONG_PRESS_MS,
  LOST_HOST_MSG,
  hostLeftMsg,
  NOT_CONNECTED_MSG,
  NO_MOVE_MS,
  OPPONENT_LEFT_MSG,
  ROOM_FULL_MSG,
  SANDBOX_LOCAL_ONLY_MSG,
  SCREENS,
  SHAKE_MS,
  SHELL_INTENT_TYPES,
  TUMBLE_MS,
  WAITING_FOR_GUEST_MSG,
  badPositionMsg,
  cuesBetween,
  guestContextOf,
  guestGoneMsg,
  handoffLabel,
  hitMsg,
  hostContextOf,
  hostRoomMsg,
  initialApp,
  joinedMsg,
  newMovesBetween,
  parseMatchLength,
  parseVariant,
  readHome,
  reduce,
  resumeFor,
  resumeLabel,
  rollModalOpen,
  runEffect,
  saveFor,
  BACKGAMMON,
  type App,
  type Effect,
  type EffectDeps,
  type HomeSnapshot,
  type Intent,
  type Step,
} from './state.ts';

const ctx = { rng: mulberry32(7), now: () => NOW };

/** Dispatch intents in turn, collecting every effect. */
const run = runIntents(reduce, ctx);

const kinds = (effects: ReadonlyArray<Effect>): ReadonlyArray<string> => effects.map((e) => e.type);
const toasts = (effects: ReadonlyArray<Effect>): ReadonlyArray<unknown> =>
  effects.flatMap((e) => (e.type === 'toast' ? [[e.message, e.ms]] : []));
const cues = (effects: ReadonlyArray<Effect>): ReadonlyArray<string> =>
  effects.flatMap((e) => (e.type === 'fx' ? [e.cue] : []));
const sends = (effects: ReadonlyArray<Effect>): ReadonlyArray<unknown> =>
  effects.flatMap((e) => (e.type === 'send' ? [e.frame] : []));

const game = (app: App): State => {
  const g = app.shell.game;
  if (g === null) throw new Error('no game');
  return g;
};
const view = (app: App): View => {
  const v = app.shell.view;
  if (v === null) throw new Error('no view');
  return v;
};

const home: HomeSnapshot = {
  name: null,
  p2Name: null,
  homeTab: 'play',
  playMode: 'local',
  matchLength: 5,
  variant: 'portes',
  curtainMode: 'always',
  soundFont: 'default',
  save: null,
  recentGames: [],
};

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

/** A pass-and-play match of the given length, curtain up for the starter. */
const local = (matchLength = '5', variant = 'portes'): App =>
  run(
    initialApp,
    { type: 'home/init', home },
    { type: 'local/click', p1: 'Ann', p2: 'Bob', matchLength, variant },
  ).app;

/** The curtain lifted for whoever must act. */
const revealed = (app: App): App => run(app, { type: 'curtain/reveal' }).app;

/** A pass-and-play game at `position` for `turn`, mid-turn with `dice` or waiting to roll when null. */
const at = (text: string, turn: Seat, dice: Dice | null, app: App = local()): App =>
  revealed(
    run(app, {
      type: 'position/load',
      state: withPosition(game(app), pos(text), turn, dice),
    }).app,
  );

/** A host in the lobby with a connected guest named Jeff. */
const lobbyApp = (): App =>
  run(
    initialApp,
    { type: 'home/init', home },
    { type: 'mode/set', mode: 'online' },
    { type: 'host/click', name: 'Ann', matchLength: '3', variant: 'portes' },
    { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } },
  ).app;

/** A host with the match started. */
const hosting = (): App => run(lobbyApp(), { type: 'host/deal' }).app;

/**
 * One tap of the mover's policy: lift the curtain, roll, or move the first target of the effective
 * source (a chip when the tap opens the tray). Returns null once nobody can act.
 */
const nextTap = (app: App): Intent | null => {
  if (app.table.curtain !== null) return { type: 'curtain/reveal' };
  if (app.table.pending !== null) return { type: 'chip/tap', index: 0 };
  // The dice tumble after every roll (TUMBLE_MS); the policy lets the timer fire, as main.ts would.
  if (app.table.rolling) return { type: 'tumble/elapsed' };
  if (app.table.noMoveUntil !== null) return { type: 'noMove/elapsed' };
  const v = view(app);
  if (v.phase === 'over') return null;
  if (!v.isMyTurn) return null;
  if (v.phase === 'toRoll') return { type: 'roll/click' };
  if (v.phase === 'cubeOffered') return { type: 'take/click' };
  const sel = effectiveSelection(app.table.selected, v);
  if (sel === null) {
    const [first] = sourcesOf(v);
    if (first === undefined) return null;
    return first === 'bar' ? { type: 'bar/tap' } : { type: 'point/tap', point: first };
  }
  const [target] = targetsOf(v, sel, app.table.picked);
  if (target === undefined) return null;
  return target.to === 'off' ? { type: 'off/tap' } : { type: 'point/tap', point: target.to };
};

/** Drive the mover's policy until the game is over or `steps` run out, collecting every effect. */
const playOut = (start: Step, steps: number): Step => {
  const intent = nextTap(start.app);
  if (intent === null || steps === 0) return start;
  const next = reduce(start.app, intent, ctx);
  return playOut({ app: next.app, effects: [...start.effects, ...next.effects] }, steps - 1);
};

/** Tap the current mover's turn through to its end (the turn flips, or the game ends). */
const playTurn = (start: Step): Step => {
  const g = game(start.app);
  const intent = nextTap(start.app);
  if (intent === null || g.phase !== 'moving') return start;
  const next = reduce(start.app, intent, ctx);
  const after = { app: next.app, effects: [...start.effects, ...next.effects] };
  return game(next.app).turn === g.turn && game(next.app).phase === 'moving'
    ? playTurn(after)
    : after;
};

describe('the initial app', () => {
  test('is gin`s shell split from the table, on the home screen, online by default', () => {
    expect(initialApp.shell).toMatchObject({
      role: null,
      code: null,
      myName: 'Ari',
      opts: { matchLength: 5, variant: 'portes' },
      game: null,
      view: null,
      oppName: null,
      oppConnected: false,
      revealed: null,
      homeTab: 'play',
      playMode: 'online',
      screen: 'homeScreen',
      netAttempt: 0,
      hostStatus: { text: OPENING_MSG, pulse: true },
      startGameVisible: false,
      handoff: false,
      resume: null,
      soundFont: 'default',
    });
    expect(initialApp.table).toEqual({
      selected: null,
      picked: null,
      pending: null,
      drag: null,
      rolling: false,
      shake: null,
      resultOpen: false,
      menuOpen: false,
      historyOpen: false,
      curtain: null,
      curtainMode: 'always',
      noMoveUntil: null,
      lastPainted: null,
    });
    expect(SCREENS).toEqual([
      'homeScreen',
      'hostWaitScreen',
      'guestWaitScreen',
      'tableScreen',
      'endgameScreen',
    ]);
  });

  test("online is the default mode (storage.ts's, as gin's); mode/set switches and remembers it", () => {
    expect(DEFAULT_PLAY_MODE).toBe('online');
    expect(initialApp.shell.playMode).toBe('online');
    const { app, effects } = run(initialApp, { type: 'mode/set', mode: 'local' });
    expect(app.shell.playMode).toBe('local');
    expect(effects).toEqual([{ type: 'writePlayMode', mode: 'local' }]);
    // Anything but `local` is online (gin's `setPlayMode`).
    expect(run(app, { type: 'mode/set', mode: 'sandbox' }).app.shell.playMode).toBe('online');
  });

  test('the shell`s intents are listed once, the shared shell reducer`s (C2), backgammon`s two selects its own', () => {
    expect(SHELL_INTENT_TYPES).toContain('home/init');
    expect(SHELL_INTENT_TYPES).toContain('guest/lost');
    expect(SHELL_INTENT_TYPES).not.toContain('point/tap');
    expect(new Set(SHELL_INTENT_TYPES).size).toBe(SHELL_INTENT_TYPES.length);
  });
});

describe('home', () => {
  test('home/init: the snapshot into the shell and the inputs, the tab, the resume offer', () => {
    const saved = game(local());
    const snapshot: HomeSnapshot = {
      ...home,
      name: 'Ann',
      p2Name: 'Bob',
      homeTab: 'rules',
      playMode: 'online',
      matchLength: 7,
      variant: 'backgammon',
      curtainMode: 'never',
      soundFont: 'felt',
      save: { role: 'local', game: saved },
    };
    const { app, effects } = run(initialApp, { type: 'home/init', home: snapshot });
    expect(app.shell).toMatchObject({
      screen: 'homeScreen',
      savedName: 'Ann',
      p1Name: 'Ann',
      p2Name: 'Bob',
      nameTouched: true,
      homeTab: 'rules',
      playMode: 'online',
      opts: { matchLength: 7, variant: 'backgammon' },
      soundFont: 'felt',
      resume: { kind: 'local', game: saved },
    });
    expect(app.table.curtainMode).toBe('never');
    expect(effects).toEqual([
      { type: 'scrollTop' },
      { type: 'fillName', name: 'Ann' },
      { type: 'fillP2Name', name: 'Bob' },
    ]);
    // Nothing saved: this game's own seats go into the inputs (shellConfig.ts LOCAL_NAMES; the
    // owner, 2026-09-25: "backgammon is Ari and Ethan"), marked so the page clears each on its
    // first tap, and the state keeps none of them; an unknown tab falls back to play. `fillName`
    // reaches `#nameInput` too, so the first must be what that input's markup already holds
    // (DEFAULT_NAME), which is the shell's first too; the pair is what the e2e reads off the registry.
    const bare = run(initialApp, { type: 'home/init', home: { ...home, homeTab: 'play' } });
    expect(bare.effects).toEqual([
      { type: 'scrollTop' },
      { type: 'fillName', name: LOCAL_NAMES[0], default: true },
      { type: 'fillP2Name', name: LOCAL_NAMES[1], default: true },
    ]);
    expect(bare.app.shell).toMatchObject({ resume: null, p1Name: '', p2Name: '', savedName: null });
    expect(LOCAL_NAMES).toEqual(['Ari', 'Ethan']);
    expect(DEFAULT_NAME).toBe(LOCAL_NAMES[0]);
    expect(DEFAULT_LOCAL_NAMES[0]).toBe(LOCAL_NAMES[0]);
  });

  test('names typed are remembered trimmed and echoed to the other inputs', () => {
    const typed = run(initialApp, { type: 'name/typed', value: ' Ann ' });
    expect(typed.app.shell).toMatchObject({ p1Name: ' Ann ', nameTouched: true });
    expect(typed.effects).toEqual([
      { type: 'rememberName', name: 'Ann' },
      { type: 'fillName', name: ' Ann ' },
    ]);
    const p1 = run(initialApp, { type: 'p1name/typed', value: 'Zed' });
    expect(p1.app.shell).toMatchObject({ p1Name: 'Zed', nameTouched: false });
    expect(kinds(p1.effects)).toEqual(['rememberName', 'fillName']);
    const p2 = run(initialApp, { type: 'p2name/typed', value: 'Bob ' });
    expect(p2.app.shell.p2Name).toBe('Bob ');
    expect(p2.effects).toEqual([
      { type: 'rememberP2Name', name: 'Bob' },
      { type: 'fillP2Name', name: 'Bob ' },
    ]);
  });

  test('tab/set: a known tab is shown and persisted unless told not to; an unknown one is play', () => {
    const rules = run(initialApp, { type: 'tab/set', tab: 'rules' });
    expect(rules.app.shell.homeTab).toBe('rules');
    expect(rules.effects).toEqual([{ type: 'writeHomeTab', tab: 'rules' }]);
    const quiet = run(initialApp, { type: 'tab/set', tab: 'about', persist: false });
    expect(quiet.app.shell.homeTab).toBe('about');
    expect(quiet.effects).toEqual([]);
    expect(run(initialApp, { type: 'tab/set', tab: 'score' }).app.shell.homeTab).toBe('play');
  });

  test('rules/show: the Rules tab (persisted) and the home list on the home screen; the overlay and its list anywhere else', () => {
    const fromHome = run(initialApp, { type: 'rules/show', rule: 'scoring' });
    expect(fromHome.app.shell).toMatchObject({ homeTab: 'rules', rulesOpen: false });
    expect(fromHome.effects).toEqual([
      { type: 'writeHomeTab', tab: 'rules' },
      { type: 'revealRule', slot: 'rulesList', rule: 'scoring' },
    ]);
    const table = local();
    const fromTable = run(table, { type: 'rules/show', rule: 'cube' });
    expect(fromTable.app.shell).toMatchObject({ homeTab: table.shell.homeTab, rulesOpen: true });
    expect(fromTable.effects).toEqual([
      { type: 'revealRule', slot: 'rulesOverlayList', rule: 'cube' },
    ]);
    const waiting = run(initialApp, { type: 'screen/show', screen: 'hostWaitScreen' }).app;
    expect(run(waiting, { type: 'rules/show', rule: 'online' }).effects).toEqual([
      { type: 'revealRule', slot: 'rulesOverlayList', rule: 'online' },
    ]);
  });

  test('mode/set stores local or online; variant/set and matchLength/set keep only shipped values', () => {
    const online = run(initialApp, { type: 'mode/set', mode: 'online' });
    const back = run(online.app, { type: 'mode/set', mode: 'local' });
    expect(back.app.shell.playMode).toBe('local');
    expect(back.effects).toEqual([{ type: 'writePlayMode', mode: 'local' }]);
    expect(run(initialApp, { type: 'mode/set', mode: 'sandbox' }).app.shell.playMode).toBe(
      'online',
    );
    const western = run(initialApp, { type: 'variant/set', variant: 'backgammon' });
    expect(western.app.shell.opts.variant).toBe('backgammon');
    expect(western.effects).toEqual([{ type: 'writeVariant', variant: 'backgammon' }]);
    expect(run(initialApp, { type: 'variant/set', variant: 'plakoto' })).toEqual({
      app: initialApp,
      effects: [],
    });
    const seven = run(initialApp, { type: 'matchLength/set', length: '7' });
    expect(seven.app.shell.opts.matchLength).toBe(7);
    expect(seven.effects).toEqual([{ type: 'writeMatchLength', length: 7 }]);
    expect(run(initialApp, { type: 'matchLength/set', length: 4 })).toEqual({
      app: initialApp,
      effects: [],
    });
    expect(parseMatchLength(undefined, 3)).toBe(3);
    expect(parseMatchLength('1', 3)).toBe(1);
    expect(parseVariant('fevga', 'portes')).toBe('portes');
    expect(parseVariant(undefined, 'backgammon')).toBe('backgammon');
  });

  test('the Play tab`s long press opens the submenu; the click that follows does not switch tabs', () => {
    const pressed = run(initialApp, { type: 'submenu/press' });
    expect(pressed.effects).toEqual([
      {
        type: 'startTimer',
        id: 'longPress',
        ms: LONG_PRESS_MS,
        then: { type: 'submenu/longPress' },
      },
    ]);
    expect(run(pressed.app, { type: 'submenu/release' }).effects).toEqual([
      { type: 'cancelTimer', id: 'longPress' },
    ]);
    const held = run(pressed.app, { type: 'submenu/longPress' });
    expect(held.app.shell).toMatchObject({ longPressed: true, submenuOpen: true });
    expect(cues(held.effects)).toEqual(['tap']);
    const clicked = run(
      { ...held.app, shell: { ...held.app.shell, homeTab: 'rules' } },
      {
        type: 'tab/playClick',
      },
    );
    expect(clicked.app.shell).toMatchObject({ longPressed: false, homeTab: 'rules' });
    expect(clicked.effects).toEqual([]);
    const plain = run(clicked.app, { type: 'tab/playClick' });
    expect(plain.app.shell).toMatchObject({ homeTab: 'play', submenuOpen: false });
    const picked = run(held.app, { type: 'submenu/pick', mode: 'online' });
    expect(picked.app.shell).toMatchObject({
      playMode: 'online',
      submenuOpen: false,
      homeTab: 'play',
    });
    expect(kinds(picked.effects)).toEqual(['writePlayMode', 'writeHomeTab']);
    expect(run(held.app, { type: 'submenu/dismiss' }).app.shell.submenuOpen).toBe(false);
  });

  test('code/typed sanitises, keeps the last good code on a replacement; join/link fills the code and shows online', () => {
    const typed = run(initialApp, { type: 'code/typed', value: 'ab1c', inputType: 'insertText' });
    expect(typed.app.shell.codeDraft).toBe('ABC');
    expect(typed.effects).toEqual([{ type: 'setCode', value: 'ABC' }]);
    const swapped = run(typed.app, {
      type: 'code/typed',
      value: 'xyz',
      inputType: 'insertReplacementText',
    });
    expect(swapped.app.shell.codeDraft).toBe('ABC');
    const linked = run(initialApp, { type: 'join/link', code: 'wxyz' });
    expect(linked.app.shell).toMatchObject({
      playMode: 'online',
      codeDraft: 'WXYZ',
      homeTab: 'play',
    });
    expect(linked.effects).toEqual([{ type: 'setCode', value: 'WXYZ' }]);
  });

  test('sound/toggle, soundFont/set and share/click are effects', () => {
    expect(run(initialApp, { type: 'sound/toggle' }).effects).toEqual([{ type: 'toggleSound' }]);
    const font = run(initialApp, { type: 'soundFont/set', font: 'arcade' });
    expect(font.app.shell.soundFont).toBe('arcade');
    expect(font.effects).toEqual([{ type: 'writeSoundFont', font: 'arcade' }]);
    expect(run(initialApp, { type: 'share/click' }).effects).toEqual([]);
    const room = lobbyApp();
    expect(run(room, { type: 'share/click' }).effects).toEqual([
      { type: 'share', code: room.shell.code },
    ]);
    expect(run(initialApp, { type: 'screen/show', screen: 'endgameScreen' }).app.shell.screen).toBe(
      'endgameScreen',
    );
  });
});

describe('hosting', () => {
  test('host/click: the name, the options, a fresh 4-letter code, the wait screen, the startHost effect', () => {
    const { app, effects } = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'variant/set', variant: 'backgammon' },
      { type: 'host/click', name: '  ', matchLength: '7' },
    );
    expect(app.shell).toMatchObject({
      role: 'host',
      myName: 'Ari',
      opts: { matchLength: 7, variant: 'backgammon' },
      game: null,
      oppName: null,
      oppConnected: false,
      netAttempt: 1,
      screen: 'hostWaitScreen',
      hostStatus: { text: OPENING_MSG, pulse: true },
      startGameVisible: false,
    });
    expect(app.shell.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(effects.slice(-2)).toEqual([
      { type: 'scrollTop' },
      { type: 'startHost', code: app.shell.code, attempt: 1, resume: false },
    ]);
    const resumed = run(app, { type: 'host/start', code: 'ABCD' });
    expect(resumed.app.shell).toMatchObject({ code: 'ABCD', netAttempt: 2 });
    expect(resumed.effects.at(-1)).toEqual({
      type: 'startHost',
      code: 'ABCD',
      attempt: 2,
      resume: true,
    });
    const status = run(app, { type: 'host/status', text: 'Waiting…', stopPulse: true });
    expect(status.app.shell.hostStatus).toEqual({ text: 'Waiting…', pulse: false });
  });

  test('a join names the guest, shows the start button and answers with the lobby frame', () => {
    const before = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'host/click', name: 'Ann', matchLength: '3', variant: 'portes' },
    ).app;
    const { app, effects } = run(before, { type: 'host/frame', frame: { t: 'join', name: 'Ann' } });
    expect(app.shell).toMatchObject({
      oppConnected: true,
      oppName: 'Ann 2',
      startGameVisible: true,
      hostStatus: { text: joinedMsg('Ann 2'), pulse: true },
    });
    expect(effects).toEqual([
      { type: 'send', frame: lobby('Ann', { matchLength: 3, variant: 'portes' }) },
    ]);
  });

  test('host/deal needs a guest; then the match starts and the guest`s view goes on the wire', () => {
    const alone = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'host/click', name: 'Ann', matchLength: '3', variant: 'portes' },
      { type: 'host/deal' },
    );
    expect(alone.app.shell.game).toBeNull();
    expect(toasts(alone.effects)).toEqual([[WAITING_FOR_GUEST_MSG, null]]);
    const { app, effects } = run(lobbyApp(), { type: 'host/deal' });
    const g = game(app);
    expect(g.players.map((p) => p.name)).toEqual(['Ann', 'Jeff']);
    expect(g.options).toMatchObject({ matchLength: 3, rotation: ['portes'] });
    expect(g.phase).toBe('toRoll');
    expect(app.shell).toMatchObject({ view: viewFor(g, 0), screen: 'tableScreen' });
    expect(app.table).toMatchObject({ curtain: null, resultOpen: false });
    expect(effects).toEqual([
      { type: 'send', frame: stateFrame(viewFor(g, 1)) },
      { type: 'persist' },
      { type: 'scrollTop' },
    ]);
  });

  test('the guest`s actions are applied by the host and broadcast; a refusal is a toast frame', () => {
    const start = hosting();
    const g0 = game(start);
    const guestFirst = g0.turn === 1;
    // Whoever is not to move is refused with the engine's message, on the wire for the guest.
    const wrong = run(start, {
      type: 'host/frame',
      frame: { t: 'action', action: { type: 'roll' } },
    });
    const mine = run(start, { type: 'roll/click' });
    if (guestFirst) {
      // The guest's roll: broadcast, the roll cue, the tumble on the host's board too.
      expect(kinds(wrong.effects)).toEqual(['send', 'persist', 'fx', 'startTimer', 'scrollTop']);
      expect(wrong.app.table.rolling).toBe(true);
      expect(game(wrong.app).phase).toBe('moving');
      expect(sends(wrong.effects)).toEqual([stateFrame(viewFor(game(wrong.app), 1))]);
      // The host's own roll is dropped by the reducer (not my turn), not by the engine.
      expect(mine).toEqual({ app: start, effects: [] });
      const undo = run(wrong.app, {
        type: 'host/frame',
        frame: { t: 'action', action: { type: 'undo' } },
      });
      expect(undo.effects).toEqual([{ type: 'send', frame: toastFrame(MESSAGES.NOTHING_TO_UNDO) }]);
    } else {
      expect(wrong.effects).toEqual([{ type: 'send', frame: toastFrame(MESSAGES.NOT_YOUR_TURN) }]);
      expect(kinds(mine.effects)).toEqual(['send', 'persist', 'fx', 'scrollTop']);
      expect(cues(mine.effects)).toEqual(['roll']);
    }
  });

  test('a hosted match against a fake guest: frames in, one state frame out per applied action, to the end', () => {
    const guestTurn = (app: App): Intent | null => {
      const g = game(app);
      const v = viewFor(g, 1);
      if (v.phase === 'over' || actorOf(g) !== 1) return null;
      if (v.phase === 'toRoll')
        return { type: 'host/frame', frame: { t: 'action', action: { type: 'roll' } } };
      const [m] = v.legal;
      return m === undefined
        ? null
        : {
            type: 'host/frame',
            frame: { t: 'action', action: { type: 'move', from: m.from, to: m.to, die: m.die } },
          };
    };
    const drive = (s: Step, steps: number): Step => {
      const intent = guestTurn(s.app) ?? nextTap(s.app);
      if (intent === null || steps === 0) return s;
      const next = reduce(s.app, intent, ctx);
      // Every applied action broadcasts exactly the guest's view of the new state.
      const frames = sends(next.effects);
      if (frames.length > 0) expect(frames).toEqual([stateFrame(viewFor(game(next.app), 1))]);
      return drive({ app: next.app, effects: [...s.effects, ...next.effects] }, steps - 1);
    };
    const done = drive({ app: hosting(), effects: [] }, 2000);
    const g = game(done.app);
    expect(g.phase).toBe('over');
    expect(g.board.off.some((n) => n === 15)).toBe(true);
    expect(done.app.table.resultOpen).toBe(true);
    expect(done.app.shell.screen).toBe('tableScreen');
    expect(cues(done.effects)).toContain('roll');
    expect(cues(done.effects)).toContain('bearOff');
    // Next game: applied for the host and broadcast; the guest's `next` would race it (design §10 risk 9).
    const nextGame = run(done.app, { type: 'next/click' });
    expect(game(nextGame.app).gameNo).toBe(2);
    expect(kinds(nextGame.effects)).toContain('send');
  });

  test('a guest that rejoins keeps the seat under the new name; one that drops is toasted mid-game and awaited in the lobby', () => {
    const mid = hosting();
    const rejoined = run(mid, { type: 'host/frame', frame: { t: 'join', name: 'Jo' } });
    expect(game(rejoined.app).players[1].name).toBe('Jo');
    expect(rejoined.app.shell.oppName).toBe('Jo');
    expect(kinds(rejoined.effects)).toEqual(['send', 'persist', 'scrollTop']);
    const gone = run(mid, { type: 'host/guestGone', iceFailed: null });
    expect(gone.app.shell.oppConnected).toBe(false);
    expect(toasts(gone.effects)).toEqual([[guestGoneMsg('Jeff', mid.shell.code), GONE_TOAST_MS]]);
    const lobbyGone = run(lobbyApp(), { type: 'host/guestGone', iceFailed: null });
    expect(lobbyGone.app.shell).toMatchObject({
      startGameVisible: false,
      hostStatus: { text: OPPONENT_LEFT_MSG, pulse: true },
    });
    const iced = run(lobbyApp(), { type: 'host/guestGone', iceFailed: 'ICE failed' });
    expect(iced.app.shell.hostStatus.text).toBe('ICE failed');
  });
});

describe('joining', () => {
  test('join/click validates the code and picks the guest name; the wait screen and the startGuest effect follow', () => {
    const bad = run(initialApp, { type: 'join/click', name: 'Bo', code: 'AB' });
    expect(bad.app).toBe(initialApp);
    expect(toasts(bad.effects)).toEqual([['Enter the 4-letter room code.', null]]);
    const { app, effects } = run(initialApp, { type: 'join/click', name: '', code: 'abcd' });
    expect(app.shell).toMatchObject({
      role: 'guest',
      myName: 'Jeff',
      code: 'ABCD',
      netAttempt: 1,
      screen: 'guestWaitScreen',
      guestStatus: { text: connectingMsg('ABCD'), pulse: true },
    });
    expect(effects.at(-1)).toEqual({ type: 'startGuest', code: 'ABCD', attempt: 1 });
    // The untouched default host name is not a guest name; a touched one is.
    expect(
      run(initialApp, { type: 'join/click', name: 'Ari', code: 'ABCD' }).app.shell.myName,
    ).toBe('Jeff');
    const touched = run(initialApp, { type: 'name/typed', value: 'Ari' }).app;
    expect(run(touched, { type: 'join/click', name: 'Ari', code: 'ABCD' }).app.shell.myName).toBe(
      'Ari',
    );
    const again = run(app, { type: 'guest/start', code: 'WXYZ' });
    expect(again.effects.at(-1)).toEqual({ type: 'startGuest', code: 'WXYZ', attempt: 2 });
    const status = run(app, { type: 'guest/status', text: 'Found', stopPulse: false });
    expect(status.app.shell.guestStatus).toEqual({ text: 'Found', pulse: true });
  });

  const guest = (): App => run(initialApp, { type: 'join/click', name: 'Bo', code: 'ABCD' }).app;

  test('the host`s frames: welcome and lobby name the room, full and toast are shown, a state frame is the view', () => {
    const welcomed = run(guest(), {
      type: 'guest/frame',
      frame: { t: 'welcome', hostName: 'Ann', matchLength: 7, variant: 'backgammon' },
    });
    expect(welcomed.app.shell).toMatchObject({
      oppName: 'Ann',
      opts: { matchLength: 7, variant: 'backgammon' },
      guestStatus: { text: hostRoomMsg('Ann'), pulse: true },
    });
    expect(
      run(guest(), { type: 'guest/frame', frame: { t: 'full' } }).app.shell.guestStatus.text,
    ).toBe(ROOM_FULL_MSG);
    const refused = run(guest(), { type: 'guest/frame', frame: { t: 'toast', msg: 'No.' } });
    expect(toasts(refused.effects)).toEqual([['No.', null]]);
    const g = game(hosting());
    const connected = run(welcomed.app, { type: 'guest/connected' });
    expect(connected.app.shell.oppConnected).toBe(true);
    const { app, effects } = run(connected.app, {
      type: 'guest/frame',
      frame: { t: 'state', view: viewFor(g, 1) },
    });
    expect(app.shell).toMatchObject({
      view: viewFor(g, 1),
      screen: 'tableScreen',
      oppConnected: true,
    });
    expect(effects).toEqual([{ type: 'scrollTop' }]);
    // The same frame again plays nothing new; a fresh roll by the host cues the guest.
    expect(
      run(app, { type: 'guest/frame', frame: { t: 'state', view: viewFor(g, 1) } }).effects,
    ).toEqual([{ type: 'scrollTop' }]);
    const rolled = applyAction(g, g.turn, { type: 'roll' }, scripted(3, 1), () => NOW);
    if (!rolled.ok) throw new Error(rolled.error);
    const seen = run(app, {
      type: 'guest/frame',
      frame: { t: 'state', view: viewFor(rolled.value, 1) },
    });
    expect(cues(seen.effects)).toEqual(g.turn === 1 ? ['roll'] : ['roll']);
    expect(seen.app.table.lastPainted).toEqual(viewFor(g, 1));
  });

  test('the guest`s taps are action frames while connected; otherwise a toast', () => {
    const g = game(hosting());
    const seated = run(
      guest(),
      { type: 'guest/connected' },
      { type: 'guest/frame', frame: { t: 'state', view: viewFor(g, 1) } },
    ).app;
    const roll = run(seated, { type: 'roll/click' });
    if (g.turn === 1) {
      expect(roll.effects).toEqual([
        { type: 'send', frame: { t: 'action', action: { type: 'roll' } } },
      ]);
    } else {
      expect(roll.effects).toEqual([]);
    }
    const act = run(seated, { type: 'act', action: { type: 'roll' } });
    expect(sends(act.effects)).toEqual([{ t: 'action', action: { type: 'roll' } }]);
    const alone = run(guest(), { type: 'act', action: { type: 'roll' } });
    expect(toasts(alone.effects)).toEqual([[NOT_CONNECTED_MSG, null]]);
    expect(run(initialApp, { type: 'act', action: { type: 'roll' } }).effects).toEqual([
      { type: 'toast', message: NOT_CONNECTED_MSG, ms: null },
    ]);
  });

  test('guest/lost mid-match toasts and keeps the table; in the lobby it goes back to the wait screen', () => {
    const g = game(hosting());
    const seated = run(
      guest(),
      { type: 'guest/connected' },
      { type: 'guest/frame', frame: { t: 'state', view: viewFor(g, 1) } },
    ).app;
    const lost = run(seated, { type: 'guest/lost' });
    expect(lost.app.shell).toMatchObject({ oppConnected: false, screen: 'tableScreen' });
    expect(toasts(lost.effects)).toEqual([[LOST_HOST_MSG, GONE_TOAST_MS]]);
    // The match over: the result stays up, the session closes and the save goes (nothing to rejoin).
    const over = { ...viewFor(g, 1), phase: 'over' as const, matchOver: true };
    const done = run(seated, { type: 'guest/frame', frame: { t: 'state', view: over } }).app;
    const gone = run(done, { type: 'guest/lost' });
    expect(gone.app.shell).toMatchObject({ oppConnected: false, screen: 'endgameScreen' });
    expect(kinds(gone.effects)).toEqual(expect.arrayContaining(['closeNet', 'clearSave']));
    expect(toasts(gone.effects)).toEqual([[hostLeftMsg('Ann'), GONE_TOAST_MS]]);
    const early = run(run(guest(), { type: 'guest/connected' }).app, { type: 'guest/lost' });
    expect(early.app.shell).toMatchObject({
      screen: 'guestWaitScreen',
      guestStatus: { text: DISCONNECTED_MSG, pulse: true },
    });
  });
});

describe('pass and play', () => {
  test('local/click: names with defaults and the " 2" suffix, the options, the wake lock, the curtain for the starter', () => {
    const { app, effects } = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'local/click', p1: ' ann ', p2: 'ANN', matchLength: '3', variant: 'backgammon' },
    );
    const g = game(app);
    expect(g.players.map((p) => p.name)).toEqual(['ann', 'ANN 2']);
    expect(g.options).toMatchObject({ matchLength: 3, rotation: ['backgammon'] });
    expect(g.variant).toBe('backgammon');
    // Western: the opening winner plays the opening pair, so the game starts moving.
    expect(g.phase).toBe('moving');
    expect(app.shell).toMatchObject({
      role: 'local',
      code: null,
      oppConnected: true,
      revealed: null,
      opts: { matchLength: 3, variant: 'backgammon' },
      screen: 'tableScreen',
      view: viewFor(g, g.turn),
    });
    expect(app.table).toMatchObject({ curtain: g.turn, selected: null, resultOpen: false });
    // The home read fills the seats with their defaults (nothing saved) before the start.
    // Initial: no "your turn" chime with the first curtain.
    expect(kinds(effects)).toEqual([
      'scrollTop',
      'fillName',
      'fillP2Name',
      'wakeLock',
      'persist',
      'scrollTop',
    ]);
    expect(effects[3]).toEqual({ type: 'wakeLock', hold: true });
    // Empty seats start as this game's own pair (the owner's "Ari and Ethan"), not the shell's.
    const defaults = run(initialApp, { type: 'local/click', p1: '', p2: '' }).app;
    expect(game(defaults).players.map((p) => p.name)).toEqual(['Ari', 'Ethan']);
    expect(game(defaults).options.matchLength).toBe(5);
    expect(game(defaults).phase).toBe('toRoll');
  });

  test('the curtain reveal shows the mover; a finished turn hands the phone over and chimes', () => {
    const start = local();
    const g = game(start);
    const lifted = run(start, { type: 'curtain/reveal' });
    expect(lifted.app.shell.revealed).toBe(g.turn);
    expect(lifted.app.table.curtain).toBeNull();
    expect(kinds(lifted.effects)).toEqual(['fx', 'persist', 'scrollTop']);
    // Roll, then play the whole turn through taps: the turn flips and the curtain names the other seat.
    const rolled = run(lifted.app, { type: 'roll/click' });
    expect(game(rolled.app).phase).toBe('moving');
    expect(cues(rolled.effects)).toEqual(['roll']);
    const turn = playTurn(rolled);
    const after = game(turn.app);
    expect(after.phase).toBe('toRoll');
    expect(after.turn).not.toBe(g.turn);
    expect(turn.app.table.curtain).toBe(after.turn);
    expect(turn.app.shell.view).toEqual(viewFor(after, after.turn));
    expect(cues(turn.effects)).toContain('yourTurn');
    expect(cues(turn.effects)).toContain('place');
    // Under the curtain nothing on the board answers a tap, and the roll button is inert.
    expect(run(turn.app, { type: 'roll/click' })).toEqual({ app: turn.app, effects: [] });
    expect(run(turn.app, { type: 'point/tap', point: 5 })).toEqual({ app: turn.app, effects: [] });
    // Reveal with no game is a no-op.
    expect(run(initialApp, { type: 'curtain/reveal' })).toEqual({ app: initialApp, effects: [] });
  });

  test('a whole 1-point match through taps with a seeded rng: the result sheet, the end screen, the rematch', () => {
    const done = playOut({ app: local('1'), effects: [] }, 4000);
    const g = game(done.app);
    expect(g.phase).toBe('over');
    expect(g.result).not.toBeNull();
    expect(g.board.off.filter((n) => n === 15)).toHaveLength(1);
    expect(g.games).toHaveLength(1);
    // A 1-point match is over with the game: the end screen, the result sheet open, no curtain.
    expect(view(done.app).matchOver).toBe(true);
    expect(done.app.shell.screen).toBe('endgameScreen');
    expect(done.app.table).toMatchObject({ curtain: null, resultOpen: true, selected: null });
    expect(cues(done.effects)).toContain('win');
    expect(cues(done.effects).filter((c) => c === 'roll').length).toBeGreaterThan(10);
    // No refusal was ever toasted (the policy only taps what the board offers); hits were.
    const messages = done.effects.flatMap((e) => (e.type === 'toast' ? [e.message] : []));
    expect(messages.every((m) => m.startsWith('Kapará'))).toBe(true);
    // Rematch: a new match, same players and options, score 0-0, curtain for the starter.
    const again = run(done.app, { type: 'next/click' });
    const fresh = game(again.app);
    expect(fresh).toMatchObject({ gameNo: 1, match: { score: [0, 0], length: 1 } });
    expect(fresh.players).toEqual(g.players);
    expect(again.app.shell.screen).toBe('tableScreen');
    expect(again.app.table.curtain).toBe(fresh.turn);
  });

  test('a longer match: game over opens the sheet on the table screen; Next game starts game 2 with the score carried', () => {
    const done = playOut({ app: local('5'), effects: [] }, 4000);
    const g = game(done.app);
    expect(g.phase).toBe('over');
    expect(view(done.app).matchOver).toBe(false);
    expect(done.app.shell.screen).toBe('tableScreen');
    expect(done.app.table.resultOpen).toBe(true);
    const peeked = run(done.app, { type: 'result/peek' });
    expect(peeked.app.table.resultOpen).toBe(false);
    expect(run(peeked.app, { type: 'result/open' }).app.table.resultOpen).toBe(true);
    const next = run(peeked.app, { type: 'next/click' });
    const g2 = game(next.app);
    expect(g2.gameNo).toBe(2);
    expect(g2.match.score).toEqual(g.match.score);
    expect(next.app.table).toMatchObject({ resultOpen: false, curtain: g2.turn });
    expect(kinds(next.effects)).toContain('persist');
  });

  test('a refused action is toasted and changes nothing but the taps', () => {
    const start = revealed(local());
    const before = start.shell.game;
    const refused = run(start, { type: 'act', action: { type: 'undo' } });
    expect(refused.app.shell.game).toBe(before);
    expect(toasts(refused.effects)).toEqual([[MESSAGES.NOTHING_TO_UNDO, null]]);
  });
});

// Positions in the engine's notation, each side in its own numbering (the engine's notation, moves.test.ts).
/** Light to play 6-3 from 13: two orders reach 4, one hitting the blot on 7 (design §4.3). */
const TWO_ORDERS = 'L: 24:2 13:5 8:3 6:5 | D: 18:1 2:14 | bar 0/0 | off 0/0';
/** Light bears off: both dice take the 4 (design §4.4 "6·5"). */
const BOTH_SUFFICE = 'L: 4:1 2:1 | D: 24:2 1:13 | bar 0/0 | off 13/0';
/** Light on the bar against a closed board: any roll forfeits (R14). */
const SHUT_OUT = 'L: 13:14 | D: 1:2 2:2 3:2 4:2 5:2 6:2 7:3 | bar 1/0 | off 0/0';

describe('the table', () => {
  test('position/load replaces the pass-and-play position, curtain down for the actor; refused elsewhere and for junk', () => {
    const start = local();
    const { app, effects } = run(start, {
      type: 'position/load',
      state: withPosition(game(start), pos(TWO_ORDERS), 0, [6, 3]),
    });
    expect(game(app).board).toEqual(pos(TWO_ORDERS));
    expect(game(app)).toMatchObject({ turn: 0, phase: 'moving', dice: [6, 3] });
    expect(app.shell).toMatchObject({ revealed: 0, view: viewFor(game(app), 0) });
    expect(app.table.curtain).toBeNull();
    expect(kinds(effects)).toEqual(['persist', 'scrollTop']);
    const junk = run(start, { type: 'position/load', state: { nope: true } });
    expect(junk.app).toBe(start);
    expect(toasts(junk.effects)).toEqual([[badPositionMsg('$.players: expected array'), null]]);
    const online = run(hosting(), { type: 'position/load', state: game(start) });
    expect(toasts(online.effects)).toEqual([[SANDBOX_LOCAL_ONLY_MSG, null]]);
    expect(toasts(run(initialApp, { type: 'position/load', state: game(start) }).effects)).toEqual([
      [SANDBOX_LOCAL_ONLY_MSG, null],
    ]);
  });

  test('point/tap: a source selects, again deselects, another source re-selects, a stray point shakes', () => {
    const app = at(TWO_ORDERS, 0, [6, 3]);
    const v = view(app);
    expect(sourcesOf(v)).toEqual([5, 7, 12, 23]);
    const picked = run(app, { type: 'point/tap', point: 12 });
    expect(picked.app.table.selected).toBe(12);
    expect(picked.effects).toEqual([{ type: 'fx', cue: 'tap' }]);
    expect(run(picked.app, { type: 'point/tap', point: 12 }).app.table.selected).toBeNull();
    expect(run(picked.app, { type: 'point/tap', point: 7 }).app.table.selected).toBe(7);
    // The felt: a tap on the board's own surface lets the source go too (design §4.2 rule 2b).
    const felt = run(picked.app, { type: 'board/tap' });
    expect(felt.app.table).toMatchObject({ selected: null, pending: null });
    expect(felt.effects).toEqual([]);
    expect(run(felt.app, { type: 'board/tap' })).toEqual({ app: felt.app, effects: [] });
    // Deselected, the targets are gone: the board paints from the same helpers the reducer taps with.
    expect(targetsOf(v, effectiveSelection(felt.app.table.selected, v), null)).toEqual([]);
    const stray = run(app, { type: 'point/tap', point: 10 });
    expect(stray.app.table.shake).toBe(10);
    expect(stray.effects).toEqual([
      { type: 'startTimer', id: 'shake', ms: SHAKE_MS, then: { type: 'shake/elapsed' } },
    ]);
    expect(run(stray.app, { type: 'shake/elapsed' }).app.table.shake).toBeNull();
  });

  test('a single-step target commits one move; the selection clears and the die is spent', () => {
    const app = run(at(TWO_ORDERS, 0, [6, 3]), { type: 'point/tap', point: 12 }).app;
    // Own 13 (abs 12) with the 3 lands on own 10 (abs 9).
    const moved = run(app, { type: 'point/tap', point: 9 });
    const g = game(moved.app);
    expect(g.played).toEqual([{ from: 12, to: 9, die: 3, hit: false }]);
    expect(g.phase).toBe('moving');
    expect(view(moved.app).movesLeft).toEqual([6]);
    expect(moved.app.table).toMatchObject({ selected: null, picked: null, pending: null });
    expect(cues(moved.effects)).toEqual(['place']);
    expect(kinds(moved.effects)).toEqual(['persist', 'fx', 'scrollTop']);
    // The hit lands the blot on the bar and cues `hit`.
    const hit = run(app, { type: 'point/tap', point: 6 });
    expect(game(hit.app).played).toEqual([{ from: 12, to: 6, die: 6, hit: true }]);
    expect(game(hit.app).board.bar).toEqual([0, 1]);
    expect(cues(hit.effects)).toEqual(['hit']);
  });

  test('a two-order target whose orders differ in a hit opens the die-chip tray; a chip commits both moves in order', () => {
    const app = run(at(TWO_ORDERS, 0, [6, 3]), { type: 'point/tap', point: 12 }).app;
    const opened = run(app, { type: 'point/tap', point: 3 });
    const pending = opened.app.table.pending;
    if (pending === null) throw new Error('no tray');
    expect(pending).toMatchObject({ from: 12, to: 3 });
    expect(pending.chains.map((c) => c.moves.map((m) => m.die))).toEqual([
      [6, 3],
      [3, 6],
    ]);
    expect(pending.chains.map((c) => c.hits)).toEqual([[6], []]);
    expect(pending.chains.map((c) => c.via)).toEqual([[6], [9]]);
    expect(opened.effects).toEqual([{ type: 'fx', cue: 'tap' }]);
    expect(game(opened.app).played).toEqual([]);
    // The quiet order: both moves, the turn ends, the curtain names Dark.
    const chosen = run(opened.app, { type: 'chip/tap', index: 1 });
    const g = game(chosen.app);
    expect(g.lastPlay).toEqual([
      { from: 12, to: 9, die: 3, hit: false },
      { from: 9, to: 3, die: 6, hit: false },
    ]);
    expect(g).toMatchObject({ turn: 1, phase: 'toRoll' });
    expect(chosen.app.table).toMatchObject({ pending: null, selected: null, curtain: 1 });
    expect(cues(chosen.effects)).toEqual(['yourTurn', 'place', 'place']);
    // The hitting order: the curtain rises for Bob with no toast yet (Ann still holds the phone);
    // Bob's reveal toasts him the hit in his own numbering (Ann's 7 is his 18).
    const hit = run(opened.app, { type: 'chip/tap', index: 0 });
    expect(game(hit.app).lastPlay.map((m) => m.hit)).toEqual([true, false]);
    expect(toasts(hit.effects)).toEqual([]);
    expect(cues(hit.effects)).toEqual(['yourTurn', 'hit', 'place']);
    expect(toasts(run(hit.app, { type: 'curtain/reveal' }).effects)).toEqual([
      [hitMsg('Ann', [18]), null],
    ]);
    // Cancel, a board tap, and a missing chip.
    expect(run(opened.app, { type: 'chip/cancel' }).app.table.pending).toBeNull();
    expect(run(opened.app, { type: 'board/tap' }).app.table).toMatchObject({
      pending: null,
      selected: null,
    });
    expect(run(opened.app, { type: 'point/tap', point: 12 }).app.table.pending).toBeNull();
    expect(run(opened.app, { type: 'chip/tap', index: 5 })).toEqual({
      app: opened.app,
      effects: [],
    });
  });
});

describe('the hit toast in pass-and-play', () => {
  /** A Dark blot on Light's 5-point (Dark's 20); Light rolls 3-1 and hits with the 3 from the 8. */
  const BLOT_ON_5 = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:4 20:1 | bar 0/0 | off 0/0';
  /** Light hits 8/5* with the 3, then covers 6/5 with the 1: the turn flips to Dark. */
  const hitTurn = (start: App): Step => {
    const first = run(start, { type: 'point/tap', point: 7 }, { type: 'point/tap', point: 4 });
    expect(game(first.app).played).toEqual([{ from: 7, to: 4, die: 3, hit: true }]);
    const second = run(first.app, { type: 'point/tap', point: 5 }, { type: 'point/tap', point: 4 });
    expect(game(second.app)).toMatchObject({ turn: 1, phase: 'toRoll' });
    return second;
  };

  test('a hit on the first of two taps: nothing at the flip, the toast on the reveal, once', () => {
    const flipped = hitTurn(at(BLOT_ON_5, 0, [3, 1]));
    expect(flipped.app.table.curtain).toBe(1);
    expect(toasts(flipped.effects)).toEqual([]);
    const lifted = run(flipped.app, { type: 'curtain/reveal' });
    expect(toasts(lifted.effects)).toEqual([[hitMsg('Ann', [20]), null]]);
    expect(lifted.app.table.curtain).toBeNull();
    // Bob rolls and plays on: no second toast, and none for Ann when the phone comes back.
    const rolled = run(lifted.app, { type: 'roll/click' });
    expect(toasts(rolled.effects)).toEqual([]);
    const back = playTurn(rolled);
    expect(toasts(back.effects)).toEqual([]);
    if (back.app.table.curtain !== null)
      expect(toasts(run(back.app, { type: 'curtain/reveal' }).effects)).toEqual([]);
  });

  test('with the curtain off the toast comes at the flip; turning it off while it is up is a reveal', () => {
    const off = run(at(BLOT_ON_5, 0, [3, 1]), { type: 'curtain/mode', mode: 'never' }).app;
    const flipped = hitTurn(off);
    expect(flipped.app.table.curtain).toBeNull();
    expect(toasts(flipped.effects)).toEqual([[hitMsg('Ann', [20]), null]]);
    const up = hitTurn(at(BLOT_ON_5, 0, [3, 1]));
    const dropped = run(up.app, { type: 'curtain/mode', mode: 'never' });
    expect(dropped.app.table.curtain).toBeNull();
    expect(toasts(dropped.effects)).toEqual([[hitMsg('Ann', [20]), null]]);
    // Turning it off with nothing behind it toasts nothing.
    expect(
      toasts(run(at(BLOT_ON_5, 0, [3, 1]), { type: 'curtain/mode', mode: 'never' }).effects),
    ).toEqual([]);
  });

  test('hitMsg: one point, or several in one breath', () => {
    expect(hitMsg('Ann', [20])).toBe('Kapará. Ann hit you on your 20-point.');
    expect(hitMsg('Ann', [20, 5])).toBe('Kapará. Ann hit you on your 20-point and your 5-point.');
    expect(hitMsg('Ann', [22, 20, 5])).toBe(
      'Kapará. Ann hit you on your 22-point, your 20-point and your 5-point.',
    );
  });
});

describe('the dice, the bar, the tray and a drag', () => {
  test('bear-off with either die opens two chips; the chosen die is the one spent (design §4.4)', () => {
    const app = at(BOTH_SUFFICE, 0, [6, 5]);
    const v = view(app);
    // The sole source is derived: nothing is stored, the tray tap acts on it.
    expect(sourcesOf(v)).toEqual([3]);
    expect(app.table.selected).toBeNull();
    const opened = run(app, { type: 'off/tap' });
    const pending = opened.app.table.pending;
    if (pending === null) throw new Error('no tray');
    expect(pending).toMatchObject({ from: 3, to: 'off' });
    expect(pending.chains.map((c) => c.moves)).toEqual([
      [{ from: 3, to: 'off', die: 6 }],
      [{ from: 3, to: 'off', die: 5 }],
    ]);
    const five = run(opened.app, { type: 'chip/tap', index: 1 });
    const g = game(five.app);
    expect(g.played).toEqual([{ from: 3, to: 'off', die: 5, hit: false }]);
    expect(view(five.app).movesLeft).toEqual([6]);
    expect(cues(five.effects)).toEqual(['bearOff']);
    // The 6 then bears off the 2 by itself: one tap, the game ends 15 off, the sheet opens.
    const last = run(five.app, { type: 'off/tap' });
    expect(game(last.app)).toMatchObject({ phase: 'over', board: { off: [15, 0] } });
    expect(last.app.table.resultOpen).toBe(true);
    expect(cues(last.effects)).toEqual(['bearOff', 'win']);
    // Cancel returns the row; a stray tap on the board also closes the tray.
    expect(run(opened.app, { type: 'chip/cancel' }).app.table.pending).toBeNull();
    expect(run(opened.app, { type: 'off/tap' }).app.table.pending).toBeNull();
  });

  test('die/pick forces a die in hand, again releases it; a die not in hand or dead is ignored; a commit clears it', () => {
    const app = run(at(TWO_ORDERS, 0, [6, 3]), { type: 'point/tap', point: 12 }).app;
    const forced = run(app, { type: 'die/pick', die: 3 });
    expect(forced.app.table.picked).toBe(3);
    expect(forced.effects).toEqual([{ type: 'fx', cue: 'tap' }]);
    // With the 3 forced, own 4 is no longer a target: the tap on it shakes instead of opening the tray.
    const shaken = run(forced.app, { type: 'point/tap', point: 3 });
    expect(shaken.app.table.pending).toBeNull();
    expect(shaken.app.table.shake).toBe(3);
    expect(run(forced.app, { type: 'die/pick', die: 3 }).app.table.picked).toBeNull();
    expect(run(forced.app, { type: 'die/pick', die: 4 })).toEqual({ app: forced.app, effects: [] });
    const moved = run(forced.app, { type: 'point/tap', point: 9 });
    expect(moved.app.table.picked).toBeNull();
    // Dice are not pickable before the roll or on the other seat's turn.
    const fresh = local();
    expect(run(fresh, { type: 'die/pick', die: 3 })).toEqual({ app: fresh, effects: [] });
  });

  test('a checker on the bar is the derived source; bar/tap selects it; entry points are its targets', () => {
    const app = at('L: 13:14 | D: 1:2 2:2 3:2 7:9 | bar 1/0 | off 0/0', 0, [4, 2]);
    const v = view(app);
    expect(sourcesOf(v)).toEqual(['bar']);
    expect(effectiveSelection(app.table.selected, v)).toBe('bar');
    const tapped = run(app, { type: 'bar/tap' });
    expect(tapped.app.table.selected).toBe('bar');
    // Entry with the 4 lands on own 21 (abs 20); with the 2 on own 23 (abs 22).
    const entered = run(app, { type: 'point/tap', point: 20 });
    expect(game(entered.app).played).toEqual([{ from: 'bar', to: 20, die: 4, hit: false }]);
    expect(game(entered.app).board.bar).toEqual([0, 0]);
    // No checker on the bar: the tap does nothing.
    expect(run(at(TWO_ORDERS, 0, [6, 3]), { type: 'bar/tap' }).app.table.selected).toBeNull();
  });

  test('undo/click rewinds the turn while a die is left; done/click is inert; roll/click is dropped while moving', () => {
    const app = run(
      at(TWO_ORDERS, 0, [6, 3]),
      { type: 'point/tap', point: 12 },
      { type: 'point/tap', point: 9 },
    ).app;
    expect(view(app).canUndo).toBe(true);
    const undone = run(app, { type: 'undo/click' });
    expect(game(undone.app).played).toEqual([]);
    expect(game(undone.app).board).toEqual(pos(TWO_ORDERS));
    expect(kinds(undone.effects)).toEqual(['persist', 'scrollTop']);
    expect(run(undone.app, { type: 'undo/click' })).toEqual({ app: undone.app, effects: [] });
    expect(run(app, { type: 'done/click' })).toEqual({ app, effects: [] });
    expect(run(app, { type: 'roll/click' })).toEqual({ app, effects: [] });
    expect(run(app, { type: 'double/click' })).toEqual({ app, effects: [] });
    expect(run(app, { type: 'take/click' })).toEqual({ app, effects: [] });
    expect(run(app, { type: 'pass/click' })).toEqual({ app, effects: [] });
    expect(run(app, { type: 'next/click' })).toEqual({ app, effects: [] });
  });

  test('a drag lights the source, follows only real targets, and drops on the default chain; released elsewhere it clears', () => {
    const app = at(TWO_ORDERS, 0, [6, 3]);
    const started = run(app, { type: 'checker/dragStart', from: 12 });
    expect(started.app.table).toMatchObject({ drag: { from: 12, over: null }, selected: 12 });
    expect(run(app, { type: 'checker/dragStart', from: 10 })).toEqual({ app, effects: [] });
    const over = run(started.app, { type: 'checker/dragOver', over: 9 });
    expect(over.app.table.drag).toEqual({ from: 12, over: 9 });
    expect(run(over.app, { type: 'checker/dragOver', over: 10 }).app.table.drag).toEqual({
      from: 12,
      over: null,
    });
    // A click during the drag selects nothing.
    expect(run(over.app, { type: 'point/tap', point: 7 })).toEqual({ app: over.app, effects: [] });
    const dropped = run(over.app, { type: 'checker/dragEnd' });
    expect(game(dropped.app).played).toEqual([{ from: 12, to: 9, die: 3, hit: false }]);
    expect(dropped.app.table.drag).toBeNull();
    const missed = run(started.app, { type: 'checker/dragEnd' });
    expect(missed.app.table).toMatchObject({ drag: null, selected: null });
    expect(game(missed.app).played).toEqual([]);
    // The two-order destination drops on the first chip (the higher first die: the hitting order).
    const combined = run(
      started.app,
      { type: 'checker/dragOver', over: 3 },
      { type: 'checker/dragEnd' },
    );
    expect(game(combined.app).lastPlay.map((m) => m.die)).toEqual([6, 3]);
    // The tray drop spends the exact die when one matches, else the largest (`moveTo`).
    const tray = run(
      at(BOTH_SUFFICE, 0, [6, 5]),
      { type: 'checker/dragStart', from: 3 },
      { type: 'checker/dragOver', over: 'off' },
      { type: 'checker/dragEnd' },
    );
    expect(game(tray.app).played).toEqual([{ from: 3, to: 'off', die: 6, hit: false }]);
    expect(run(app, { type: 'checker/dragEnd' })).toEqual({ app, effects: [] });
  });

  test('the overlays toggle; the curtain setting persists and drops a raised curtain', () => {
    const app = local();
    expect(run(app, { type: 'menu/toggle' }).app.table.menuOpen).toBe(true);
    expect(run(app, { type: 'history/toggle' }).app.table.historyOpen).toBe(true);
    expect(run(app, { type: 'rules/toggle' }).app.shell.rulesOpen).toBe(true);
    expect(app.table.curtain).not.toBeNull();
    const never = run(app, { type: 'curtain/mode', mode: 'never' });
    expect(never.app.table).toMatchObject({ curtainMode: 'never', curtain: null });
    expect(never.effects).toEqual([{ type: 'writeCurtainMode', mode: 'never' }]);
    // With the curtain off, a finished turn just shows the next mover.
    const rolled = run(never.app, { type: 'roll/click' });
    const turn = playOut(rolled, 8);
    expect(turn.app.table.curtain).toBeNull();
    expect(cues(turn.effects)).not.toContain('yourTurn');
    expect(run(never.app, { type: 'curtain/mode', mode: 'always' }).app.table.curtainMode).toBe(
      'always',
    );
  });
});

describe('the roll modal and the tumble (design §4.7)', () => {
  const START = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';
  const tumble = {
    type: 'startTimer',
    id: 'tumble',
    ms: TUMBLE_MS,
    then: { type: 'tumble/elapsed' },
  };

  test('pass-and-play: the modal is up for the revealed seat to roll, not under the curtain; the click tumbles, holds every tap, then settles', () => {
    const covered = local();
    expect(game(covered).phase).toBe('toRoll');
    expect(rollModalOpen(covered)).toBe(false);
    const open = revealed(covered);
    expect(rollModalOpen(open)).toBe(true);
    expect(open.table.rolling).toBe(false);
    // The click: the engine rolls at once; the tumble timer is armed at the click and again as the
    // roll arrives; the modal stays through the tumble.
    const rolled = run(open, { type: 'roll/click' });
    expect(game(rolled.app).phase).toBe('moving');
    expect(rolled.app.table.rolling).toBe(true);
    expect(rollModalOpen(rolled.app)).toBe(true);
    expect(rolled.effects).toEqual([
      tumble,
      { type: 'persist' },
      { type: 'fx', cue: 'roll' },
      tumble,
      { type: 'scrollTop' },
    ]);
    // Nothing answers while the dice tumble: a tap on a source, a second roll, an undo.
    const [source] = sourcesOf(view(rolled.app));
    if (source === undefined || source === 'bar') throw new Error('no point source');
    expect(run(rolled.app, { type: 'point/tap', point: source })).toEqual({
      app: rolled.app,
      effects: [],
    });
    expect(run(rolled.app, { type: 'roll/click' })).toEqual({ app: rolled.app, effects: [] });
    expect(run(rolled.app, { type: 'undo/click' })).toEqual({ app: rolled.app, effects: [] });
    // The timer: the dice settle, the modal goes, the board answers.
    const settledDice = run(rolled.app, { type: 'tumble/elapsed' });
    expect(settledDice.app.table.rolling).toBe(false);
    expect(settledDice.effects).toEqual([]);
    expect(rollModalOpen(settledDice.app)).toBe(false);
    expect(run(settledDice.app, { type: 'point/tap', point: source }).app.table.selected).toBe(
      source,
    );
    // A stray timer changes nothing.
    expect(run(settledDice.app, { type: 'tumble/elapsed' })).toEqual({
      app: settledDice.app,
      effects: [],
    });
    // A double (a constant rng throws 4-4) earns its cue as the dice settle, after the roll's,
    // never before; a plain roll earns none.
    const doubled = reduce(open, { type: 'roll/click' }, { rng: () => 0.5, now: () => NOW });
    expect(game(doubled.app).dice).toEqual([4, 4]);
    expect(cues(doubled.effects)).toEqual(['roll']);
    expect(cues(reduce(doubled.app, { type: 'tumble/elapsed' }, ctx).effects)).toEqual(['doubles']);
    expect(game(rolled.app).dice?.[0]).not.toBe(game(rolled.app).dice?.[1]);
    expect(cues(settledDice.effects)).toEqual([]);
    // Once the match is over there is no roll to ask for.
    const done = playOut({ app: local('1'), effects: [] }, 4000).app;
    expect(view(done).matchOver).toBe(true);
    expect(rollModalOpen(done)).toBe(false);
  });

  test('the guest: the click sends the roll and holds the modal; the host`s frame brings the faces and restarts the tumble; a refusal drops it; the host`s own roll tumbles without the modal', () => {
    const seated = withPosition(game(local()), pos(START), 1, null);
    const welcome = { t: 'welcome', hostName: 'Ann', matchLength: 5, variant: 'portes' } as const;
    const guest = run(
      initialApp,
      { type: 'join/click', name: 'Bo', code: 'ABCD' },
      { type: 'guest/frame', frame: welcome },
      { type: 'guest/connected' },
      { type: 'guest/frame', frame: stateFrame(viewFor(seated, 1)) },
    ).app;
    expect(guest.shell.view?.isMyTurn).toBe(true);
    expect(rollModalOpen(guest)).toBe(true);
    const asked = run(guest, { type: 'roll/click' });
    expect(asked.app.table.rolling).toBe(true);
    expect(rollModalOpen(asked.app)).toBe(true);
    expect(asked.effects).toEqual([tumble, { type: 'send', frame: actionFrame({ type: 'roll' }) }]);
    // The host rolled: the frame's fresh roll cues and restarts the tumble; the modal stays.
    const rolledState = applyAction(seated, 1, { type: 'roll' }, ctx.rng, ctx.now);
    if (!rolledState.ok) throw new Error(rolledState.error);
    const arrived = run(asked.app, {
      type: 'guest/frame',
      frame: stateFrame(viewFor(rolledState.value, 1)),
    });
    expect(arrived.app.table.rolling).toBe(true);
    expect(rollModalOpen(arrived.app)).toBe(true);
    expect(arrived.effects).toEqual([{ type: 'fx', cue: 'roll' }, tumble, { type: 'scrollTop' }]);
    expect(rollModalOpen(run(arrived.app, { type: 'tumble/elapsed' }).app)).toBe(false);
    // The host refused (not my turn after all): the toast frame drops the tumble with the taps.
    const refused = run(asked.app, { type: 'guest/frame', frame: toastFrame('No.') });
    expect(refused.app.table.rolling).toBe(false);
    // The other seat's roll: the dice tumble on my board, no modal of mine.
    const hostToRoll = withPosition(game(local()), pos(START), 0, null);
    const hostRolled = applyAction(hostToRoll, 0, { type: 'roll' }, ctx.rng, ctx.now);
    if (!hostRolled.ok) throw new Error(hostRolled.error);
    const watching = run(
      run(guest, { type: 'guest/frame', frame: stateFrame(viewFor(hostToRoll, 1)) }).app,
      { type: 'guest/frame', frame: stateFrame(viewFor(hostRolled.value, 1)) },
    );
    expect(watching.app.table.rolling).toBe(true);
    expect(rollModalOpen(watching.app)).toBe(false);
    expect(kinds(watching.effects)).toEqual(['fx', 'startTimer', 'scrollTop']);
  });
});

describe('the R14 beat and the Western cube', () => {
  test('a roll with no move keeps the roller`s table for NO_MOVE_MS, then the curtain rises for the other seat', () => {
    const app = at(SHUT_OUT, 0, null);
    const rolled = run(app, { type: 'roll/click' });
    const g = game(rolled.app);
    expect(g).toMatchObject({ phase: 'toRoll', turn: 1 });
    expect(g.lastAction?.kind).toBe('noMove');
    // The forfeited roll stays in view: Light's view, dice shown, no curtain yet, the timer armed.
    expect(rolled.app.shell.view).toEqual(viewFor(g, 0));
    expect(rolled.app.table).toMatchObject({
      curtain: null,
      noMoveUntil: NOW + NO_MOVE_MS,
      rolling: true,
    });
    // The tumble timer is armed at the click and again as the roll arrives (design §4.7).
    const tumble = {
      type: 'startTimer',
      id: 'tumble',
      ms: TUMBLE_MS,
      then: { type: 'tumble/elapsed' },
    };
    expect(rolled.effects).toEqual([
      tumble,
      { type: 'persist' },
      { type: 'fx', cue: 'roll' },
      tumble,
      { type: 'startTimer', id: 'noMove', ms: NO_MOVE_MS, then: { type: 'noMove/elapsed' } },
      { type: 'scrollTop' },
    ]);
    // The forfeited roll's modal stays through the tumble (the roller's own), then goes; the beat holds on.
    expect(rollModalOpen(rolled.app)).toBe(true);
    const settledDice = run(rolled.app, { type: 'tumble/elapsed' }).app;
    expect(settledDice.table).toMatchObject({ rolling: false, noMoveUntil: NOW + NO_MOVE_MS });
    expect(rollModalOpen(settledDice)).toBe(false);
    // Taps and rolls during the beat are dropped (not Light's turn any more).
    expect(run(settledDice, { type: 'roll/click' })).toEqual({ app: settledDice, effects: [] });
    const seen = run(settledDice, { type: 'noMove/elapsed' });
    expect(seen.app.table).toMatchObject({ noMoveUntil: null, curtain: 1 });
    expect(seen.app.shell.view).toEqual(viewFor(g, 1));
    expect(kinds(seen.effects)).toEqual(['persist', 'fx', 'scrollTop']);
    expect(cues(seen.effects)).toEqual(['yourTurn']);
    // Online the beat only clears; the paint re-reads.
    const hosted = run(hosting(), { type: 'noMove/elapsed' });
    expect(hosted.effects).toEqual([]);
  });

  test('Western: the starter plays the opening pair, the responder may double, the taker owns the cube, a pass ends the game', () => {
    const start = local('5', 'backgammon');
    const g0 = game(start);
    expect(g0).toMatchObject({ phase: 'moving', variant: 'backgammon' });
    // The curtain button reveals only: the dice are already in hand, so a roll is refused by the reducer.
    const lifted = revealed(start);
    expect(run(lifted, { type: 'roll/click' })).toEqual({ app: lifted, effects: [] });
    const turn = playTurn({ app: lifted, effects: [] });
    const g1 = game(turn.app);
    expect(g1.turn).not.toBe(g0.turn);
    expect(g1.phase).toBe('toRoll');
    const other = revealed(turn.app);
    expect(view(other).canDouble).toBe(true);
    const doubled = run(other, { type: 'double/click' });
    const g2 = game(doubled.app);
    expect(g2.phase).toBe('cubeOffered');
    // The phone goes to the doubled player (the actor), who sees the cube overlay under the curtain.
    expect(doubled.app.table.curtain).toBe(actorOf(g2));
    expect(doubled.app.shell.view).toEqual(viewFor(g2, actorOf(g2) ?? 0));
    expect(cues(doubled.effects)).toEqual(['yourTurn', 'double']);
    const taken = run(revealed(doubled.app), { type: 'take/click' });
    const g3 = game(taken.app);
    expect(g3).toMatchObject({
      phase: 'toRoll',
      turn: g1.turn,
      cube: { value: 2, owner: actorOf(g2) },
    });
    expect(taken.app.table.curtain).toBe(g1.turn);
    const passed = run(revealed(doubled.app), { type: 'pass/click' });
    const g4 = game(passed.app);
    expect(g4).toMatchObject({
      phase: 'over',
      result: { reason: 'passed', points: 1, winner: g1.turn },
    });
    expect(passed.app.table).toMatchObject({ resultOpen: true, curtain: null });
    expect(cues(passed.effects)).toEqual(['win']);
    // Portes has no cube: double/click is dropped.
    const portes = revealed(local());
    expect(run(portes, { type: 'double/click' })).toEqual({ app: portes, effects: [] });
  });
});

describe('leaving and cancelling', () => {
  test('leave/request confirms with the role`s message; confirmed closes the network first; finish resets and goes home', () => {
    const l = local();
    expect(run(l, { type: 'leave/request' }).effects).toEqual([
      { type: 'confirm', message: LEAVE_LOCAL_MSG, then: { type: 'leave/confirmed' } },
    ]);
    const h = hosting();
    expect(run(h, { type: 'leave/request' }).effects).toEqual([
      { type: 'confirm', message: LEAVE_ONLINE_MSG, then: { type: 'leave/confirmed' } },
    ]);
    expect(run(h, { type: 'leave/confirmed' }).effects).toEqual([
      { type: 'wakeLock', hold: false },
      { type: 'closeNet' },
      { type: 'then', intent: { type: 'leave/finish' } },
    ]);
    const { app, effects } = run(h, { type: 'leave/finish' });
    expect(app.shell).toMatchObject({
      role: null,
      game: null,
      view: null,
      code: null,
      oppConnected: false,
      revealed: null,
      handoff: false,
      netAttempt: h.shell.netAttempt + 1,
    });
    expect(app.table).toMatchObject({ curtain: null, selected: null, curtainMode: 'always' });
    expect(effects).toEqual([{ type: 'clearSave' }, { type: 'initHome' }]);
  });

  test('cancel closes the network then finishes: the save is cleared, or a handed-off game goes back to pass-and-play', () => {
    const room = lobbyApp();
    expect(run(room, { type: 'cancel' }).effects).toEqual([
      { type: 'closeNet' },
      { type: 'then', intent: { type: 'cancel/finish' } },
    ]);
    const done = run(room, { type: 'cancel/finish' });
    expect(done.app.shell).toMatchObject({ role: null, netAttempt: room.shell.netAttempt + 1 });
    expect(done.effects).toEqual([{ type: 'clearSave' }, { type: 'initHome' }]);
    const handed = run(revealed(local()), { type: 'handoff/click' });
    const g = game(handed.app);
    expect(handed.app.shell).toMatchObject({
      role: 'host',
      handoff: true,
      myName: 'Ann',
      oppName: 'Bob',
      oppConnected: false,
      view: viewFor(g, 0),
      revealed: null,
      screen: 'hostWaitScreen',
    });
    expect(handed.app.table.curtain).toBeNull();
    expect(handed.effects.at(-1)).toMatchObject({ type: 'startHost', resume: false });
    expect(run(handed.app, { type: 'cancel/finish' }).effects).toEqual([
      { type: 'saveLocal', game: g },
      { type: 'initHome' },
    ]);
    // A guest that drops before joining a handed-off room leaves the invite text in place.
    const dropped = run(handed.app, { type: 'host/guestGone', iceFailed: null });
    expect(dropped.app.shell.hostStatus.text).toBe(handoffMsg(handed.app.shell.code ?? '', 'Bob'));
    expect(dropped.effects).toEqual([]);
    // handoff/click with nothing to hand off does nothing.
    expect(run(initialApp, { type: 'handoff/click' })).toEqual({ app: initialApp, effects: [] });
  });
});

/** Recorded adapters: every call lands in `log` as [name, ...args]; `answer.yes` is the confirm's reply. */
const deps = (
  store = createStore(fakeStorage()),
): Readonly<{ deps: EffectDeps; log: unknown[][]; answer: { yes: boolean } }> => {
  const log: unknown[][] = [];
  const answer = { yes: true };
  const note =
    (name: string) =>
    (...args: unknown[]): void => {
      log.push([name, ...args]);
    };
  return {
    log,
    answer,
    deps: {
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
    },
  };
};

describe('resume', () => {
  test('resumeFor offers each save role, not a finished match; the labels name the room or the players', () => {
    expect(resumeFor(null)).toBeNull();
    const g = game(local());
    expect(resumeFor({ role: 'local', game: g })).toEqual({ kind: 'local', game: g });
    expect(resumeLabel({ kind: 'local', game: g })).toBe('Resume pass & play: Ann vs Bob');
    const over = { ...g, phase: 'over' as const, match: { ...g.match, score: [5, 0] as const } };
    expect(resumeFor({ role: 'local', game: over })).toBeNull();
    const hostSave = {
      role: 'host' as const,
      code: 'ABCD',
      myName: 'Ann',
      matchLength: 5,
      variant: 'portes' as const,
      game: g,
      oppName: 'Jeff',
    };
    const hostOffer = resumeFor(hostSave);
    expect(hostOffer).toEqual({
      kind: 'host',
      code: 'ABCD',
      myName: 'Ann',
      matchLength: 5,
      variant: 'portes',
      game: g,
      oppName: 'Jeff',
      handoff: false,
    });
    if (hostOffer === null) throw new Error('no offer');
    expect(resumeLabel(hostOffer)).toBe('Resume hosting room ABCD');
    expect(resumeFor({ ...hostSave, game: null })).toBeNull();
    expect(resumeFor({ ...hostSave, game: over })).toBeNull();
    const handed = resumeFor({ ...hostSave, handoff: true });
    if (handed === null) throw new Error('no offer');
    expect(resumeLabel(handed)).toBe(handoffLabel(g));
    expect(handoffLabel(g)).toBe('Continue online: Ann hosts, Bob joins by invite');
    expect(resumeFor({ role: 'guest', code: 'ABCD', myName: 'Bo' })).toEqual({
      kind: 'guest',
      code: 'ABCD',
      myName: 'Bo',
    });
    expect(resumeLabel({ kind: 'guest', code: 'ABCD', myName: 'Bo' })).toBe('Rejoin room ABCD');
  });

  test('resume/click restarts each kind: pass-and-play with the position, hosting under the same code, the guest`s join', () => {
    expect(run(initialApp, { type: 'resume/click' })).toEqual({ app: initialApp, effects: [] });
    const played = playTurn(run(revealed(local()), { type: 'roll/click' }));
    const g = game(played.app);
    const snapshot: HomeSnapshot = { ...home, save: { role: 'local', game: g } };
    const offered = run(initialApp, { type: 'home/init', home: snapshot }).app;
    const resumed = run(offered, { type: 'resume/click' });
    expect(resumed.app.shell).toMatchObject({ role: 'local', game: g, screen: 'tableScreen' });
    expect(resumed.app.shell.view).toEqual(viewFor(g, g.turn));
    expect(resumed.app.table.curtain).toBe(g.turn);
    expect(kinds(resumed.effects)).toEqual(['wakeLock', 'persist', 'scrollTop']);
    const host = run(initialApp, {
      type: 'home/init',
      home: {
        ...home,
        save: {
          role: 'host',
          code: 'ABCD',
          myName: 'Ann',
          matchLength: 3,
          variant: 'backgammon',
          game: g,
          oppName: 'Jeff',
          handoff: true,
        },
      },
    }).app;
    const hostResumed = run(host, { type: 'resume/click' });
    expect(hostResumed.app.shell).toMatchObject({
      role: 'host',
      code: 'ABCD',
      myName: 'Ann',
      opts: { matchLength: 3, variant: 'backgammon' },
      oppName: 'Jeff',
      handoff: true,
      game: g,
      view: viewFor(g, 0),
    });
    expect(hostResumed.effects.at(-1)).toEqual({
      type: 'startHost',
      code: 'ABCD',
      attempt: 1,
      resume: true,
    });
    const guest = run(initialApp, {
      type: 'home/init',
      home: { ...home, save: { role: 'guest', code: 'WXYZ', myName: 'Bo' } },
    }).app;
    const guestResumed = run(guest, { type: 'resume/click' });
    expect(guestResumed.app.shell).toMatchObject({ role: 'guest', code: 'WXYZ', myName: 'Bo' });
    expect(guestResumed.effects.at(-1)).toEqual({ type: 'startGuest', code: 'WXYZ', attempt: 1 });
  });

  test('the resume snapshot round-trips through storage: persist, read, offer, continue', () => {
    const storage = fakeStorage();
    const store = createStore(storage);
    const played = playTurn(run(revealed(local()), { type: 'roll/click' }));
    const g = game(played.app);
    runEffect(played.app, { type: 'persist' }, deps(store).deps);
    expect(storage.map.get(STORAGE_KEYS.save)).toBe(JSON.stringify({ role: 'local', game: g }));
    const read = readHome(store);
    expect(read.save).toEqual({ role: 'local', game: g });
    const offered = run(initialApp, { type: 'home/init', home: read }).app;
    expect(offered.shell.resume).toEqual({ kind: 'local', game: g });
    const back = run(offered, { type: 'resume/click' }).app;
    expect(game(back)).toEqual(g);
    expect(view(back)).toEqual(viewFor(g, g.turn));
  });
});

describe('the finished match`s record (the owner, 2026-09-25)', () => {
  const records = (effects: ReadonlyArray<Effect>): ReadonlyArray<unknown> =>
    effects.flatMap((e) => (e.type === 'recordGame' ? [e.game] : []));

  test('the adapters: the opening`s clock is the key, the match score the score, `matchWinner` the victor', () => {
    const l = local();
    const v = view(l);
    expect(BACKGAMMON.result.keyOf(v)).toBe(String(game(l).startedAt));
    expect(BACKGAMMON.result.playersOf(v)).toEqual(['Ann', 'Bob']);
    expect(BACKGAMMON.result.scoreOf(v)).toBe('0–0');
    expect(BACKGAMMON.result.winnerOf(v)).toBeNull();
    const won: View = { ...v, match: { ...v.match, score: [2, 5] }, matchOver: true };
    expect(BACKGAMMON.result.scoreOf(won)).toBe('2–5');
    expect(BACKGAMMON.result.winnerOf(won)).toBe(1);
  });

  test('pass and play: the bear-off that takes the match records it once, a win for the first name; the end screen`s repaints record nothing more', () => {
    // Light's last checker on its 1-point at 4–0 in a match to 5 (Dark's fifteen well away from
    // it: its own 24 is Light's own 1): the bear-off is a gammon, and the match.
    const l = local();
    const seated = {
      ...withPosition(game(l), pos('L: 1:1 | D: 1:13 6:2 | bar 0/0 | off 14/0'), 0, [2, 1]),
      match: { ...game(l).match, score: [4, 0] as const },
    };
    const before = run(revealed(l), { type: 'position/load', state: seated });
    expect(records(before.effects)).toEqual([]);
    const done = playOut(before, 20);
    expect(view(done.app).matchOver).toBe(true);
    expect(records(done.effects)).toEqual([
      {
        at: NOW,
        mode: 'local',
        players: ['Ann', 'Bob'],
        score: '6–0',
        winner: 0,
        outcome: 'win',
      },
    ]);
    expect(done.app.shell.recentGames).toHaveLength(1);
    expect(done.app.shell.screen).toBe('endgameScreen');
    expect(records(run(done.app, { type: 'render' }, { type: 'history/toggle' }).effects)).toEqual(
      [],
    );
  });
});

describe('storage', () => {
  test('saveFor: one shape per role, handoff written only when true, nothing for no role', () => {
    expect(saveFor(initialApp)).toBeNull();
    const l = local();
    expect(saveFor(l)).toEqual({ role: 'local', game: game(l) });
    const h = hosting();
    expect(saveFor(h)).toEqual({
      role: 'host',
      code: h.shell.code,
      myName: 'Ann',
      matchLength: 3,
      variant: 'portes',
      game: game(h),
      oppName: 'Jeff',
    });
    const handed = run(revealed(local()), { type: 'handoff/click' }).app;
    expect(saveFor(handed)).toMatchObject({ role: 'host', handoff: true, oppName: 'Bob' });
    const g = run(initialApp, { type: 'join/click', name: 'Bo', code: 'ABCD' }).app;
    expect(saveFor(g)).toEqual({ role: 'guest', code: 'ABCD', myName: 'Bo' });
    expect(saveFor({ ...l, shell: { ...l.shell, game: null } })).toBeNull();
  });

  test('readHome: the defaults when the store is empty, the values when it is not', () => {
    const storage = fakeStorage();
    const store = createStore(storage);
    expect(readHome(store)).toEqual({ ...home, playMode: 'online' });
    storage.map.set(STORAGE_KEYS.name, 'Ann');
    storage.map.set(STORAGE_KEYS.p2Name, 'Bob');
    storage.map.set(STORAGE_KEYS.homeTab, 'about');
    storage.map.set(STORAGE_KEYS.playMode, 'online');
    storage.map.set(STORAGE_KEYS.variant, 'backgammon');
    storage.map.set(STORAGE_KEYS.matchLength, '7');
    storage.map.set(STORAGE_KEYS.curtain, 'never');
    storage.map.set(STORAGE_KEYS.soundFont, 'felt');
    expect(readHome(store)).toEqual({
      name: 'Ann',
      p2Name: 'Bob',
      homeTab: 'about',
      playMode: 'online',
      matchLength: 7,
      variant: 'backgammon',
      curtainMode: 'never',
      soundFont: 'felt',
      save: null,
      recentGames: [],
    });
    storage.map.set(STORAGE_KEYS.variant, 'plakoto');
    storage.map.set(STORAGE_KEYS.matchLength, '4');
    expect(readHome(store)).toMatchObject({ variant: 'portes', matchLength: 5 });
  });
});

describe('the sessions read back', () => {
  test('hostContextOf and guestContextOf mirror the shell', () => {
    const h = hosting();
    expect(hostContextOf(h)).toEqual({
      attempt: 1,
      role: 'host',
      code: h.shell.code,
      myName: 'Ann',
      matchLength: 3,
      variant: 'portes',
      hasGame: true,
      handoff: false,
      oppName: 'Jeff',
      oppConnected: true,
    });
    const g = run(initialApp, { type: 'join/click', name: 'Bo', code: 'ABCD' }).app;
    expect(guestContextOf(g)).toEqual({
      attempt: 1,
      role: 'guest',
      code: 'ABCD',
      myName: 'Bo',
      oppConnected: false,
    });
  });
});

describe('what changed between two views', () => {
  test('newMovesBetween: this turn`s tail, the finished turn once it flipped, nothing across games or after an undo', () => {
    const app = run(at(TWO_ORDERS, 0, [6, 3]), { type: 'point/tap', point: 12 }).app;
    const v0 = view(app);
    const one = run(app, { type: 'point/tap', point: 9 });
    const v1 = view(one.app);
    expect(newMovesBetween(v0, v1)).toEqual([{ from: 12, to: 9, die: 3, hit: false }]);
    expect(newMovesBetween(null, v1)).toEqual([]);
    const two = run(one.app, { type: 'point/tap', point: 9 }, { type: 'point/tap', point: 3 });
    const v2 = view(two.app);
    // The turn flipped: the finished play beyond what v1 saw, from either seat's view.
    expect(newMovesBetween(v1, v2)).toEqual([{ from: 9, to: 3, die: 6, hit: false }]);
    expect(newMovesBetween(v0, viewFor(game(two.app), 0))).toEqual(game(two.app).lastPlay);
    const undone = view(run(one.app, { type: 'undo/click' }).app);
    expect(newMovesBetween(v1, undone)).toEqual([]);
    const other = view(local());
    expect(newMovesBetween(v1, other)).toEqual([]);
  });

  test('cuesBetween: roll, the moves, the double, win or lose by seat online, the turn chime online only', () => {
    const start = revealed(local());
    const v0 = view(start);
    const rolled = run(start, { type: 'roll/click' });
    expect(cuesBetween(v0, view(rolled.app), 'local')).toEqual(['roll']);
    expect(cuesBetween(view(rolled.app), view(rolled.app), 'local')).toEqual([]);
    const off = at(BOTH_SUFFICE, 0, [6, 5]);
    const won = run(
      off,
      { type: 'off/tap' },
      { type: 'chip/tap', index: 0 },
      { type: 'off/tap' },
    ).app;
    const g = game(won);
    expect(cuesBetween(viewFor(g, 1), viewFor(g, 1), 'guest')).toEqual([]);
    const before = viewFor({ ...g, phase: 'moving' }, 1);
    expect(cuesBetween(before, viewFor(g, 1), 'guest')).toEqual(['lose']);
    expect(cuesBetween(before, viewFor(g, 0), 'host')).toEqual(['win']);
    // Online, my turn arriving chimes; in pass-and-play the curtain does.
    const h = hosting();
    const hg = game(h);
    const theirs = viewFor({ ...hg, turn: 1 }, 0);
    const mine = viewFor({ ...hg, turn: 0 }, 0);
    expect(cuesBetween(theirs, mine, 'host')).toEqual(['yourTurn']);
    expect(cuesBetween(theirs, mine, 'local')).toEqual([]);
  });
});

describe('runEffect', () => {
  test('storage effects write through storage.ts', () => {
    const storage = fakeStorage();
    const { deps: d } = deps(createStore(storage));
    const h = hosting();
    runEffect(h, { type: 'persist' }, d);
    expect(storage.map.get(STORAGE_KEYS.save)).toBe(JSON.stringify(saveFor(h)));
    runEffect(initialApp, { type: 'persist' }, d); // nothing to save: untouched
    expect(storage.map.has(STORAGE_KEYS.save)).toBe(true);
    runEffect(initialApp, { type: 'clearSave' }, d);
    expect(storage.map.has(STORAGE_KEYS.save)).toBe(false);
    const g = game(h);
    runEffect(initialApp, { type: 'saveLocal', game: g }, d);
    expect(storage.map.get(STORAGE_KEYS.save)).toBe(JSON.stringify({ role: 'local', game: g }));
    runEffect(initialApp, { type: 'rememberName', name: 'Ann' }, d);
    runEffect(initialApp, { type: 'rememberP2Name', name: 'Bob' }, d);
    runEffect(initialApp, { type: 'writeHomeTab', tab: 'about' }, d);
    runEffect(initialApp, { type: 'writePlayMode', mode: 'online' }, d);
    runEffect(initialApp, { type: 'writeVariant', variant: 'backgammon' }, d);
    runEffect(initialApp, { type: 'writeMatchLength', length: 7 }, d);
    runEffect(initialApp, { type: 'writeCurtainMode', mode: 'never' }, d);
    runEffect(initialApp, { type: 'writeSoundFont', font: 'arcade' }, d);
    expect(storage.map.get(STORAGE_KEYS.name)).toBe('Ann');
    expect(storage.map.get(STORAGE_KEYS.p2Name)).toBe('Bob');
    expect(storage.map.get(STORAGE_KEYS.homeTab)).toBe('about');
    expect(storage.map.get(STORAGE_KEYS.playMode)).toBe('online');
    expect(storage.map.get(STORAGE_KEYS.variant)).toBe('backgammon');
    expect(storage.map.get(STORAGE_KEYS.matchLength)).toBe('7');
    expect(storage.map.get(STORAGE_KEYS.curtain)).toBe('never');
    expect(storage.map.get(STORAGE_KEYS.soundFont)).toBe('arcade');
    expect(readHome(createStore(storage))).toMatchObject({
      name: 'Ann',
      p2Name: 'Bob',
      homeTab: 'about',
      playMode: 'online',
      matchLength: 7,
      variant: 'backgammon',
      curtainMode: 'never',
      soundFont: 'arcade',
    });
  });

  test('every other effect reaches its adapter with its arguments; fx plays in the App`s font', () => {
    const { deps: d, log, answer } = deps();
    const frame = { t: 'action', action: { type: 'roll' } } as const;
    const then: Intent = { type: 'leave/confirmed' };
    const app = { ...initialApp, shell: { ...initialApp.shell, soundFont: 'felt' as const } };
    runEffect(app, { type: 'toast', message: 'Hi', ms: 1000 }, d);
    runEffect(app, { type: 'send', frame }, d);
    runEffect(app, { type: 'fx', cue: 'hit' }, d);
    runEffect(app, { type: 'wakeLock', hold: true }, d);
    runEffect(app, { type: 'startHost', code: 'ABCD', attempt: 2, resume: true }, d);
    runEffect(app, { type: 'startGuest', code: 'WXYZ', attempt: 3 }, d);
    runEffect(app, { type: 'closeNet' }, d);
    runEffect(app, { type: 'confirm', message: 'Sure?', then }, d);
    runEffect(app, { type: 'then', intent: { type: 'persist' } }, d);
    runEffect(app, { type: 'scrollTop' }, d);
    runEffect(
      app,
      { type: 'startTimer', id: 'shake', ms: SHAKE_MS, then: { type: 'shake/elapsed' } },
      d,
    );
    runEffect(app, { type: 'cancelTimer', id: 'longPress' }, d);
    runEffect(app, { type: 'toggleSound' }, d);
    runEffect(app, { type: 'share', code: 'ABCD' }, d);
    runEffect(app, { type: 'revealRule', slot: 'rulesList', rule: 'blocks' }, d);
    runEffect(app, { type: 'fillName', name: 'Ann' }, d);
    runEffect(app, { type: 'fillP2Name', name: 'Bob' }, d);
    runEffect(app, { type: 'setCode', value: 'ABC' }, d);
    expect(log).toEqual([
      ['toast', 'Hi', 1000],
      ['send', frame],
      ['fx', 'hit', 'felt'],
      ['wakeLock', true],
      ['startHost', 'ABCD', 2, true],
      ['startGuest', 'WXYZ', 3],
      ['close'],
      ['confirm', 'Sure?'],
      ['dispatch', then],
      ['dispatch', { type: 'persist' }],
      ['scrollTop'],
      ['timers.start', 'shake', SHAKE_MS, { type: 'shake/elapsed' }],
      ['timers.cancel', 'longPress'],
      ['toggleSound'],
      ['share', 'ABCD'],
      ['revealRule', 'rulesList', 'blocks'],
      ['page.fillName', 'Ann', false],
      ['page.fillP2Name', 'Bob', false],
      ['page.setCode', 'ABC'],
    ]);
    // A declined confirm dispatches nothing; initHome re-reads the store into home/init.
    answer.yes = false;
    runEffect(app, { type: 'confirm', message: 'Sure?', then }, d);
    expect(log.at(-1)).toEqual(['confirm', 'Sure?']);
    runEffect(app, { type: 'initHome' }, d);
    expect(log.at(-1)).toEqual(['dispatch', { type: 'home/init', home: readHome(d.store) }]);
  });
});

describe('the rest of the shell', () => {
  test('visible holds the wake lock in a game; render re-renders; persist persists; a guest gone after the match is quiet', () => {
    expect(run(initialApp, { type: 'visible' }).effects).toEqual([]);
    expect(run(local(), { type: 'visible' }).effects).toEqual([{ type: 'wakeLock', hold: true }]);
    expect(run(initialApp, { type: 'render' })).toEqual({ app: initialApp, effects: [] });
    const l = local();
    const again = run(l, { type: 'render' });
    expect(again.app.shell.view).toEqual(l.shell.view);
    expect(again.effects).toEqual([{ type: 'scrollTop' }]);
    expect(run(l, { type: 'persist' }).effects).toEqual([{ type: 'persist' }]);
    // The match over on the host: a guest that drops is neither toasted nor awaited.
    const done = playOut({ app: local('1'), effects: [] }, 4000).app;
    const overHost = {
      ...hosting(),
      shell: { ...hosting().shell, game: game(done), view: viewFor(game(done), 0) },
    };
    expect(run(overHost, { type: 'host/guestGone', iceFailed: null }).effects).toEqual([]);
    // Rematch by role: the host broadcasts a fresh match, the guest waits for it.
    const hostAgain = run(overHost, { type: 'next/click' });
    expect(game(hostAgain.app)).toMatchObject({ gameNo: 1, match: { score: [0, 0] } });
    expect(kinds(hostAgain.effects).slice(0, 2)).toEqual(['send', 'persist']);
    const guestOver = run(
      run(initialApp, { type: 'join/click', name: 'Bo', code: 'ABCD' }).app,
      { type: 'guest/connected' },
      { type: 'guest/frame', frame: { t: 'state', view: viewFor(game(done), 1) } },
    ).app;
    expect(guestOver.shell.screen).toBe('endgameScreen');
    expect(run(guestOver, { type: 'next/click' })).toEqual({ app: guestOver, effects: [] });
    // A game over but the match on: the guest's Next game is sent for the host to arbitrate.
    const midMatch = playOut({ app: local('5'), effects: [] }, 4000).app;
    const guestMid = run(guestOver, {
      type: 'guest/frame',
      frame: { t: 'state', view: viewFor(game(midMatch), 1) },
    }).app;
    expect(sends(run(guestMid, { type: 'next/click' }).effects)).toEqual([
      { t: 'action', action: { type: 'next' } },
    ]);
  });

  test('every cue the reducer raises has a sound row', () => {
    const raised = [
      'roll',
      'doubles',
      'place',
      'hit',
      'bearOff',
      'yourTurn',
      'win',
      'lose',
      'double',
      'tap',
    ];
    expect(Object.keys(CUES).sort()).toEqual([...raised].sort());
    expect(CUES.hit.cue).toBe('capture');
    expect(CUES.bearOff.cue).toBe('score');
  });
});
