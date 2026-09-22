// The stories catalogue (docs/design/gin-draw-ghost-slot.md §7, docs/design/gin-arrangement-and-
// discards.md §10): table states of the gin page, each an `App` the real paint renders as it is
// (`?story=<id>`, src/stories/boot.ts) and a record of what the table must then show. Every
// state is played through the engine alone from one seeded deal (`mulberry32(SEED)`, dealer 1, so
// Ann in seat 0 decides on the upcard first); the knock story searches the seeds from SEED up with
// a least-deadwood policy and takes the first deal that offers a knock, the two-ways story the
// first deal whose accepted hand melds two ways, the gin story rebuilds the deal's hands around a
// gin so the engine still computes its view, the three-rows story around a run of seven, and the
// two laid-off stories around the chain position of test/parity/gin.legacy.test.ts (4S then 5S
// onto A-2-3 of spades). The facts are derived from the engine state, the draw stage and the
// picture (never from the renderer), so the test beside this file (facts against the painted
// markup) and e2e/gin-stories.spec.ts (facts against the served DOM, geometry, screenshots) are
// independent oracles of the paint. `sameHandAs` names the story whose first ten slots must hold
// the same cards in the same places: the owner's "no cards would move position until you took an
// action" as an assertion. Pure data and pure builders: no DOM, no clock, no `?raw`, so vitest,
// Playwright and the page's own chunk all import it. Outside src/ui/** on purpose (the ui/
// coverage ratchet).
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import {
  HAND_SIZE,
  applyAction,
  createGame,
  makeCard,
  makeDeck,
  viewFor,
} from '../engine/index.ts';
import type {
  Action,
  Card,
  Cards,
  PendingDraw,
  Rank,
  Seat,
  State,
  Suit,
  View,
} from '../engine/types.ts';
import { DEFAULT_SORT, type SortMode } from '../storage.ts';
import { arrangedOf, toggleMeld, type HumanMelds } from '../ui/hand/arrange.ts';
import type { DrawStage } from '../ui/hand/draw.ts';
import {
  cardsOf,
  engineOf,
  inPlay,
  phoneRows,
  samePicture,
  settlePicture,
  type Picture,
} from '../ui/hand/picture.ts';
import { initialApp, type App } from '../ui/state.ts';

/** The seed of the deal every story but the seed searches plays from. */
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
/** The one sheet open over the table, by its overlay's id, or `none`. */
export type SheetState =
  'none' | 'meldOverlay' | 'arrangeOverlay' | 'discardsOverlay' | 'roundResultOverlay';
/** `#arrangeBtn`: disabled, enabled, or enabled and marked `due` (the picture differs from the arrangement asked for). */
export type ArrangeState = 'off' | 'idle' | 'due';

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
  /** `#hand .slot.human .card` ids in order: the melds the player made by hand. */
  human: ReadonlyArray<string>;
  /** `#hand[data-rows]`: the rows a phone lays the hand in. */
  rows: number;
  arrange: ArrangeState;
  /** The `.active` button of `#arrangeModes`. */
  sort: SortMode;
  stock: 'tappable' | 'idle';
  discard: 'tappable' | 'blocked' | 'idle';
  /** `#actions [data-act]` in order, with whether each is enabled. */
  actions: ReadonlyArray<StoryAction>;
  statusSub: string;
  sheet: SheetState;
  /** With the result sheet open: `#rrBody .meld-group.laid .card` ids, the cards laid off. */
  laidOff?: ReadonlyArray<string>;
  /** With the discarded-cards sheet open: the greyed chips, the ringed top, the toggle. */
  dc?: Readonly<{
    seen: ReadonlyArray<string>;
    held: ReadonlyArray<string>;
    top: string | null;
    withHand: boolean;
  }>;
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
/** Only a draw from the discard pile undoes (docs/design/gin-arrangement-and-discards.md §4). */
const undone = play(drewDiscard, 0, { type: 'undoDraw' });
const drawnId = drewStock.lastDrawn?.id ?? '';
/** Ann discards for the least deadwood but keeps the card she drew, so its dot survives her turn. */
const discarded = play(drewStock, 0, {
  type: 'discard',
  cardId: bestDiscard(drewStock, 0, drawnId),
});

