// The stories catalogue (docs/design/briscola.md §5.6 "Stories"): table states of the briscola
// page, each an `App` the real paint renders as it is (`?story=<id>`, src/stories/boot.ts over the
// shared web/shared/ui/stories.ts) and a record of what the table must then show. Every state is
// played through the reducer alone (ui/state.ts `reduce`, the same one main.ts runs) from one
// seeded pass-and-play start (`mulberry32(SEED)`, the clock pinned at EPOCH): the deal for two,
// three and four seats, the reveal, a lift, a card laid, a trick held by the settle beat and
// settled, the two sheets, and positions seated through `sandbox/load` for the last three tricks,
// the result sheet and the match's end. The facts are derived from the App in the terms the DOM
// exposes (never from the renderer), so e2e/briscola-stories.spec.ts (facts against the served
// DOM, the geometry oracle, screenshots) is an independent oracle of the paint. Pure data and pure
// builders: no DOM, no clock, so vitest, Playwright and the page's own chunk all import it.
// Outside src/ui/** on purpose (the ui/ coverage ratchet). The `linea` pack is the page's default
// for the deck until a picture pack lands, so face art never re-records a baseline (§5.6).
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import {
  actorOf,
  cardById,
  createGame,
  deckFor,
  viewFor,
  withPosition,
  type Card,
  type Player,
  type Seat,
  type State,
} from '../engine/index.ts';
import {
  initialApp,
  liveView,
  reduce,
  resultOpen,
  type App,
  type Context,
  type Intent,
} from '../ui/state.ts';

/** The seed of every story's start (the deal, the dealer). */
export const SEED = 7;
/** The clock every story reads. */
export const EPOCH = 1_700_000_000_000;

export type SheetState = 'none' | 'lastTrickOverlay' | 'historyOverlay' | 'resultOverlay';

/** What the table must show for a story, in the terms the DOM exposes (design §5.6). */
export type StoryFacts = Readonly<{
  /** The screen shown: the table, or the end screen once the match is decided and settled. */
  screen: 'tableScreen' | 'endgameScreen';
  /** `#seats[data-players]`. */
  players: number;
  /** `#curtainOverlay` shown. */
  curtain: boolean;
  /** `#hand .slot .card` count (backs under the curtain count too). */
  handCards: number;
  /** `#hand.active` (else `inert`). */
  handLive: boolean;
  /** `#hand.hidden-cards`. */
  handDown: boolean;
  /** `#hand .card.selected[data-card]`, or none. */
  selected: string | null;
  /** `#trick .play .card` count (the held trick's through the beat). */
  trickCards: number;
  /** `#stock[data-count]` (before the draw through the beat). */
  stockCount: number;
  /** `#stock.empty`: one card (the trump) or none left. */
  stockEmpty: boolean;
  /** `#briscola.gone`. */
  briscolaGone: boolean;
  /** The one sheet open over the table, by its overlay's id, or `none`. */
  sheet: SheetState;
}>;

export type Story = Readonly<{
  /** kebab-case, unique; the `?story=` value and the screenshot file's stem. */
  id: string;
  title: string;
  app: App;
  facts: StoryFacts;
  /** Compared against the committed per-platform baseline (false: DOM and geometry only). */
  screenshot: boolean;
}>;

// ---- the seeded start and the reducer ------------------------------------------------------------

const NAMES: ReadonlyArray<string> = ['Ann', 'Bob', 'Cara', 'Dan'];

/** One story's context: its own rng from SEED, so every story's start deals the same for its count. */
const context = (): Context => ({ rng: mulberry32(SEED), now: () => EPOCH });

/** The App after `intents`, one reducer step each (the effects are the page's and dropped here). */
const run = (ctx: Context, app: App, intents: ReadonlyArray<Intent>): App =>
  intents.reduce((a, intent) => reduce(a, intent, ctx).app, app);

/** Pass and play for `n` seats from the home screen: the shell's `local/click` with the panel's raw values. */
const localStart = (ctx: Context, n: 2 | 3 | 4): App =>
  run(ctx, initialApp, [
    {
      type: 'local/click',
      p1: NAMES[0] ?? '',
      p2: NAMES[1] ?? '',
      localPlayers: String(n),
      localMatch: '2',
      ...(n >= 3 ? { p3: NAMES[2] } : {}),
      ...(n === 4 ? { p4: NAMES[3] } : {}),
    },
  ]);

const REVEAL: Intent = { type: 'curtain/reveal' };

/** The view shown, which every started story has. */
const viewOf = (app: App): NonNullable<App['shell']['view']> => {
  const v = app.shell.view;
  if (v === null) throw new Error('story without a view');
  return v;
};

/** The first legal card of the seat shown (deal order), as the e2e policy plays it. */
const firstLegal = (app: App): string => {
  const [first] = viewOf(app).legal;
  if (first === undefined) throw new Error('story: no legal card');
  return first;
};

