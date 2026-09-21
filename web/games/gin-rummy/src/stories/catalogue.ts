// The stories catalogue (docs/design/gin-draw-ghost-slot.md §7): sixteen table states of the gin
// page, each an `App` the real paint renders as it is (`?story=<id>`, src/stories/boot.ts) and a
// record of what the table must then show. Every state is played through the engine alone from
// one seeded deal (`mulberry32(SEED)`, dealer 1, so Ann in seat 0 decides on the upcard first);
// the knock story searches the seeds from SEED up with a least-deadwood policy and takes the first
// deal that offers a knock, and the gin story rebuilds the deal's hands around a gin so the engine
// still computes its view. The facts are derived from the engine state and the draw stage (never
// from the renderer), so the test beside this file (facts against the painted markup) and
// e2e/gin-stories.spec.ts (facts against the served DOM, geometry, screenshots) are independent
// oracles of the paint. `sameHandAs` names the story whose first ten slots must hold the same
// cards in the same places: the owner's "no cards would move position until you took an action"
// as an assertion. Pure data and pure builders: no DOM, no clock, no `?raw`, so vitest, Playwright
// and the page's own chunk all import it. Outside src/ui/** on purpose (the ui/ coverage ratchet).
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import {
  HAND_SIZE,
  applyAction,
  createGame,
  makeCard,
  makeDeck,
  viewFor,
} from '../engine/index.ts';
import type { Action, Cards, PendingDraw, Seat, State, View } from '../engine/types.ts';
import { holdOf, type DrawStage } from '../ui/hand/draw.ts';
import { initialApp, type App } from '../ui/state.ts';

/** The seed of the deal every story but the knock search plays from. */
export const SEED = 12;
/** The clock every story reads: the epoch of the other gin oracles. */
export const EPOCH = 1_700_000_000_000;
const now = (): number => EPOCH;
const PLAYERS = [
  { id: 'p1', name: 'Ann' },
  { id: 'p2', name: 'Bob' },
] as const;

/** The ghost cell's class, or `none` when the eleven cards fill the grid and no cell is emitted. */
export type GhostState = 'none' | 'hidden' | 'open' | 'pending' | 'shown';
export type StoryAction = Readonly<{ act: string; enabled: boolean }>;

/** What the table must show for a story, in the terms the DOM exposes. */
export type StoryFacts = Readonly<{
  /** `#hand .slot` count: always eleven (ten cards and the ghost cell, or eleven cards). */
  slots: number;
  /** `#hand .slot .card[data-card]` count: the held cards plus the drawn card in the ghost cell. */
  handCards: number;
  ghost: GhostState;
  freshId: string | null;
  lockedId: string | null;
  selectedId: string | null;
  stock: 'tappable' | 'idle';
  discard: 'tappable' | 'blocked' | 'idle';
  /** `#actions [data-act]` in order, with whether each is enabled. */
  actions: ReadonlyArray<StoryAction>;
  statusSub: string;
}>;

export type Story = Readonly<{
  /** kebab-case, unique; the `?story=` value and the screenshot file's stem. */
  id: string;
  title: string;
  app: App;
  facts: StoryFacts;
  /** A story whose first ten slots hold the same cards in the same places. */
  sameHandAs?: string;
  /** Compared against the committed per-platform baseline (false: DOM and geometry only). */
  screenshot: boolean;
}>;

// ---- the seeded game -----------------------------------------------------------------------------

const play = (state: State, seat: Seat, action: Action): State => {
  const applied = applyAction(state, seat, action, mulberry32(SEED), now);
  if (!applied.ok) throw new Error(`story game refused ${action.type}: ${applied.error}`);
  return applied.value;
};

type Option = Readonly<{ id: string; deadwood: number; canKnock: boolean }>;

