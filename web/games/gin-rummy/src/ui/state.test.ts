import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { STOCK_DRAW_FINAL_MSG, applyAction, createGame, viewFor } from '../engine/index.ts';
import type { Action, Seat, State, View } from '../engine/index.ts';
import { CONNECTED_MSG, connectingMsg } from '../net/guest.ts';
import { OPENING_MSG, WAITING_MSG, handoffMsg } from '../net/host.ts';
import { STORAGE_KEYS } from '../storage.ts';
import { arrangedOf } from './hand/arrange.ts';
import { engineOf } from './hand/picture.ts';
import {
  DISCONNECTED_MSG,
  FORCE_STOCK_MSG,
  GONE_TOAST_MS,
  LEAVE_LOCAL_MSG,
  LEAVE_ONLINE_MSG,
  LOCKED_CARD_MSG,
  LONG_PRESS_MS,
  LOST_HOST_MSG,
  NOT_CONNECTED_MSG,
  NO_MELD_MSG,
  OPPONENT_LEFT_MSG,
  ROOM_FULL_MSG,
  SCREENS,
  WAITING_FOR_GUEST_MSG,
  guestContextOf,
  guestGoneMsg,
  handoffLabel,
  hostContextOf,
  hostRoomMsg,
  initialApp,
  joinedMsg,
  parseTarget,
  readHome,
  reduce,
  resumeFor,
  resumeLabel,
  runEffect,
  saveFor,
  type App,
  type Effect,
  type EffectDeps,
  type HomeSnapshot,
  type Intent,
  type Step,
} from './state.ts';

const NOW = 1_700_000_000_000;
const ctx = { rng: mulberry32(7), now: () => NOW };

/** Dispatch intents in turn, collecting every effect. */
const run = (app: App, ...intents: ReadonlyArray<Intent>): Step =>
  intents.reduce<Step>(
    (s, intent) => {
      const next = reduce(s.app, intent, ctx);
      return { app: next.app, effects: [...s.effects, ...next.effects] };
    },
    { app, effects: [] },
  );

const kinds = (effects: ReadonlyArray<Effect>): ReadonlyArray<string> => effects.map((e) => e.type);
const toasts = (effects: ReadonlyArray<Effect>): ReadonlyArray<unknown> =>
  effects.flatMap((e) => (e.type === 'toast' ? [[e.message, e.ms]] : []));

const PLAYERS = [
  { id: 'host', name: 'Ann' },
  { id: 'guest', name: 'Jeff' },
] as const;
/** Dealer 1, so seat 0 (the host) is the non-dealer and moves first. */
const dealt = createGame({ players: PLAYERS, target: 100, dealer: 1 }, mulberry32(3), () => NOW);
const play = (state: State, moves: ReadonlyArray<readonly [Seat, Action]>): State =>
  moves.reduce((g, [seat, a]) => {
    const r = applyAction(g, seat, a, mulberry32(0), () => NOW);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }, state);
/** Seat 0 has drawn from the stock and must discard. */
const drawn = play(dealt, [
  [0, { type: 'passUpcard' }],
  [1, { type: 'passUpcard' }],
  [0, { type: 'drawStock' }],
]);

const home: HomeSnapshot = {
  name: null,
  p2Name: null,
  homeTab: 'play',
  playMode: 'online',
  sort: 'melds',
  save: null,
  scorer: null,
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

/** A host in the lobby with a connected guest named Jeff. */
const lobby = (): App =>
  run(
    initialApp,
    { type: 'home/init', home },
    { type: 'host/click', name: 'Ann', target: '100' },
    { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } },
  ).app;

/** A host mid-hand: dealt, both passed the upcard, the host drew from the stock. */
const hosting = (): App => ({
  ...lobby(),
  game: drawn,
  view: viewFor(drawn, 0),
  screen: 'tableScreen',
});

describe('the initial app', () => {
  test('is the legacy `app` literal plus the DOM state, on the home screen', () => {
    expect(initialApp).toMatchObject({
      role: null,
      code: null,
      myName: 'Ari',
      target: 100,
      game: null,
      view: null,
      oppName: null,
      oppConnected: false,
      selectedCard: null,
      hostSeated: false,
      nameTouched: false,
      revealed: null,
      homeTab: 'play',
      playMode: 'online',
      screen: 'homeScreen',
      netAttempt: 0,
      hostStatus: { text: 'Opening room…', pulse: true },
      guestStatus: { text: 'Connecting…', pulse: true },
    });
    expect(SCREENS).toEqual([
      'homeScreen',
      'hostWaitScreen',
      'guestWaitScreen',
      'tableScreen',
      'endgameScreen',
      'scGameScreen',
      'scEndScreen',
    ]);
  });
});

describe('home', () => {
  test('home/init shows the home screen, applies the saved name, tab and mode, and offers a resume', () => {
    const { app, effects } = run(
      { ...initialApp, screen: 'tableScreen' },
      {
        type: 'home/init',
        home: { ...home, name: 'Ann', p2Name: 'Bob', homeTab: 'score', playMode: 'local' },
      },
    );
    expect(app).toMatchObject({
      screen: 'homeScreen',
      savedName: 'Ann',
      nameTouched: true,
      homeTab: 'score',
      playMode: 'local',
      resume: null,
    });
    // The saved names go into the inputs; the tab is applied without persisting
    // (`{ persist: false }`); the score tab wakes the scorer.
    expect(effects).toEqual([
      { type: 'scrollTop' },
      { type: 'fillName', name: 'Ann' },
      { type: 'fillP2Name', name: 'Bob' },
    ]);
    const plain = run(initialApp, { type: 'home/init', home });
    expect(plain.app.nameTouched).toBe(false);
    expect(plain.effects).toEqual([{ type: 'scrollTop' }]);
  });

  test('tab/set persists a known tab, maps an unknown one to play, wakes the scorer on score', () => {
    expect(run(initialApp, { type: 'tab/set', tab: 'rules' })).toEqual({
      app: { ...initialApp, homeTab: 'rules' },
      effects: [{ type: 'writeHomeTab', tab: 'rules' }],
    });
    expect(run(initialApp, { type: 'tab/set', tab: 'settings' }).effects).toEqual([
      { type: 'writeHomeTab', tab: 'play' },
    ]);
    expect(run(initialApp, { type: 'tab/set', tab: 'score', persist: false }).effects).toEqual([]);
  });

  test('mode/set: local or online, persisted', () => {
    expect(run(initialApp, { type: 'mode/set', mode: 'local' })).toEqual({
      app: { ...initialApp, playMode: 'local' },
      effects: [{ type: 'writePlayMode', mode: 'local' }],
    });
    expect(run(initialApp, { type: 'mode/set', mode: 'bots' }).app.playMode).toBe('online');
  });

  test('typing a name remembers it trimmed, shows it as typed in the other inputs, and marks the online one touched', () => {
    expect(run(initialApp, { type: 'name/typed', value: '  Zoë ' })).toEqual({
      app: { ...initialApp, nameTouched: true },
      effects: [
        { type: 'rememberName', name: 'Zoë' },
        { type: 'fillName', name: '  Zoë ' },
      ],
    });
    expect(run(initialApp, { type: 'p1name/typed', value: '' })).toEqual({
      app: initialApp,
      effects: [
        { type: 'rememberName', name: '' },
        { type: 'fillName', name: '' },
      ],
    });
  });

  test('typing the second name remembers it trimmed under its own key, fills its other input and touches nothing', () => {
    expect(run(initialApp, { type: 'p2name/typed', value: ' Bob ' })).toEqual({
      app: initialApp,
      effects: [
        { type: 'rememberP2Name', name: 'Bob' },
        { type: 'fillP2Name', name: ' Bob ' },
      ],
    });
    expect(run(initialApp, { type: 'p2name/typed', value: '' })).toEqual({
      app: initialApp,
      effects: [
        { type: 'rememberP2Name', name: '' },
        { type: 'fillP2Name', name: '' },
      ],
    });
    // A saved second name alone fills its input and nothing else.
    expect(run(initialApp, { type: 'home/init', home: { ...home, p2Name: 'Bob' } })).toMatchObject({
      app: { nameTouched: false, savedName: null },
      effects: [{ type: 'scrollTop' }, { type: 'fillP2Name', name: 'Bob' }],
    });
  });

  test('parseTarget: a positive integer, else 100', () => {
    expect(['75', ' 12 ', '0', '-5', 'abc', '', '3.9'].map(parseTarget)).toEqual([
      75, 12, 100, 100, 100, 100, 3,
    ]);
  });

  test('screen/show flips the screen and scrolls to the top', () => {
    expect(run(initialApp, { type: 'screen/show', screen: 'scGameScreen' })).toEqual({
      app: { ...initialApp, screen: 'scGameScreen' },
      effects: [{ type: 'scrollTop' }],
    });
  });

  test('the Play tab: a tap switches tabs; a long press opens the submenu and swallows the click that follows', () => {
    const pressed = run({ ...initialApp, homeTab: 'rules' }, { type: 'submenu/press' });
    expect(pressed.app.longPressed).toBe(false);
    expect(pressed.effects).toEqual([
      {
        type: 'startTimer',
        id: 'longPress',
        ms: LONG_PRESS_MS,
        then: { type: 'submenu/longPress' },
      },
    ]);
    // Released in time: the timer is cancelled and the click switches to the Play tab.
    const tapped = run(pressed.app, { type: 'submenu/release' }, { type: 'tab/playClick' });
    expect(tapped.app).toMatchObject({ homeTab: 'play', submenuOpen: false, longPressed: false });
    expect(tapped.effects).toEqual([
      { type: 'cancelTimer', id: 'longPress' },
      { type: 'writeHomeTab', tab: 'play' },
    ]);
    // Held: the submenu opens with a tap sound; the click that follows only clears the flag.
    const held = run(pressed.app, { type: 'submenu/longPress' });
    expect(held.app).toMatchObject({ submenuOpen: true, longPressed: true, homeTab: 'rules' });
    expect(held.effects).toEqual([{ type: 'fx', cue: 'tap' }]);
    const swallowed = run(held.app, { type: 'tab/playClick' });
    expect(swallowed.app).toMatchObject({
      submenuOpen: true,
      longPressed: false,
      homeTab: 'rules',
    });
    expect(swallowed.effects).toEqual([]);
    // A submenu pick sets the mode, shows the Play tab and closes the submenu; a click elsewhere just closes it.
    const picked = run(held.app, { type: 'submenu/pick', mode: 'local' });
    expect(picked.app).toMatchObject({ playMode: 'local', homeTab: 'play', submenuOpen: false });
    expect(picked.effects).toEqual([
      { type: 'writePlayMode', mode: 'local' },
      { type: 'writeHomeTab', tab: 'play' },
    ]);
    expect(run(held.app, { type: 'submenu/dismiss' }).app.submenuOpen).toBe(false);
  });

  test('the code input keeps upper-case letters only, four at most, and reverts a keyboard replacement', () => {
    const typed = run(initialApp, { type: 'code/typed', value: 'ab1c', inputType: 'insertText' });
    expect(typed.app.codeDraft).toBe('ABC');
    expect(typed.effects).toEqual([{ type: 'setCode', value: 'ABC' }]);
    const more = run(typed.app, { type: 'code/typed', value: 'abcde', inputType: 'insertText' });
    expect(more.app.codeDraft).toBe('ABCD');
    const swapped = run(more.app, {
      type: 'code/typed',
      value: 'XYZW',
      inputType: 'insertReplacementText',
    });
    expect(swapped.app.codeDraft).toBe('ABCD');
    expect(swapped.effects).toEqual([{ type: 'setCode', value: 'ABCD' }]);
  });

  test('sound, share and the two overlays', () => {
    expect(run(initialApp, { type: 'sound/toggle' })).toEqual({
      app: initialApp,
      effects: [{ type: 'toggleSound' }],
    });
    expect(run(initialApp, { type: 'share/click' }).effects).toEqual([]);
    expect(run({ ...initialApp, code: 'ABCD' }, { type: 'share/click' }).effects).toEqual([
      { type: 'share', code: 'ABCD' },
    ]);
    const opened = run(initialApp, { type: 'rules/open' }, { type: 'history/open', who: 'game' });
    expect(opened.app).toMatchObject({ rulesOpen: true, history: 'game' });
    expect(opened.effects).toEqual([]);
    const scorer = run(opened.app, { type: 'history/open', who: 'scorer' });
    expect(scorer.app.history).toBe('scorer');
    expect(run(opened.app, { type: 'rules/close' }, { type: 'history/close' }).app).toMatchObject({
      rulesOpen: false,
      history: null,
    });
  });
});