// ---- pictures --------------------------------------------------------------------------------------

/** The turn-start arrangement of `seat` over `state`: the engine's melding, nothing hand-made. */
const startOf = (state: State, seat: Seat): Picture => engineOf(viewFor(state, seat), null);

/** The picture after a draw from `before` was accepted: the turn-start picture, the drawn card loose at its end. */
const acceptedFrom = (before: State, after: State, seat: Seat): Picture =>
  settlePicture(startOf(before, seat), viewFor(after, seat), null, () => startOf(after, seat));

/** The picture after a discard from `accepted`: the discarded card gone in place. */
const discardedFrom = (accepted: Picture, after: State, seat: Seat): Picture =>
  settlePicture(accepted, viewFor(after, seat), null, () => startOf(after, seat));

/** Ann's accepted stock draw, the drawn card loose at the end: the picture the accepted stories keep. */
const acceptedPicture = acceptedFrom(openDraw, drewStock, 0);

/**
 * Turns after a stock draw, both seats discarding for the least deadwood and drawing from the
 * stock, until the player who just drew can knock; null when the hand ends first or `budget` is
 * spent. `before` is the draw phase the knock turn started from.
 */
const untilKnock = (
  beforeDraw: State,
  budget: number,
): Readonly<{ before: State; state: State; seat: Seat; cardId: string }> | null => {
  if (beforeDraw.phase !== 'draw' || budget === 0) return null;
  const state = play(beforeDraw, beforeDraw.turn, { type: 'drawStock' });
  if (state.phase !== 'discard') return null;
  const seat = state.turn;
  const cardId = knockCard(state, seat);
  if (cardId !== null) return { before: beforeDraw, state, seat, cardId };
  return untilKnock(
    play(state, seat, { type: 'discard', cardId: bestDiscard(state, seat) }),
    budget - 1,
  );
};

const knockAfter = (seed: number): ReturnType<typeof untilKnock> =>
  untilKnock(openingOf(seed).openDraw, 40);

/** The first seed from SEED whose deal offers a knock within forty policy turns. */
export const KNOCK_SEED =
  Array.from({ length: 32 }, (_, i) => SEED + i).find((seed) => knockAfter(seed) !== null) ?? SEED;
const knockable = knockAfter(KNOCK_SEED);
if (knockable === null) throw new Error('no seed from SEED offers a knock');
const knockState = knockable.state;
const knockSeat = knockable.seat;
/** The knocker's table once the hand is scored. */
const knocked = play(knockState, knockSeat, { type: 'knock', cardId: knockable.cardId });

/** Ann's accepted stock draw from `seed`, and the draw phase before it. */
const acceptedOf = (seed: number): Readonly<{ before: State; after: State }> => {
  const before = openingOf(seed).openDraw;
  return { before, after: play(before, 0, { type: 'drawStock' }) };
};

/** The first seed from SEED whose accepted first draw melds at least two ways. */
export const TWO_WAYS_SEED = Array.from({ length: 128 }, (_, i) => SEED + i).find(
  (seed) => viewFor(acceptedOf(seed).after, 0).meldOptions.length >= 2,
);
if (TWO_WAYS_SEED === undefined) throw new Error('no seed from SEED melds two ways');
const twoWays = acceptedOf(TWO_WAYS_SEED);
/** The two-ways hand as accepted: it melds, so it carries the stories that need a meld. */
const twoWaysPicture = acceptedFrom(twoWays.before, twoWays.after, 0);
/** A card out of that picture's first meld, discarded: the broken group stays in place. */
const meldCard = twoWaysPicture.groups[0]?.[0];
if (meldCard === undefined) throw new Error('the two-ways hand melds nothing before the draw');
const discardedFromMeld = play(twoWays.after, 0, { type: 'discard', cardId: meldCard.id });

/**
 * A long press on the first card of that meld: the meld made by hand, and the solver melds the
 * rest.
 */
