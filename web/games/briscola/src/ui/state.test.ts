// The reducer alone (docs/design/briscola.md §5.4, §5.6 "Pure twins" and the reducer tests;
// backgammon's state.test.ts shape): every table intent once, the flows that matter (pass-and-play
// for two, three and four seats driven through a tap policy with a seeded rng, the settle beat's
// stages and timers, the curtain deferred to the beat, a hosted match against a fake guest frame
// stream, the resume snapshot, the event-driven cues), the effects as data, and `runEffect`
// against recorded adapters.
import { describe, expect, test } from 'vitest';

import { NOW, runIntents } from '../../../../../test/shared/engine-helpers.ts';
import { createStore, type StorageLike } from '../../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { newEvents } from '../../../../shared/lib/events.ts';
import { sequenceOf } from '../../../../shared/lib/sound/phrase.ts';
import { MESSAGES, actorOf, applyAction, createGame, viewFor } from '../engine/index.ts';
import type { GameEvent, State, TrickRecord, View } from '../engine/index.ts';
import {
  action as actionFrame,
  lobby,
  state as stateFrame,
  toast as toastFrame,
} from '../protocol.ts';
import { DEFAULT_CARD_PACK, STORAGE_KEYS } from '../storage.ts';
import { CUES } from './sound.ts';
import {
  DEFAULT_OPTS,
  DRAW_GAP_MS,
  DRAW_MS,
  EMPTY_SLOTS,
  FLY_MS,
  GONE_TOAST_MS,
  HOLD_MS,
  LEAVE_LOCAL_MSG,
  NOT_CONNECTED_MSG,
  SANDBOX_LOCAL_ONLY_MSG,
  SCREENS,
  SHELL_INTENT_TYPES,
  WAITING_FOR_GUEST_MSG,
  badPositionMsg,
  cueKey,
  cuesBetween,
  guestContextOf,
  handoffLabel,
  hostContextOf,
  hostLeftMsg,
  hostRoomMsg,
  initialApp,
  initialTable,
  continuedEvents,
  liveView,
  nextStage,
  phrasesBetween,
  playedBetween,
  readHome,
  reduce,
  resultOpen,
  resumeFor,
  resumeLabel,
  runEffect,
  saveFor,
  seatNames,
  seatPlayers,
  settleMs,
  settleSlots,
  trickResolvedBetween,
  waitingToDealMsg,
  type App,
  type Effect,
  type EffectDeps,
  type HomeSnapshot,
  type Raw,
  type Step,
} from './state.ts';

const ctx = { rng: mulberry32(7), now: () => NOW };

/** Dispatch intents in turn, collecting every effect. */
const run = runIntents(reduce, ctx);

const kinds = (effects: ReadonlyArray<Effect>): ReadonlyArray<string> => effects.map((e) => e.type);
const toasts = (effects: ReadonlyArray<Effect>): ReadonlyArray<unknown> =>
  effects.flatMap((e) => (e.type === 'toast' ? [[e.message, e.ms]] : []));
/** The shell's `phrases` effects (web/shared/ui/shell.ts): the events' phrases of one paint. */
type PhrasesEffect = Extract<Effect, Readonly<{ type: 'phrases' }>>;
const isPhrases = (e: Effect): e is PhrasesEffect => e.type === 'phrases';
const phrasesOf = (effects: ReadonlyArray<Effect>): ReadonlyArray<PhrasesEffect> =>
  effects.flatMap((e) => (isPhrases(e) ? [e] : []));
/** The cue ids an intent plays, in effect order: `fx` rows, and the steps of a `phrases` effect. */
const cues = (effects: ReadonlyArray<Effect>): ReadonlyArray<string> =>
  effects.flatMap((e) =>
    isPhrases(e)
      ? e.phrases.flatMap((p) => sequenceOf(p).steps.map((s) => s.cue))
      : e.type === 'fx'
        ? [e.cue]
        : [],
  );
const sends = (effects: ReadonlyArray<Effect>): ReadonlyArray<unknown> =>
  effects.flatMap((e) => (e.type === 'send' ? [e.frame] : []));
const timers = (effects: ReadonlyArray<Effect>): ReadonlyArray<unknown> =>
  effects.flatMap((e) => (e.type === 'startTimer' ? [[e.id, e.ms, e.then.type]] : []));

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
  soundFont: 'default',
  save: null,
  recentGames: [],
  opts: DEFAULT_OPTS,
  cardPack: DEFAULT_CARD_PACK,
  p3Name: null,
  p4Name: null,
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

/** A pass-and-play table, curtain up for the leader; `raw` picks the seats and the rules. */
const local = (raw: Raw = {}, snapshot: HomeSnapshot = home): App =>
  run(
    initialApp,
    { type: 'home/init', home: snapshot },
    { type: 'local/click', p1: 'Ann', p2: 'Bob', ...raw },
  ).app;

/** The curtain lifted for whoever must act. */
const revealed = (app: App): App => run(app, { type: 'curtain/reveal' }).app;

/** The tap policy: the first legal card lifted, then played (two taps). */
const playFirst = (app: App): Step => {
  const id = view(app).legal[0];
  if (id === undefined) throw new Error('nothing legal');
  return run(app, { type: 'card/tap', cardId: id }, { type: 'card/tap', cardId: id });
};

/** The settle beat run to its end (at most the three stages). */
const settled = (app: App): Step =>
  Array.from({ length: 3 }).reduce<Step>(
    (s) =>
      s.app.table.settle === null
        ? s
        : {
            app: run(s.app, { type: 'settle/elapsed' }).app,
            effects: [...s.effects, ...run(s.app, { type: 'settle/elapsed' }).effects],
          },
    { app, effects: [] },
  );

/** One step of a whole game: the curtain lifted, a trick settled, or the first legal card played. */
const advance = (app: App): App => {
  if (app.table.curtain !== null) return revealed(app);
  if (app.table.settle !== null) return run(app, { type: 'settle/elapsed' }).app;
  if (view(app).phase === 'over') return run(app, { type: 'next/click' }).app;
  return playFirst(app).app;
};
const STEP_CAP = 400;
/** Play until `stop` holds (or the cap), by `advance`. */
const playUntil = (start: App, stop: (app: App) => boolean): App =>
  Array.from({ length: STEP_CAP }).reduce<App>((app) => (stop(app) ? app : advance(app)), start);

