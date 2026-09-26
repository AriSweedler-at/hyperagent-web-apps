// The reducer alone (docs/design/briscola.md §5.4, §5.6 "Pure twins" and the reducer tests;
// backgammon's state.test.ts shape): every table intent once, the flows that matter (pass-and-play
// for two, three and four seats driven through a tap policy with a seeded rng, the settle beat's
// stages and timers, the curtain deferred to the beat, a hosted game against a fake guest frame
// stream, Play again after a decided game and after a draw, an older save's match running on, the
// resume snapshot, the event-driven cues), the effects as data, and `runEffect` against recorded
// adapters.
import { describe, expect, test } from 'vitest';

import { NOW, runIntents } from '../../../../../test/shared/engine-helpers.ts';
import { createStore, type StorageLike } from '../../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { newEvents } from '../../../../shared/lib/events.ts';
import { sequenceOf } from '../../../../shared/lib/sound/phrase.ts';
import {
  MESSAGES,
  actorOf,
  applyAction,
  cardById,
  createGame,
  deckFor,
  viewFor,
  withPosition,
} from '../engine/index.ts';
import type { Card, GameEvent, Seat, State, TrickRecord, View } from '../engine/index.ts';
import { EMPTY_SEAT } from '../../../../shared/ui/shell.ts';
import { WAITING_MSG } from '../../../../shared/net/host.ts';
import {
  action as actionFrame,
  full as fullFrame,
  intent as intentWire,
  lobby,
  state as stateFrame,
  toast as toastFrame,
  welcome,
} from '../protocol.ts';
import { LOCAL_NAMES } from '../shellConfig.ts';
import { DEFAULT_CARD_PACK, STORAGE_KEYS } from '../storage.ts';
import { BEAT_MS, DURATIONS, drawSpan } from './beat.ts';
import { TEMPO_SCALE } from './variant.ts';
import { CUES } from './sound.ts';
import {
  DEFAULT_OPTS,
  DRAW_GAP_MS,
  DRAW_MS,
  EMPTY_SLOTS,
  FLY_MS,
  GONE_TOAST_MS,
  INTENT_BUDGET,
  INTENT_MS,
  INTENT_WINDOW_MS,
  LEAVE_LOCAL_MSG,
  NOT_CONNECTED_MSG,
  SANDBOX_LOCAL_ONLY_MSG,
  SCREENS,
  SHELL_INTENT_TYPES,
  TABLE_FULL_MSG,
  TIP_HOVER_MS,
  TIP_PRESS_MS,
  WAITING_FOR_GUEST_MSG,
  badPositionMsg,
  cueKey,
  cuesBetween,
  guestContextOf,
  guestGoneMsg,
  handoffLabel,
  hostContextOf,
  hostLeftMsg,
  hostRoomMsg,
  initialApp,
  initialTable,
  continuedEvents,
  intentOf,
  joinedMsg,
  listNames,
  liveView,
  pausedMsg,
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
  seatGoneMsg,
  seatNames,
  seatPlayers,
  awaitingDraw,
  seatsDown,
  settleMs,
  settleSlots,
  trickResolvedBetween,
  waitingMsg,
  waitingToDealMsg,
  type App,
  type Effect,
  type EffectDeps,
  type HomeSnapshot,
  type Intent,
  type Raw,
  type Settle,
  type SettleStage,
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
  lang: 'it',
  speed: 'normal',
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
/** A card of the deck by id; a typo is a test bug. */
const c = (id: string): Card => {
  const card = cardById(id);
  if (card === null) throw new Error(`no card ${id}`);
  return card;
};

/** The tap policy: the first legal card lifted, then played (two taps). */
const playFirst = (app: App): Step => {
  const id = view(app).legal[0];
  if (id === undefined) throw new Error('nothing legal');
  return run(app, { type: 'card/tap', cardId: id }, { type: 'card/tap', cardId: id });
};

/** One step of the settle beat: the draw's tap where it waits for it, else the timer's end. */
const beat = (app: App): App =>
  run(app, awaitingDraw(app.table.settle) ? { type: 'draw/tap' } : { type: 'settle/elapsed' }).app;
/** One step of a whole game: the curtain lifted, a trick settled, or the first legal card played. */
const advance = (app: App): App => {
  if (app.table.curtain !== null) return revealed(app);
  if (app.table.settle !== null) return beat(app);
  if (view(app).phase === 'over') return run(app, { type: 'replay/click' }).app;
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
      resultDismissed: false,
      historyOpen: false,
      deckOpen: false,
      deckWithHand: false,
      curtain: null,
      lastPainted: null,
      cardPack: DEFAULT_CARD_PACK,
      lang: 'it',
      speed: 'normal',
      tip: null,
      swallowTap: null,
      cardView: null,
      extraNames: { 2: null, 3: null },
      hover: null,
      sent: null,
      intentArmed: false,
      mirror: [null, null, null, null],
      budget: [null, null, null, null],
    });
    expect(SCREENS).toEqual([
      'homeScreen',
      'hostWaitScreen',
      'guestWaitScreen',
      'tableScreen',
      'endgameScreen',
    ]);
    expect(SHELL_INTENT_TYPES).toHaveLength(45);
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
    // A seat with nothing remembered is null: the paint shows its default, marked for the first-tap clear.
    expect(app.table.extraNames).toEqual({ 2: 'Cara', 3: null });
    expect(app.shell.resume).toBeNull();
    expect(kinds(effects)).toEqual(['scrollTop', 'fillName', 'fillP2Name']);
  });

  test('opts/set parses the raw seat count against the current room onto the fixed terms and remembers it', () => {
    const { app, effects } = run(initialApp, { type: 'opts/set', raw: { players: '3' } });
    const opts = { ...DEFAULT_OPTS, seatCount: 3 };
    expect(app.shell.opts).toEqual(opts);
    expect(effects).toEqual([{ type: 'writeOpts', opts }]);
    // A key not carried keeps the current value; a bad value too.
    expect(run(app, { type: 'opts/set', raw: {} }).app.shell.opts).toEqual(opts);
    expect(run(app, { type: 'opts/set', raw: { players: '9' } }).app.shell.opts).toEqual(opts);
    // The pass-and-play twin is read too.
    expect(
      run(initialApp, { type: 'opts/set', raw: { localPlayers: '4' } }).app.shell.opts,
    ).toEqual({ ...DEFAULT_OPTS, seatCount: 4 });
    // A room that still carries a match or a house rule (an older save) is parsed onto the fixed terms.
    const older: App = {
      ...initialApp,
      shell: { ...initialApp.shell, opts: { ...DEFAULT_OPTS, gamesToWin: 3, exchange: true } },
    };
    expect(run(older, { type: 'opts/set', raw: { players: '2' } }).app.shell.opts).toEqual(
      DEFAULT_OPTS,
    );
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

  test('speed/set takes one of the three speeds and remembers it, refuses a stranger', () => {
    const quick = run(initialApp, { type: 'speed/set', speed: 'quick' });
    expect(quick.app.table.speed).toBe('quick');
    expect(quick.effects).toEqual([{ type: 'writeSpeed', speed: 'quick' }]);
    const bad = run(quick.app, { type: 'speed/set', speed: 'fast' });
    expect(bad.app).toBe(quick.app);
    expect(bad.effects).toEqual([]);
    const off = run(quick.app, { type: 'speed/set', speed: 'off' });
    expect(off.app.table.speed).toBe('off');
    expect(off.effects).toEqual([{ type: 'writeSpeed', speed: 'off' }]);
  });
});