/** Lift the first legal card and play it (`card/tap`, then `play/click`). */
const playFirst = (ctx: Context, app: App): App => {
  const lifted = run(ctx, app, [{ type: 'card/tap', cardId: firstLegal(app) }]);
  return run(ctx, lifted, [{ type: 'play/click' }]);
};

/** The curtain lifted if it is up (the seat whose turn continues has none). */
const revealed = (ctx: Context, app: App): App =>
  app.table.curtain === null ? app : run(ctx, app, [REVEAL]);

/** The settle beat run to its end: `settle/elapsed` until no stage is left (at most the three stages). */
const settled = (ctx: Context, app: App): App =>
  app.table.settle === null ? app : settled(ctx, run(ctx, app, [{ type: 'settle/elapsed' }]));

/** One whole trick from the table as it stands, each seat revealing and playing its first legal card, then the beat. */
const trick = (ctx: Context, app: App): App => {
  const n = viewOf(app).options.seatCount - viewOf(app).trick.length;
  const laid = Array.from({ length: n }).reduce<App>((a) => playFirst(ctx, revealed(ctx, a)), app);
  return settled(ctx, laid);
};

// ---- seated positions (E22 `withPosition`, loaded through `sandbox/load`) ----------------------------

const card = (id: string): Card => {
  const c = cardById(id);
  if (c === null) throw new Error(`story: ${id} is not a card`);
  return c;
};

type Position = Readonly<{
  hands: readonly [ReadonlyArray<string>, ReadonlyArray<string>];
  trumpCard: string;
  leader: Seat;
  wins?: readonly [number, number];
}>;

/**
 * A two-seat state with the stock out: `hands` by id, the rest of the deck already taken in deck
 * order (seat 0 the first even half), the deal event rewritten to the position's trump card.
 */
const position = (p: Position): State => {
  const players: readonly [Player, Player] = [
    { id: 'p1', name: NAMES[0] ?? '' },
    { id: 'p2', name: NAMES[1] ?? '' },
  ];
  const fresh = createGame(players, { gamesToWin: 2 }, mulberry32(SEED), () => EPOCH);
  const hands = p.hands.map((ids) => ids.map(card));
  const held = new Set(p.hands.flat());
  const rest = deckFor(fresh.options).filter((c) => !held.has(c.id));
  const half = Math.ceil(rest.length / 2 / 2) * 2;
  const piles: ReadonlyArray<ReadonlyArray<Card>> = [rest.slice(0, half), rest.slice(half)];
  const trumpCard = card(p.trumpCard);
  const seated = withPosition(fresh, hands, [], trumpCard, p.leader);
  const [deal] = fresh.events;
  return {
    ...seated,
    piles,
    trickNo: piles.reduce((sum, pile) => sum + pile.length, 0) / 2,
    match: { ...seated.match, wins: p.wins === undefined ? seated.match.wins : [...p.wins] },
    events:
      deal?.kind === 'deal'
        ? [{ ...deal, data: { dealer: deal.data.dealer, trumpCard } }]
        : seated.events,
  };
};

/** Ann's asso, tre and re di bastoni against Bob's small coppe under a spade trump: Ann takes every trick, 96-24. */
const LAST_THREE: Position = {
  hands: [
    ['AB', '3B', 'RB'],
    ['2C', '4C', '5C'],
  ],
  trumpCard: '7S',
  leader: 0,
};

/** The last three tricks played out from `p` by the first-legal policy, the beat settled: the result sheet, or the end screen. */
const playedOut = (ctx: Context, p: Position): App => {
  const start = run(ctx, revealed(ctx, localStart(ctx, 2)), [
    { type: 'position/load', state: position(p) },
  ]);
  const plays = Array.from({ length: 6 }).reduce<App>((a) => {
    const game = a.shell.game;
    const actor = game === null ? null : actorOf(game);
    if (game === null || actor === null) return a;
    const [cardId] = viewFor(game, actor).legal;
    return cardId === undefined
      ? a
      : run(ctx, a, [{ type: 'act', action: { type: 'play', cardId } }]);
  }, start);
  return settled(ctx, plays);
};

// ---- the facts ------------------------------------------------------------------------------------------

/** The facts of an App, derived as ui/render.ts paints them (the beat's `before`/`undrawn` reads). */
export const factsOf = (app: App): StoryFacts => {
  const v = viewOf(app);
  const settle = app.table.settle;
  const stockCount = v.stockCount + (settle === null ? 0 : settle.trick.drew.length);
  return {
    screen: app.shell.screen === 'endgameScreen' ? 'endgameScreen' : 'tableScreen',
    players: v.options.seatCount,
    curtain: app.table.curtain !== null,
    handCards: app.table.slots.filter((slot) => slot !== null).length,
    handLive: liveView(app) !== null,
    handDown: app.table.curtain !== null,
    selected: app.table.selected,
    trickCards: settle === null ? v.trick.length : settle.trick.cards.length,
    stockCount,
    stockEmpty: stockCount <= 1,
    briscolaGone: !(v.trumpOnTable || settle?.trick.trumpTaken === true),
    sheet: app.table.lastTrickOpen
      ? 'lastTrickOverlay'
      : app.table.historyOpen
        ? 'historyOverlay'
        : resultOpen(app) && !v.matchOver
          ? 'resultOverlay'
          : 'none',
  };
};