describe('the initial app', () => {
  test('is the shell split from the table, on the home screen, online by default, the table empty', () => {
    expect(initialApp.shell).toMatchObject({
      role: null,
      code: null,
      myName: 'Ari',
      opts: DEFAULT_OPTS,
      game: null,
      view: null,
      screen: 'homeScreen',
      playMode: 'online',
      homeTab: 'play',
      cues: { key: null },
      revealed: null,
    });
    expect(initialApp.table).toEqual(initialTable);
    expect(initialTable).toEqual({
      slots: [null, null, null],
      selected: null,
      settle: null,
      drag: null,
      lastTrickOpen: false,
      resultDismissed: false,
      historyOpen: false,
      curtain: null,
      lastPainted: null,
      cardPack: DEFAULT_CARD_PACK,
      extraNames: { 2: '', 3: '' },
    });
    expect(SCREENS).toEqual([
      'homeScreen',
      'hostWaitScreen',
      'guestWaitScreen',
      'tableScreen',
      'endgameScreen',
    ]);
    expect(SHELL_INTENT_TYPES).toHaveLength(44);
    expect(EMPTY_SLOTS).toEqual([null, null, null]);
  });
});

describe('home', () => {
  test('home/init puts the options into the shell and the card pack and the extra names onto the table; the offer follows the save', () => {
    const snapshot: HomeSnapshot = {
      ...home,
      name: 'Ann',
      opts: { ...DEFAULT_OPTS, seatCount: 3, removedTwo: 'D' },
      cardPack: 'default',
      p3Name: 'Cara',
      p4Name: null,
    };
    const { app, effects } = run(initialApp, { type: 'home/init', home: snapshot });
    expect(app.shell.opts).toEqual({ ...DEFAULT_OPTS, seatCount: 3, removedTwo: 'D' });
    expect(app.table.cardPack).toBe('default');
    expect(app.table.extraNames).toEqual({ 2: 'Cara', 3: '' });
    expect(app.shell.resume).toBeNull();
    expect(kinds(effects)).toEqual(['scrollTop', 'fillName', 'fillP2Name']);
  });

  test('opts/set parses the raw selects against the current room, normalises and remembers; the home switches read on/off', () => {
    const { app, effects } = run(initialApp, {
      type: 'opts/set',
      raw: { players: '3', match: '3', removedTwo: 'S', exchange: 'on', scoperta: 'on' },
    });
    const opts = { ...DEFAULT_OPTS, seatCount: 3, gamesToWin: 3, removedTwo: 'S', exchange: true };
    expect(app.shell.opts).toEqual(opts);
    expect(effects).toEqual([{ type: 'writeOpts', opts }]);
    // A key not carried keeps the current value; a bad value too.
    const again = run(app, { type: 'opts/set', raw: { players: '9', exchange: 'off' } });
    expect(again.app.shell.opts).toEqual({ ...opts, exchange: false });
    // The pass-and-play twins are read too.
    expect(
      run(initialApp, { type: 'opts/set', raw: { localPlayers: '4', localPartnerPeek: 'on' } }).app
        .shell.opts,
    ).toEqual({
      ...DEFAULT_OPTS,
      seatCount: 4,
      partnerPeek: true,
    });
  });

  test('pname/typed keeps the third and fourth names and remembers them trimmed; cardPack/set takes a pack of the deck and refuses another', () => {
    const typed = run(
      initialApp,
      { type: 'pname/typed', seat: 2, value: ' Cara ' },
      { type: 'pname/typed', seat: 3, value: 'Dan' },
    );
    expect(typed.app.table.extraNames).toEqual({ 2: ' Cara ', 3: 'Dan' });
    expect(typed.effects).toEqual([
      { type: 'rememberPName', seat: 2, name: 'Cara' },
      { type: 'rememberPName', seat: 3, name: 'Dan' },
    ]);
    const pack = run(initialApp, { type: 'cardPack/set', pack: 'default' });
    expect(pack.app.table.cardPack).toBe('default');
    expect(pack.effects).toEqual([{ type: 'writeCardPack', pack: 'default' }]);
    const bad = run(pack.app, { type: 'cardPack/set', pack: 'plaid' });
    expect(bad.app).toBe(pack.app);
    expect(bad.effects).toEqual([]);
  });
});