describe('pass and play: seating two, three and four', () => {
  test('local/click at two: the names with defaults and the " 2" suffix, the options into the shell, the wake lock first, the curtain for the leader, the options remembered last', () => {
    const { app, effects } = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'local/click', p1: ' ann ', p2: 'ANN' },
    );
    const g = game(app);
    expect(g.players).toEqual([
      { id: 'p1', name: 'ann' },
      { id: 'p2', name: 'ANN 2' },
    ]);
    // One game per sitting: the engine's match is fixed at one game.
    expect(g.options).toEqual({ ...DEFAULT_OPTS, gamesToWin: 1 });
    expect(app.shell).toMatchObject({
      role: 'local',
      code: null,
      oppConnected: true,
      revealed: null,
      opts: DEFAULT_OPTS,
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
    expect(view(remembered).sides).toHaveLength(4);

    // An empty seat is this game's default (shellConfig.ts LOCAL_NAMES: the owner's "Ari and Lavi
    // (with p3 Sandro and p4 Grant)"); a clash with an earlier seat is suffixed by its number.
    const defaults = local({ localPlayers: '4', p3: '', p4: 'ann' });
    expect(game(defaults).players.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Sandro', 'ann 4']);
    expect(LOCAL_NAMES).toEqual(['Ari', 'Lavi', 'Sandro', 'Grant']);
    const untouched = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'local/click', p1: '', p2: '', localPlayers: '4', p3: '', p4: '' },
    ).app;
    expect(game(untouched).players.map((p) => p.name)).toEqual(LOCAL_NAMES);
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

  test('a completed trick settles: the clash, the pack, the draw with their timers, the phone holder kept, the cue for the trick, then the curtain for the winner', () => {
    const start = local();
    const first = playFirst(revealed(start)).app;
    const second = playFirst(revealed(first));
    const g = game(second.app);
    expect(g.trickNo).toBe(1);
    const trick = g.lastTrick;
    if (trick === null) throw new Error('no trick');
    // Hold: the trick painted from the record, the view still the last player's (whose draw will wait), no curtain yet.
    const me = view(second.app).me.idx;
    expect(second.app.table.settle).toMatchObject({ stage: 'follow', trick, me });
    expect(second.app.table.settle?.since).toBe(view(second.app));
    expect(view(second.app).me.idx).toBe(first.shell.view?.me.idx);
    expect(second.app.table.curtain).toBeNull();
    expect(timers(second.effects)).toEqual([
      ['settle', BEAT_MS.followLast.normal, 'settle/elapsed'],
    ]);
    // The card laid; the trick's phrase for the winner (pass-and-play plays the winner's) is HELD
    // on the settle until the impact (docs/design/briscola-sound-history.md §3.5): ONE `phrases`
    // effect carrying the trick event's phrase, its leaf a trick row of the table, none at the paint.
    expect(cues(second.effects)).toEqual(['tap', 'move.play']);
    expect(phrasesOf(second.effects)).toHaveLength(0);
    const held = second.app.table.settle?.phrases ?? [];
    const heldCues = cues(held);
    expect(heldCues.length).toBeGreaterThan(0);
    heldCues.forEach((cue) => {
      expect(Object.keys(CUES)).toContain(cue);
    });
    const phrased = phrasesOf(held);
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
    // The clash: charge, strike, then the impact, where the held phrases play (the BOOM) and the
    // hit-stop is the variant's by the trick's value; the aftermath; then the pack (`fly`), then
    // draw (two seats drew: one draw and one gap), the draw chiming.
    const variant = second.app.table.settle?.variant;
    if (variant === undefined) throw new Error('no variant');
    const tempo = TEMPO_SCALE[variant.tempo];
    const charge = run(second.app, { type: 'settle/elapsed' });
    expect(charge.app.table.settle?.stage).toBe('charge');
    expect(phrasesOf(charge.effects)).toHaveLength(0);
    expect(timers(charge.effects)).toEqual([
      ['settle', Math.round(BEAT_MS.charge.normal * tempo), 'settle/elapsed'],
    ]);
    const strike = run(charge.app, { type: 'settle/elapsed' });
    expect(strike.app.table.settle?.stage).toBe('strike');
    expect(timers(strike.effects)).toEqual([
      ['settle', Math.round(BEAT_MS.strike.normal * tempo), 'settle/elapsed'],
    ]);
    const impact = run(strike.app, { type: 'settle/elapsed' });
    expect(impact.app.table.settle?.stage).toBe('impact');
    expect(phrasesOf(impact.effects)).toEqual(phrased);
    expect(timers(impact.effects)).toEqual([['settle', variant.freezeMs, 'settle/elapsed']]);
    const aftermath = run(impact.app, { type: 'settle/elapsed' });
    expect(aftermath.app.table.settle?.stage).toBe('aftermath');
    expect(phrasesOf(aftermath.effects)).toHaveLength(0);
    expect(timers(aftermath.effects)).toEqual([
      ['settle', Math.round(BEAT_MS.aftermath.normal * tempo), 'settle/elapsed'],
    ]);
    const fly = run(aftermath.app, { type: 'settle/elapsed' });
    expect(fly.app.table.settle?.stage).toBe('fly');
    expect(timers(fly.effects)).toEqual([['settle', FLY_MS, 'settle/elapsed']]);
    // Reduced motion (or the switch at `off`): charge, strike and the aftermath hold nothing and
    // are stepped over; the impact is the 300 ms still, the phrases still its.
    const still = runIntents(reduce, { ...ctx, reducedMotion: true })(second.app, {
      type: 'settle/elapsed',
    });
    expect(still.app.table.settle?.stage).toBe('impact');
    expect(phrasesOf(still.effects)).toEqual(phrased);
    expect(timers(still.effects)).toEqual([['settle', 300, 'settle/elapsed']]);
    const packed = runIntents(reduce, { ...ctx, reducedMotion: true })(still.app, {
      type: 'settle/elapsed',
    });
    expect(packed.app.table.settle?.stage).toBe('fly');
    const draw = run(fly.app, { type: 'settle/elapsed' });
    expect(draw.app.table.settle?.stage).toBe('draw');
    // The seats before me in the draw order (the winner first) draw now, chiming; none when I won.
    const span = drawSpan(trick.drew, me);
    expect(cues(draw.effects)).toEqual(span.before > 0 ? ['draw.stock'] : []);
    expect(timers(draw.effects)).toEqual(
      span.before > 0 ? [['settle', DRAW_MS, 'settle/elapsed']] : [],
    );
    // Then my draw waits for the tap: the timer's end (or none) changes nothing; a hand tap is the draw's.
    expect(awaitingDraw(draw.app.table.settle)).toBe(true);
    expect(run(draw.app, { type: 'settle/elapsed' }).app).toBe(draw.app);
    const mine = run(draw.app, { type: 'draw/tap' });
    expect(mine.app.table.settle?.stage).toBe('drawMine');
    expect(cues(mine.effects)).toEqual(['draw.stock']);
    expect(timers(mine.effects)).toEqual([
      ['settle', DRAW_MS + DURATIONS.flipMs, 'settle/elapsed'],
    ]);
    const viaHand = run(draw.app, {
      type: 'card/tap',
      cardId: view(draw.app).me.hand[0]?.id ?? '',
    });
    expect(viaHand.app.table.settle?.stage).toBe('drawMine');
    // A second tap, or a tap at any other stage, is nothing.
    expect(run(mine.app, { type: 'draw/tap' }).app).toBe(mine.app);
    expect(run(fly.app, { type: 'draw/tap' }).app).toBe(fly.app);
    // My card landed: the seats after me draw, or the beat is done.
    const rest = run(mine.app, { type: 'settle/elapsed' });
    if (span.after > 0) {
      expect(rest.app.table.settle?.stage).toBe('drawRest');
      expect(cues(rest.effects)).toEqual([]);
      expect(timers(rest.effects)).toEqual([['settle', DRAW_MS, 'settle/elapsed']]);
    }
    // Done: the winner's view, the curtain for them unless they held the phone, nothing re-plays.
    const done = span.after > 0 ? run(rest.app, { type: 'settle/elapsed' }) : rest;
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

  test('settleMs and nextStage: the clash, the pack, one draw per seat with the gaps; no draw once the stock is out', () => {
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
    // A real trick's settle for its variant (the clash's clock reads it); the stage, trick and seat
    // overridden. Dealt through its own rng, so the file's shared stream (the whole-game rows below
    // read their deals from it) is not moved.
    const own = runIntents(reduce, { rng: mulberry32(11), now: () => NOW });
    const seated = own(
      initialApp,
      { type: 'home/init', home },
      { type: 'local/click', p1: 'Ann', p2: 'Bob' },
    ).app;
    const base = playFirst(revealed(playFirst(revealed(seated)).app)).app.table.settle;
    if (base === null) throw new Error('no settle');
    // Me = seat 0, second in the order: one seat before my tap, one after.
    const at = (stage: SettleStage, trick: TrickRecord, me: Seat = 0): Settle => ({
      ...base,
      stage,
      trick,
      me,
    });
    const tempo = TEMPO_SCALE[base.variant.tempo];
    expect(settleMs(at('follow', drew))).toBe(BEAT_MS.followLast.normal);
    expect(settleMs(at('charge', drew))).toBe(Math.round(BEAT_MS.charge.normal * tempo));
    expect(settleMs(at('strike', drew))).toBe(Math.round(BEAT_MS.strike.normal * tempo));
    expect(settleMs(at('impact', drew))).toBe(base.variant.freezeMs);
    expect(settleMs(at('aftermath', drew))).toBe(Math.round(BEAT_MS.aftermath.normal * tempo));
    // Quick: the tempo stages from the quick column; the hit-stop ×0.6, never under 80. Reduced or off: the still.
    expect(settleMs(at('charge', drew), 'quick')).toBe(Math.round(BEAT_MS.charge.quick * tempo));
    expect(settleMs(at('impact', drew), 'quick')).toBe(
      Math.max(80, Math.round(base.variant.freezeMs * 0.6)),
    );
    expect(settleMs(at('charge', drew), 'normal', true)).toBe(0);
    expect(settleMs(at('impact', drew), 'normal', true)).toBe(300);
    expect(settleMs(at('impact', drew), 'off')).toBe(300);
    expect(settleMs(at('fly', drew))).toBe(FLY_MS);
    expect(settleMs(at('draw', drew))).toBe(DRAW_MS);
    expect(settleMs(at('drawMine', drew))).toBe(DRAW_MS + DURATIONS.flipMs);
    expect(settleMs(at('drawRest', drew))).toBe(DRAW_MS);
    // The winner (first to draw) waits at once; the last drawer has everyone before and nobody after.
    expect(settleMs(at('draw', drew, 1))).toBe(0);
    expect(settleMs(at('draw', drew, 2))).toBe(DRAW_MS + DRAW_GAP_MS);
    expect(settleMs(at('drawRest', drew, 2))).toBe(0);
    // A device whose seat is not drawing runs every draw at `draw`.
    expect(settleMs(at('draw', drew, 3))).toBe(DRAW_MS + 2 * DRAW_GAP_MS);
    expect(nextStage(at('follow', drew))).toEqual(at('charge', drew));
    expect(nextStage(at('charge', drew))).toEqual(at('strike', drew));
    expect(nextStage(at('strike', drew))).toEqual(at('impact', drew));
    expect(nextStage(at('impact', drew))).toEqual(at('aftermath', drew));
    expect(nextStage(at('aftermath', drew))).toEqual(at('fly', drew));
    expect(nextStage(at('fly', drew))).toEqual(at('draw', drew));
    expect(nextStage(at('fly', none))).toBeNull();
    // `draw` ends in the wait for my tap (the same settle), or in nothing when I do not draw.
    const waiting = at('draw', drew);
    expect(nextStage(waiting)).toBe(waiting);
    expect(nextStage(at('draw', drew, 3))).toBeNull();
    expect(nextStage(at('drawMine', drew))).toEqual(at('drawRest', drew));
    expect(nextStage(at('drawMine', drew, 2))).toBeNull();
    expect(nextStage(at('drawRest', drew))).toBeNull();
    expect(awaitingDraw(null)).toBe(false);
    expect(awaitingDraw(at('draw', drew, 3))).toBe(false);
    expect(awaitingDraw(at('drawMine', drew))).toBe(false);
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

  test('the history and rules sheets toggle', () => {
    const start = revealed(local());
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
      const start = local({ localPlayers: String(n), p3: 'Cara', p4: 'Dan' });
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
      // The result is everyone's: no curtain, the sheet up over the table (never the shell's end screen).
      expect(over.table.curtain).toBeNull();
      expect(v.matchOver).toBe(true);
      expect(over.shell.screen).toBe('tableScreen');
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

  test('Play again after a decided game: a fresh deal for the same players on the same terms, the deal passed to the next seat, the tally and the stream fresh, the deal chiming after the curtain', () => {
    const start = local();
    const one = playUntil(start, (app) => view(app).phase === 'over' && app.table.settle === null);
    const v1 = view(one);
    expect(v1.matchOver).toBe(true);
    expect(one.shell.screen).toBe('tableScreen');
    expect(resultOpen(one)).toBe(true);
    // The result's phrase played once, at the end: the cue memory keys on the last event.
    expect(one.shell.cues.key).toBe(cueKey(v1));
    const again = run(one, { type: 'replay/click' });
    const v2 = view(again.app);
    expect(v2.gameNo).toBe(1);
    expect(v2.phase).toBe('trick');
    expect(v2.players).toEqual(v1.players);
    expect(v2.options).toEqual(v1.options);
    expect(v2.dealer).toBe((v1.dealer + 1) % 2);
    expect(v2.match).toEqual({ gamesToWin: 1, wins: [0, 0], draws: 0 });
    expect(v2.events.map((e) => e.kind)).toEqual(['deal']);
    expect(v2.stockCount).toBe(34);
    expect(v2.me.hand).toHaveLength(3);
    expect(resultOpen(again.app)).toBe(false);
    expect(again.app.table.resultDismissed).toBe(false);
    expect(again.app.shell.revealed).toBeNull();
    // The curtain rises for the new leader (the shell's chime), then the deal.
    expect(again.app.table.curtain).toBe(game(again.app).turn);
    expect(cues(again.effects)).toEqual(['yourTurn', 'start.deal']);
    expect(again.app.shell.cues.key).toBe(cueKey(v2));
    // Play again before the game is over is nothing.
    expect(run(again.app, { type: 'replay/click' }).app).toBe(again.app);
  });

  test('Play again after a draw is the engine`s next game: the deal rotates, the tally carries the draw, the stream runs on', () => {
    const one = playUntil(
      local(),
      (app) => view(app).phase === 'over' && app.table.settle === null,
    );
    const g = game(one);
    // The finished game re-read as a 60-60 draw (the engine's own literal, so `next` applies to it).
    const drawn: State = {
      ...g,
      match: { ...g.match, wins: [0, 0], draws: 1 },
      result: { winner: null, totals: [60, 60], draw: true },
    };
    const app: App = {
      ...one,
      shell: { ...one.shell, game: drawn, view: viewFor(drawn, view(one).me.idx) },
    };
    expect(view(app).matchOver).toBe(false);
    expect(resultOpen(app)).toBe(true);
    const two = run(app, { type: 'replay/click' });
    const v = view(two.app);
    expect(v.gameNo).toBe(2);
    expect(v.dealer).toBe((g.dealer + 1) % 2);
    expect(v.match).toEqual({ gamesToWin: 1, wins: [0, 0], draws: 1 });
    expect(v.events.map((e) => e.kind).slice(-2)).toEqual(['game', 'deal']);
    expect(cues(two.effects)).toContain('start.deal');
    expect(two.app.table.curtain).toBe(game(two.app).turn);
  });

  test('an older save whose game holds a best-of-three loads and plays on: its first result is not decided, Play again deals game two of that match', () => {
    const older = createGame(
      [
        { id: 'p1', name: 'Ann' },
        { id: 'p2', name: 'Bob' },
      ],
      { gamesToWin: 2 },
      mulberry32(11),
      () => NOW,
    );
    const resumed = run(
      initialApp,
      { type: 'home/init', home: { ...home, save: { role: 'local', game: older } } },
      { type: 'resume/click' },
    ).app;
    expect(game(resumed)).toEqual(older);
    expect(resumed.shell.opts.gamesToWin).toBe(1);
    const one = playUntil(
      resumed,
      (app) => view(app).phase === 'over' && app.table.settle === null,
    );
    expect(view(one).matchOver).toBe(false);
    expect(one.shell.screen).toBe('tableScreen');
    expect(resultOpen(one)).toBe(true);
    const two = run(one, { type: 'replay/click' }).app;
    expect(view(two).gameNo).toBe(2);
    expect(view(two).match.gamesToWin).toBe(2);
    expect(view(two).match.wins.reduce((a, b) => a + b, 0) + view(two).match.draws).toBe(1);
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
    // `exchange/click` while the table does not play the exchange: a closer look at the trump card instead.
    const looked = run(start, { type: 'exchange/click' });
    expect(looked.app.table.cardView).toBe(game(start).trumpCard.id);
    expect(looked.app.shell).toBe(start.shell);
    expect(looked.effects).toEqual([]);
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
      { type: 'host/click', name: 'Ann', players: '2' },
    );

  test('host/click: the name, the options, a fresh 4-letter code, the wait screen, the startHost effect, the options remembered', () => {
    const { app, effects } = opened();
    expect(app.shell).toMatchObject({
      role: 'host',
      myName: 'Ann',
      opts: DEFAULT_OPTS,
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
    expect(effects.at(-1)).toEqual({ type: 'writeOpts', opts: DEFAULT_OPTS });
  });

  test('a join answers with the lobby frame carrying the room; host/deal needs a guest, then deals and sends the guest`s view; the guest`s plays are applied and broadcast, a refusal is a toast frame', () => {
    const room = opened().app;
    expect(toasts(run(room, { type: 'host/deal' }).effects)).toEqual([
      [WAITING_FOR_GUEST_MSG, null],
    ]);
    const joined = run(room, { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } });
    expect(sends(joined.effects)).toEqual([lobby('Ann', DEFAULT_OPTS, joined.app.shell.seats, 1)]);
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

  test('a hosted game against a fake guest: whoever must act acts, one state frame per applied action, the beat and the cues on the host, to the end of the game; Play again deals afresh on the wire', () => {
    const dealt = run(
      opened().app,
      { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } },
      { type: 'host/deal' },
    ).app;
    const step1 = (app: App): App => {
      if (app.table.settle !== null) return beat(app);
      const g = game(app);
      if (g.phase === 'over') return run(app, { type: 'replay/click' }).app;
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
    expect(end.shell.screen).toBe('tableScreen');
    expect(resultOpen(end)).toBe(true);
    expect(view(end).events.filter((e) => e.kind === 'trick')).toHaveLength(20);
    // The host's Play again deals afresh, the deal passed to the guest's seat, one state frame out.
    const again = run(end, { type: 'replay/click' });
    expect(view(again.app).gameNo).toBe(1);
    expect(view(again.app).dealer).toBe((view(end).dealer + 1) % 2);
    expect(view(again.app).players).toEqual(view(end).players);
    expect(sends(again.effects)).toHaveLength(1);
  });

  test('joining: the host`s lobby names the room; a state frame is the view with the beat; the guest`s tap is an action frame; its Play again is refused (the host deals); the host gone after the game closes the table', () => {
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
      frame: lobby('Ann', { ...DEFAULT_OPTS, scoperta: true }, [], 1),
    }).app;
    expect(named.shell.guestStatus.text).toBe(hostRoomMsg('Ann'));
    expect(named.shell.opts).toEqual({ ...DEFAULT_OPTS, scoperta: true });
    // A room whose frame turns scoperta on at three seats is normalised as it is picked.
    expect(
      run(joining, {
        type: 'guest/frame',
        frame: lobby('Ann', { ...DEFAULT_OPTS, seatCount: 3, scoperta: true }, [], 1),
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
    // Play again while the game is on is nothing; once over, the guest is told the host deals.
    expect(run(laid.app, { type: 'replay/click' }).app).toBe(laid.app);
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
    // A frame that skipped the tricks paints cold: no beat; the result sheet over the table.
    expect(done.table.settle).toBeNull();
    expect(done.shell.screen).toBe('tableScreen');
    expect(resultOpen(done)).toBe(true);
    expect(toasts(run(done, { type: 'replay/click' }).effects)).toEqual([
      [waitingToDealMsg('Ann'), null],
    ]);
    const midGame = { ...viewFor(overGame, 1), phase: 'over' as const, matchOver: false };
    const waiting = run(withView(laid.app, midGame), { type: 'replay/click' });
    expect(toasts(waiting.effects)).toEqual([[waitingToDealMsg('Ann'), null]]);
    // The host gone after the game: the result stays, the net closes, the save goes.
    const gone = run(done, { type: 'guest/lost' });
    expect(kinds(gone.effects)).toEqual(['scrollTop', 'closeNet', 'clearSave', 'toast']);
    expect(toasts(gone.effects)).toEqual([[hostLeftMsg('Ann'), GONE_TOAST_MS]]);
    expect(gone.app.shell.screen).toBe('tableScreen');
    // Not connected: a tap is refused.
    expect(toasts(run(joining, { type: 'act', action: { type: 'next' } }).effects)).toEqual([
      [NOT_CONNECTED_MSG, null],
    ]);
  });
});

/** The app with another view in place (a frame's view without the reducer). */
const withView = (app: App, v: View): App => ({ ...app, shell: { ...app.shell, view: v } });

describe('resume, storage and what the sessions read back', () => {
  test('resumeFor offers each save role, not a decided game; the labels name the players (vs at two, a list at more) or the room', () => {
    const two = game(local());
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
      at: null,
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
        at: null,
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
        at: null,
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
      // A room still waiting for its first guest is offered too (docs/design/lobby-resume.md D3).
    ).toMatchObject({ kind: 'host', game: null, at: null });
    const over = game(playUntil(local(), (app) => view(app).matchOver));
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
    const h = run(initialApp, { type: 'host/click', name: 'Ann', players: '2' }).app;
    expect(saveFor(h)).toEqual({
      role: 'host',
      code: h.shell.code,
      myName: 'Ann',
      ...DEFAULT_OPTS,
      game: null,
      oppName: null,
      // The waiting room's stamp (docs/design/lobby-resume.md D1): the clock at `host/click`.
      at: NOW,
    });
    expect(hostContextOf(h)).toEqual({
      attempt: 1,
      role: 'host',
      code: h.shell.code,
      myName: 'Ann',
      ...DEFAULT_OPTS,
      hasGame: false,
      handoff: false,
      oppName: null,
      oppConnected: false,
      seats: [EMPTY_SEAT],
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
      extraNames: { 2: 'Cara', 3: null },
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
    // The seat count alone: the house rules have no key any more.
    expect([...s.map.entries()]).toEqual([[STORAGE_KEYS.players, '4']]);
    runEffect(l, { type: 'rememberPName', seat: 2, name: 'Cara' }, deps);
    runEffect(l, { type: 'rememberPName', seat: 3, name: 'Dan' }, deps);
    expect(s.map.get(STORAGE_KEYS.p3Name)).toBe('Cara');
    expect(s.map.get(STORAGE_KEYS.p4Name)).toBe('Dan');
    runEffect(l, { type: 'writeCardPack', pack: 'default' }, deps);
    expect(s.map.get(STORAGE_KEYS.cardPack)).toBe('default');
    runEffect(l, { type: 'writeSpeed', speed: 'quick' }, deps);
    expect(s.map.get(STORAGE_KEYS.speed)).toBe('quick');
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
    const start = revealed(local());
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

describe('card names: the language pack, the tip and the card view (docs/design/language-packs.md §5)', () => {
  const first = (app: App): string => {
    const id = view(app).legal[0];
    if (id === undefined) throw new Error('nothing legal');
    return id;
  };

  test('lang/set takes a language pack and remembers it, refuses a stranger; home/init reads it; a left table keeps it', () => {
    const en = run(initialApp, { type: 'lang/set', name: 'en' });
    expect(en.app.table.lang).toBe('en');
    expect(en.effects).toEqual([{ type: 'writeLang', name: 'en' }]);
    expect(run(en.app, { type: 'lang/set', name: 'fr' }).app).toBe(en.app);
    const read = run(initialApp, { type: 'home/init', home: { ...home, lang: 'en-plates' } }).app;
    expect(read.table.lang).toBe('en-plates');
    const table = run(
      local({}, { ...home, lang: 'en' }),
      { type: 'leave/confirmed' },
      { type: 'leave/finish' },
    );
    expect(table.app.table.lang).toBe('en');
    expect(TIP_HOVER_MS).toBe(400);
    expect(TIP_PRESS_MS).toBe(450);
  });

  test('tip/arm arms the tip timer for a hand card (a hover 400ms, a press 450ms); tip/show shows it; tip/hide drops it and the timer', () => {
    const start = revealed(local());
    const card = first(start);
    const hover = run(start, { type: 'tip/arm', card, press: false });
    expect(hover.app.table.tip).toEqual({ card, shown: false });
    expect(hover.effects).toEqual([
      { type: 'startTimer', id: 'tip', ms: TIP_HOVER_MS, then: { type: 'tip/show' } },
    ]);
    const press = run(start, { type: 'tip/arm', card, press: true });
    expect(press.effects).toEqual([
      { type: 'startTimer', id: 'tip', ms: TIP_PRESS_MS, then: { type: 'tip/show' } },
    ]);
    const shown = run(hover.app, { type: 'tip/show' });
    expect(shown.app.table.tip).toEqual({ card, shown: true });
    expect(shown.effects).toEqual([]);
    // Over the same card while shown: nothing restarts.
    expect(run(shown.app, { type: 'tip/arm', card, press: false }).app).toBe(shown.app);
    const hidden = run(shown.app, { type: 'tip/hide' });
    expect(hidden.app.table.tip).toBeNull();
    expect(hidden.app.table.swallowTap).toBeNull();
    expect(hidden.effects).toEqual([{ type: 'cancelTimer', id: 'tip' }]);
    // Nothing armed: nothing to hide or show.
    expect(run(hidden.app, { type: 'tip/hide' }).app).toBe(hidden.app);
    expect(run(hidden.app, { type: 'tip/show' }).app).toBe(hidden.app);
    // Another card takes over the tip.
    const other = view(start).me.hand.find((c) => c.id !== card)?.id ?? '';
    expect(run(shown.app, { type: 'tip/arm', card: other, press: false }).app.table.tip).toEqual({
      card: other,
      shown: false,
    });
  });

  test('a touch lift after the tip showed swallows the click that follows: the card is not lifted once; an early lift swallows nothing', () => {
    const start = revealed(local());
    const card = first(start);
    const long = run(
      start,
      { type: 'tip/arm', card, press: true },
      { type: 'tip/show' },
      { type: 'tip/hide', swallow: true },
    ).app;
    expect(long.table.tip).toBeNull();
    expect(long.table.swallowTap).toBe(card);
    const tapped = run(long, { type: 'card/tap', cardId: card });
    expect(tapped.app.table.selected).toBeNull();
    expect(tapped.app.table.swallowTap).toBeNull();
    expect(tapped.effects).toEqual([]);
    expect(run(tapped.app, { type: 'card/tap', cardId: card }).app.table.selected).toBe(card);
    // A tap on another card is not swallowed; the marker stays for its card.
    const other = view(start).me.hand.find((c) => c.id !== card)?.id ?? '';
    expect(run(long, { type: 'card/tap', cardId: other }).app.table.swallowTap).toBe(card);
    // Lifted before the timer fired: no swallow.
    const early = run(
      start,
      { type: 'tip/arm', card, press: true },
      { type: 'tip/hide', swallow: true },
    ).app;
    expect(early.table.swallowTap).toBeNull();
    // A new press clears a stale marker.
    expect(run(long, { type: 'tip/arm', card, press: true }).app.table.swallowTap).toBeNull();
  });

  test('the tip never arms under the curtain or for a card not in my hand; a drag drops it', () => {
    const down = local();
    expect(down.table.curtain).not.toBeNull();
    const held = view(down).me.hand[0]?.id ?? '';
    expect(run(down, { type: 'tip/arm', card: held, press: false }).app).toBe(down);
    const start = revealed(down);
    expect(run(start, { type: 'tip/arm', card: 'ZZ', press: false }).app).toBe(start);
    const theirs = view(start).others[0]?.hand?.[0]?.id ?? 'RB';
    expect(view(start).me.hand.some((c) => c.id === theirs)).toBe(false);
    expect(run(start, { type: 'tip/arm', card: theirs, press: false }).app).toBe(start);
    const card = first(start);
    const dragged = run(
      start,
      { type: 'tip/arm', card, press: true },
      { type: 'tip/show' },
      { type: 'card/dragStart', cardId: card },
    ).app;
    expect(dragged.table.tip).toBeNull();
    expect(dragged.table.drag).toEqual({ card, over: false });
  });

  test('the card view opens on a card of the deck and closes; Escape closes it before anything else; the trump card tapped opens it while it lies on the table', () => {
    const start = revealed(local());
    const open = run(start, { type: 'cardView/open', card: 'RD' });
    expect(open.app.table.cardView).toBe('RD');
    expect(open.effects).toEqual([]);
    expect(run(start, { type: 'cardView/open', card: 'ZZ' }).app).toBe(start);
    expect(run(open.app, { type: 'cardView/close' }).app.table.cardView).toBeNull();
    const lifted = run(open.app, { type: 'card/tap', cardId: first(start) }).app;
    const escaped = run(lifted, { type: 'escape' }).app;
    expect(escaped.table.cardView).toBeNull();
    expect(escaped.table.selected).toBe(first(start));
    // The trump card: a look while it lies under the stock (the exchange is not offered here).
    expect(view(start).canExchange).toBe(false);
    expect(run(start, { type: 'exchange/click' }).app.table.cardView).toBe(
      view(start).trumpCard.id,
    );
    // Drawn: nothing to look at.
    const g = game(start);
    const rest = deckFor(g.options).filter((card) => card.id !== 'AC' && card.id !== '3C');
    const drawn: State = {
      ...withPosition(g, [[c('AC')], [c('3C')]], [], c('RB'), 0),
      piles: [rest, []],
    };
    const last = run(start, {
      type: 'position/load',
      state: JSON.parse(JSON.stringify(drawn)),
    }).app;
    expect(view(last).trumpOnTable).toBe(false);
    expect(run(last, { type: 'exchange/click' }).app).toBe(last);
    // A left table drops the view.
    expect(
      run(open.app, { type: 'leave/confirmed' }, { type: 'leave/finish' }).app.table.cardView,
    ).toBeNull();
  });
});

// The deck sheet (ui/deck.ts): last, since its deal would shift the seeded flows above.
describe('the deck sheet', () => {
  test('the deck sheet opens with a tap over a view, its toggle is remembered across openings, Escape and Close shut it', () => {
    // No view, no sheet (the button is on the table, but the hook can ask).
    expect(run(initialApp, { type: 'deck/open' }).app).toBe(initialApp);
    const start = revealed(local());
    expect(start.table).toMatchObject({ deckOpen: false, deckWithHand: false });
    const open = run(start, { type: 'deck/open' });
    expect(open.app.table.deckOpen).toBe(true);
    expect(cues(open.effects)).toEqual(['tap']);
    const toggled = run(open.app, { type: 'deck/toggleHand' }).app;
    expect(toggled.table.deckWithHand).toBe(true);
    expect(run(toggled, { type: 'deck/toggleHand' }).app.table.deckWithHand).toBe(false);
    const closed = run(toggled, { type: 'deck/close' }).app;
    expect(closed.table).toMatchObject({ deckOpen: false, deckWithHand: true });
    expect(run(toggled, { type: 'escape' }).app.table).toMatchObject({
      deckOpen: false,
      deckWithHand: true,
    });
    // A lift survives the sheet; the reducer's Escape (the hook's: the binder closes an open sheet
    // itself) drops the lift first, as for every sheet, and takes the sheet on the next press.
    const lifted = run(toggled, { type: 'card/tap', cardId: view(toggled).legal[0] ?? '' }).app;
    expect(lifted.table.selected).not.toBeNull();
    const once = run(lifted, { type: 'escape' }).app;
    expect(once.table).toMatchObject({ deckOpen: true, selected: null });
    expect(run(once, { type: 'escape' }).app.table.deckOpen).toBe(false);
  });
});

describe('the live intent mirror (docs/design/briscola-battle.md §4)', () => {
  const SLOTS = [0, 1, 2] as const;
  /** A hosted table, the guest seated and the hand dealt (the host is seat 0, its channel seat 1). */
  const hosted = (): App =>
    run(
      initialApp,
      { type: 'home/init', home: { ...home, playMode: 'online' } },
      { type: 'host/click', name: 'Ann', players: '2' },
      { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } },
      { type: 'host/deal' },
    ).app;
  /** The same table with my hand live (my turn, every card legal), forced so the deal's leader does not decide a row. */
  const live = (app: App): App => {
    const v = view(app);
    return withView(app, {
      ...v,
      isMyTurn: true,
      turn: v.me.idx,
      legal: v.me.hand.map((card) => card.id),
    });
  };
  const inert = (app: App): App => {
    const v = view(app);
    return withView(app, { ...v, isMyTurn: false, turn: v.me.idx === 0 ? 1 : 0, legal: [] });
  };
  /** The engine-order slot of the card the kept picture holds at `i`: what the wire names. */
  const slotOf = (app: App, i: number): 0 | 1 | 2 => {
    const id = app.table.slots[i];
    const k = view(app).me.hand.findIndex((card) => card.id === id);
    if (k !== 0 && k !== 1 && k !== 2) throw new Error('not in hand');
    return k;
  };
  const intentTimers = (effects: ReadonlyArray<Effect>): ReadonlyArray<unknown> =>
    effects.filter((e) => e.type === 'startTimer' && e.id === 'intent');
  const armedOnce = [
    { type: 'startTimer', id: 'intent', ms: INTENT_MS, then: { type: 'intent/flush' } },
  ];

  test('sender: a hover arms the 60 ms timer once and coalesces, the flush sends the engine-order slot, equality stops a repeat, a lift is raised, escape falls back to the hover, leaving clears once', () => {
    const app = live(hosted());
    expect(intentOf(app)).toEqual(intentWire(0, null, 'hover'));
    const armed = run(app, { type: 'hover/set', slot: 1 });
    expect(armed.app.table).toMatchObject({ hover: 1, intentArmed: true, sent: null });
    expect(intentTimers(armed.effects)).toEqual(armedOnce);
    // A second hover before the flush moves the memory and arms nothing more; the same slot again is nothing.
    const moved = run(armed.app, { type: 'hover/set', slot: 2 });
    expect(moved.app.table.hover).toBe(2);
    expect(intentTimers(moved.effects)).toEqual([]);
    expect(run(moved.app, { type: 'hover/set', slot: 2 }).app).toBe(moved.app);
    // The flush sends the latest as an index into the engine-order hand and remembers it; a second flush sends nothing.
    const hover2 = intentWire(0, slotOf(moved.app, 2), 'hover');
    const flushed = run(moved.app, { type: 'intent/flush' });
    expect(sends(flushed.effects)).toEqual([hover2]);
    expect(flushed.app.table).toMatchObject({ sent: hover2, intentArmed: false });
    expect(run(flushed.app, { type: 'intent/flush' })).toEqual({ app: flushed.app, effects: [] });
    // A lift is `raised` for that slot.
    const id2 = moved.app.table.slots[2] ?? '';
    const lifted = run(flushed.app, { type: 'card/tap', cardId: id2 });
    expect(lifted.app.table.selected).toBe(id2);
    expect(intentTimers(lifted.effects)).toEqual(armedOnce);
    const raised = run(lifted.app, { type: 'intent/flush' });
    expect(sends(raised.effects)).toEqual([intentWire(0, slotOf(moved.app, 2), 'raised')]);
    // Escape drops the lift: the hover shows again. The pointer leaving is one clear, and a second leave is nothing.
    const dropped = run(raised.app, { type: 'escape' }, { type: 'intent/flush' });
    expect(sends(dropped.effects)).toEqual([hover2]);
    const left = run(dropped.app, { type: 'hover/set', slot: null }, { type: 'intent/flush' });
    expect(sends(left.effects)).toEqual([intentWire(0, null, 'hover')]);
    expect(run(left.app, { type: 'hover/set', slot: null }).app).toBe(left.app);
    // A guest rejoining mid-game forgets what was sent, so a held state is re-sent (§4.2).
    const rejoin = run(dropped.app, { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } });
    expect(rejoin.app.table.sent).toBeNull();
  });

  test('nothing goes out for a hover while my hand is inert, over a card that is not legal or a slot that is empty, before anything was sent, in pass-and-play, or before a deal', () => {
    const idle = run(inert(hosted()), { type: 'hover/set', slot: 1 }, { type: 'intent/flush' });
    expect(idle.app.table.hover).toBe(1);
    expect(sends(idle.effects)).toEqual([]);
    expect(intentTimers(idle.effects)).toEqual([]);
    const app = live(hosted());
    const onlyFirst = withView(app, { ...view(app), legal: [app.table.slots[0] ?? ''] });
    const overIllegal = run(onlyFirst, { type: 'hover/set', slot: 1 }, { type: 'intent/flush' });
    expect(intentOf(overIllegal.app)).toEqual(intentWire(0, null, 'hover'));
    expect(sends(overIllegal.effects)).toEqual([]);
    const gap: App = {
      ...app,
      table: {
        ...app.table,
        slots: [app.table.slots[0] ?? null, null, app.table.slots[2] ?? null],
      },
    };
    expect(intentOf(run(gap, { type: 'hover/set', slot: 1 }).app)).toEqual(
      intentWire(0, null, 'hover'),
    );
    const phone = run(revealed(local()), { type: 'hover/set', slot: 0 });
    expect(intentOf(phone.app)).toBeNull();
    expect(intentTimers(phone.effects)).toEqual([]);
    const room = run(
      initialApp,
      { type: 'home/init', home: { ...home, playMode: 'online' } },
      { type: 'host/click', name: 'Ann', players: '2' },
    ).app;
    expect(intentOf(run(room, { type: 'hover/set', slot: 0 }).app)).toBeNull();
  });

  test('host: a guest`s frame fills its seat`s mirror (last write wins), one claiming another seat is dropped, the 31st in a second is dropped in silence and the window reopens, a clear or guestGone empties the seat, a deal empties every seat', () => {
    const app = hosted();
    const hover = intentWire(1, 2, 'hover');
    const one = run(app, { type: 'host/frame', frame: hover });
    expect(one.app.table.mirror).toEqual([null, { slot: 2, mode: 'hover' }, null, null]);
    expect(one.app.table.budget[1]).toEqual({ at: NOW, n: 1 });
    expect(one.effects).toEqual([]);
    const two = run(one.app, { type: 'host/frame', frame: intentWire(1, 0, 'raised') });
    expect(two.app.table.mirror[1]).toEqual({ slot: 0, mode: 'raised' });
    expect(run(two.app, { type: 'host/frame', frame: intentWire(0, 1, 'hover') }).app).toBe(
      two.app,
    );
    expect(run(two.app, { type: 'host/frame', frame: intentWire(3, 1, 'hover') }).app).toBe(
      two.app,
    );
    expect(
      run(two.app, { type: 'host/frame', frame: intentWire(1, null, 'raised') }).app.table
        .mirror[1],
    ).toBeNull();
    // The budget over a moving clock: thirty in a second pass, the thirty-first is dropped, a second later the window is fresh.
    const clock = { now: NOW };
    const timed = runIntents(reduce, { rng: mulberry32(7), now: () => clock.now });
    const frames = Array.from({ length: INTENT_BUDGET }, (_, i) => ({
      type: 'host/frame' as const,
      frame: intentWire(1, SLOTS[i % 3] ?? 0, 'hover'),
    }));
    const spent = timed(app, ...frames);
    expect(spent.app.table.budget[1]).toEqual({ at: NOW, n: INTENT_BUDGET });
    expect(spent.app.table.mirror[1]).toEqual({ slot: 2, mode: 'hover' });
    const over = timed(spent.app, { type: 'host/frame', frame: intentWire(1, null, 'hover') });
    expect(over.app).toBe(spent.app);
    clock.now = NOW + INTENT_WINDOW_MS;
    const fresh = timed(spent.app, { type: 'host/frame', frame: intentWire(1, null, 'hover') });
    expect(fresh.app.table.mirror[1]).toBeNull();
    expect(fresh.app.table.budget[1]).toEqual({ at: NOW + INTENT_WINDOW_MS, n: 1 });
    // The guest gone: its seat's mirror goes with it.
    expect(
      run(two.app, { type: 'host/guestGone', iceFailed: null }).app.table.mirror[1],
    ).toBeNull();
    // A frame in the waiting room is kept until the deal, which empties every seat.
    const room = run(
      initialApp,
      { type: 'home/init', home: { ...home, playMode: 'online' } },
      { type: 'host/click', name: 'Ann', players: '2' },
      { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } },
      { type: 'host/frame', frame: hover },
    ).app;
    expect(room.table.mirror[1]).toEqual({ slot: 2, mode: 'hover' });
    expect(run(room, { type: 'host/deal' }).app.table.mirror).toEqual([null, null, null, null]);
  });

  test('guest: the host`s frame fills seat 0`s mirror, one naming my own seat is dropped, a re-sent view keeps it and that seat`s hand change clears it; a reconnect re-sends a held lift once', () => {
    const g = createGame(
      [
        { id: 'host', name: 'Ann' },
        { id: 'guest', name: 'Jeff' },
      ],
      { gamesToWin: 1 },
      mulberry32(3),
      () => NOW,
    );
    const v1 = viewFor(g, 1);
    const joined = run(
      initialApp,
      { type: 'join/click', name: 'Jeff', code: 'ABCD' },
      { type: 'guest/frame', frame: lobby('Ann', DEFAULT_OPTS, [], 1) },
      { type: 'guest/connected' },
      { type: 'guest/frame', frame: stateFrame(v1) },
    ).app;
    const shown = run(joined, { type: 'guest/frame', frame: intentWire(0, 1, 'raised') });
    expect(shown.app.table.mirror).toEqual([{ slot: 1, mode: 'raised' }, null, null, null]);
    expect(shown.effects).toEqual([]);
    expect(run(shown.app, { type: 'guest/frame', frame: intentWire(1, 0, 'hover') }).app).toBe(
      shown.app,
    );
    const again = run(shown.app, { type: 'guest/frame', frame: stateFrame(v1) }).app;
    expect(again.table.mirror[0]).toEqual({ slot: 1, mode: 'raised' });
    const fewer = {
      ...v1,
      others: v1.others.map((o) => (o.idx === 0 ? { ...o, handCount: o.handCount - 1 } : o)),
    };
    expect(
      run(again, { type: 'guest/frame', frame: stateFrame(fewer) }).app.table.mirror[0],
    ).toBeNull();
    // My own lift goes out as the guest's seat; the reconnect forgets it was sent, so the held lift is re-sent exactly once.
    const mine = live(joined);
    const id = mine.table.slots[0] ?? '';
    const held = run(mine, { type: 'card/tap', cardId: id }, { type: 'intent/flush' });
    const raised = intentWire(1, slotOf(mine, 0), 'raised');
    expect(sends(held.effects)).toEqual([raised]);
    const back = run(held.app, { type: 'guest/connected' });
    expect(back.app.table.sent).toBeNull();
    expect(intentTimers(back.effects)).toEqual(armedOnce);
    const resent = run(back.app, { type: 'intent/flush' });
    expect(sends(resent.effects)).toEqual([raised]);
    expect(sends(run(resent.app, { type: 'intent/flush' }).effects)).toEqual([]);
  });
});

describe('hosting and joining three and four seats (docs/design/n-seat-sessions.md §7)', () => {
  const opts3 = { ...DEFAULT_OPTS, seatCount: 3 as const };
  const opts4 = { ...DEFAULT_OPTS, seatCount: 4 as const };
  const opened = (players: '3' | '4'): Step =>
    run(
      initialApp,
      { type: 'home/init', home: { ...home, playMode: 'online' } },
      { type: 'host/click', name: 'Ann', players },
    );
  const join = (name: string, seat: 1 | 2 | 3): Intent => ({
    type: 'host/frame',
    frame: { t: 'join', name },
    seat,
  });
  /** Ann's table of three, Bob at seat 1 and Cara at seat 2. */
  const seated3 = (): App => run(opened('3').app, join('Bob', 1), join('Cara', 2)).app;
  const dealt3 = (): App => run(seated3(), { type: 'host/deal' }).app;
  type Send = Extract<Effect, Readonly<{ type: 'send' }>>;
  const sent = (effects: ReadonlyArray<Effect>): ReadonlyArray<Send> =>
    effects.flatMap((e) => (e.type === 'send' ? [e] : []));

  test('host/click at three: two empty seats, the session told the capacity and the waiting copy, the context carrying the seats, the options remembered', () => {
    const { app, effects } = opened('3');
    expect(app.shell).toMatchObject({
      role: 'host',
      mySeat: 0,
      opts: opts3,
      seats: [EMPTY_SEAT, EMPTY_SEAT],
      startGameVisible: false,
      screen: 'hostWaitScreen',
    });
    expect(effects.find((e) => e.type === 'startHost')).toEqual({
      type: 'startHost',
      code: app.shell.code,
      attempt: 1,
      resume: false,
      capacity: 3,
      waiting: 'Waiting for 2 players to join',
    });
    expect(waitingMsg(3)).toBe('Waiting for 2 players to join');
    expect(waitingMsg(2)).toBe(WAITING_MSG);
    expect(effects.at(-1)).toEqual({ type: 'writeOpts', opts: opts3 });
    expect(hostContextOf(app)).toMatchObject({ seatCount: 3, seats: [EMPTY_SEAT, EMPTY_SEAT] });
    expect(opened('4').app.shell.seats).toEqual([EMPTY_SEAT, EMPTY_SEAT, EMPTY_SEAT]);
  });

  test('joins fill the seats the session names, each connected seat sent the lobby with the table and its own `you`; Start waits for the full table (fixed), the deal refused with the count until then', () => {
    const one = run(opened('3').app, join('Bob', 1));
    expect(one.app.shell.seats).toEqual([{ name: 'Bob', connected: true }, EMPTY_SEAT]);
    expect(one.app.shell).toMatchObject({
      oppName: 'Bob',
      oppConnected: true,
      startGameVisible: false,
      hostStatus: { text: 'Bob joined! Waiting for 1 more.' },
    });
    expect(sent(one.effects)).toEqual([
      { type: 'send', frame: lobby('Ann', opts3, one.app.shell.seats, 1), seat: 1 },
    ]);
    expect(sent(one.effects)[0]?.frame).toMatchObject({
      t: 'lobby',
      seats: one.app.shell.seats,
      you: 1,
    });
    expect(toasts(run(one.app, { type: 'host/deal' }).effects)).toEqual([
      ['2 of 3 seated — waiting for 1 more.', null],
    ]);
    const two = run(one.app, join('Cara', 2));
    expect(two.app.shell.seats).toEqual([
      { name: 'Bob', connected: true },
      { name: 'Cara', connected: true },
    ]);
    expect(two.app.shell).toMatchObject({
      startGameVisible: true,
      hostStatus: { text: joinedMsg('Cara') },
    });
    expect(sent(two.effects).map((e) => e.seat)).toEqual([1, 2]);
    expect(sent(two.effects)[1]?.frame).toEqual(lobby('Ann', opts3, two.app.shell.seats, 2));
    // A name is deduped against the host and every seat.
    const same = run(one.app, join('bob', 2));
    expect(same.app.shell.seats[1]?.name).toBe('bob 2');
  });

  test('host/deal at three: the host and both seats in order (ids host, guest, guest2), one state frame per seat with that seat`s view; an action is applied as the seat it came in on, a refusal is a toast frame to that seat alone', () => {
    const { app, effects } = run(seated3(), { type: 'host/deal' });
    const g = game(app);
    expect(g.players).toEqual([
      { id: 'host', name: 'Ann' },
      { id: 'guest', name: 'Bob' },
      { id: 'guest2', name: 'Cara' },
    ]);
    expect(g.options).toEqual(opts3);
    expect(g.hands).toHaveLength(3);
    expect(view(app)).toEqual(viewFor(g, 0));
    expect(app.shell.screen).toBe('tableScreen');
    expect(sent(effects)).toEqual([
      { type: 'send', frame: stateFrame(viewFor(g, 1)), seat: 1 },
      { type: 'send', frame: stateFrame(viewFor(g, 2)), seat: 2 },
    ]);
    const actor = actorOf(g) ?? 0;
    const other = ([1, 2] as const).find((seat) => seat !== actor) ?? 1;
    const wrong = run(app, {
      type: 'host/frame',
      frame: actionFrame({ type: 'play', cardId: g.hands[other]?.[0]?.id ?? '' }),
      seat: other,
    });
    expect(wrong.app.shell.game).toBe(g);
    expect(sent(wrong.effects)).toEqual([
      { type: 'send', frame: toastFrame(MESSAGES.NOT_YOUR_TURN), seat: other },
    ]);
    if (actor !== 0) {
      const played = run(app, {
        type: 'host/frame',
        frame: actionFrame({ type: 'play', cardId: g.hands[actor]?.[0]?.id ?? '' }),
        seat: actor,
      });
      expect(game(played.app).trick).toEqual([{ seat: actor, card: g.hands[actor]?.[0] }]);
      expect(sent(played.effects).map((e) => e.seat)).toEqual([1, 2]);
    }
  });

  test('a seat down mid-game pauses the trick: the toast names its player, the host`s hand is inert, a guest`s play is refused with who is missing; back by name (the session`s seat) the seat is renamed and everyone connected gets the view', () => {
    const app = dealt3();
    const gone = run(app, { type: 'host/guestGone', iceFailed: null, seat: 2 });
    expect(gone.app.shell.seats).toEqual([
      { name: 'Bob', connected: true },
      { name: 'Cara', connected: false },
    ]);
    expect(toasts(gone.effects)).toEqual([[guestGoneMsg('Cara', app.shell.code), GONE_TOAST_MS]]);
    expect(seatsDown(gone.app)).toEqual(['Cara']);
    expect(liveView(gone.app)).toBeNull();
    expect(pausedMsg(['Cara'])).toBe('Waiting for Cara to reconnect…');
    expect(pausedMsg(['Bob', 'Cara'])).toBe('Waiting for Bob and Cara to reconnect…');
    expect(listNames(['Ann', 'Bob', 'Cara'])).toBe('Ann, Bob and Cara');
    const g = game(app);
    const refused = run(gone.app, {
      type: 'host/frame',
      frame: actionFrame({ type: 'play', cardId: g.hands[1]?.[0]?.id ?? '' }),
      seat: 1,
    });
    expect(refused.app).toBe(gone.app);
    expect(refused.effects).toEqual([
      { type: 'send', frame: toastFrame('Waiting for Cara to reconnect…'), seat: 1 },
    ]);
    // Seat 1 is still up: nothing is paused for the guest's own view, and the host is not toasted twice.
    expect(seatsDown({ ...gone.app, shell: { ...gone.app.shell, role: 'guest' } })).toEqual([]);
    // Back: a join on seat 2 (the session reseated the name, D6) renames the seat and broadcasts.
    const back = run(gone.app, join('Cara', 2));
    expect(back.app.shell.seats[1]).toEqual({ name: 'Cara', connected: true });
    expect(game(back.app).players[2]?.name).toBe('Cara');
    expect(sent(back.effects).map((e) => e.seat)).toEqual([1, 2]);
    expect(seatsDown(back.app)).toEqual([]);
    expect(liveView(back.app)).toEqual(view(back.app).isMyTurn ? view(back.app) : null);
    // A seat never named is its number; ICE failed is the status alone, the seat kept as down.
    expect(seatGoneMsg(null, 'ABCD', 2)).toBe(guestGoneMsg('Seat 3', 'ABCD'));
    const iced = run(app, { type: 'host/guestGone', iceFailed: 'ICE failed', seat: 1 }).app;
    expect(iced.shell.hostStatus.text).toBe('ICE failed');
    expect(seatsDown(iced)).toEqual(['Bob']);
  });

  test('a seat leaving the lobby reads empty again with the count, Start hidden, the others told the new lobby', () => {
    const left = run(seated3(), { type: 'host/guestGone', iceFailed: null, seat: 1 });
    expect(left.app.shell.seats).toEqual([EMPTY_SEAT, { name: 'Cara', connected: true }]);
    expect(left.app.shell.hostStatus.text).toBe('Bob left. 2 of 3 seated.');
    expect(left.app.shell.startGameVisible).toBe(false);
    expect(sent(left.effects)).toEqual([
      { type: 'send', frame: lobby('Ann', opts3, left.app.shell.seats, 2), seat: 2 },
    ]);
  });

  test('the save carries the seat names; resume reopens the table at three with every seat named and down (the trick paused until they are back)', () => {
    const app = dealt3();
    const save = saveFor(app);
    expect(save).toMatchObject({ role: 'host', seatCount: 3, seatNames: ['Bob', 'Cara'] });
    const offer = resumeFor(save);
    expect(offer).toMatchObject({ kind: 'host', seatNames: ['Bob', 'Cara'] });
    const resumed = run(
      initialApp,
      { type: 'home/init', home: { ...home, playMode: 'online', save } },
      { type: 'resume/click' },
    );
    expect(resumed.app.shell).toMatchObject({
      role: 'host',
      code: app.shell.code,
      opts: opts3,
      seats: [
        { name: 'Bob', connected: false },
        { name: 'Cara', connected: false },
      ],
      game: game(app),
      screen: 'hostWaitScreen',
    });
    expect(resumed.effects.find((e) => e.type === 'startHost')).toMatchObject({
      code: app.shell.code,
      resume: true,
      capacity: 3,
      waiting: waitingMsg(3),
    });
    expect(seatsDown(resumed.app)).toEqual(['Bob', 'Cara']);
    expect(liveView(resumed.app)).toBeNull();
    // A two-seat save stays the legacy literal: no seat names.
    const two = run(
      initialApp,
      { type: 'home/init', home: { ...home, playMode: 'online' } },
      { type: 'host/click', name: 'Ann', players: '2' },
      { type: 'host/frame', frame: { t: 'join', name: 'Jeff' } },
      { type: 'host/deal' },
    ).app;
    expect(saveFor(two)).not.toHaveProperty('seatNames');
  });

  test('the guest at a table of four: welcome and lobby name my seat and list the table, the status counts the seated; full is the table`s copy; a state frame is my seat`s view', () => {
    const joining = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'join/click', name: 'Cara', code: 'ABCD' },
    ).app;
    const seats = [{ name: 'Bob', connected: true }, { name: null, connected: true }, EMPTY_SEAT];
    const welcomed = run(joining, {
      type: 'guest/frame',
      frame: welcome('Ann', opts4, seats, 2),
    }).app;
    expect(welcomed.shell).toMatchObject({ mySeat: 2, seats, opts: opts4, oppName: 'Ann' });
    expect(welcomed.shell.guestStatus.text).toBe(
      'Connected — 3 of 4 seated · waiting for Ann to deal',
    );
    const table = [
      seats[0] ?? EMPTY_SEAT,
      { name: 'Cara', connected: true },
      { name: 'Dan', connected: true },
    ];
    const named = run(welcomed, { type: 'guest/frame', frame: lobby('Ann', opts4, table, 2) }).app;
    expect(named.shell).toMatchObject({ mySeat: 2, seats: table });
    expect(named.shell.guestStatus.text).toBe(
      'Connected — 4 of 4 seated · waiting for Ann to deal',
    );
    expect(
      run(joining, { type: 'guest/frame', frame: fullFrame() }).app.shell.guestStatus.text,
    ).toBe(TABLE_FULL_MSG);
    const g = createGame(
      [
        { id: 'host', name: 'Ann' },
        { id: 'guest', name: 'Bob' },
        { id: 'guest2', name: 'Cara' },
        { id: 'guest3', name: 'Dan' },
      ],
      { gamesToWin: 1 },
      mulberry32(3),
      () => NOW,
    );
    const shown = run(
      named,
      { type: 'guest/connected' },
      { type: 'guest/frame', frame: stateFrame(viewFor(g, 2)) },
    ).app;
    expect(shown.shell.screen).toBe('tableScreen');
    expect(view(shown).me.idx).toBe(2);
    expect(view(shown).players.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Cara', 'Dan']);
    // A guest's own seat never reads as down: the pause is the host's.
    expect(seatsDown(shown)).toEqual([]);
  });

  test('the intent lane at three: the host relays a seat`s frame to every other connected seat and never back, not to a seat that is down; the mirror cleared is the seat that went', () => {
    const app = dealt3();
    const hover = intentWire(1, 0, 'hover');
    const relayed = run(app, { type: 'host/frame', frame: hover, seat: 1 });
    expect(relayed.app.table.mirror[1]).toEqual({ slot: 0, mode: 'hover' });
    expect(relayed.effects).toEqual([{ type: 'send', frame: hover, seat: 2 }]);
    const fromTwo = run(relayed.app, {
      type: 'host/frame',
      frame: intentWire(2, 1, 'raised'),
      seat: 2,
    });
    expect(fromTwo.effects).toEqual([{ type: 'send', frame: intentWire(2, 1, 'raised'), seat: 1 }]);
    const gone = run(fromTwo.app, { type: 'host/guestGone', iceFailed: null, seat: 2 }).app;
    expect(gone.table.mirror[1]).toEqual({ slot: 0, mode: 'hover' });
    expect(gone.table.mirror[2]).toBeNull();
    expect(run(gone, { type: 'host/frame', frame: hover, seat: 1 }).effects).toEqual([]);
  });
});