type Spec = Readonly<{ id: string; title: string; app: App; screenshot?: boolean }>;
const story = (s: Spec): Story => ({
  id: s.id,
  title: s.title,
  app: s.app,
  facts: factsOf(s.app),
  screenshot: s.screenshot ?? false,
});

// ---- the catalogue ----------------------------------------------------------------------------------------

/** Each story from its own context, so the shared rng never couples two stories. */
const chain = (build: (ctx: Context) => App): App => build(context());

const deal2 = chain((c) => localStart(c, 2));
const revealed2 = chain((c) => revealed(c, localStart(c, 2)));
const lifted2 = chain((c) => {
  const app = revealed(c, localStart(c, 2));
  return run(c, app, [{ type: 'card/tap', cardId: firstLegal(app) }]);
});
const onePlayed2 = chain((c) => playFirst(c, revealed(c, localStart(c, 2))));
const oneRevealed2 = chain((c) => revealed(c, playFirst(c, revealed(c, localStart(c, 2)))));
const hold2 = chain((c) => {
  const second = revealed(c, playFirst(c, revealed(c, localStart(c, 2))));
  return playFirst(c, second);
});
const settled2 = chain((c) => revealed(c, trick(c, localStart(c, 2))));
const lastTrick2 = chain((c) =>
  run(c, revealed(c, trick(c, localStart(c, 2))), [{ type: 'lastTrick/open' }]),
);
const history2 = chain((c) =>
  run(c, revealed(c, trick(c, localStart(c, 2))), [{ type: 'history/open' }]),
);
const deal3 = chain((c) => localStart(c, 3));
const revealed3 = chain((c) => revealed(c, localStart(c, 3)));
const deal4 = chain((c) => localStart(c, 4));
const revealed4 = chain((c) => revealed(c, localStart(c, 4)));
const stockEmpty2 = chain((c) =>
  run(c, revealed(c, localStart(c, 2)), [{ type: 'position/load', state: position(LAST_THREE) }]),
);
const result2 = chain((c) => playedOut(c, LAST_THREE));

export const STORIES: ReadonlyArray<Story> = [
  story({
    id: 'deal-2p',
    title: 'Two seats dealt: the curtain names the leader over a face-down hand',
    app: deal2,
    screenshot: true,
  }),
  story({
    id: 'revealed-2p',
    title: 'The leader revealed: three cards live, the briscola under a stock of 34',
    app: revealed2,
    screenshot: true,
  }),
  story({
    id: 'lifted-2p',
    title: 'A card lifted: the ring, the lift, Play enabled',
    app: lifted2,
  }),
  story({
    id: 'trick-one-played-2p',
    title: 'The leader has played: one card in the fan, the next curtain up',
    app: onePlayed2,
  }),
  story({
    id: 'trick-one-revealed-2p',
    title: 'The second seat revealed to one card on the table',
    app: oneRevealed2,
    screenshot: true,
  }),
  story({
    id: 'trick-full-2p-hold',
    title: 'The trick held: both cards in the fan, the taking card marked, the stock still 34',
    app: hold2,
    screenshot: true,
  }),
  story({
    id: 'after-settle-2p',
    title: 'Settled: the fan empty, the stock at 32, the winner revealed to lead',
    app: settled2,
  }),
  story({ id: 'last-trick-sheet-2p', title: 'The last trick on its sheet', app: lastTrick2 }),
  story({
    id: 'history-sheet-2p',
    title: 'The history sheet: the deal and one trick',
    app: history2,
  }),
  story({
    id: 'deal-3p',
    title: 'Three seats dealt: the curtain names the leader, the others told to look away',
    app: deal3,
  }),
  story({
    id: 'revealed-3p',
    title: 'Three seats revealed: right and left cells, a stock of 30',
    app: revealed3,
  }),
  story({
    id: 'deal-4p',
    title: 'Four seats dealt: three names told to look away',
    app: deal4,
    screenshot: true,
  }),
  story({
    id: 'revealed-4p',
    title: 'Four seats revealed: three cells, the team strip, a stock of 28',
    app: revealed4,
    screenshot: true,
  }),
  story({
    id: 'stock-empty-2p',
    title: 'The last three tricks: the stock a dashed outline, the briscola gone',
    app: stockEmpty2,
  }),
  story({
    id: 'result-win-2p',
    title: 'The game over: the result sheet, Ann wins 96-24',
    app: result2,
    screenshot: true,
  }),
];

export const storyById = (id: string): Story | null => STORIES.find((s) => s.id === id) ?? null;