describe('pass and play: seating two, three and four', () => {
  test('local/click at two: the names with defaults and the " 2" suffix, the options into the shell, the wake lock first, the curtain for the leader, the options remembered last', () => {
    const { app, effects } = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'local/click', p1: ' ann ', p2: 'ANN', localMatch: '1' },
    );
    const g = game(app);
    expect(g.players).toEqual([
      { id: 'p1', name: 'ann' },
      { id: 'p2', name: 'ANN 2' },
    ]);
    expect(g.options).toEqual({ ...DEFAULT_OPTS, gamesToWin: 1 });
    expect(app.shell).toMatchObject({
      role: 'local',
      code: null,
      oppConnected: true,
      revealed: null,
      opts: { ...DEFAULT_OPTS, gamesToWin: 1 },
      screen: 'tableScreen',
    });
    // The curtain names the leader (the seat after the dealer), whose view is shown.
    expect(app.table.curtain).toBe(g.turn);
    expect(view(app).me.idx).toBe(g.turn);
    expect(app.table.slots.every((s) => s !== null)).toBe(true);
    expect(kinds(effects.slice(1))).toEqual([
      'fillName',
      'fillP2Name',
      'wakeLock',
      'persist',
      'scrollTop',
      'writeOpts',
    ]);
    // A cold paint: no sound with the first curtain, the cue memory primed.
    expect(cues(effects)).toEqual([]);
    expect(app.shell.cues.key).toBe(cueKey(view(app)));
  });

  test('local/click at three and four: the extra names off the raw inputs, else as remembered, else the defaults; the deck and the sides follow', () => {
    const three = local({ localPlayers: '3', p3: 'Cara' });
    expect(game(three).players.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Cara']);
    expect(game(three).options.seatCount).toBe(3);
    expect(view(three).stockCount).toBe(30);
    expect(view(three).sides).toHaveLength(3);
    expect(three.table.curtain).toBe(game(three).turn);

    const remembered = local({ localPlayers: '4' }, { ...home, p3Name: 'Cara', p4Name: 'Dan' });
    expect(game(remembered).players.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Cara', 'Dan']);
    expect(view(remembered).stockCount).toBe(28);
    expect(view(remembered).sides).toHaveLength(2);

    const defaults = local({ localPlayers: '4', p3: '', p4: 'ann' });
    expect(game(defaults).players.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Player 3', 'ann 4']);
    // A fourth name typed into the input but not carried by the click is not used: the click is the truth.
    const typed = run(local({ localPlayers: '3' }), {
      type: 'pname/typed',
      seat: 2,
      value: 'Zed',
    }).app;
    expect(game(typed).players).toHaveLength(3);
  });

  test('the handoff is offered at two seats only: at three the intent is dropped, at two it opens a room', () => {
    const three = revealed(local({ localPlayers: '3', p3: 'Cara' }));
    const dropped = run(three, { type: 'handoff/click' });
    expect(dropped.app).toBe(three);
    expect(dropped.effects).toEqual([]);
    const two = run(revealed(local()), { type: 'handoff/click' });
    expect(two.app.shell.role).toBe('host');
    expect(two.app.shell.handoff).toBe(true);
    expect(two.app.shell.screen).toBe('hostWaitScreen');
    expect(handoffLabel(game(two.app))).toBe('Continue online: Ann hosts, Bob joins by invite');
  });
});

describe('pass and play: the lift, the play, the settle beat and the curtain', () => {
  test('the curtain reveal shows the mover; a lift taps, a second tap plays; the turn passes under the curtain with the chime', () => {
    const start = local();
    const g = game(start);
    const lifted = run(revealed(start), {
      type: 'card/tap',
      cardId: view(revealed(start)).legal[0] ?? '',
    });
    expect(lifted.app.shell.revealed).toBe(g.turn);
    expect(lifted.app.table.curtain).toBeNull();
    expect(lifted.app.table.selected).toBe(view(start).legal[0]);
    expect(cues(lifted.effects)).toEqual(['tap']);
    // Another card moves the lift; the lifted card tapped again plays it.
    const other = view(lifted.app).legal[1] ?? '';
    const moved = run(lifted.app, { type: 'card/tap', cardId: other });
    expect(moved.app.table.selected).toBe(other);
    const played = run(moved.app, { type: 'card/tap', cardId: other });
    const next = game(played.app);
    expect(next.trick).toHaveLength(1);
    expect(next.trick[0]?.card.id).toBe(other);
    // The other seat's view, its curtain up (pass-and-play chimes turns with the curtain, not `yourTurn`).
    expect(view(played.app).me.idx).toBe(next.turn);
    expect(played.app.table.curtain).toBe(next.turn);
    expect(played.app.table.selected).toBeNull();
    expect(cues(played.effects)).toEqual(['yourTurn', 'move.play']);
    // The played card's slot is empty; the other two slots did not move.
    const before = moved.app.table.slots;
    const after = played.app.table.slots;
    expect(after.filter((s) => s === null)).toHaveLength(0);
    expect(before.indexOf(other)).toBeGreaterThanOrEqual(0);
    // The next seat's hand fills the three slots from empty (its own picture).
    expect(after.every((s) => s !== null)).toBe(true);
  });

  test('a completed trick settles: hold, fly, draw with their timers, the phone holder kept, the cue for the trick, then the curtain for the winner', () => {
    const start = local({ localMatch: '1' });
    const first = playFirst(revealed(start)).app;
    const second = playFirst(revealed(first));
    const g = game(second.app);
    expect(g.trickNo).toBe(1);
    const trick = g.lastTrick;
    if (trick === null) throw new Error('no trick');
    // Hold: the trick painted from the record, the view still the last player's, no curtain yet.
    expect(second.app.table.settle).toEqual({ stage: 'hold', trick });
    expect(view(second.app).me.idx).toBe(first.shell.view?.me.idx);
    expect(second.app.table.curtain).toBeNull();
    expect(timers(second.effects)).toEqual([['settle', HOLD_MS, 'settle/elapsed']]);
    // The card laid, then the trick's phrase for the winner (pass-and-play plays the winner's):
    // ONE `phrases` effect carrying the trick event's phrase, its leaf a trick row of the table.
    const played = cues(second.effects);
    expect(played.slice(0, 2)).toEqual(['tap', 'move.play']);
    expect(played.length).toBeGreaterThan(2);
    played.slice(2).forEach((cue) => {
      expect(Object.keys(CUES)).toContain(cue);
    });
    const phrased = phrasesOf(second.effects);
    expect(phrased).toHaveLength(1);
    const prevView = first.shell.view;
    if (prevView === null) throw new Error('no view before the trick');
    expect(phrased).toEqual(phrasesBetween(prevView, view(second.app), 'local'));
    const last = phrased[0]?.phrases.at(-1);
    expect(last === undefined ? '' : sequenceOf(last).steps.at(-1)?.cue).toMatch(/\.trick\./);
    // A tap while the beat runs is dropped: the hand is inert.
    expect(liveView(second.app)).toBeNull();
    const dropped = run(second.app, {
      type: 'card/tap',
      cardId: view(second.app).me.hand[0]?.id ?? '',
    });
    expect(dropped.app).toBe(second.app);
    // Fly, then draw (two seats drew: one draw and one gap), the draw chiming.
    const fly = run(second.app, { type: 'settle/elapsed' });
    expect(fly.app.table.settle?.stage).toBe('fly');
    expect(timers(fly.effects)).toEqual([['settle', FLY_MS, 'settle/elapsed']]);
    const draw = run(fly.app, { type: 'settle/elapsed' });
    expect(draw.app.table.settle?.stage).toBe('draw');
    expect(cues(draw.effects)).toEqual(['draw.stock']);
    expect(timers(draw.effects)).toEqual([['settle', DRAW_MS + DRAW_GAP_MS, 'settle/elapsed']]);
    // Done: the winner's view, the curtain for them unless they held the phone, nothing re-plays.
    const done = run(draw.app, { type: 'settle/elapsed' });
    expect(done.app.table.settle).toBeNull();
    expect(view(done.app).me.idx).toBe(trick.winner);
    expect(done.app.table.curtain).toBe(
      done.app.shell.revealed === trick.winner ? null : trick.winner,
    );
    expect(cues(done.effects)).toEqual(done.app.table.curtain === null ? [] : ['yourTurn']);
    expect(timers(done.effects)).toEqual([]);
    // Another elapsed with no beat running changes nothing.
    expect(run(done.app, { type: 'settle/elapsed' }).app).toBe(done.app);
  });

  test('settleMs and nextStage: the hold, the flight, one draw per seat with the gaps; no draw once the stock is out', () => {
    const drew: TrickRecord = {
      no: 5,
      leader: 0,
      cards: [],
      winner: 1,
      points: 0,
      drew: [1, 0, 2],
      trumpTaken: false,
    };
    const none: TrickRecord = { ...drew, drew: [] };
    expect(settleMs({ stage: 'hold', trick: drew })).toBe(HOLD_MS);
    expect(settleMs({ stage: 'fly', trick: drew })).toBe(FLY_MS);
    expect(settleMs({ stage: 'draw', trick: drew })).toBe(DRAW_MS + 2 * DRAW_GAP_MS);
    expect(nextStage({ stage: 'hold', trick: drew })).toEqual({ stage: 'fly', trick: drew });
    expect(nextStage({ stage: 'fly', trick: drew })).toEqual({ stage: 'draw', trick: drew });
    expect(nextStage({ stage: 'fly', trick: none })).toBeNull();
    expect(nextStage({ stage: 'draw', trick: drew })).toBeNull();
  });

  test('play/click and table/tap play the lifted card; a drag lights, follows and drops on the trick; released elsewhere it clears; Escape peels one thing at a time', () => {
    const start = revealed(local());
    const id = view(start).legal[0] ?? '';
    expect(run(start, { type: 'play/click' }).app).toBe(start);
    const lifted = run(start, { type: 'card/tap', cardId: id }).app;
    expect(game(run(lifted, { type: 'play/click' }).app).trick).toHaveLength(1);
    expect(game(run(lifted, { type: 'table/tap' }).app).trick).toHaveLength(1);
    // A drag: the source is lifted; over the trick or not; a drop over it plays.
    const drag = run(
      start,
      { type: 'card/dragStart', cardId: id },
      { type: 'card/dragOver', over: true },
    );
    expect(drag.app.table.drag).toEqual({ card: id, over: true });
    expect(drag.app.table.selected).toBe(id);
    // The click a release fires reaches a card while the drag is on: nothing.
    expect(run(drag.app, { type: 'card/tap', cardId: id }).app).toBe(drag.app);
    expect(game(run(drag.app, { type: 'card/dragEnd' }).app).trick).toHaveLength(1);
    const away = run(
      drag.app,
      { type: 'card/dragOver', over: false },
      { type: 'card/dragEnd' },
    ).app;
    expect(away.table.drag).toBeNull();
    expect(away.table.selected).toBeNull();
    expect(game(away).trick).toHaveLength(0);
    // A card not in the hand starts no drag.
    expect(run(start, { type: 'card/dragStart', cardId: 'ZZ' }).app).toBe(start);
    // Escape: the drag, then the lift, then the sheets.
    expect(run(drag.app, { type: 'escape' }).app.table).toMatchObject({
      drag: null,
      selected: null,
    });
    expect(run(lifted, { type: 'escape' }).app.table.selected).toBeNull();
    const sheets = run(start, { type: 'history/open' }, { type: 'rules/open' }).app;
    expect(sheets.table.historyOpen).toBe(true);
    expect(sheets.shell.rulesOpen).toBe(true);
    const once = run(sheets, { type: 'escape' }).app;
    expect(once.table.historyOpen).toBe(false);
    expect(once.shell.rulesOpen).toBe(true);
    expect(run(once, { type: 'escape' }).app.shell.rulesOpen).toBe(false);
    expect(run(start, { type: 'escape' }).app).toBe(start);
  });

  test('the last-trick sheet opens only once a trick has been taken; the history and rules sheets toggle', () => {
    const start = revealed(local());
    expect(run(start, { type: 'lastTrick/open' }).app).toBe(start);
    const taken = settled(playFirst(revealed(playFirst(start).app)).app).app;
    const open = run(taken, { type: 'lastTrick/open' }).app;
    expect(open.table.lastTrickOpen).toBe(true);
    expect(run(open, { type: 'lastTrick/close' }).app.table.lastTrickOpen).toBe(false);
    expect(
      run(start, { type: 'history/open' }, { type: 'history/close' }).app.table.historyOpen,
    ).toBe(false);
    expect(run(start, { type: 'rules/open' }, { type: 'rules/close' }).app.shell.rulesOpen).toBe(
      false,
    );
  });
});

describe('pass and play: whole games through the tap policy', () => {
  test.each([2, 3, 4] as const)(
    'a game of %i seats plays to its end: every trick settles, the result sheet opens once the beat is done, the score sums to 120',
    (n) => {
      const start = local({ localPlayers: String(n), localMatch: '1', p3: 'Cara', p4: 'Dan' });
      const over = playUntil(
        start,
        (app) => view(app).phase === 'over' && app.table.settle === null,
      );
      const v = view(over);
      expect(v.phase).toBe('over');
      expect(v.trickNo).toBe(n === 3 ? 13 : 40 / n);
      expect(v.sides.reduce((a, b) => a + b, 0)).toBe(120);
      expect(v.tricks.reduce((a, b) => a + b, 0)).toBe(v.trickNo);
      expect(v.stockCount).toBe(0);
      // The result is everyone's: no curtain, the sheet up, the end screen since the match was one game.
      expect(over.table.curtain).toBeNull();
      expect(v.matchOver).toBe(true);
      expect(over.shell.screen).toBe('endgameScreen');
      expect(resultOpen(over)).toBe(true);
      expect(run(over, { type: 'result/peek' }).app.table.resultDismissed).toBe(true);
      // The event stream: one deal, one trick per trick, one result.
      expect(v.events.map((e) => e.kind)).toEqual([
        'deal',
        ...Array.from({ length: v.trickNo }, () => 'trick'),
        'result',
      ]);
    },
  );

  test('a match of games: game one over opens the sheet on the table screen; Next game deals game two with the tally carried; the match end shows the end screen; Rematch starts afresh with the deal chiming', () => {
    const start = local({ localMatch: '2' });
    const one = playUntil(start, (app) => view(app).phase === 'over' && app.table.settle === null);
    expect(view(one).matchOver).toBe(false);
    expect(one.shell.screen).toBe('tableScreen');
    expect(resultOpen(one)).toBe(true);
    // The result's phrase played once, at the end: the cue memory keys on the last event.
    expect(one.shell.cues.key).toBe(cueKey(view(one)));
    const two = run(one, { type: 'next/click' });
    expect(view(two.app).gameNo).toBe(2);
    expect(view(two.app).phase).toBe('trick');
    expect(resultOpen(two.app)).toBe(false);
    expect(two.app.shell.revealed).toBeNull();
    expect(two.app.table.curtain).toBe(game(two.app).turn);
    // Game two opens with its `game` and `deal` events: the deal chimes.
    expect(cues(two.effects)).toContain('start.deal');
    const wins = view(two.app).match.wins.reduce((a, b) => a + b, 0) + view(two.app).match.draws;
    expect(wins).toBe(1);
    const end = playUntil(two.app, (app) => view(app).matchOver && app.table.settle === null);
    expect(end.shell.screen).toBe('endgameScreen');
    const again = run(end, { type: 'next/click' });
    expect(view(again.app).gameNo).toBe(1);
    expect(view(again.app).match.wins).toEqual([0, 0]);
    expect(again.app.shell.cues.key).toBe(cueKey(view(again.app)));
    // The curtain rises for the new leader (the shell's chime), then the deal.
    expect(cues(again.effects)).toEqual(['yourTurn', 'start.deal']);
    // Next before the game is over is nothing.
    expect(run(again.app, { type: 'next/click' }).app).toBe(again.app);
  });

  test('a refused action is toasted with the font`s bad and drops the lift; an act by the hook applies for the actor', () => {
    const start = revealed(local());
    const bad = run(start, { type: 'act', action: { type: 'play', cardId: 'ZZ' } });
    expect(toasts(bad.effects)).toEqual([[MESSAGES.NOT_IN_HAND, null]]);
    expect(cues(bad.effects)).toEqual(['bad.refused']);
    expect(bad.app.shell.game).toBe(start.shell.game);
    const legal = view(start).legal[0] ?? '';
    const ok = run(start, { type: 'act', action: { type: 'play', cardId: legal } });
    expect(game(ok.app).trick[0]?.card.id).toBe(legal);
    // `exchange/click` is nothing while the table does not play the exchange.
    expect(run(start, { type: 'exchange/click' }).app).toBe(start);
  });

  test("position/load (the shell's, over the engine decoder) replaces the pass-and-play position, curtain down for the actor; refused elsewhere and for junk", () => {
    const start = local();
    const other = createGame(
      [
        { id: 'p1', name: 'Ann' },
        { id: 'p2', name: 'Bob' },
        { id: 'p3', name: 'Cara' },
      ],
      { gamesToWin: 1 },
      mulberry32(99),
      () => NOW,
    );
    const loaded = run(start, { type: 'position/load', state: JSON.parse(JSON.stringify(other)) });
    expect(game(loaded.app)).toEqual(other);
    expect(loaded.app.shell.revealed).toBe(other.turn);
    expect(loaded.app.table.curtain).toBeNull();
    expect(view(loaded.app).me.idx).toBe(other.turn);
    expect(loaded.app.table.settle).toBeNull();
    expect(cues(loaded.effects)).toEqual([]);
    const junk = run(start, { type: 'position/load', state: { nope: 1 } });
    expect(toasts(junk.effects)).toEqual([[badPositionMsg('$.players: expected array'), null]]);
    const home1 = run(initialApp, { type: 'position/load', state: other });
    expect(toasts(home1.effects)).toEqual([[SANDBOX_LOCAL_ONLY_MSG, null]]);
  });
});

describe('hosting and joining (two seats)', () => {
  const opened = (): Step =>
    run(
      initialApp,
      { type: 'home/init', home: { ...home, playMode: 'online' } },
      { type: 'host/click', name: 'Ann', match: '1' },
    );

  test('host/click: the name, the options, a fresh 4-letter code, the wait screen, the startHost effect, the options remembered', () => {
    const { app, effects } = opened();
    expect(app.shell).toMatchObject({
      role: 'host',
      myName: 'Ann',
      opts: { ...DEFAULT_OPTS, gamesToWin: 1 },
      screen: 'hostWaitScreen',
      game: null,
    });
    expect(app.shell.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(kinds(effects.slice(1))).toEqual([
      'fillName',
      'fillP2Name',
      'scrollTop',
      'startHost',
      'writeOpts',
    ]);
    expect(effects.at(-1)).toEqual({ type: 'writeOpts', opts: { ...DEFAULT_OPTS, gamesToWin: 1 } });
  });

  test('a join answers with the lobby frame carrying the room; host/deal needs a guest, then deals and sends the guest`s view; the guest`s plays are applied and broadcast, a refusal is a toast frame', () => {
    const room = opened().app;
    expect(toasts(run(room, { type: 'host/deal' }).effects)).toEqual([
      [WAITING_FOR_GUEST_MSG, null],
    ]);
    const joined = run(room, { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } });
    expect(sends(joined.effects)).toEqual([lobby('Ann', { ...DEFAULT_OPTS, gamesToWin: 1 })]);
    const dealt = run(joined.app, { type: 'host/deal' });
    const g = game(dealt.app);
    expect(g.players.map((p) => p.name)).toEqual(['Ann', 'Jeff']);
    expect(g.options.seatCount).toBe(2);
    expect(sends(dealt.effects)).toEqual([stateFrame(viewFor(g, 1))]);
    expect(view(dealt.app)).toEqual(viewFor(g, 0));
    expect(dealt.app.shell.screen).toBe('tableScreen');
    // The guest's card while it is the guest's turn is applied and broadcast; out of turn it is a toast frame.
    const guestTurn = g.turn === 1;
    const guestCard = g.hands[1]?.[0]?.id ?? '';
    const played = run(dealt.app, {
      type: 'host/frame',
      frame: actionFrame({ type: 'play', cardId: guestCard }),
    });
    if (guestTurn) {
      expect(game(played.app).trick).toHaveLength(1);
      expect(sends(played.effects)).toEqual([stateFrame(viewFor(game(played.app), 1))]);
    } else {
      expect(sends(played.effects)).toEqual([toastFrame(MESSAGES.NOT_YOUR_TURN)]);
      // The host's own card, and its chime for the guest is on the wire as a view.
      const mine = view(dealt.app).legal[0] ?? '';
      const hostPlayed = run(
        dealt.app,
        { type: 'card/tap', cardId: mine },
        { type: 'card/tap', cardId: mine },
      );
      expect(game(hostPlayed.app).trick[0]?.card.id).toBe(mine);
      expect(cues(hostPlayed.effects)).toEqual(['tap', 'move.play']);
    }
  });

  test('a hosted game against a fake guest: whoever must act acts, one state frame per applied action, the beat and the cues on the host, to the end of a match', () => {
    const dealt = run(
      opened().app,
      { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } },
      { type: 'host/deal' },
    ).app;
    const step1 = (app: App): App => {
      if (app.table.settle !== null) return run(app, { type: 'settle/elapsed' }).app;
      const g = game(app);
      if (g.phase === 'over') return run(app, { type: 'next/click' }).app;
      const seat = actorOf(g) ?? 0;
      const card = g.hands[seat]?.[0]?.id ?? '';
      return seat === 0
        ? run(app, { type: 'act', action: { type: 'play', cardId: card } }).app
        : run(app, { type: 'host/frame', frame: actionFrame({ type: 'play', cardId: card }) }).app;
    };
    const end = Array.from({ length: STEP_CAP }).reduce<App>(
      (app) => (view(app).matchOver && app.table.settle === null ? app : step1(app)),
      dealt,
    );
    expect(view(end).matchOver).toBe(true);
    expect(end.shell.screen).toBe('endgameScreen');
    expect(view(end).events.filter((e) => e.kind === 'trick')).toHaveLength(20);
    // The guest's Next is nothing after the match; the host's Rematch deals afresh.
    const again = run(end, { type: 'next/click' });
    expect(view(again.app).gameNo).toBe(1);
    expect(sends(again.effects)).toHaveLength(1);
  });

  test('joining: the host`s lobby names the room; a state frame is the view with the beat; the guest`s tap is an action frame; its Next is refused until the host deals; the host gone after the match closes the table', () => {
    const joining = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'join/click', name: 'Jeff', code: 'ABCD' },
    ).app;
    expect(joining.shell).toMatchObject({
      role: 'guest',
      code: 'ABCD',
      myName: 'Jeff',
      screen: 'guestWaitScreen',
    });
    const named = run(joining, {
      type: 'guest/frame',
      frame: lobby('Ann', { ...DEFAULT_OPTS, scoperta: true }),
    }).app;
    expect(named.shell.guestStatus.text).toBe(hostRoomMsg('Ann'));
    expect(named.shell.opts).toEqual({ ...DEFAULT_OPTS, scoperta: true });
    // A room whose frame turns scoperta on at three seats is normalised as it is picked.
    expect(
      run(joining, {
        type: 'guest/frame',
        frame: lobby('Ann', { ...DEFAULT_OPTS, seatCount: 3, scoperta: true }),
      }).app.shell.opts,
    ).toEqual({ ...DEFAULT_OPTS, seatCount: 3 });
    const g = createGame(
      [
        { id: 'host', name: 'Ann' },
        { id: 'guest', name: 'Jeff' },
      ],
      { gamesToWin: 1 },
      mulberry32(3),
      () => NOW,
    );
    const connected = run(
      named,
      { type: 'guest/connected' },
      { type: 'guest/frame', frame: stateFrame(viewFor(g, 1)) },
    );
    expect(connected.app.shell.screen).toBe('tableScreen');
    expect(view(connected.app)).toEqual(viewFor(g, 1));
    expect(connected.app.table.slots.every((s) => s !== null)).toBe(true);
    // A tap while it is the guest's turn sends the action frame; before its turn the hand is inert.
    const mine = view(connected.app).legal[0];
    if (mine !== undefined) {
      const tapped = run(
        connected.app,
        { type: 'card/tap', cardId: mine },
        { type: 'card/tap', cardId: mine },
      );
      expect(sends(tapped.effects)).toEqual([actionFrame({ type: 'play', cardId: mine })]);
      // The guest holds no engine state: the host applies it.
      expect(tapped.app.shell.game).toBeNull();
    } else {
      expect(
        run(connected.app, { type: 'card/tap', cardId: view(connected.app).me.hand[0]?.id ?? '' })
          .app,
      ).toBe(connected.app);
    }
    // The host's frames bring the cues: the leader's card laid (theirs), then a trick resolved settles here too.
    const r1 = applyAction(
      g,
      g.turn,
      { type: 'play', cardId: g.hands[g.turn]?.[0]?.id ?? '' },
      mulberry32(1),
      () => NOW,
    );
    if (!r1.ok) throw new Error(r1.error);
    const laid = run(connected.app, {
      type: 'guest/frame',
      frame: stateFrame(viewFor(r1.value, 1)),
    });
    expect(cues(laid.effects)).toEqual(g.turn === 1 ? ['move.play'] : ['move.opp', 'yourTurn']);
    // The same frame again plays nothing.
    expect(
      cues(run(laid.app, { type: 'guest/frame', frame: stateFrame(viewFor(r1.value, 1)) }).effects),
    ).toEqual([]);
    // Next while the game is on is nothing; once over, the guest is told the host deals.
    expect(run(laid.app, { type: 'next/click' }).app).toBe(laid.app);
    const overGame = Array.from({ length: STEP_CAP }).reduce<State>((s) => {
      if (s.phase === 'over') return s;
      const seat = actorOf(s) ?? 0;
      const r = applyAction(
        s,
        seat,
        { type: 'play', cardId: s.hands[seat]?.[0]?.id ?? '' },
        mulberry32(1),
        () => NOW,
      );
      return r.ok ? r.value : s;
    }, g);
    const done = run(laid.app, {
      type: 'guest/frame',
      frame: stateFrame(viewFor(overGame, 1)),
    }).app;
    expect(view(done).matchOver).toBe(true);
    // A frame that skipped the tricks paints cold: no beat.
    expect(done.table.settle).toBeNull();
    expect(done.shell.screen).toBe('endgameScreen');
    expect(run(done, { type: 'next/click' }).app).toBe(done);
    const midGame = { ...viewFor(overGame, 1), phase: 'over' as const, matchOver: false };
    const waiting = run(withView(laid.app, midGame), { type: 'next/click' });
    expect(toasts(waiting.effects)).toEqual([[waitingToDealMsg('Ann'), null]]);
    // The host gone after the match: the result stays, the net closes, the save goes.
    const gone = run(done, { type: 'guest/lost' });
    expect(kinds(gone.effects)).toEqual(['scrollTop', 'closeNet', 'clearSave', 'toast']);
    expect(toasts(gone.effects)).toEqual([[hostLeftMsg('Ann'), GONE_TOAST_MS]]);
    expect(gone.app.shell.screen).toBe('endgameScreen');
    // Not connected: a tap is refused.
    expect(toasts(run(joining, { type: 'act', action: { type: 'next' } }).effects)).toEqual([
      [NOT_CONNECTED_MSG, null],
    ]);
  });
});