/** The seat's discard options in hand order, the locked card and `exclude` left out. */
const options = (
  state: State,
  seat: Seat,
  exclude: string | null = null,
): ReadonlyArray<Option> => {
  const view = viewFor(state, seat);
  return view.me.hand.flatMap((c): ReadonlyArray<Option> => {
    const option = view.discardOptions?.[c.id];
    return option === undefined || 'locked' in option || c.id === exclude
      ? []
      : [{ id: c.id, deadwood: option.deadwood, canKnock: option.canKnock }];
  });
};

/** The discard that leaves the least deadwood (the first in hand order on a tie). */
const bestDiscard = (state: State, seat: Seat, exclude: string | null = null): string => {
  const best = options(state, seat, exclude).reduce<Option | null>(
    (acc, o) => (acc === null || o.deadwood < acc.deadwood ? o : acc),
    null,
  );
  if (best === null) throw new Error('story game has no discard to make');
  return best.id;
};

/** The first card whose discard lets the seat knock, or null. */
const knockCard = (state: State, seat: Seat): string | null =>
  options(state, seat).find((o) => o.canKnock)?.id ?? null;

/**
 * The opening every story shares, from one seed: Ann passes the upcard, Bob takes it and discards
 * for the least deadwood, so Ann faces an open draw (both piles) rather than the forced stock.
 */
const openingOf = (
  seed: number,
): Readonly<{ dealt: State; passedOnce: State; openDraw: State }> => {
  const dealt = createGame({ players: PLAYERS, target: 100, dealer: 1 }, mulberry32(seed), now);
  const passedOnce = play(dealt, 0, { type: 'passUpcard' });
  const dealerTook = play(passedOnce, 1, { type: 'takeUpcard' });
  const openDraw = play(dealerTook, 1, { type: 'discard', cardId: bestDiscard(dealerTook, 1) });
  return { dealt, passedOnce, openDraw };
};

const opening = openingOf(SEED);
/** Ann's upcard decision. */
const dealt = opening.dealt;
/** Both passed: Ann must draw from the stock. */
const bothPassed = play(opening.passedOnce, 1, { type: 'passUpcard' });
/** Ann's open draw (Bob took the upcard and discarded). */
const openDraw = opening.openDraw;
const tookUpcard = play(dealt, 0, { type: 'takeUpcard' });
const drewStock = play(openDraw, 0, { type: 'drawStock' });
const drewDiscard = play(openDraw, 0, { type: 'drawDiscard' });
const undone = play(drewStock, 0, { type: 'undoDraw' });
const drawnId = drewStock.lastDrawn?.id ?? '';
/** Ann discards for the least deadwood but keeps the card she drew, so its dot survives her turn. */
const discarded = play(drewStock, 0, {
  type: 'discard',
  cardId: bestDiscard(drewStock, 0, drawnId),
});

/**
 * Turns after a stock draw, both seats discarding for the least deadwood and drawing from the
 * stock, until the player who just drew can knock; null when the hand ends first or `budget` is
 * spent.
 */
const untilKnock = (
  state: State,
  budget: number,
): Readonly<{ state: State; seat: Seat; cardId: string }> | null => {
  if (state.phase !== 'discard' || budget === 0) return null;
  const seat = state.turn;
  const cardId = knockCard(state, seat);
  if (cardId !== null) return { state, seat, cardId };
  const next = play(state, seat, { type: 'discard', cardId: bestDiscard(state, seat) });
  if (next.phase !== 'draw') return null;
  return untilKnock(play(next, next.turn, { type: 'drawStock' }), budget - 1);
};

const knockAfter = (seed: number): ReturnType<typeof untilKnock> =>
  untilKnock(play(openingOf(seed).openDraw, 0, { type: 'drawStock' }), 40);

/** The first seed from SEED whose deal offers a knock within forty policy turns. */
export const KNOCK_SEED =
  Array.from({ length: 32 }, (_, i) => SEED + i).find((seed) => knockAfter(seed) !== null) ?? SEED;
const knockable = knockAfter(KNOCK_SEED);
if (knockable === null) throw new Error('no seed from SEED offers a knock');
const knockState = knockable.state;
const knockSeat = knockable.seat;
/** The knocker's table once the hand is scored. */
const knocked = play(knockState, knockSeat, { type: 'knock', cardId: knockable.cardId });