const humanMeld = toggleMeld(null, twoWays.after.handNumber, twoWays.after.hands[0], meldCard.id);
if (humanMeld === null) throw new Error('the first meld card of the two-ways hand joins no meld');

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
 * Ann's discard phase with `mine` (eleven cards) dealt around: `theirs` is Bob's ten (the next ten
 * of the deck when null), then one card is the upcard and the rest the stock; the card named
 * counts as drawn from the stock (fresh, not undoable) and the engine computes the view.
 */
const dealtAround = (mine: Cards, theirs: Cards | null, drawnFromStock: string): State => {
  const held = new Set([...mine, ...(theirs ?? [])].map((c) => c.id));
  const rest = makeDeck().filter((c) => !held.has(c.id));
  const bob = theirs ?? rest.slice(0, HAND_SIZE);
  const undealt = theirs === null ? rest.slice(HAND_SIZE) : rest;
  const pendingDraw: PendingDraw = {
    from: 'stock',
    cardId: drawnFromStock,
    prevPhase: 'draw',
    prevUpcardStage: null,
    prevForceStock: false,
    prevTurn: 0,
  };
  return {
    ...drewStock,
    hands: [mine, bob],
    discard: undealt.slice(0, 1),
    stock: undealt.slice(1),
    turn: 0,
    phase: 'discard',
    upcardStage: null,
    drawnFromDiscard: null,
    forceStock: false,
    pendingDraw,
    meldPref: [null, null],
    lastDrawn: { p: 0, id: drawnFromStock },
    lastAction: { text: `${PLAYERS[0].name} drew from the stock.`, by: 0 },
  };
};

/** The gin hand dealt around, so `GIN!` comes from the engine's own `isGin`. */
const ginState = dealtAround(GIN_HAND, null, GIN_DISCARD);

// ---- the laid-off hand -------------------------------------------------------------------------

const RANKS: Readonly<Record<string, Rank>> = { A: 1, J: 11, Q: 12, K: 13 };
const isSuit = (s: string): s is Suit => s === 'S' || s === 'H' || s === 'D' || s === 'C';
const cardOf = (id: string): Card => {
  const suit = id.slice(-1);
  const label = id.slice(0, -1);
  if (!isSuit(suit)) throw new Error(`bad card id ${id}`);
  return makeCard(RANKS[label] ?? (Number(label) as Rank), suit);
};
const cardsOfIds = (ids: string): Cards => ids.split(' ').map(cardOf);

/**
 * The chain position of test/parity/gin.legacy.test.ts: Ann knocks with the KC on A-2-3 of spades,
 * 4-5-6 of hearts and 7-8-9 of diamonds (the 2C her deadwood); Bob lays off 4S then 5S onto the
 * spades and counts QD KD, twenty.
 */
const LAID_OFF_KNOCKER = cardsOfIds('AS 2S 3S 4H 5H 6H 7D 8D 9D 2C KC');
const LAID_OFF_DEFENDER = cardsOfIds('4S 5S 10H JH QH 7C 8C 9C QD KD');
const laidOffKnocked = play(dealtAround(LAID_OFF_KNOCKER, LAID_OFF_DEFENDER, 'KC'), 0, {
  type: 'knock',
  cardId: 'KC',
});

// ---- the three-row hand --------------------------------------------------------------------------

/** A run of seven spades declared as one meld: on a phone it wraps into its own two rows (§6). */
const SEVEN_RUN = '4S 5S 6S 7S 8S 9S 10S';
const KINGS = 'KC KD KH';
const threeRows = play(dealtAround(cardsOfIds(`${SEVEN_RUN} ${KINGS} 2C`), null, '2C'), 0, {
  type: 'setMelds',
  melds: [SEVEN_RUN.split(' '), KINGS.split(' ')],
});

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

/** The `shown` stage for a draw just made from `before`, and the picture from before the draw the ten slots keep. */
const shownFrom = (
  before: State,
  after: State,
  seat: Seat,
  from: 'stock' | 'discard',
): Readonly<{ stage: DrawStage; picture: Picture }> => ({
  stage: { kind: 'shown', from, cardId: after.lastDrawn?.id ?? '' },
  picture: startOf(before, seat),
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
    // Only a draw from the discard pile undoes (docs/design/gin-arrangement-and-discards.md §4).
    ...(state.pendingDraw?.from === 'discard' ? [{ act: 'undoDraw', enabled: true }] : []),
    { act: 'discard', enabled: scored !== null },
    { act: 'knock', enabled: scored?.canKnock === true },
  ];
};