/** The app with another view in place (a frame's view without the reducer). */
const withView = (app: App, v: View): App => ({ ...app, shell: { ...app.shell, view: v } });

describe('resume, storage and what the sessions read back', () => {
  test('resumeFor offers each save role, not a finished match; the labels name the players (vs at two, a list at more) or the room', () => {
    const two = game(local({ localMatch: '1' }));
    const three = game(local({ localPlayers: '3', p3: 'Cara' }));
    expect(resumeFor(null)).toBeNull();
    expect(resumeFor({ role: 'local', game: two })).toEqual({ kind: 'local', game: two });
    expect(resumeLabel({ kind: 'local', game: two })).toBe('Resume pass & play: Ann vs Bob');
    expect(resumeLabel({ kind: 'local', game: three })).toBe(
      'Resume pass & play: Ann, Bob and Cara',
    );
    const host = {
      role: 'host',
      code: 'ABCD',
      myName: 'Ann',
      ...DEFAULT_OPTS,
      game: two,
      oppName: 'Jeff',
    } as const;
    expect(resumeFor(host)).toEqual({
      kind: 'host',
      code: 'ABCD',
      myName: 'Ann',
      ...DEFAULT_OPTS,
      game: two,
      oppName: 'Jeff',
      handoff: false,
    });
    expect(
      resumeLabel({
        kind: 'host',
        code: 'ABCD',
        myName: 'Ann',
        ...DEFAULT_OPTS,
        game: two,
        oppName: 'Jeff',
        handoff: false,
      }),
    ).toBe('Resume hosting room ABCD');
    expect(
      resumeLabel({
        kind: 'host',
        code: 'ABCD',
        myName: 'Ann',
        ...DEFAULT_OPTS,
        game: two,
        oppName: 'Bob',
        handoff: true,
      }),
    ).toBe(handoffLabel(two));
    expect(resumeLabel({ kind: 'guest', code: 'ABCD', myName: 'Jeff' })).toBe('Rejoin room ABCD');
    expect(
      resumeFor({
        role: 'host',
        code: 'ABCD',
        myName: 'Ann',
        ...DEFAULT_OPTS,
        game: null,
        oppName: null,
      }),
    ).toBeNull();
    const over = game(playUntil(local({ localMatch: '1' }), (app) => view(app).matchOver));
    expect(resumeFor({ role: 'local', game: over })).toBeNull();
    // A three-seat pass-and-play save resumes with its curtain for the actor.
    const resumed = run(
      initialApp,
      { type: 'home/init', home: { ...home, save: { role: 'local', game: three } } },
      { type: 'resume/click' },
    ).app;
    expect(game(resumed)).toEqual(three);
    expect(resumed.table.curtain).toBe(three.turn);
    expect(seatNames(['Ann'])).toBe('Ann');
    expect(seatNames(['Ann', 'Bob', 'Cara', 'Dan'])).toBe('Ann, Bob, Cara and Dan');
    expect(seatPlayers(2, [])).toEqual([
      { id: 'p1', name: 'Player 1' },
      { id: 'p2', name: 'Player 2' },
    ]);
    expect(seatPlayers(4, three.players)).toHaveLength(4);
  });

  test('saveFor: one shape per role with the six options on the host save; readHome the defaults on an empty store; the contexts mirror the shell', () => {
    const l = local();
    expect(saveFor(l)).toEqual({ role: 'local', game: game(l) });
    const h = run(initialApp, { type: 'host/click', name: 'Ann', players: '2', match: '3' }).app;
    expect(saveFor(h)).toEqual({
      role: 'host',
      code: h.shell.code,
      myName: 'Ann',
      ...DEFAULT_OPTS,
      gamesToWin: 3,
      game: null,
      oppName: null,
    });
    expect(hostContextOf(h)).toEqual({
      attempt: 1,
      role: 'host',
      code: h.shell.code,
      myName: 'Ann',
      ...DEFAULT_OPTS,
      gamesToWin: 3,
      hasGame: false,
      handoff: false,
      oppName: null,
      oppConnected: false,
    });
    const gst = run(initialApp, { type: 'join/click', name: 'Jeff', code: 'ABCD' }).app;
    expect(saveFor(gst)).toEqual({ role: 'guest', code: 'ABCD', myName: 'Jeff' });
    expect(guestContextOf(gst)).toEqual({
      attempt: 1,
      role: 'guest',
      code: 'ABCD',
      myName: 'Jeff',
      oppConnected: false,
    });
    expect(saveFor(initialApp)).toBeNull();
    expect(readHome(createStore(fakeStorage()))).toEqual({ ...home, playMode: 'online' });
  });

  test('leave/request confirms with the role`s message; the finish resets the table but keeps the pack and the names', () => {
    const start = run(
      local({ localPlayers: '3', p3: 'Cara' }),
      { type: 'cardPack/set', pack: 'default' },
      { type: 'pname/typed', seat: 2, value: 'Cara' },
    ).app;
    const asked = run(start, { type: 'leave/request' });
    expect(asked.effects).toEqual([
      { type: 'confirm', message: LEAVE_LOCAL_MSG, then: { type: 'leave/confirmed' } },
    ]);
    const left = run(start, { type: 'leave/confirmed' }, { type: 'leave/finish' }).app;
    expect(left.shell.role).toBeNull();
    expect(left.shell.game).toBeNull();
    expect(left.table).toEqual({
      ...initialTable,
      cardPack: 'default',
      extraNames: { 2: 'Cara', 3: '' },
    });
  });
});