// ---- the gin hand ------------------------------------------------------------------------------------

/** Three aces, the 5-8 of spades, three kings, and the deuce whose discard is gin. */
const GIN_HAND: Cards = [
  makeCard(1, 'S'),
  makeCard(1, 'H'),
  makeCard(1, 'D'),
  makeCard(5, 'S'),
  makeCard(6, 'S'),
  makeCard(7, 'S'),
  makeCard(8, 'S'),
  makeCard(13, 'C'),
  makeCard(13, 'D'),
  makeCard(13, 'H'),
  makeCard(2, 'C'),
];
const GIN_DISCARD = '2C';

/**
 * Ann's discard phase with the gin hand dealt around: the rest of the deck is Bob's ten, the
 * upcard and the stock, the deuce counts as drawn from the stock (fresh, undoable) and the engine
 * computes the view, so `GIN!` comes from its own `isGin`.
 */
const ginState = ((): State => {
  const ginIds = new Set(GIN_HAND.map((c) => c.id));
  const rest = makeDeck().filter((c) => !ginIds.has(c.id));
  const pendingDraw: PendingDraw = {
    from: 'stock',
    cardId: GIN_DISCARD,
    prevPhase: 'draw',
    prevUpcardStage: null,
    prevForceStock: false,
    prevTurn: 0,
  };
  return {
    ...drewStock,
    hands: [GIN_HAND, rest.slice(0, HAND_SIZE)],
    discard: rest.slice(HAND_SIZE, HAND_SIZE + 1),
    stock: rest.slice(HAND_SIZE + 1),
    turn: 0,
    phase: 'discard',
    upcardStage: null,
    drawnFromDiscard: null,
    forceStock: false,
    pendingDraw,
    meldPref: [null, null],
    lastDrawn: { p: 0, id: GIN_DISCARD },
    lastAction: { text: `${PLAYERS[0].name} drew from the stock.`, by: 0 },
  };
})();

// ---- apps and facts ---------------------------------------------------------------------------------

/** A pass-and-play table showing `seat`'s view, the phone revealed to that seat. */
const tableApp = (game: State, seat: Seat, over: Partial<App> = {}): App => ({
  ...initialApp,
  role: 'local',
  oppConnected: true,
  game,
  view: viewFor(game, seat),
  screen: 'tableScreen',
  revealed: seat,
  draw: null,
  ...over,
});

/** The `shown` stage for a draw just made from `before`: the hold is the picture before the draw. */
const shownFrom = (
  before: State,
  after: State,
  seat: Seat,
  from: 'stock' | 'discard',
): DrawStage => ({
  kind: 'shown',
  from,
  cardId: after.lastDrawn?.id ?? '',
  hold: holdOf(viewFor(before, seat).me),
});

const actionsOf = (
  state: State,
  seat: Seat,
  view: View,
  selectedId: string | null,
): ReadonlyArray<StoryAction> => {
  if (state.phase === 'roundOver') return [{ act: 'showResult', enabled: true }];
  if (state.turn !== seat) return [];
  if (state.phase === 'upcard')
    return [
      { act: 'passUpcard', enabled: true },
      { act: 'takeUpcard', enabled: true },
    ];
  if (state.phase !== 'discard') return [];
  const option = selectedId === null ? undefined : view.discardOptions?.[selectedId];
  const scored = option !== undefined && !('locked' in option) ? option : null;
  return [
    ...(state.pendingDraw === null ? [] : [{ act: 'undoDraw', enabled: true }]),
    { act: 'discard', enabled: scored !== null },
    { act: 'knock', enabled: scored?.canKnock === true },
  ];
};