/** The sheet the app's flags open over `state`: a chooser, the discards, or the result while not put away. */
const sheetOf = (state: State, app: Partial<App>): SheetState =>
  app.meldChooser === true
    ? 'meldOverlay'
    : app.arrangeOpen === true
      ? 'arrangeOverlay'
      : app.discardsOpen === true
        ? 'discardsOverlay'
        : state.phase === 'roundOver' && state.result !== null && app.resultDismissed !== true
          ? 'roundResultOverlay'
          : 'none';

/** With the discarded-cards sheet open: the pile's ids in deck order, my hand when included, the top. */
const dcOf = (
  state: State,
  seat: Seat,
  sheet: SheetState,
  app: Partial<App>,
): Partial<StoryFacts> => {
  if (sheet !== 'discardsOverlay') return {};
  const withHand = app.discardsWithHand === true;
  const deck = makeDeck().map((c) => c.id);
  const inDeckOrder = (ids: ReadonlyArray<string>): ReadonlyArray<string> =>
    deck.filter((id) => ids.includes(id));
  return {
    dc: {
      seen: inDeckOrder(state.discard.map((c) => c.id)),
      held: withHand ? inDeckOrder(state.hands[seat].map((c) => c.id)) : [],
      top: state.discard.at(-1)?.id ?? null,
      withHand,
    },
  };
};

/** With the result sheet open over a scored hand: the ids of the cards the defender laid off. */
const laidOffOf = (state: State, sheet: SheetState): Partial<StoryFacts> => {
  const result = state.result;
  return sheet === 'roundResultOverlay' && result !== null && !result.void
    ? { laidOff: result.opponent.laidOff.map((x) => x.card.id) }
    : {};
};

type Arrangement = Readonly<{ picture: Picture; human: HumanMelds | null; sort: SortMode }>;

/**
 * The facts of `seat`'s table over `state` under `stage` with `selected`, the arrangement and the
 * app's overlay flags, from the engine and the picture alone.
 */
const factsOf = (
  state: State,
  seat: Seat,
  stage: DrawStage | null,
  selected: string | null,
  arrangement: Arrangement,
  statusSub: string,
  app: Partial<App>,
): StoryFacts => {
  const view = viewFor(state, seat);
  const sheet = sheetOf(state, app);
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
  const { picture, human, sort } = arrangement;
  const arrangeable = inPlay(view) && stage === null;
  const asked = arrangedOf(view, stage, human, sort);
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
    human: cardsOf(picture)
      .filter((c) => picture.human.includes(c.id))
      .map((c) => c.id),
    rows: phoneRows(picture),
    arrange: !arrangeable ? 'off' : samePicture(picture, asked) ? 'idle' : 'due',
    sort,
    stock: canDrawStock ? 'tappable' : 'idle',
    discard:
      (mine && state.phase === 'upcard') || canDrawDiscard
        ? 'tappable'
        : canDrawStock && state.forceStock
          ? 'blocked'
          : 'idle',
    actions: actionsOf(state, seat, view, selectedId),
    statusSub,
    sheet,
    ...laidOffOf(state, sheet),
    ...dcOf(state, seat, sheet, app),
  };
};

type Spec = Readonly<{
  id: string;
  title: string;
  state: State;
  seat: Seat;
  statusSub: string;
  stage?: DrawStage;
  /** The kept picture; the arrangement asked for (`human`, `sort`) when absent. */
  picture?: Picture;
  human?: HumanMelds;
  sort?: SortMode;
  selected?: string;
  app?: Partial<App>;
  sameHandAs?: string;
  screenshot?: false;
}>;

const story = (spec: Spec): Story => {
  const stage = spec.stage ?? null;
  const selected = spec.selected ?? null;
  const human = spec.human ?? null;
  const sort = spec.sort ?? DEFAULT_SORT;
  const picture = spec.picture ?? arrangedOf(viewFor(spec.state, spec.seat), stage, human, sort);
  return {
    id: spec.id,
    title: spec.title,
    app: tableApp(spec.state, spec.seat, {
      draw: stage,
      selectedCard: selected,
      picture,
      human,
      sort,
      ...spec.app,
    }),
    facts: factsOf(
      spec.state,
      spec.seat,
      stage,
      selected,
      { picture, human, sort },
      spec.statusSub,
      spec.app ?? {},
    ),
    ...(spec.sameHandAs === undefined ? {} : { sameHandAs: spec.sameHandAs }),
    screenshot: spec.screenshot !== false,
  };
};