describe('runEffect', () => {
  test('briscola`s three write through storage.ts; a shell effect reaches the shared runner (the save)', () => {
    const s = fakeStorage();
    const store = createStore(s);
    const l = local();
    const deps = { store } as unknown as EffectDeps;
    runEffect(
      l,
      { type: 'writeOpts', opts: { ...DEFAULT_OPTS, seatCount: 4, partnerPeek: true } },
      deps,
    );
    expect(s.map.get(STORAGE_KEYS.players)).toBe('4');
    expect(s.map.get(STORAGE_KEYS.partnerPeek)).toBe('on');
    runEffect(l, { type: 'rememberPName', seat: 2, name: 'Cara' }, deps);
    runEffect(l, { type: 'rememberPName', seat: 3, name: 'Dan' }, deps);
    expect(s.map.get(STORAGE_KEYS.p3Name)).toBe('Cara');
    expect(s.map.get(STORAGE_KEYS.p4Name)).toBe('Dan');
    runEffect(l, { type: 'writeCardPack', pack: 'default' }, deps);
    expect(s.map.get(STORAGE_KEYS.cardPack)).toBe('default');
    runEffect(l, { type: 'persist' }, deps);
    expect(s.map.get(STORAGE_KEYS.save)).toBe(JSON.stringify({ role: 'local', game: game(l) }));
  });
});