/** The facts of `seat`'s table over `state` under `stage` with `selected`, from the engine alone. */
const factsOf = (
  state: State,
  seat: Seat,
  stage: DrawStage | null,
  selected: string | null,
  statusSub: string,
): StoryFacts => {
  const view = viewFor(state, seat);
  const hand = state.hands[seat];
  const mine = state.turn === seat;
  const shown = stage?.kind === 'shown' ? stage : null;
  const drawing = mine && (state.phase === 'upcard' || state.phase === 'draw');
  const ghost: GhostState =
    stage?.kind === 'waiting'
      ? 'pending'
      : shown !== null
        ? 'shown'
        : hand.length > HAND_SIZE
          ? 'none'
          : drawing
            ? 'open'
            : 'hidden';
  const lastDrawn = state.lastDrawn ?? null;
  const kept =
    lastDrawn !== null && lastDrawn.p === seat && hand.some((c) => c.id === lastDrawn.id)
      ? lastDrawn.id
      : null;
  const canDrawStock = mine && state.phase === 'draw';
  const canDrawDiscard = canDrawStock && !state.forceStock && state.discard.length > 0;
  const selectedId = stage === null ? selected : null;
  return {
    slots: Math.max(hand.length, HAND_SIZE + 1),
    handCards: hand.length,
    ghost,
    freshId: shown === null ? kept : shown.cardId,
    lockedId:
      shown === null
        ? mine && state.phase === 'discard'
          ? state.drawnFromDiscard
          : null
        : shown.from === 'discard'
          ? shown.cardId
          : null,
    selectedId,
    stock: canDrawStock ? 'tappable' : 'idle',
    discard:
      (mine && state.phase === 'upcard') || canDrawDiscard
        ? 'tappable'
        : canDrawStock && state.forceStock
          ? 'blocked'
          : 'idle',
    actions: actionsOf(state, seat, view, selectedId),
    statusSub,
  };
};

type Spec = Readonly<{
  id: string;
  title: string;
  state: State;
  seat: Seat;
  statusSub: string;
  stage?: DrawStage;
  selected?: string;
  app?: Partial<App>;
  sameHandAs?: string;
  screenshot?: false;
}>;

const story = (spec: Spec): Story => {
  const stage = spec.stage ?? null;
  const selected = spec.selected ?? null;
  return {
    id: spec.id,
    title: spec.title,
    app: tableApp(spec.state, spec.seat, { draw: stage, selectedCard: selected, ...spec.app }),
    facts: factsOf(spec.state, spec.seat, stage, selected, spec.statusSub),
    ...(spec.sameHandAs === undefined ? {} : { sameHandAs: spec.sameHandAs }),
    screenshot: spec.screenshot !== false,
  };
};

const SHOWN_SUB = 'Tap the new card to keep it, or pick a discard';
const OPEN_SUB = 'Tap the stock or the discard pile';
const SELECTED_SUB = 'Discard it, or knock if you can';