describe('hosting', () => {
  test('host/click: the name and target from the inputs, a fresh 4-letter code, the wait screen, the session', () => {
    const { app, effects } = run(initialApp, {
      type: 'host/click',
      name: '  Ann  ',
      target: '75',
    });
    expect(app).toMatchObject({
      role: 'host',
      myName: 'Ann',
      target: 75,
      game: null,
      oppName: null,
      oppConnected: false,
      netAttempt: 1,
      screen: 'hostWaitScreen',
      hostStatus: { text: OPENING_MSG, pulse: true },
      startGameVisible: false,
    });
    expect(app.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    expect(effects).toEqual([
      { type: 'scrollTop' },
      { type: 'startHost', code: app.code, attempt: 1, resume: false },
    ]);
    // An empty name is Ari, a long one is cut to 20; a bad target is 100.
    const defaults = run(initialApp, { type: 'host/click', name: '', target: 'x' }).app;
    expect(defaults).toMatchObject({ myName: 'Ari', target: 100 });
    expect(
      run(initialApp, { type: 'host/click', name: 'A'.repeat(25), target: '1' }).app.myName,
    ).toBe('A'.repeat(20));
  });

  test('host/start with a code keeps it (a resume or a busy retry); null draws another', () => {
    const resumed = run({ ...initialApp, netAttempt: 4 }, { type: 'host/start', code: 'LRZL' });
    expect(resumed.app).toMatchObject({ role: 'host', code: 'LRZL', netAttempt: 5 });
    expect(resumed.effects).toEqual([
      { type: 'scrollTop' },
      { type: 'startHost', code: 'LRZL', attempt: 5, resume: true },
    ]);
    const fresh = run(resumed.app, { type: 'host/start', code: null });
    expect(fresh.app.code).not.toBe('LRZL');
    expect(fresh.effects.at(-1)).toMatchObject({ type: 'startHost', attempt: 6, resume: false });
  });

  test('host/status writes the wait status; stopPulse sticks', () => {
    const a = run(initialApp, { type: 'host/status', text: WAITING_MSG, stopPulse: false }).app;
    expect(a.hostStatus).toEqual({ text: WAITING_MSG, pulse: true });
    const b = run(a, { type: 'host/status', text: 'boom', stopPulse: true }).app;
    expect(b.hostStatus).toEqual({ text: 'boom', pulse: false });
    expect(run(b, { type: 'host/status', text: 'again', stopPulse: false }).app.hostStatus).toEqual(
      {
        text: 'again',
        pulse: false,
      },
    );
  });

  test('a join in the lobby: the guest is named (normalised against the host), the lobby frame goes out', () => {
    const started = run(initialApp, { type: 'host/click', name: 'Ann', target: '50' }).app;
    const { app, effects } = run(started, {
      type: 'host/frame',
      frame: { t: 'join', name: ' ann ' },
    });
    expect(app).toMatchObject({
      oppConnected: true,
      oppName: 'ann 2',
      startGameVisible: true,
      hostStatus: { text: joinedMsg('ann 2'), pulse: true },
    });
    expect(effects).toEqual([{ type: 'send', frame: { t: 'lobby', hostName: 'Ann', target: 50 } }]);
    expect(run(started, { type: 'host/frame', frame: { t: 'join', name: '' } }).app.oppName).toBe(
      'Jeff',
    );
  });

  test('an action frame before the deal is ignored', () => {
    const app = lobby();
    expect(
      run(app, { type: 'host/frame', frame: { t: 'action', action: { type: 'drawStock' } } }),
    ).toEqual({ app, effects: [] });
  });

  test('host/deal: refused without a guest; else a game, both views, the state frame, a save, the table', () => {
    const alone = run(initialApp, { type: 'host/click', name: 'Ann', target: '100' }).app;
    expect(run(alone, { type: 'host/deal' })).toEqual({
      app: alone,
      effects: [{ type: 'toast', message: WAITING_FOR_GUEST_MSG, ms: null }],
    });
    const { app, effects } = run(lobby(), { type: 'host/deal' });
    const game = app.game;
    if (game === null) throw new Error('no game');
    expect(game.players).toEqual([
      { id: 'host', name: 'Ann', total: 0 },
      { id: 'guest', name: 'Jeff', total: 0 },
    ]);
    expect(game.startedAt).toBe(NOW);
    expect(app.view).toEqual(viewFor(game, 0));
    expect(app).toMatchObject({
      screen: 'tableScreen',
      selectedCard: null,
      resultDismissed: false,
    });
    // The first render chimes "your turn" when the host moves first.
    expect(kinds(effects)).toEqual(
      game.turn === 0 ? ['send', 'persist', 'fx', 'scrollTop'] : ['send', 'persist', 'scrollTop'],
    );
    expect(effects[0]).toEqual({ type: 'send', frame: { t: 'state', view: viewFor(game, 1) } });
    if (game.turn === 0) expect(effects[2]).toEqual({ type: 'fx', cue: 'yourTurn' });
  });

  test("the guest's actions are applied for seat 1 and broadcast; a refusal goes back as a toast frame", () => {
    const app = hosting();
    // Seat 0 must discard, so a guest draw is out of turn.
    const refused = run(app, {
      type: 'host/frame',
      frame: { t: 'action', action: { type: 'drawStock' } },
    });
    expect(refused.app).toBe(app);
    expect(refused.effects).toEqual([
      { type: 'send', frame: { t: 'toast', msg: "It's not your turn." } },
    ]);
    // The host discards, then the guest draws.
    const card = drawn.hands[0][0]?.id ?? '';
    const afterHost = run(app, { type: 'act', action: { type: 'discard', cardId: card } });
    expect(kinds(afterHost.effects)).toEqual(['fx', 'send', 'persist', 'scrollTop']);
    expect(afterHost.app.game?.turn).toBe(1);
    const afterGuest = run(afterHost.app, {
      type: 'host/frame',
      frame: { t: 'action', action: { type: 'drawStock' } },
    });
    expect(afterGuest.app.game?.phase).toBe('discard');
    expect(afterGuest.effects[0]).toEqual({
      type: 'send',
      frame: { t: 'state', view: viewFor(afterGuest.app.game ?? drawn, 1) },
    });
    // The guest drew from the stock: the host hears the pickup.
    expect(kinds(afterGuest.effects)).toEqual(['send', 'persist', 'fx', 'scrollTop']);
    expect(afterGuest.effects[2]).toEqual({ type: 'fx', cue: 'oppStock' });
    expect(afterGuest.app.view).toEqual(viewFor(afterGuest.app.game ?? drawn, 0));
  });

  test("the host's own refused move is toasted", () => {
    const { app, effects } = run(hosting(), { type: 'act', action: { type: 'drawStock' } });
    expect(app.game).toBe(drawn);
    expect(effects).toEqual([
      { type: 'fx', cue: 'tap' },
      { type: 'toast', message: 'Discard a card, knock, or undo your draw.', ms: null },
    ]);
  });

  test('a rejoin mid-hand renames seat 1 and broadcasts', () => {
    const gone = { ...hosting(), oppConnected: false };
    const { app, effects } = run(gone, {
      type: 'host/frame',
      frame: { t: 'join', name: 'Jeffrey' },
    });
    expect(app.oppConnected).toBe(true);
    expect(app.oppName).toBe('Jeffrey');
    expect(app.game?.players[1]).toEqual({ id: 'guest', name: 'Jeffrey', total: 0 });
    expect(kinds(effects)).toEqual(['send', 'persist', 'scrollTop']);
  });

  test('the guest going: mid-hand a toast with the code; in the lobby the status and no deal button', () => {
    const midHand = run(hosting(), { type: 'host/guestGone', iceFailed: null });
    expect(midHand.app.oppConnected).toBe(false);
    expect(toasts(midHand.effects)).toEqual([
      [guestGoneMsg('Jeff', midHand.app.code), GONE_TOAST_MS],
    ]);
    expect(guestGoneMsg(null, 'ABCD')).toBe(
      'Opponent disconnected — they can rejoin with code ABCD.',
    );
    const inLobby = run(lobby(), { type: 'host/guestGone', iceFailed: null });
    expect(inLobby.app).toMatchObject({
      oppConnected: false,
      startGameVisible: false,
      hostStatus: { text: OPPONENT_LEFT_MSG },
    });
    expect(inLobby.effects).toEqual([]);
    // Game over: nothing said.
    const over = { ...hosting(), view: { ...viewFor(drawn, 0), phase: 'gameOver' as const } };
    expect(run(over, { type: 'host/guestGone', iceFailed: null }).effects).toEqual([]);
    // ICE failed before anyone joined: the status carries the explanation.
    const ice = run(lobby(), { type: 'host/guestGone', iceFailed: 'no route' });
    expect(ice.app.hostStatus.text).toBe('no route');
    expect(ice.app.startGameVisible).toBe(true);
  });
});

describe('joining', () => {
  test('join/click: a 4-letter code (else the toast), the name rules, the wait screen, the session', () => {
    const bad = run(initialApp, { type: 'join/click', name: 'Zoë', code: 'AB' });
    expect(bad.app).toBe(initialApp);
    expect(toasts(bad.effects)).toEqual([['Enter the 4-letter room code.', null]]);
    const { app, effects } = run(initialApp, { type: 'join/click', name: 'Zoë', code: ' kqzm ' });
    expect(app).toMatchObject({
      role: 'guest',
      code: 'KQZM',
      myName: 'Zoë',
      netAttempt: 1,
      screen: 'guestWaitScreen',
      guestStatus: { text: connectingMsg('KQZM'), pulse: true },
    });
    expect(effects).toEqual([
      { type: 'scrollTop' },
      { type: 'startGuest', code: 'KQZM', attempt: 1 },
    ]);
    // The untouched default "Ari" joins as Jeff; a touched "Ari" keeps it; empty is Jeff.
    expect(run(initialApp, { type: 'join/click', name: 'Ari', code: 'KQZM' }).app.myName).toBe(
      'Jeff',
    );
    expect(
      run({ ...initialApp, nameTouched: true }, { type: 'join/click', name: 'Ari', code: 'KQZM' })
        .app.myName,
    ).toBe('Ari');
    expect(run(initialApp, { type: 'join/click', name: '  ', code: 'KQZM' }).app.myName).toBe(
      'Jeff',
    );
  });

  const joined = (): App =>
    run(
      initialApp,
      { type: 'join/click', name: 'Jeff', code: 'KQZM' },
      { type: 'guest/connected' },
      { type: 'guest/status', text: CONNECTED_MSG, stopPulse: false },
    ).app;

  test('the host frames: welcome/lobby name the room, full says so, toast toasts, state renders the table', () => {
    const app = joined();
    expect(app.oppConnected).toBe(true);
    const welcomed = run(app, {
      type: 'guest/frame',
      frame: { t: 'welcome', hostName: 'Ann', target: 75 },
    });
    expect(welcomed.app).toMatchObject({
      oppName: 'Ann',
      target: 75,
      guestStatus: { text: hostRoomMsg('Ann', 75), pulse: true },
    });
    expect(welcomed.effects).toEqual([]);
    expect(
      run(app, { type: 'guest/frame', frame: { t: 'lobby', hostName: 'Bo', target: 5 } }).app
        .guestStatus.text,
    ).toBe("Connected to Bo's room (playing to 5). Waiting for the host to start…");
    expect(run(app, { type: 'guest/frame', frame: { t: 'full' } }).app.guestStatus.text).toBe(
      ROOM_FULL_MSG,
    );
    expect(run(app, { type: 'guest/frame', frame: { t: 'toast', msg: 'x' } }).effects).toEqual([
      { type: 'toast', message: 'x', ms: null },
    ]);
    const view = viewFor(drawn, 1);
    const shown = run(
      { ...app, oppConnected: false, selectedCard: 'AS', resultDismissed: true },
      { type: 'guest/frame', frame: { t: 'state', view } },
    );
    expect(shown.app).toMatchObject({
      view,
      oppConnected: true,
      selectedCard: null,
      resultDismissed: false,
      screen: 'tableScreen',
    });
    expect(shown.effects).toEqual([{ type: 'scrollTop' }]);
  });

  test("the opponent's pickup chimes on the guest's side: their draw phase, then their discard phase with a pile one shorter", () => {
    const bothPassed = play(dealt, [
      [0, { type: 'passUpcard' }],
      [1, { type: 'passUpcard' }],
    ]);
    const stock = run(
      { ...joined(), view: viewFor(bothPassed, 1) },
      { type: 'guest/frame', frame: { t: 'state', view: viewFor(drawn, 1) } },
    );
    expect(stock.effects).toEqual([{ type: 'fx', cue: 'oppStock' }, { type: 'scrollTop' }]);
    const tookUpcard = play(dealt, [[0, { type: 'takeUpcard' }]]);
    const discard = run(
      { ...joined(), view: viewFor(dealt, 1) },
      { type: 'guest/frame', frame: { t: 'state', view: viewFor(tookUpcard, 1) } },
    );
    expect(discard.effects).toEqual([{ type: 'fx', cue: 'oppDiscard' }, { type: 'scrollTop' }]);
  });

  test('acting sends the action frame while connected, else the not-connected toast', () => {
    const app = { ...joined(), view: viewFor(drawn, 1) };
    expect(run(app, { type: 'act', action: { type: 'ready' } }).effects).toEqual([
      { type: 'fx', cue: 'tap' },
      { type: 'send', frame: { t: 'action', action: { type: 'ready' } } },
    ]);
    expect(
      toasts(
        run({ ...app, oppConnected: false }, { type: 'act', action: { type: 'ready' } }).effects,
      ),
    ).toEqual([[NOT_CONNECTED_MSG, null]]);
    // No role at all (the hook's act on the home screen): the same toast.
    expect(toasts(run(initialApp, { type: 'act', action: { type: 'ready' } }).effects)).toEqual([
      [NOT_CONNECTED_MSG, null],
    ]);
  });

  test('losing the host: mid-game a re-render and a toast; otherwise the wait screen says so', () => {
    const inGame = run(
      { ...joined(), view: viewFor(drawn, 1), screen: 'tableScreen' },
      { type: 'guest/lost' },
    );
    expect(inGame.app.oppConnected).toBe(false);
    expect(inGame.app.screen).toBe('tableScreen');
    expect(inGame.effects).toEqual([
      { type: 'scrollTop' },
      { type: 'toast', message: LOST_HOST_MSG, ms: GONE_TOAST_MS },
    ]);
    const waiting = run(joined(), { type: 'guest/lost' });
    expect(waiting.app).toMatchObject({
      oppConnected: false,
      screen: 'guestWaitScreen',
      guestStatus: { text: DISCONNECTED_MSG },
    });
    expect(waiting.effects).toEqual([{ type: 'scrollTop' }]);
    const over = { ...joined(), view: { ...viewFor(drawn, 1), phase: 'gameOver' as const } };
    expect(run(over, { type: 'guest/lost' }).app.screen).toBe('guestWaitScreen');
  });

  test('guest/status writes the wait status', () => {
    const app = run(joined(), { type: 'guest/status', text: 'x', stopPulse: true }).app;
    expect(app.guestStatus).toEqual({ text: 'x', pulse: false });
  });
});

describe('pass and play', () => {
  test('local/click: names with defaults and the " 2" suffix, the target, the wake lock, the curtain', () => {
    const { app, effects } = run(initialApp, {
      type: 'local/click',
      p1: ' ann ',
      p2: 'ANN',
      target: '20',
    });
    const game = app.game;
    if (game === null) throw new Error('no game');
    expect(game.players.map((p) => p.name)).toEqual(['ann', 'ANN 2']);
    expect(game.target).toBe(20);
    expect(app).toMatchObject({
      role: 'local',
      code: null,
      oppConnected: true,
      revealed: null,
      resultDismissed: false,
      curtain: game.turn,
      selectedCard: null,
      screen: 'tableScreen',
    });
    expect(app.view).toEqual(viewFor(game, game.turn));
    // Initial: no "your turn" chime with the first curtain (one phone: the render never chimes turns).
    expect(kinds(effects)).toEqual(['wakeLock', 'persist', 'scrollTop']);
    expect(effects[0]).toEqual({ type: 'wakeLock', hold: true });
    const defaults = run(initialApp, { type: 'local/click', p1: '', p2: '', target: '' }).app;
    expect(defaults.game?.players.map((p) => p.name)).toEqual(['Player 1', 'Player 2']);
    expect(defaults.game?.target).toBe(100);
  });

  const local = (): App =>
    run(initialApp, { type: 'local/click', p1: 'Ann', p2: 'Bob', target: '100' }).app;

  test('the curtain reveal shows the mover and hides the curtain; a move hands the phone over', () => {
    const start = local();
    const revealed = run(start, { type: 'curtain/reveal' });
    expect(revealed.app).toMatchObject({ revealed: start.game?.turn, curtain: null });
    expect(kinds(revealed.effects)).toEqual(['fx', 'persist', 'scrollTop']);
    const passed = run(revealed.app, { type: 'act', action: { type: 'passUpcard' } });
    const game = passed.app.game;
    if (game === null) throw new Error('no game');
    expect(game.turn).not.toBe(start.game?.turn);
    // The phone must change hands: the curtain is up for the new mover and chimes.
    expect(passed.app.curtain).toBe(game.turn);
    expect(passed.app.view).toEqual(viewFor(game, game.turn));
    expect(kinds(passed.effects)).toEqual(['fx', 'persist', 'fx', 'scrollTop']);
    expect(passed.effects[2]).toEqual({ type: 'fx', cue: 'yourTurn' });
    // A refused move is toasted and changes nothing (a refused draw passes through the ghost
    // slot's waiting stage and back, so the record is equal rather than the same object).
    const refused = run(passed.app, { type: 'act', action: { type: 'drawStock' } });
    expect(refused.app).toEqual(passed.app);
    expect(toasts(refused.effects)).toEqual([['Take the upcard or pass.', null]]);
    // Reveal with no game is a no-op.
    expect(run(initialApp, { type: 'curtain/reveal' })).toEqual({ app: initialApp, effects: [] });
  });

  test('ready is applied for both seats at once; refused for both, the first refusal is toasted', () => {
    const start = local();
    const notOver = run(start, { type: 'act', action: { type: 'ready' } });
    expect(notOver.app).toBe(start);
    // Both seats are refused; seat 0's refusal is the one toasted (`r1.error`).
    const r1 = applyAction(start.game ?? dealt, 0, { type: 'ready' }, mulberry32(0), () => NOW);
    expect(r1.ok).toBe(false);
    expect(toasts(notOver.effects)).toEqual([[r1.ok ? '' : r1.error, null]]);
  });
});

describe('the table', () => {
  const myTurn = (): App => ({
    ...run(initialApp, { type: 'host/click', name: 'Ann', target: '100' }).app,
    game: drawn,
    view: viewFor(drawn, 0),
    oppConnected: true,
    oppName: 'Jeff',
  });

  test('card/tap selects and deselects during my discard, refuses the locked card, ignores otherwise', () => {
    const app = myTurn();
    const card = drawn.hands[0][1]?.id ?? '';
    const selected = run(app, { type: 'card/tap', cardId: card });
    expect(selected.app.selectedCard).toBe(card);
    expect(selected.effects).toEqual([{ type: 'fx', cue: 'tap' }, { type: 'scrollTop' }]);
    expect(run(selected.app, { type: 'card/tap', cardId: card }).app.selectedCard).toBeNull();
    // Not my turn / not discarding: nothing.
    expect(run({ ...app, view: viewFor(drawn, 1) }, { type: 'card/tap', cardId: card })).toEqual({
      app: { ...app, view: viewFor(drawn, 1) },
      effects: [],
    });
    expect(run(initialApp, { type: 'card/tap', cardId: card }).effects).toEqual([]);
    // The card just taken from the discard pile cannot be discarded.
    const took = play(dealt, [[0, { type: 'takeUpcard' }]]);
    const locked = took.drawnFromDiscard ?? '';
    const refused = run(
      { ...app, game: took, view: viewFor(took, 0) },
      { type: 'card/tap', cardId: locked },
    );
    expect(toasts(refused.effects)).toEqual([[LOCKED_CARD_MSG, null]]);
  });

  test('stock/tap and discard/tap act only in the right phase; the forced stock is explained', () => {
    const app = myTurn();
    expect(run(app, { type: 'stock/tap' }).effects).toEqual([]); // discard phase
    const draw = play(dealt, [
      [0, { type: 'passUpcard' }],
      [1, { type: 'passUpcard' }],
    ]);
    const drawing = { ...app, game: draw, view: viewFor(draw, 0) };
    expect(kinds(run(drawing, { type: 'stock/tap' }).effects)).toEqual([
      'fx',
      'send',
      'persist',
      'scrollTop',
    ]);
    // Both passed: the discard pile is blocked.
    expect(toasts(run(drawing, { type: 'discard/tap' }).effects)).toEqual([
      [FORCE_STOCK_MSG, null],
    ]);
    const upcard = { ...app, game: dealt, view: viewFor(dealt, 0) };
    const took = run(upcard, { type: 'discard/tap' });
    expect(took.app.game?.drawnFromDiscard).not.toBeNull();
    const notMine = { ...app, view: viewFor(drawn, 1) };
    expect(run(notMine, { type: 'discard/tap' }).effects).toEqual([]);
    expect(run(app, { type: 'discard/tap' }).effects).toEqual([]); // discard phase
    const oneDraw = play(dealt, [
      [0, { type: 'takeUpcard' }],
      [0, { type: 'discard', cardId: dealt.hands[0][0]?.id ?? '' }],
    ]);
    const canDrawDiscard = { ...app, game: oneDraw, view: viewFor(oneDraw, 0) };
    // Seat 1's turn now: no.
    expect(run(canDrawDiscard, { type: 'discard/tap' }).effects).toEqual([]);
  });

  test('the action buttons: pass/take act, discard/knock need a selection, showResult reopens the sheet', () => {
    const app = myTurn();
    expect(run(app, { type: 'action/click', act: 'discard' }).effects).toEqual([]);
    const card = drawn.hands[0][0]?.id ?? '';
    const discarded = run({ ...app, selectedCard: card }, { type: 'action/click', act: 'discard' });
    expect(discarded.app.game?.turn).toBe(1);
    const knocked = run({ ...app, selectedCard: card }, { type: 'action/click', act: 'knock' });
    const option = viewFor(drawn, 0).discardOptions?.[card];
    const canKnock = option !== undefined && !('locked' in option) && option.canKnock;
    expect(kinds(knocked.effects)).toEqual(
      canKnock ? ['fx', 'send', 'persist', 'fx', 'scrollTop'] : ['fx', 'toast'],
    );
    const upcard = { ...app, game: dealt, view: viewFor(dealt, 0) };
    expect(run(upcard, { type: 'action/click', act: 'passUpcard' }).app.game?.upcardStage).toBe(
      'dealer',
    );
    expect(run(upcard, { type: 'action/click', act: 'takeUpcard' }).app.game?.phase).toBe(
      'discard',
    );
    const dismissed = { ...app, resultDismissed: true };
    expect(run(dismissed, { type: 'action/click', act: 'showResult' }).app.resultDismissed).toBe(
      false,
    );
    expect(run(app, { type: 'result/hide' }).app.resultDismissed).toBe(true);
    expect(run(app, { type: 'action/click', act: 'bogus' })).toEqual({ app, effects: [] });
  });

  test('the meld chooser opens only with alternatives, closes, and chooses by index', () => {
    const app = myTurn();
    if (viewFor(drawn, 0).meldOptions.length > 1) throw new Error('pick another seed');
    expect(run(app, { type: 'meld/open' })).toEqual({ app, effects: [] });
    const two = {
      ...app,
      view: {
        ...viewFor(drawn, 0),
        meldOptions: [
          {
            melds: [[drawn.hands[0][0] ?? { id: 'AS', r: 1, s: 'S' }]],
            deadwood: [],
            value: 0,
            sig: 'a',
          },
          { melds: [], deadwood: [], value: 0, sig: 'b' },
        ],
      },
    };
    const opened = run(two, { type: 'meld/open' });
    expect(opened.app.meldChooser).toBe(true);
    expect(opened.effects).toEqual([{ type: 'fx', cue: 'tap' }]);
    expect(run(opened.app, { type: 'meld/close' }).app.meldChooser).toBe(false);
    const chosen = run(opened.app, { type: 'meld/choose', index: 0 });
    expect(chosen.app.meldChooser).toBe(false);
    // The arrangement is a setMelds action through the host's dispatch (refused here: unfit).
    expect(chosen.effects[0]).toEqual({ type: 'fx', cue: 'tap' });
    expect(kinds(chosen.effects)).toEqual(['fx', 'toast']);
    expect(run(opened.app, { type: 'meld/choose', index: 5 })).toEqual({
      app: opened.app,
      effects: [],
    });
  });

  test('render re-runs the render step: the table, the cue machine, a stale selection dropped', () => {
    const app = { ...myTurn(), screen: 'homeScreen' as const, selectedCard: 'ZZ' };
    const { app: after, effects } = run(app, { type: 'render' });
    expect(after.screen).toBe('tableScreen');
    expect(after.selectedCard).toBeNull();
    expect(kinds(effects)).toEqual(['scrollTop']);
    expect(run(initialApp, { type: 'render' })).toEqual({ app: initialApp, effects: [] });
    const over = {
      ...app,
      view: { ...viewFor(drawn, 0), phase: 'gameOver' as const, winner: 0 as const },
    };
    expect(run(over, { type: 'render' }).app.screen).toBe('endgameScreen');
  });
});

describe('the ghost draw slot', () => {
  /** Pass-and-play, seat 0 revealed and moving. */
  const local = (game: State): App => ({
    ...initialApp,
    role: 'local',
    oppConnected: true,
    game,
    view: viewFor(game, 0),
    screen: 'tableScreen',
    revealed: 0,
  });
  const passed = play(dealt, [
    [0, { type: 'passUpcard' }],
    [1, { type: 'passUpcard' }],
  ]);
  /** The picture before the draw: the engine's melding of the ten. */
  const preDraw = engineOf(viewFor(passed, 0), null);
  /** Ann passed, Jeff took the upcard and discarded: Ann's open draw, both piles tappable. */
  const openDraw = play(dealt, [
    [0, { type: 'passUpcard' }],
    [1, { type: 'takeUpcard' }],
    [1, { type: 'discard', cardId: dealt.hands[1][0]?.id ?? '' }],
  ]);

  test('a stock draw shows the drawn card over the ten cards held as they were before the draw', () => {
    const { app, effects } = run(local(passed), { type: 'stock/tap' });
    const view = app.view;
    expect(view?.phase).toBe('discard');
    expect(app.draw).toEqual({ kind: 'shown', from: 'stock', cardId: view?.lastDrawnId });
    // The picture is the one before the draw, not the re-melded eleven (picture.ts rule b).
    expect(app.picture).toEqual(preDraw);
    if (view === null) throw new Error('no view');
    expect(app.picture).not.toEqual(engineOf(view, null));
    expect(app.selectedCard).toBeNull();
    expect(kinds(effects)).toEqual(['fx', 'persist', 'scrollTop']);
  });

  test('taking the upcard shows it from the discard pile (the locked card)', () => {
    const tapped = run(local(dealt), { type: 'discard/tap' }).app;
    expect(tapped.draw).toEqual({
      kind: 'shown',
      from: 'discard',
      cardId: tapped.game?.drawnFromDiscard,
    });
    expect(tapped.picture).toEqual(engineOf(viewFor(dealt, 0), null));
    const button = run(local(dealt), { type: 'action/click', act: 'takeUpcard' }).app;
    expect(button.draw).toEqual(tapped.draw);
    const drawPile = run(
      local(
        play(dealt, [
          [0, { type: 'takeUpcard' }],
          [0, { type: 'discard', cardId: dealt.hands[0][0]?.id ?? '' }],
        ]),
      ),
      { type: 'render' },
    ).app;
    // Seat 1 draws now; a view for seat 0 is not its turn, so no stage is set.
    expect(run(drawPile, { type: 'discard/tap' }).app.draw).toBeNull();
  });

  test('tapping the ghost card accepts it; tapping a held card accepts and selects that card', () => {
    const shown = run(local(passed), { type: 'stock/tap' }).app;
    const ghostId = shown.draw?.kind === 'shown' ? shown.draw.cardId : '';
    const accepted = run(shown, { type: 'card/tap', cardId: ghostId });
    expect(accepted.app.draw).toBeNull();
    expect(accepted.app.selectedCard).toBeNull();
    expect(accepted.app.view).toBe(shown.view);
    expect(accepted.effects).toEqual([{ type: 'fx', cue: 'tap' }, { type: 'scrollTop' }]);
    const held = shown.view?.me.hand.find((c) => c.id !== ghostId)?.id ?? '';
    const selected = run(shown, { type: 'card/tap', cardId: held });
    expect(selected.app.draw).toBeNull();
    expect(selected.app.selectedCard).toBe(held);
    expect(selected.effects).toEqual([{ type: 'fx', cue: 'tap' }, { type: 'scrollTop' }]);
    // Accepted: today's toggle, no stage comes back.
    const toggled = run(selected.app, { type: 'card/tap', cardId: held });
    expect(toggled.app.selectedCard).toBeNull();
    expect(toggled.app.draw).toBeNull();
  });

  test('a re-render while shown keeps the stage (the meld chooser re-broadcasts the same view)', () => {
    const shown = run(local(passed), { type: 'stock/tap' }).app;
    expect(run(shown, { type: 'render' }).app.draw).toBe(shown.draw);
    expect(run(shown, { type: 'visible' }).app.draw).toBe(shown.draw);
    expect(run(shown, { type: 'meld/open' }).app.draw).toBe(shown.draw);
  });

  test('a stock draw is final: no ↩, and `undoDraw` through act toasts with the shown stage kept', () => {
    const shown = run(local(passed), { type: 'stock/tap' }).app;
    expect(shown.view?.canUndo).toBe(false);
    expect(shown.draw?.kind).toBe('shown');
    const refused = run(shown, { type: 'action/click', act: 'undoDraw' });
    expect(refused.app.draw).toBe(shown.draw);
    expect(refused.app.view).toBe(shown.view);
    expect(refused.app.game).toBe(shown.game);
    expect(kinds(refused.effects)).toEqual(['fx', 'toast']);
    expect(toasts(refused.effects)).toEqual([[STOCK_DRAW_FINAL_MSG, null]]);
  });

  test('the undo button undoes a discard-pile draw through act: the view is back in the draw phase, no stage', () => {
    const shown = run(local(openDraw), { type: 'discard/tap' }).app;
    expect(shown.draw).toMatchObject({ kind: 'shown', from: 'discard' });
    expect(shown.view?.canUndo).toBe(true);
    const undone = run(shown, { type: 'action/click', act: 'undoDraw' });
    expect(undone.app.view?.phase).toBe('draw');
    expect(undone.app.view?.canUndo).toBe(false);
    expect(undone.app.draw).toBeNull();
    expect(kinds(undone.effects)).toEqual(['fx', 'persist', 'scrollTop']);
    // The upcard path undoes back to the upcard decision.
    const took = run(local(dealt), { type: 'discard/tap' }).app;
    const back = run(took, { type: 'action/click', act: 'undoDraw' }).app;
    expect(back.view?.phase).toBe('upcard');
    expect(back.draw).toBeNull();
  });

  test('a refused draw clears the stage and toasts: pass-and-play, the host, a disconnected guest', () => {
    // Both passed: the engine refuses the discard pile (the reducer's own guard is bypassed by act).
    const refused = run(local(passed), { type: 'act', action: { type: 'drawDiscard' } });
    expect(refused.app.draw).toBeNull();
    expect(kinds(refused.effects)).toEqual(['fx', 'toast']);
    const host = { ...hosting(), game: passed, view: viewFor(passed, 0) };
    const hostRefused = run(host, { type: 'act', action: { type: 'drawDiscard' } });
    expect(hostRefused.app.draw).toBeNull();
    expect(kinds(hostRefused.effects)).toEqual(['fx', 'toast']);
    const guest: App = {
      ...run(initialApp, { type: 'join/click', name: 'Jeff', code: 'KQZM' }).app,
      view: viewFor(passed, 0),
    };
    const offline = run(guest, { type: 'stock/tap' });
    expect(offline.app.draw).toBeNull();
    expect(toasts(offline.effects)).toEqual([[NOT_CONNECTED_MSG, null]]);
    // A refusal that is not a draw (ready for both seats) clears nothing that was not there.
    expect(run(local(passed), { type: 'act', action: { type: 'ready' } }).app.draw).toBeNull();
  });

  test('a guest waits for the state frame: pending through a re-render, shown on the frame, cleared by a toast', () => {
    const guest: App = {
      ...run(
        initialApp,
        { type: 'join/click', name: 'Jeff', code: 'KQZM' },
        { type: 'guest/connected' },
      ).app,
      view: viewFor(passed, 0),
      screen: 'tableScreen',
    };
    const waiting = run(guest, { type: 'stock/tap' });
    expect(waiting.app.draw).toEqual({ kind: 'waiting', from: 'stock' });
    expect(waiting.effects).toEqual([
      { type: 'fx', cue: 'tap' },
      { type: 'send', frame: { t: 'action', action: { type: 'drawStock' } } },
    ]);
    const rerendered = run(waiting.app, { type: 'render' }, { type: 'visible' }).app;
    expect(rerendered.draw).toEqual(waiting.app.draw);
    const view = viewFor(drawn, 0);
    const shown = run(rerendered, { type: 'guest/frame', frame: { t: 'state', view } }).app;
    expect(shown.draw).toEqual({ kind: 'shown', from: 'stock', cardId: view.lastDrawnId });
    // The guest's picture is the one it painted before the draw, kept through the state frame.
    expect(shown.picture).toEqual(preDraw);
    const refused = run(waiting.app, { type: 'guest/frame', frame: { t: 'toast', msg: 'no' } });
    expect(refused.app.draw).toBeNull();
    expect(toasts(refused.effects)).toEqual([['no', null]]);
    // The host's own view never carries the guest's stage: a state frame for the other seat clears it.
    const theirs = run(waiting.app, {
      type: 'guest/frame',
      frame: { t: 'state', view: viewFor(drawn, 1) },
    }).app;
    expect(theirs.draw).toBeNull();
    // Losing the host mid-wait clears the stage.
    expect(run(waiting.app, { type: 'guest/lost' }).app.draw).toBeNull();
  });

  test('a guest tapping again mid-wait sends nothing: one draw on the wire, the stage kept, no refusal', () => {
    const guest: App = {
      ...run(
        initialApp,
        { type: 'join/click', name: 'Jeff', code: 'KQZM' },
        { type: 'guest/connected' },
      ).app,
      view: viewFor(passed, 0),
      screen: 'tableScreen',
    };
    const twice = run(guest, { type: 'stock/tap' }, { type: 'stock/tap' });
    expect(twice.app.draw).toEqual({ kind: 'waiting', from: 'stock' });
    expect(twice.effects).toEqual([
      { type: 'fx', cue: 'tap' },
      { type: 'send', frame: { t: 'action', action: { type: 'drawStock' } } },
    ]);
    // Nor does the Take button or a direct draw action get through (the discard pile here is
    // forced-stock: its toast fires before `act`, and keeps the stage).
    (
      [
        { type: 'action/click', act: 'takeUpcard' },
        { type: 'act', action: { type: 'drawDiscard' } },
      ] as const
    ).forEach((intent) => {
      const again = run(twice.app, intent);
      expect(again.app).toBe(twice.app);
      expect(again.effects).toEqual([]);
    });
    expect(run(twice.app, { type: 'discard/tap' }).app.draw).toEqual(twice.app.draw);
    // The upcard path: two pile taps, one `takeUpcard` on the wire.
    const upcardTwice = run(
      { ...guest, view: viewFor(dealt, 0) },
      { type: 'discard/tap' },
      { type: 'discard/tap' },
    );
    expect(upcardTwice.app.draw?.kind).toBe('waiting');
    expect(upcardTwice.effects.filter((e) => e.type === 'send')).toEqual([
      { type: 'send', frame: { t: 'action', action: { type: 'takeUpcard' } } },
    ]);
    // The host, having seen one draw, answers with one state frame: the card shows, and no
    // refusal toast follows to clear it.
    const view = viewFor(drawn, 0);
    const shown = run(twice.app, { type: 'guest/frame', frame: { t: 'state', view } }).app;
    expect(shown.draw).toEqual({ kind: 'shown', from: 'stock', cardId: view.lastDrawnId });
    // Undo is not a draw: it is never swallowed by the wait (the upcard path, which undoes).
    expect(
      kinds(run(upcardTwice.app, { type: 'action/click', act: 'undoDraw' }).effects),
    ).toContain('send');
  });

  test('a new game, a new deal and leaving clear the stage; the save never carries it', () => {
    const shown = run(local(passed), { type: 'stock/tap' }).app;
    expect(run(shown, { type: 'local/click', p1: 'A', p2: 'B', target: '1' }).app.draw).toBeNull();
    expect(run(shown, { type: 'leave/finish' }).app.draw).toBeNull();
    const host = { ...lobby(), draw: shown.draw };
    expect(run(host, { type: 'host/deal' }).app.draw).toBeNull();
    expect(saveFor(shown)).toEqual({ role: 'local', game: shown.game });
    expect(saveFor(shown)).not.toHaveProperty('draw');
    expect(saveFor({ ...hosting(), draw: shown.draw })).not.toHaveProperty('draw');
  });
});

describe('leaving and cancelling', () => {
  test('leave asks first, by role; the network closes before the reset; then home', () => {
    const online = run(hosting(), { type: 'leave/request' });
    expect(online.effects).toEqual([
      { type: 'confirm', message: LEAVE_ONLINE_MSG, then: { type: 'leave/confirmed' } },
    ]);
    const local = run(run(initialApp, { type: 'local/click', p1: 'A', p2: 'B', target: '1' }).app, {
      type: 'leave/request',
    });
    expect(local.effects[0]).toMatchObject({ type: 'confirm', message: LEAVE_LOCAL_MSG });
    const midHand = hosting();
    const confirmed = run(midHand, { type: 'leave/confirmed' });
    expect(confirmed.app).toBe(midHand);
    expect(confirmed.effects).toEqual([
      { type: 'wakeLock', hold: false },
      { type: 'closeNet' },
      { type: 'then', intent: { type: 'leave/finish' } },
    ]);
    const finished = run(hosting(), { type: 'leave/finish' });
    expect(finished.app).toMatchObject({
      role: null,
      game: null,
      view: null,
      oppConnected: false,
      code: null,
      revealed: null,
      curtain: null,
      netAttempt: hosting().netAttempt + 1,
    });
    expect(finished.effects).toEqual([{ type: 'clearSave' }, { type: 'initHome' }]);
  });

  test('cancel destroys the Peer, then drops the role, bumps the ticket and goes home', () => {
    const waiting = run(initialApp, { type: 'host/click', name: 'Ann', target: '100' }).app;
    const cancelled = run(waiting, { type: 'cancel' });
    expect(cancelled.app).toBe(waiting);
    expect(cancelled.effects).toEqual([
      { type: 'closeNet' },
      { type: 'then', intent: { type: 'cancel/finish' } },
    ]);
    const finished = run(waiting, { type: 'cancel/finish' });
    expect(finished.app).toMatchObject({ role: null, netAttempt: 2, code: waiting.code });
    expect(finished.effects).toEqual([{ type: 'clearSave' }, { type: 'initHome' }]);
  });

  test('visible takes the wake lock again only in a game; persist persists', () => {
    expect(run(initialApp, { type: 'visible' }).effects).toEqual([]);
    expect(run(hosting(), { type: 'visible' }).effects).toEqual([{ type: 'wakeLock', hold: true }]);
    expect(run(hosting(), { type: 'persist' }).effects).toEqual([{ type: 'persist' }]);
  });
});

describe('resume', () => {
  const hostSave = {
    role: 'host',
    code: 'LRZL',
    myName: 'Ann',
    target: 75,
    game: drawn,
    oppName: 'Jeff',
  } as const;
  const scorer = {
    players: [
      { id: 'a', name: 'Ann' },
      { id: 'b', name: 'Bo' },
    ],
    target: 100,
    rounds: [],
    startedAt: 1,
  };

  test('resumeFor: the scorer first, then a live local or host game, then a guest room', () => {
    expect(resumeFor(null, null)).toBeNull();
    expect(resumeFor(hostSave, scorer)).toEqual({ kind: 'scorer', state: scorer });
    expect(resumeFor({ role: 'local', game: drawn }, null)).toEqual({ kind: 'local', game: drawn });
    const over = { ...drawn, phase: 'gameOver' as const };
    expect(resumeFor({ role: 'local', game: over }, null)).toBeNull();
    expect(resumeFor(hostSave, null)).toEqual({
      kind: 'host',
      code: 'LRZL',
      myName: 'Ann',
      target: 75,
      game: drawn,
      oppName: 'Jeff',
      handoff: false,
    });
    expect(resumeFor({ ...hostSave, handoff: true }, null)).toMatchObject({ handoff: true });
    expect(resumeFor({ ...hostSave, game: null }, null)).toBeNull();
    expect(resumeFor({ ...hostSave, game: over }, null)).toBeNull();
    expect(resumeFor({ role: 'guest', code: 'KQZM', myName: 'Jeff' }, null)).toEqual({
      kind: 'guest',
      code: 'KQZM',
      myName: 'Jeff',
    });
  });

  test('resumeLabel is the legacy button text', () => {
    expect(resumeLabel({ kind: 'scorer', state: scorer })).toBe('Resume scoring: Ann vs Bo');
    expect(resumeLabel({ kind: 'local', game: drawn })).toBe('Resume pass & play: Ann vs Jeff');
    expect(resumeLabel({ kind: 'host', ...hostSave, handoff: false })).toBe(
      'Resume hosting room LRZL',
    );
    expect(resumeLabel({ kind: 'host', ...hostSave, handoff: true })).toBe(
      'Continue online: Ann hosts, Jeff joins by invite',
    );
    expect(resumeLabel({ kind: 'guest', code: 'KQZM', myName: 'Jeff' })).toBe('Rejoin room KQZM');
  });

  test('resume/click: nothing to resume, the scorer, a local game, a hosted room, a guest room', () => {
    expect(run(initialApp, { type: 'resume/click' })).toEqual({ app: initialApp, effects: [] });
    const withScorer = run(initialApp, { type: 'home/init', home: { ...home, scorer } }).app;
    expect(run(withScorer, { type: 'resume/click' }).effects).toEqual([
      { type: 'scorer', call: 'resume' },
    ]);
    const local = run(
      initialApp,
      { type: 'home/init', home: { ...home, save: { role: 'local', game: drawn } } },
      { type: 'resume/click' },
    );
    expect(local.app).toMatchObject({ role: 'local', game: drawn, screen: 'tableScreen' });
    const host = run(
      initialApp,
      { type: 'home/init', home: { ...home, save: hostSave } },
      { type: 'resume/click' },
    );
    expect(host.app).toMatchObject({
      role: 'host',
      code: 'LRZL',
      myName: 'Ann',
      target: 75,
      game: drawn,
      oppName: 'Jeff',
      view: viewFor(drawn, 0),
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
    expect(guest.app).toMatchObject({ role: 'guest', code: 'KQZM', myName: 'Jo' });
    expect(guest.effects.at(-1)).toEqual({ type: 'startGuest', code: 'KQZM', attempt: 1 });
  });
});

describe('storage', () => {
  test('saveFor is the persist() literal per role, null at home', () => {
    expect(saveFor(initialApp)).toBeNull();
    const midHand = hosting();
    expect(saveFor(midHand)).toEqual({
      role: 'host',
      code: midHand.code,
      myName: 'Ann',
      target: 100,
      game: drawn,
      oppName: 'Jeff',
    });
    const guest = run(initialApp, { type: 'join/click', name: 'Jeff', code: 'KQZM' }).app;
    expect(saveFor(guest)).toEqual({ role: 'guest', code: 'KQZM', myName: 'Jeff' });
    const local = run(initialApp, { type: 'local/click', p1: 'A', p2: 'B', target: '1' }).app;
    expect(saveFor(local)).toEqual({ role: 'local', game: local.game });
    expect(saveFor({ ...local, game: null })).toBeNull();
  });

  test('readHome: the defaults when nothing is stored, the values when they are', () => {
    const storage = fakeStorage();
    const store = createStore(storage);
    expect(readHome(store)).toEqual(home);
    storage.setItem(STORAGE_KEYS.name, 'Ann');
    storage.setItem(STORAGE_KEYS.p2Name, 'Bob');
    storage.setItem(STORAGE_KEYS.homeTab, 'rules');
    storage.setItem(STORAGE_KEYS.playMode, 'local');
    storage.setItem(STORAGE_KEYS.save, '{"role":"guest","code":"KQZM","myName":"Jeff"}');
    storage.setItem(
      STORAGE_KEYS.scorerState,
      JSON.stringify({
        players: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        target: 5,
        rounds: [],
        startedAt: 1,
      }),
    );
    expect(readHome(store)).toEqual({
      name: 'Ann',
      p2Name: 'Bob',
      homeTab: 'rules',
      playMode: 'local',
      sort: 'melds',
      save: { role: 'guest', code: 'KQZM', myName: 'Jeff' },
      scorer: {
        players: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        target: 5,
        rounds: [],
        startedAt: 1,
      },
    });
    // Garbage reads as the defaults, as the legacy fell back.
    storage.setItem(STORAGE_KEYS.homeTab, 'settings');
    storage.setItem(STORAGE_KEYS.save, 'not json');
    storage.setItem(STORAGE_KEYS.p2Name, '');
    expect(readHome(store)).toMatchObject({ homeTab: 'play', save: null, p2Name: null });
  });
});

describe('the sessions read back', () => {
  test('hostContextOf and guestContextOf pick the fields the sessions read', () => {
    const app = hosting();
    expect(hostContextOf(app)).toEqual({
      attempt: 1,
      role: 'host',
      code: app.code,
      myName: 'Ann',
      target: 100,
      hasGame: true,
      handoff: false,
      oppName: 'Jeff',
      oppConnected: true,
    });
    expect(guestContextOf(app)).toEqual({
      attempt: 1,
      role: 'host',
      code: app.code,
      myName: 'Ann',
      oppConnected: true,
    });
  });
});

describe('runEffect', () => {
  const recorded = (): Readonly<{
    deps: EffectDeps;
    log: unknown[][];
    storage: ReturnType<typeof fakeStorage>;
    answer: { yes: boolean };
  }> => {
    const log: unknown[][] = [];
    const storage = fakeStorage();
    const answer = { yes: true };
    const note =
      (name: string) =>
      (...args: unknown[]): void => {
        log.push([name, ...args]);
      };
    const deps: EffectDeps = {
      store: createStore(storage),
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
      scorer: { resume: note('scorer.resume') },
      timers: { start: note('timers.start'), cancel: note('timers.cancel') },
      toggleSound: note('toggleSound'),
      share: note('share'),
      page: {
        fillName: note('page.fillName'),
        fillP2Name: note('page.fillP2Name'),
        setCode: note('page.setCode'),
      },
      dispatch: note('dispatch'),
    };
    return { deps, log, storage, answer };
  };

  test('storage effects write through storage.ts', () => {
    const { deps, storage } = recorded();
    const midHand = hosting();
    runEffect(midHand, { type: 'persist' }, deps);
    expect(storage.map.get(STORAGE_KEYS.save)).toBe(JSON.stringify(saveFor(midHand)));
    runEffect(initialApp, { type: 'persist' }, deps); // nothing to save: untouched
    expect(storage.map.has(STORAGE_KEYS.save)).toBe(true);
    runEffect(initialApp, { type: 'clearSave' }, deps);
    expect(storage.map.has(STORAGE_KEYS.save)).toBe(false);
    runEffect(initialApp, { type: 'saveLocal', game: drawn }, deps);
    expect(storage.map.get(STORAGE_KEYS.save)).toBe(JSON.stringify({ role: 'local', game: drawn }));
    runEffect(initialApp, { type: 'clearSave' }, deps);
    runEffect(initialApp, { type: 'rememberName', name: 'Ann' }, deps);
    runEffect(initialApp, { type: 'rememberP2Name', name: 'Bob' }, deps);
    runEffect(initialApp, { type: 'writeHomeTab', tab: 'score' }, deps);
    runEffect(initialApp, { type: 'writePlayMode', mode: 'local' }, deps);
    expect([...storage.map.entries()]).toEqual([
      [STORAGE_KEYS.name, 'Ann'],
      [STORAGE_KEYS.p2Name, 'Bob'],
      [STORAGE_KEYS.homeTab, 'score'],
      [STORAGE_KEYS.playMode, 'local'],
    ]);
    runEffect(initialApp, { type: 'rememberName', name: '' }, deps);
    expect(storage.map.has(STORAGE_KEYS.name)).toBe(false);
    expect(storage.map.get(STORAGE_KEYS.p2Name)).toBe('Bob');
    runEffect(initialApp, { type: 'rememberP2Name', name: '' }, deps);
    expect(storage.map.has(STORAGE_KEYS.p2Name)).toBe(false);
  });

  test('every other effect reaches its adapter; confirm dispatches only on yes; initHome re-reads storage', () => {
    const { deps, log, answer } = recorded();
    const effects: ReadonlyArray<Effect> = [
      { type: 'toast', message: 'hi', ms: 4000 },
      { type: 'send', frame: { t: 'full' } },
      { type: 'fx', cue: 'gin' },
      { type: 'wakeLock', hold: true },
      { type: 'startHost', code: 'ABCD', attempt: 2, resume: false },
      { type: 'startGuest', code: 'ABCD', attempt: 3 },
      { type: 'closeNet' },
      { type: 'confirm', message: 'sure?', then: { type: 'leave/confirmed' } },
      { type: 'then', intent: { type: 'cancel/finish' } },
      { type: 'scrollTop' },
      { type: 'scorer', call: 'resume' },
      { type: 'startTimer', id: 'longPress', ms: 450, then: { type: 'submenu/longPress' } },
      { type: 'cancelTimer', id: 'longPress' },
      { type: 'toggleSound' },
      { type: 'share', code: 'ABCD' },
      { type: 'fillName', name: 'Ann' },
      { type: 'fillP2Name', name: 'Bob' },
      { type: 'setCode', value: 'AB' },
      { type: 'initHome' },
    ];
    effects.forEach((e) => {
      runEffect(initialApp, e, deps);
    });
    expect(log).toEqual([
      ['toast', 'hi', 4000],
      ['send', { t: 'full' }],
      ['fx', 'gin'],
      ['wakeLock', true],
      ['startHost', 'ABCD', 2, false],
      ['startGuest', 'ABCD', 3],
      ['close'],
      ['confirm', 'sure?'],
      ['dispatch', { type: 'leave/confirmed' }],
      ['dispatch', { type: 'cancel/finish' }],
      ['scrollTop'],
      ['scorer.resume'],
      ['timers.start', 'longPress', 450, { type: 'submenu/longPress' }],
      ['timers.cancel', 'longPress'],
      ['toggleSound'],
      ['share', 'ABCD'],
      ['page.fillName', 'Ann'],
      ['page.fillP2Name', 'Bob'],
      ['page.setCode', 'AB'],
      ['dispatch', { type: 'home/init', home }],
    ]);
    answer.yes = false;
    log.length = 0;
    runEffect(
      initialApp,
      { type: 'confirm', message: 'sure?', then: { type: 'leave/confirmed' } },
      deps,
    );
    expect(log).toEqual([['confirm', 'sure?']]);
  });
});

describe('the remote handoff of a pass-and-play game', () => {
  const offered = (): App =>
    run(initialApp, { type: 'home/init', home: { ...home, save: { role: 'local', game: drawn } } })
      .app;

  test('handoffLabel names who hosts and who joins', () => {
    expect(handoffLabel(drawn)).toBe('Continue online: Ann hosts, Jeff joins by invite');
  });

  test('handoff/click does nothing without a pass-and-play offer', () => {
    expect(run(initialApp, { type: 'handoff/click' })).toEqual({ app: initialApp, effects: [] });
    const hostOffer = run(initialApp, {
      type: 'home/init',
      home: {
        ...home,
        save: {
          role: 'host',
          code: 'LRZL',
          myName: 'Ann',
          target: 75,
          game: drawn,
          oppName: 'Jeff',
        },
      },
    }).app;
    expect(run(hostOffer, { type: 'handoff/click' })).toEqual({ app: hostOffer, effects: [] });
  });

  test('handoff/click: seat 0 hosts the game as it stands under a fresh code; seat 1 is awaited', () => {
    const handed = run(offered(), { type: 'handoff/click' });
    expect(handed.app).toMatchObject({
      role: 'host',
      myName: 'Ann',
      target: 100,
      game: drawn,
      oppName: 'Jeff',
      oppConnected: false,
      view: viewFor(drawn, 0),
      handoff: true,
      screen: 'hostWaitScreen',
    });
    expect(handed.app.code).toMatch(/^[A-Z]{4}$/);
    expect(handed.effects.at(-1)).toEqual({
      type: 'startHost',
      code: handed.app.code,
      attempt: 1,
      resume: false,
    });
    expect(hostContextOf(handed.app)).toMatchObject({
      hasGame: true,
      handoff: true,
      oppName: 'Jeff',
    });
    expect(saveFor(handed.app)).toEqual({
      role: 'host',
      code: handed.app.code,
      myName: 'Ann',
      target: 100,
      game: drawn,
      oppName: 'Jeff',
      handoff: true,
    });
  });

  test('the saved handoff resumes as the offer after a reload: the same code, the invite wording, and cancel still gives the game back', () => {
    const handed = run(offered(), { type: 'handoff/click' }).app;
    const save = saveFor(handed);
    // Back on the home screen after a reload: the offer reads as the handoff, not a room to host.
    const reloaded = run(initialApp, { type: 'home/init', home: { ...home, save } });
    expect(reloaded.app.resume).toEqual({
      kind: 'host',
      code: handed.code,
      myName: 'Ann',
      target: 100,
      game: drawn,
      oppName: 'Jeff',
      handoff: true,
    });
    if (reloaded.app.resume === null) throw new Error('no offer');
    expect(resumeLabel(reloaded.app.resume)).toBe(
      'Continue online: Ann hosts, Jeff joins by invite',
    );
    // Resuming reopens the room under the code the invite already carries, still as a handoff.
    const resumed = run(reloaded.app, { type: 'resume/click' });
    expect(resumed.app).toMatchObject({
      role: 'host',
      code: handed.code,
      handoff: true,
      screen: 'hostWaitScreen',
    });
    expect(resumed.effects.at(-1)).toEqual({
      type: 'startHost',
      code: handed.code,
      attempt: 1,
      resume: true,
    });
    expect(hostContextOf(resumed.app).handoff).toBe(true);
    expect(saveFor(resumed.app)).toEqual(save);
    expect(run(resumed.app, { type: 'cancel/finish' }).effects).toEqual([
      { type: 'saveLocal', game: drawn },
      { type: 'initHome' },
    ]);
    // A host save without the mark is the ordinary room, as before.
    const plain = run(initialApp, {
      type: 'home/init',
      home: {
        ...home,
        save: {
          role: 'host',
          code: 'LRZL',
          myName: 'Ann',
          target: 100,
          game: drawn,
          oppName: 'Jeff',
        },
      },
    });
    expect(plain.app.resume).toMatchObject({ kind: 'host', handoff: false });
    if (plain.app.resume === null) throw new Error('no offer');
    expect(resumeLabel(plain.app.resume)).toBe('Resume hosting room LRZL');
    expect(run(plain.app, { type: 'resume/click' }).app.handoff).toBe(false);
  });

  test('a guest that drops before its join leaves the handoff waiting for the invite: no table, no toast', () => {
    const handed = run(offered(), { type: 'handoff/click' }).app;
    const code = handed.code ?? '';
    const gone = run(handed, { type: 'host/guestGone', iceFailed: null });
    expect(gone.app).toMatchObject({
      screen: 'hostWaitScreen',
      handoff: true,
      oppConnected: false,
      hostStatus: { text: handoffMsg(code, 'Jeff') },
    });
    expect(gone.effects).toEqual([]);
    // ICE failed before the channel opened: the session's text, still on the wait screen.
    const failed = run(handed, { type: 'host/guestGone', iceFailed: 'ICE failed' });
    expect(failed.app).toMatchObject({ screen: 'hostWaitScreen', handoff: true });
    expect(failed.app.hostStatus.text).toBe('ICE failed');
  });

  test('handoff/click from the pass-and-play table: the game in play goes online, its curtain and draw marks cleared', () => {
    const playing = run(offered(), { type: 'resume/click' }).app;
    expect(playing).toMatchObject({ role: 'local', game: drawn, screen: 'tableScreen' });
    expect(playing.curtain).not.toBeNull();
    const handed = run(
      { ...playing, selectedCard: drawn.hands[0][0]?.id ?? null },
      { type: 'handoff/click' },
    );
    expect(handed.app).toMatchObject({
      role: 'host',
      myName: 'Ann',
      oppName: 'Jeff',
      oppConnected: false,
      game: drawn,
      view: viewFor(drawn, 0),
      handoff: true,
      screen: 'hostWaitScreen',
      curtain: null,
      revealed: null,
      draw: null,
      selectedCard: null,
      meldChooser: false,
    });
    expect(handed.app.code).toMatch(/^[A-Z]{4}$/);
    expect(kinds(handed.effects)).toContain('startHost');
    // Not from an online table.
    const online = hosting();
    expect(run(online, { type: 'handoff/click' })).toEqual({ app: online, effects: [] });
  });

  test("the guest's join is a rejoin: the seat kept, the name refreshed, the hand broadcast; the handoff is over", () => {
    const handed = run(offered(), { type: 'handoff/click' }).app;
    const joined = run(handed, { type: 'host/frame', frame: { t: 'join', name: 'Bobby' } });
    expect(joined.app).toMatchObject({
      handoff: false,
      oppName: 'Bobby',
      oppConnected: true,
      screen: 'tableScreen',
    });
    expect(joined.app.game?.players[1].name).toBe('Bobby');
    expect(joined.app.game?.hands).toEqual(drawn.hands);
    expect(kinds(joined.effects)).toEqual(expect.arrayContaining(['send', 'persist']));
    expect(hostContextOf(joined.app).handoff).toBe(false);
  });

  test('cancelling the room before anyone joined gives the game back to pass-and-play', () => {
    const handed = run(offered(), { type: 'handoff/click' }).app;
    const finished = run(handed, { type: 'cancel/finish' });
    expect(finished.app).toMatchObject({ role: null, handoff: false, netAttempt: 2 });
    expect(finished.effects).toEqual([{ type: 'saveLocal', game: drawn }, { type: 'initHome' }]);
    // A room opened from the home screen is cleared with its save, as before.
    const fresh = run(initialApp, { type: 'host/click', name: 'Ann', target: '100' }).app;
    expect(run(fresh, { type: 'cancel/finish' }).effects).toEqual([
      { type: 'clearSave' },
      { type: 'initHome' },
    ]);
  });

  test('join/link: the invite code into the join form, the Play tab and online mode; nothing stored', () => {
    const linked = run(
      { ...initialApp, homeTab: 'rules', playMode: 'local' },
      { type: 'join/link', code: 'kqzm9' },
    );
    expect(linked.app).toMatchObject({
      codeDraft: 'KQZM',
      homeTab: 'play',
      playMode: 'online',
      nameTouched: false,
    });
    expect(linked.effects).toEqual([{ type: 'setCode', value: 'KQZM' }]);
  });
});

describe('the arrangement: the sheet, the sort modes and the long press', () => {
  const local = (game: State, seat: Seat = 0): App => ({
    ...initialApp,
    role: 'local',
    oppConnected: true,
    game,
    view: viewFor(game, seat),
    screen: 'tableScreen',
    revealed: seat,
  });
  const passed = play(dealt, [
    [0, { type: 'passUpcard' }],
    [1, { type: 'passUpcard' }],
  ]);
  /** The first seed whose drawn hand melds: the long-press tests need a meld to make. */
  const meldy = Array.from({ length: 40 }, (_, i) =>
    play(
      createGame({ players: PLAYERS, target: 100, dealer: 1 }, mulberry32(i), () => NOW),
      [
        [0, { type: 'passUpcard' }],
        [1, { type: 'passUpcard' }],
        [0, { type: 'drawStock' }],
      ],
    ),
  ).find((g) => viewFor(g, 0).me.melds.length > 0);
  if (meldy === undefined) throw new Error('no seed under forty deals a meld');
  const accepted = run(local(meldy), { type: 'render' }).app;
  const v = accepted.view;
  if (v === null) throw new Error('no view');

  test('the sheet opens in play without a draw stage and closes; never while the drawn card waits', () => {
    const open = run(accepted, { type: 'arrange/open' });
    expect(open.app.arrangeOpen).toBe(true);
    expect(kinds(open.effects)).toEqual(['fx']);
    expect(run(open.app, { type: 'arrange/close' }).app.arrangeOpen).toBe(false);
    const shown = run(local(passed), { type: 'stock/tap' }).app;
    expect(shown.draw?.kind).toBe('shown');
    expect(run(shown, { type: 'arrange/open' }).app).toBe(shown);
  });

  test('a sort mode is remembered, closes the sheet and re-arranges the picture at once', () => {
    const open = run(accepted, { type: 'arrange/open' }).app;
    const sorted = run(open, { type: 'hand/arrange', mode: 'suit' });
    expect(sorted.app.sort).toBe('suit');
    expect(sorted.app.arrangeOpen).toBe(false);
    expect(sorted.effects).toEqual(
      expect.arrayContaining([
        { type: 'writeSort', sort: 'suit' },
        { type: 'fx', cue: 'tap' },
      ]),
    );
    expect(sorted.app.picture).toEqual(arrangedOf(v, null, null, 'suit'));
    // Out of play the mode is still remembered, the picture untouched.
    const over = { ...accepted, view: { ...v, phase: 'roundOver' as const } };
    const later = run(over, { type: 'hand/arrange', mode: 'rank' });
    expect(later.app.sort).toBe('rank');
    expect(later.app.picture).toBe(over.picture);
    expect(kinds(later.effects)).toEqual(['writeSort']);
  });

  test('a press arms the timer without changing the App; a release cancels it', () => {
    const id = v.me.hand[0]?.id ?? '';
    const pressed = run(accepted, { type: 'card/press', cardId: id });
    expect(pressed.app).toBe(accepted);
    expect(pressed.effects).toEqual([
      {
        type: 'startTimer',
        id: 'cardPress',
        ms: LONG_PRESS_MS,
        then: { type: 'hand/mark', cardId: id },
      },
    ]);
    expect(run(accepted, { type: 'card/release' }).effects).toEqual([
      { type: 'cancelTimer', id: 'cardPress' },
    ]);
    const shown = run(local(passed), { type: 'stock/tap' }).app;
    expect(run(shown, { type: 'card/press', cardId: id }).effects).toEqual([]);
  });

  test('a long press makes the meld by hand, marks it and declares it when it scores as the solver; again dissolves it', () => {
    const meld = v.me.melds[0];
    if (meld === undefined) throw new Error('meldy melds nothing');
    const id = meld[0]?.id ?? '';
    const marked = run(accepted, { type: 'hand/mark', cardId: id });
    expect(marked.app.human?.groups).toEqual([meld.map((c) => c.id)]);
    expect(marked.app.picture?.human).toEqual(meld.map((c) => c.id));
    expect(marked.app.picture?.groups[0]).toEqual(meld);
    expect(marked.app.selectedCard).toBeNull();
    // The engine's own meld scores as the solver: declared, so the game's meldPref names it.
    expect(marked.app.game?.meldPref[0]?.[0]).toEqual(meld.map((c) => c.id));
    expect(kinds(marked.effects)).toContain('persist');
    const dissolved = run(marked.app, { type: 'hand/mark', cardId: id });
    expect(dissolved.app.human).toEqual({ hand: meldy.handNumber, groups: [] });
    expect(dissolved.app.picture?.human).toEqual([]);
  });

  test('a long press on a card that melds nothing toasts and changes nothing else', () => {
    const lone = v.me.deadwood.find(
      (c) =>
        !v.me.hand.some(
          (o) => o.id !== c.id && (o.r === c.r || (o.s === c.s && Math.abs(o.r - c.r) === 1)),
        ),
    );
    if (lone === undefined) return;
    const pressed = run(accepted, { type: 'hand/mark', cardId: lone.id });
    expect(pressed.app.human).toBeNull();
    expect(pressed.app.picture).toBe(accepted.picture);
    expect(toasts(pressed.effects)).toEqual([[NO_MELD_MSG, null]]);
  });

  test('a chooser pick becomes hand-made, so it outlives the engine dropping its declaration', () => {
    const options = v.meldOptions;
    if (options.length < 2) return;
    const picked = run(accepted, { type: 'meld/choose', index: 1 });
    expect(picked.app.human?.groups).toEqual(options[1]?.melds.map((m) => m.map((c) => c.id)));
    expect(picked.app.meldChooser).toBe(false);
  });

  test('a new deal and leaving drop the hand-made melds; the save never carries them', () => {
    const meld = v.me.melds[0];
    if (meld === undefined) throw new Error('meldy melds nothing');
    const marked = run(accepted, { type: 'hand/mark', cardId: meld[0]?.id ?? '' }).app;
    expect(marked.human).not.toBeNull();
    expect(run(marked, { type: 'leave/finish' }).app.human).toBeNull();
    expect(
      run(marked, { type: 'local/click', p1: 'A', p2: 'B', target: '1' }).app.human,
    ).toBeNull();
    expect(saveFor(marked)).not.toHaveProperty('human');
    expect(saveFor(marked)).not.toHaveProperty('picture');
  });
});

describe('the discarded-cards sheet', () => {
  const table: App = {
    ...initialApp,
    role: 'local',
    oppConnected: true,
    game: drawn,
    view: viewFor(drawn, 0),
    screen: 'tableScreen',
    revealed: 0,
  };

  test('opens with a tap cue when the view lists the discards, toggles the hand, closes', () => {
    const open = run(table, { type: 'discards/open' });
    expect(open.app.discardsOpen).toBe(true);
    expect(kinds(open.effects)).toEqual(['fx']);
    const toggled = run(open.app, { type: 'discards/toggleHand' }).app;
    expect(toggled.discardsWithHand).toBe(true);
    expect(run(toggled, { type: 'discards/toggleHand' }).app.discardsWithHand).toBe(false);
    const closed = run(toggled, { type: 'discards/close' }).app;
    expect(closed.discardsOpen).toBe(false);
    // The toggle is remembered for the next opening within the session.
    expect(closed.discardsWithHand).toBe(true);
  });

  test("a legacy host's view without discardIds keeps the sheet shut", () => {
    const legacy = Object.fromEntries(
      Object.entries(viewFor(drawn, 0)).filter(([k]) => k !== 'discardIds'),
    ) as View;
    const guest: App = { ...table, role: 'guest', game: null, view: legacy };
    expect(run(guest, { type: 'discards/open' }).app).toBe(guest);
  });
});