describe('the pure twins', () => {
  const card = (id: string) => ({ id, r: 1 as const, s: 'C' as const });

  test('settleSlots keeps a card in its slot, empties a slot whose card went, fills the first free slot with a new card, and deals left to right', () => {
    const hand = (...ids: ReadonlyArray<string>) => ids.map(card);
    expect(settleSlots(EMPTY_SLOTS, hand('AC', '3D', 'RS'))).toEqual(['AC', '3D', 'RS']);
    expect(settleSlots(['AC', '3D', 'RS'], hand('AC', 'RS'))).toEqual(['AC', null, 'RS']);
    expect(settleSlots(['AC', null, 'RS'], hand('AC', 'RS', '7B'))).toEqual(['AC', '7B', 'RS']);
    expect(settleSlots(['AC', '3D', 'RS'], hand('RS', 'AC', '3D'))).toEqual(['AC', '3D', 'RS']);
    expect(settleSlots(['AC', '3D', 'RS'], hand('2B'))).toEqual(['2B', null, null]);
    expect(settleSlots(['AC', '3D', 'RS'], [])).toEqual([null, null, null]);
    expect(settleSlots([], hand('AC'))).toEqual(['AC', null, null]);
  });

  test('trickResolvedBetween, playedBetween, continuedEvents and cueKey read the change between two views of one game', () => {
    const start = revealed(local({ localMatch: '1' }));
    const v0 = view(start);
    const first = playFirst(start).app;
    const v1 = viewFor(game(first), v0.me.idx);
    expect(trickResolvedBetween(v0, v1)).toBeNull();
    expect(playedBetween(v0, v1)).toEqual(v1.trick[0]);
    const second = playFirst(revealed(first)).app;
    const v2 = viewFor(game(second), v0.me.idx);
    expect(trickResolvedBetween(v1, v2)).toEqual(v2.lastTrick);
    expect(playedBetween(v1, v2)).toEqual(v2.lastTrick?.cards.at(-1));
    // Across a skipped trick: nothing laid, the trick not the one that just resolved.
    expect(playedBetween(v0, v2)).toBeNull();
    expect(trickResolvedBetween(v0, v2)).toEqual(v2.lastTrick);
    // One match continues its stream: prev's events, so the shared `newEvents` finds the trick alone.
    expect(continuedEvents(v0, v1)).toEqual(v0.events);
    expect(continuedEvents(v1, v2)).toEqual(v1.events);
    expect(newEvents(continuedEvents(v1, v2), v2.events).map((e: GameEvent) => e.kind)).toEqual([
      'trick',
    ]);
    // A stream prev never saw while no match ended (a hand-made position) paints cold.
    const fresh = viewFor(
      createGame(
        [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        {},
        mulberry32(5),
        () => NOW + 1,
      ),
      0,
    );
    expect(continuedEvents(v2, fresh)).toBeNull();
    // After a finished match a new stream is a rematch: nothing continued, so its deal chimes.
    expect(continuedEvents({ ...v2, matchOver: true }, fresh)).toEqual([]);
    expect(newEvents([], fresh.events)).toEqual(fresh.events);
    expect(cueKey(v0)).not.toBe(cueKey(v1));
    expect(cueKey(v1)).not.toBe(cueKey(v2));
    // Online: the other seat's card is theirs, and the turn passing to me chimes.
    expect(cuesBetween(viewFor(game(start), 1), viewFor(game(first), 1), 'host')).toEqual(
      v1.trick[0]?.seat === 1 ? ['move.play'] : ['move.opp', 'yourTurn'],
    );
  });
});