/** The sixteen stories of docs/design/gin-draw-ghost-slot.md §7, in its order. */
export const STORIES: ReadonlyArray<Story> = [
  story({
    id: 'upcard-mine',
    title: 'My upcard decision: the ghost cell open, the discard pile glowing, Pass and Take',
    state: dealt,
    seat: 0,
    statusSub: 'Take the upcard or pass',
  }),
  story({
    id: 'upcard-theirs',
    title: 'Their upcard decision: nothing to tap, the ghost cell hidden, the waiting note',
    state: dealt,
    seat: 1,
    statusSub: 'Deciding on the upcard…',
  }),
  story({
    id: 'draw-theirs',
    title: 'Their draw: nothing to tap, the ghost cell hidden, the waiting note',
    state: bothPassed,
    seat: 1,
    statusSub: 'Drawing a card…',
  }),
  story({
    id: 'draw-mine-open',
    title: 'My draw: the ghost cell open, the stock and the discard pile both glowing, no buttons',
    state: openDraw,
    seat: 0,
    statusSub: OPEN_SUB,
  }),
  story({
    id: 'draw-mine-forced',
    title: 'My draw after both passed: the discard pile blocked, the stock glowing',
    state: bothPassed,
    seat: 0,
    statusSub: 'Both passed — tap the stock to draw',
  }),
  story({
    id: 'drawn-stock-shown',
    title:
      'Drew from the stock: the card waits in the ghost cell with the dot, the ten cards unmoved',
    state: drewStock,
    seat: 0,
    stage: shownFrom(openDraw, drewStock, 0, 'stock'),
    statusSub: SHOWN_SUB,
    sameHandAs: 'draw-mine-open',
  }),
  story({
    id: 'drawn-discard-shown',
    title: 'Took the discard: the card waits locked in the ghost cell, the ten cards unmoved',
    state: drewDiscard,
    seat: 0,
    stage: shownFrom(openDraw, drewDiscard, 0, 'discard'),
    statusSub: SHOWN_SUB,
    sameHandAs: 'draw-mine-open',
  }),
  story({
    id: 'taken-upcard-shown',
    title: 'Took the upcard: the card waits locked in the ghost cell, the ten cards unmoved',
    state: tookUpcard,
    seat: 0,
    stage: shownFrom(dealt, tookUpcard, 0, 'discard'),
    statusSub: SHOWN_SUB,
    sameHandAs: 'upcard-mine',
  }),
  story({
    id: 'drawn-pending-guest',
    title: "A guest's draw awaiting the host's state: the ghost cell pending",
    state: openDraw,
    seat: 0,
    stage: { kind: 'waiting', from: 'stock', hold: holdOf(viewFor(openDraw, 0).me) },
    statusSub: 'Drawing…',
    app: { role: 'guest', game: null, code: 'ABCD', oppName: PLAYERS[1].name },
  }),
  story({
    id: 'accepted-fresh',
    title: 'Accepted the draw: eleven cards re-melded, the dot on the new one, Discard disabled',
    state: drewStock,
    seat: 0,
    statusSub: 'Tap a card to select it',
  }),
  story({
    id: 'accepted-selected',
    title: 'A card selected for the discard: Discard enabled, the deadwood-after readout',
    state: drewStock,
    seat: 0,
    selected: bestDiscard(drewStock, 0),
    statusSub: SELECTED_SUB,
  }),
  story({
    id: 'accepted-knock',
    title: 'A knock available: Knock enabled with the deadwood count',
    state: knockState,
    seat: knockSeat,
    selected: knockable.cardId,
    statusSub: SELECTED_SUB,
  }),
  story({
    id: 'accepted-gin',
    title: 'Gin: the GIN! label on the knock button',
    state: ginState,
    seat: 0,
    selected: GIN_DISCARD,
    statusSub: SELECTED_SUB,
  }),
  story({
    id: 'undo-back-to-draw',
    title: 'Undid the draw: the open ghost cell again, the same ten cards in the same cells',
    state: undone,
    seat: 0,
    statusSub: OPEN_SUB,
    sameHandAs: 'draw-mine-open',
    screenshot: false,
  }),
  story({
    id: 'after-discard-theirs',
    title: 'After my discard: their draw, the dot still on the card I kept',
    state: discarded,
    seat: 0,
    statusSub: 'Drawing a card…',
  }),
  story({
    id: 'round-over-table',
    title: 'Round over: the table behind the put-away result sheet, Show results',
    state: knocked,
    seat: knockSeat,
    statusSub: 'See results',
    app: { resultDismissed: true },
  }),
];

export const storyById = (id: string): Story | null => STORIES.find((s) => s.id === id) ?? null;

/**
 * The card ids of the first ten slots as the engine orders them: the held picture (the hold's
 * melds then its deadwood while a draw is staged, else the view's), which `sameHandAs` pairs share.
 */
export const heldCards = (story: Story): ReadonlyArray<string> => {
  const view = story.app.view;
  if (view === null) return [];
  const hold = story.app.draw === null ? holdOf(view.me) : story.app.draw.hold;
  return [...hold.melds.flat(), ...hold.deadwood].map((c) => c.id).slice(0, HAND_SIZE);
};