const SHOWN_SUB = 'Tap the new card to keep it, or pick a discard';
const OPEN_SUB = 'Tap the stock or the discard pile';
const SELECTED_SUB = 'Discard it, or knock if you can';
const ACCEPTED_SUB = 'Tap a card to select it';
const THEIRS_SUB = 'Drawing a card…';

/**
 * The sixteen stories of docs/design/gin-draw-ghost-slot.md §7 in its order, with the stories of
 * docs/design/gin-arrangement-and-discards.md §10 (the kept picture, Arrange, the chooser, the
 * three-row hand, the hand-made meld, the sort modes, the laid-off result) placed where they
 * belong in a turn.
 */
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
    statusSub: THEIRS_SUB,
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
    ...shownFrom(openDraw, drewStock, 0, 'stock'),
    statusSub: SHOWN_SUB,
    sameHandAs: 'draw-mine-open',
  }),
  story({
    id: 'drawn-discard-shown',
    title: 'Took the discard: the card waits locked in the ghost cell, the ten cards unmoved',
    state: drewDiscard,
    seat: 0,
    ...shownFrom(openDraw, drewDiscard, 0, 'discard'),
    statusSub: SHOWN_SUB,
    sameHandAs: 'draw-mine-open',
  }),
  story({
    id: 'taken-upcard-shown',
    title: 'Took the upcard: the card waits locked in the ghost cell, the ten cards unmoved',
    state: tookUpcard,
    seat: 0,
    ...shownFrom(dealt, tookUpcard, 0, 'discard'),
    statusSub: SHOWN_SUB,
    sameHandAs: 'upcard-mine',
  }),
  story({
    id: 'drawn-pending-guest',
    title: "A guest's draw awaiting the host's state: the ghost cell pending",
    state: openDraw,
    seat: 0,
    stage: { kind: 'waiting', from: 'stock' },
    statusSub: 'Drawing…',
    app: { role: 'guest', game: null, code: 'ABCD', oppName: PLAYERS[1].name },
  }),
  story({
    id: 'accepted-fresh',
    title:
      'Accepted the draw: the ten cards unmoved, the new one loose at the end with the dot, Discard disabled',
    state: drewStock,
    seat: 0,
    picture: acceptedPicture,
    statusSub: ACCEPTED_SUB,
    sameHandAs: 'draw-mine-open',
  }),
  story({
    id: 'arranged-after-accept',
    title: "Arranged after the accept: the engine's melding of the eleven, Arrange idle",
    state: drewStock,
    seat: 0,
    statusSub: ACCEPTED_SUB,
  }),
  story({
    id: 'accepted-selected',
    title: 'A card selected for the discard: Discard enabled, the deadwood-after readout',
    state: drewStock,
    seat: 0,
    picture: acceptedPicture,
    selected: bestDiscard(drewStock, 0),
    statusSub: SELECTED_SUB,
  }),
  story({
    id: 'accepted-knock',
    title: 'A knock available: Knock enabled with the deadwood count',
    state: knockState,
    seat: knockSeat,
    picture: acceptedFrom(knockable.before, knockState, knockSeat),
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
    id: 'accepted-two-ways',
    title: 'The accepted hand melds two ways: the ⇄ badge on the deadwood readout',
    state: twoWays.after,
    seat: 0,
    picture: twoWaysPicture,
    statusSub: ACCEPTED_SUB,
  }),
  story({
    id: 'meld-chooser-open',
    title: 'The meld chooser open over the two-ways hand: one option in use',
    state: twoWays.after,
    seat: 0,
    picture: twoWaysPicture,
    statusSub: ACCEPTED_SUB,
    app: { meldChooser: true },
  }),
  story({
    id: 'human-meld',
    title: 'A meld made by hand (long press): its cells marked, the solver melds the rest',
    state: twoWays.after,
    seat: 0,
    human: humanMeld,
    statusSub: ACCEPTED_SUB,
  }),
  story({
    id: 'sorted-by-rank',
    title: 'The accepted hand arranged by rank: groups by their lowest card, then the loose cards',
    state: drewStock,
    seat: 0,
    sort: 'rank',
    statusSub: ACCEPTED_SUB,
  }),
  story({
    id: 'sorted-by-suit',
    title: 'The accepted hand arranged by suit: spades, hearts, diamonds, clubs',
    state: drewStock,
    seat: 0,
    sort: 'suit',
    statusSub: ACCEPTED_SUB,
  }),
  story({
    id: 'arrange-sheet-open',
    title: 'The arrange sheet: the three sort modes, the current one active, the long-press hint',
    state: drewStock,
    seat: 0,
    picture: acceptedPicture,
    statusSub: ACCEPTED_SUB,
    app: { arrangeOpen: true },
  }),
  story({
    id: 'hand-three-rows',
    title: 'A run of seven with three kings: three rows on a phone, one on a laptop',
    state: threeRows,
    seat: 0,
    statusSub: ACCEPTED_SUB,
  }),
  story({
    id: 'undo-back-to-draw',
    title:
      'Undid the draw from the discard pile: the open ghost cell again, the same ten cards in the same cells',
    state: undone,
    seat: 0,
    statusSub: OPEN_SUB,
    sameHandAs: 'draw-mine-open',
    screenshot: false,
  }),
  story({
    id: 'after-discard-theirs',
    title: 'After my discard: their draw, the dot still on the card I kept, the picture kept',
    state: discarded,
    seat: 0,
    picture: discardedFrom(acceptedPicture, discarded, 0),
    statusSub: THEIRS_SUB,
  }),
  story({
    id: 'discarded-kept-picture',
    title: 'Discarded out of a meld: the broken group stays in place with dead cells, Arrange due',
    state: discardedFromMeld,
    seat: 0,
    picture: discardedFrom(twoWaysPicture, discardedFromMeld, 0),
    statusSub: THEIRS_SUB,
  }),
  story({
    id: 'discards-open',
    title: 'The discarded cards: four suit rows, the pile greyed, its top ringed',
    state: knockState,
    seat: knockSeat,
    picture: acceptedFrom(knockable.before, knockState, knockSeat),
    statusSub: ACCEPTED_SUB,
    app: { discardsOpen: true },
  }),
  story({
    id: 'discards-with-hand',
    title: 'The discarded cards with my hand included: my eleven greyed in gold',
    state: knockState,
    seat: knockSeat,
    picture: acceptedFrom(knockable.before, knockState, knockSeat),
    statusSub: ACCEPTED_SUB,
    app: { discardsOpen: true, discardsWithHand: true },
  }),
  story({
    id: 'round-over-table',
    title: 'Round over: the table behind the put-away result sheet, Show results',
    state: knocked,
    seat: knockSeat,
    statusSub: 'See results',
    app: { resultDismissed: true },
  }),
  story({
    id: 'round-over-laid-off',
    title:
      "Round over, the knocker's seat: the result sheet with the cards laid off onto her melds",
    state: laidOffKnocked,
    seat: 0,
    statusSub: 'See results',
    app: { resultDismissed: false },
  }),
  story({
    id: 'round-over-laid-off-defender',
    title: "Round over, the defender's seat: the same sheet, the laid-off cards under his deadwood",
    state: laidOffKnocked,
    seat: 1,
    statusSub: 'See results',
    app: { resultDismissed: false },
  }),
];

export const storyById = (id: string): Story | null => STORIES.find((s) => s.id === id) ?? null;

/** The card ids of the first ten slots as the picture orders them, which `sameHandAs` pairs share. */
export const heldCards = (story: Story): ReadonlyArray<string> => {
  const view = story.app.view;
  if (view === null) return [];
  const picture =
    story.app.picture ?? arrangedOf(view, story.app.draw, story.app.human, story.app.sort);
  return cardsOf(picture)
    .map((c) => c.id)
    .slice(0, HAND_SIZE);
};
