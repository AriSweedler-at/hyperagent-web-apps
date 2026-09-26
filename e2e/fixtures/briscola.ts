// Drives the briscola table through its DOM (docs/design/briscola.md §5.6 "Testability"): the
// pass-and-play start for two, three or four seats over the shell's `startLocal`
// (e2e/fixtures/shell.ts), the curtain's words, a card played by its id (the lift, then Play),
// the wait for the settle beat, the history sheet, and a position seated through
// `window.__briscola.setup`. The one thing read from the documented hook (`window.__briscola`,
// docs/ARCHITECTURE.md) is the engine's `View` (`readView`) and its event stream (`readEvents`),
// which the specs use as the oracle for what the DOM must show; positions are built here in node
// from the same engine the page runs (`briscolaPosition`). The sounds are spied on the hook's
// `fx` (the shared cue player main.ts hands the boot): `spyFx` replaces its `play` and `playedCues`
// reads the qualified table rows (ui/sound.ts) the reducer's `fx` effects named, in order.
import { expect, type Page } from '@playwright/test';

import {
  actorOf,
  applyAction,
  cardById,
  createGame,
  deckFor,
  viewFor,
  withPosition,
  type Action,
  type Card,
  type GameEvent,
  type Player,
  type Seat,
  type SeatCount,
  type State,
  type View,
} from '../../web/games/briscola/src/engine/index.ts';
import {
  CHIP_H,
  STRIP_WIDTHS,
  briscolaBox,
  cardWidth,
  coveredFraction,
  fits,
  layoutFor,
  sameAspect,
  stripWidth,
} from '../../web/games/briscola/src/ui/layout.ts';
import { mulberry32 } from '../../web/shared/lib/rng.ts';
import type { Box } from './boxes.ts';
import { TOL, fitsScript, frameScript, type Frame, type Viewport } from './geometry.ts';
import { DEFAULT_NAMES, reveal, startLocal, type Names } from './shell.ts';

export type { Viewport, Names };
export { DEFAULT_NAMES };

/** The seats of a pass-and-play game, two to four names (the inputs take 20 characters). */
export type LocalNames =
  | readonly [string, string]
  | readonly [string, string, string]
  | readonly [string, string, string, string];
export const LOCAL_NAMES: Readonly<Record<SeatCount, LocalNames>> = {
  2: DEFAULT_NAMES,
  3: ['Ann', 'Bob', 'Cara'],
  4: ['Ann', 'Bob', 'Cara', 'Dan'],
};

// ---- the hook -----------------------------------------------------------------------------------

/** The view the page holds for the seat it shows, as `window.__briscola.view()` returns it. */
export const readView = (page: Page): Promise<View | null> =>
  page.evaluate<View | null>('window.__briscola.view()');

/** A view the page must have (the table is up); throws with the reason otherwise. */
export const requireView = async (page: Page): Promise<View> => {
  const view = await readView(page);
  if (view === null) throw new Error('the page holds no game view');
  return view;
};

/** The match's event stream as the page's view carries it (`window.__briscola.events()`). */
export const readEvents = (page: Page): Promise<ReadonlyArray<GameEvent>> =>
  page.evaluate<ReadonlyArray<GameEvent>>('window.__briscola.events()');

/** The settle beat's stage, or null once the table is at rest (ui/state.ts `Table.settle`). */
export const readSettleStage = (page: Page): Promise<string | null> =>
  page.evaluate<string | null>('window.__briscola.app.table.settle?.stage ?? null');

/**
 * The beat waits for my tap to draw (ui/state.ts `awaitingDraw`, docs/design/briscola-battle.md
 * §3.1 DRAW): the stage is `draw` and the seat this device shows is among the drawers. The wait
 * has no timer, so a test that plays through a trick must tap (`tapToDraw`) or wait forever.
 */
export const readAwaitingDraw = (page: Page): Promise<boolean> =>
  page.evaluate<boolean>(
    `(() => { const s = window.__briscola.app.table.settle; return s !== null && s.stage === 'draw' && s.trick.drew.includes(s.me); })()`,
  );

/**
 * Tap to draw as a finger does: `#stock` (its click is `draw/tap`; the reducer takes it while the
 * beat waits and drops it otherwise, so a tap that lands after a collapse is harmless). The box
 * stays when the stock is out (`.stock.empty`), so the last card's draw taps the same place.
 */
export const tapToDraw = (page: Page): Promise<void> => page.locator('#stock').click();

/** An engine action through the reducer (`window.__briscola.act`), for every role. */
export const briscolaAct = (page: Page, action: Action): Promise<void> =>
  page.evaluate(`window.__briscola.act(${JSON.stringify(action)})`);

// ---- pass and play: the start and the curtain ----------------------------------------------------

/**
 * Start pass and play for `names.length` seats (the shell's `startLocal`: the switch, the two
 * names, Start) with the panel's count select and the third and fourth names filled first; the
 * room's other terms are fixed (one game per sitting, no house rules). Resolves with the table up
 * and the first curtain over it, naming the leader (the seat after the dealer).
 */
export const briscolaStartLocal = (
  page: Page,
  url: string,
  viewport: Viewport,
  names: LocalNames = LOCAL_NAMES[2],
): Promise<void> =>
  startLocal(page, url, viewport, [names[0], names[1]], async (p) => {
    const [, , p3, p4] = names;
    if (p3 !== undefined) {
      await p.locator('#localPlayersSel').selectOption(String(names.length));
      await expect(p.locator('#moreNames')).toBeVisible();
      await p.locator('#p3NameInput').fill(p3);
      if (p4 !== undefined) {
        await expect(p.locator('#p4NameInput')).toBeVisible();
        await p.locator('#p4NameInput').fill(p4);
      }
    }
  });

/** What the curtain says (design §5.1, ui/local.ts `curtainText`). */
export type Curtain = Readonly<{ title: string; sub: string; last: string; button: string }>;
export const briscolaCurtain = async (page: Page): Promise<Curtain> => {
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  return {
    title: await page.locator('#curtainTitle').innerText(),
    sub: await page.locator('#curtainSub').innerText(),
    last: await page.locator('#curtainLast').innerText(),
    button: await page.locator('#curtainBtn').innerText(),
  };
};

/** Hand the phone over: the seat behind the curtain taps its button; the curtain goes (the shell's). */
export const briscolaReveal = reveal;

/** The curtain lifted if it is up (a seat whose turn continues has none to lift). */
export const revealIfUp = async (page: Page): Promise<void> => {
  if (await page.locator('#curtainOverlay').isVisible()) await reveal(page);
};

// ---- the table ------------------------------------------------------------------------------------

/** The ids of the cards held, in slot order (`#hand .slot .card[data-card]`, design §5.6). */
export const heldCards = (page: Page): Promise<ReadonlyArray<string>> =>
  page.evaluate<ReadonlyArray<string>>(
    `Array.from(document.querySelectorAll('#hand .slot .card[data-card]')).map((c) => c.getAttribute('data-card'))`,
  );

/** The fan's cards in play order, each with the seat that laid it (`#trick .card[data-seat]`). */
export const trickShown = (page: Page): Promise<ReadonlyArray<readonly [string, string]>> =>
  page.evaluate<ReadonlyArray<readonly [string, string]>>(
    `Array.from(document.querySelectorAll('#trick .play .card')).map((c) => [c.getAttribute('data-card'), c.getAttribute('data-seat')])`,
  );

/**
 * Play the card `cardId` from the hand as a player does (design §5.4 "lift then play"): the curtain
 * lifted if it is up, one tap lifts the card (`selected`, the slot pressed), Play commits it.
 * Resolves once the fan shows the card (a completing card stays through the hold).
 */
export const playCard = async (page: Page, cardId: string): Promise<void> => {
  await revealIfUp(page);
  const card = page.locator(`#hand .card[data-card="${cardId}"]`);
  await expect(card).toHaveClass(/\bplayable\b/);
  await card.click();
  await expect(card).toHaveClass(/\bselected\b/);
  await expect(page.locator(`#hand .slot:has(.card[data-card="${cardId}"])`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const play = page.locator('#playBtn');
  await expect(play).toBeEnabled();
  await play.click();
  await expect(page.locator(`#trick .card[data-card="${cardId}"]`)).toHaveCount(1);
};

/**
 * The settle beat of trick `no` has run its course (ui/state.ts: hold, fly, draw, then the view
 * painted cold): the page's `lastTrick` is that trick, no stage is running and nothing is still
 * in the air. Resolves with the view then shown.
 */
export const waitForSettle = async (page: Page, no: number): Promise<View> => {
  await expect
    .poll(
      async () => {
        const [view, stage, awaiting] = await Promise.all([
          readView(page),
          readSettleStage(page),
          readAwaitingDraw(page),
        ]);
        // My draw waits for the tap (the phone holder's, D2 (a)): tap, then keep polling.
        if (awaiting) {
          await tapToDraw(page);
          return 'draw (tapped)';
        }
        return view?.lastTrick?.no === no && stage === null ? 'settled' : String(stage);
      },
      { timeout: 15_000 },
    )
    .toBe('settled');
  // Nothing shown is still in the air: a flying clone or a card hidden under one. (A table the
  // match's end has just hidden may keep the last fan's marks; they are not shown.)
  await expect(page.locator('.flyer:visible, .card.arriving:visible')).toHaveCount(0);
  return requireView(page);
};

/** Which card a seat plays: by default the first legal one (the engine's `legal`, my hand's ids in deal order). */
export type Policy = (view: View) => string;
export const FIRST_LEGAL: Policy = (v) => {
  const [first] = v.legal;
  if (first === undefined) throw new Error(`no legal card for seat ${String(v.me.idx)}`);
  return first;
};

/**
 * One whole trick from the table as it stands: every seat in turn lifts the curtain, plays what
 * `pick` says of its own view, and the phone passes; then the beat settles. Resolves with the
 * settled view (the winner's, who leads next, unless the game ended).
 */
export const playTrick = async (page: Page, pick: Policy = FIRST_LEGAL): Promise<View> => {
  const start = await requireView(page);
  const no = start.trickNo + 1;
  const plays = start.options.seatCount - start.trick.length;
  const play = async (left: number): Promise<void> => {
    if (left === 0) return;
    await revealIfUp(page);
    const v = await requireView(page);
    await playCard(page, pick(v));
    return play(left - 1);
  };
  await play(plays);
  return waitForSettle(page, no);
};

// ---- the sheets -----------------------------------------------------------------------------------

/** Open the history sheet: the topbar's 📜 from 900px, else the phone's menu row (design deviation 1). */
export const openHistory = async (page: Page): Promise<void> => {
  const btn = page.locator('#historyBtn');
  if (await btn.isVisible()) await btn.click();
  else {
    await page.locator('#menuBtn').click();
    await expect(page.locator('#menuOverlay')).toBeVisible();
    await page.locator('#menuHistoryBtn').click();
    await expect(page.locator('#menuOverlay')).toBeHidden();
  }
  await expect(page.locator('#historyOverlay')).toBeVisible();
};

export const closeHistory = async (page: Page): Promise<void> => {
  await page.locator('#closeHistoryBtn').click();
  await expect(page.locator('#historyOverlay')).toBeHidden();
};

/** The history rows as shown: each summary's text and whether it is expanded, oldest first. */
export type HistoryRow = Readonly<{
  id: string | null;
  kind: string | null;
  summary: string;
  open: boolean;
}>;
export const historyRows = (page: Page): Promise<ReadonlyArray<HistoryRow>> =>
  page.evaluate<ReadonlyArray<HistoryRow>>(
    `Array.from(document.querySelectorAll('#historyList .history-row')).map((d) => ({
  id: d.getAttribute('data-id'), kind: d.getAttribute('data-kind'),
  summary: d.querySelector('summary').innerText.replace(/\\s+/g, ' ').trim(), open: d.open }))`,
  );

/** The label/value pairs of one row's expanded detail (`dl.history-detail`), in order, as written (the theme uppercases the labels for display). */
export const historyDetail = (
  page: Page,
  id: number,
): Promise<ReadonlyArray<readonly [string, string]>> =>
  page.evaluate<ReadonlyArray<readonly [string, string]>>(
    `(() => { const dl = document.querySelector('#historyList .history-row[data-id="${String(id)}"] dl.history-detail');
  if (dl === null) return [];
  const dts = Array.from(dl.querySelectorAll('dt')); const dds = Array.from(dl.querySelectorAll('dd'));
  return dts.map((dt, i) => [dt.textContent.trim(), dds[i].textContent.trim()]); })()`,
  );

/**
 * The taken strips show the view's tricks (docs/design/briscola-battle.md §7 G): my `#myTricks`
 * and every other seat's `.seat-taken` carry one face-down `.chip` per trick that seat has taken
 * and say so in `data-count`; nothing is still in flight.
 */
export const expectChips = async (page: Page, v: View): Promise<void> => {
  const mine = v.tricks[v.me.idx] ?? 0;
  await expect(page.locator('#myTricks')).toHaveAttribute('data-count', String(mine));
  await expect(page.locator('#myTricks .chip')).toHaveCount(mine);
  await Promise.all(
    v.others.map(async (o) => {
      const strip = page.locator(
        `#seats .seat[data-seat="${String(o.idx)}"]:not([hidden]) .seat-taken`,
      );
      await expect(strip).toHaveAttribute('data-count', String(v.tricks[o.idx] ?? 0));
      await expect(strip.locator('.chip')).toHaveCount(v.tricks[o.idx] ?? 0);
    }),
  );
  await expect(page.locator('.chip.arriving')).toHaveCount(0);
  // The row is as wide as the twin says for that many chips: one chip, then a step more per chip
  // (the CSS's min()/max() over `--n` agrees with layout.ts chipStep).
  const measured = await page.evaluate<Readonly<{ w: number; width: number; aspect: number }>>(
    `(() => ({ w: document.getElementById('myTricks').getBoundingClientRect().width, width: window.innerWidth, aspect: Number(getComputedStyle(document.getElementById('tableScreen')).getPropertyValue('--aspect')) }))()`,
  );
  const predicted = stripWidth(mine, STRIP_WIDTHS[layoutFor(measured.width)].mine, measured.aspect);
  expect(
    Math.abs(measured.w - predicted),
    `#myTricks is ${String(measured.w)} wide for ${String(mine)} chips, the twin says ${String(predicted)}`,
  ).toBeLessThanOrEqual(1);
};

// ---- the sounds -------------------------------------------------------------------------------------

/**
 * The cue ids a phrase plays, in order, whatever its shape: a one-step row (`{cue, buzz}`), a
 * sequence (`{steps: [{cue}], ...}`), or null for silence. Read structurally so the spec holds
 * across the shared `Phrase` (web/shared/lib/sound/phrase.ts) and briscola's table.
 */
export const cuesOf = (phrase: unknown): ReadonlyArray<string> => {
  if (phrase === null || typeof phrase !== 'object') return [];
  const p = phrase as Readonly<{ steps?: unknown; cue?: unknown }>;
  if (Array.isArray(p.steps))
    return p.steps.flatMap((step: unknown) =>
      step !== null &&
      typeof step === 'object' &&
      typeof (step as { cue?: unknown }).cue === 'string'
        ? [(step as { cue: string }).cue]
        : [],
    );
  return typeof p.cue === 'string' ? [p.cue] : [];
};

/**
 * Spy the cue player: `window.__briscola.fx` is the object the boot's `fx` effect calls, so its
 * `play` (one row by name) and `playPhrases` (phrases already chosen) replaced record every cue the
 * reducer's effects named, flattened to the qualified ids of ui/sound.ts CUES in playing order
 * (`move.briscola` then the win for a trump's big trick), and play nothing.
 */
export const spyFx = (page: Page): Promise<void> =>
  page.evaluate(
    `(() => {
  const cuesOf = (p) => p === null || typeof p !== 'object' ? [] : Array.isArray(p.steps) ? p.steps.map((s) => s.cue) : typeof p.cue === 'string' ? [p.cue] : [];
  window.__playedCues = [];
  const fx = window.__briscola.fx;
  fx.play = (cue) => { window.__playedCues.push(cue); };
  fx.playPhrases = (phrases) => { phrases.forEach((p) => window.__playedCues.push(...cuesOf(p))); };
})()`,
  );

/** The cues played since the spy was installed (or last cleared), in order. */
export const playedCues = (page: Page): Promise<ReadonlyArray<string>> =>
  page.evaluate<ReadonlyArray<string>>('window.__playedCues ?? []');

export const clearCues = (page: Page): Promise<void> => page.evaluate('window.__playedCues = []');

// ---- positions ---------------------------------------------------------------------------------------

/**
 * Seat a position through `window.__briscola.setup` (pass-and-play only; ui/state.ts
 * `sandbox/load`): the actor's view comes up cold, no curtain, no beat. Resolves once the page
 * shows it.
 */
export const briscolaSetup = async (page: Page, state: State): Promise<View> => {
  // The harness has no DOM types (tsconfig.node.json): the hook is called by source, as backgammon's is.
  await page.evaluate(`window.__briscola.setup(${JSON.stringify(state)})`);
  const seated = (v: View | State | null): string =>
    v === null ? '' : JSON.stringify([v.turn, v.trickNo, v.trumpCard.id, v.gameNo]);
  await expect.poll(async () => seated(await readView(page))).toBe(seated(state));
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await expect(page.locator('.flyer:visible, .card.arriving:visible')).toHaveCount(0);
  return requireView(page);
};

/** A card of the deck by its id; a typo in a spec is a test bug and throws. */
export const card = (id: string): Card => {
  const c = cardById(id);
  if (c === null) throw new Error(`${id} is not a card`);
  return c;
};

/** A two-seat position for `briscolaSetup`: the stock out, three (or fewer) cards each, the rest taken. */
export type Position = Readonly<{
  names?: Names;
  /** Each seat's hand, by id, the same size. */
  hands: readonly [ReadonlyArray<string>, ReadonlyArray<string>];
  /** The trump card (off the table: the stock is out), naming the trump suit. */
  trumpCard: string;
  leader: Seat;
  /**
   * The cards each seat has taken, whole tricks; absent, the rest of the deck is dealt to the
   * piles in deck order, seat 0 taking the first even half.
   */
  piles?: readonly [ReadonlyArray<string>, ReadonlyArray<string>];
}>;

/**
 * The clock for the states built here (the page's own clock stamps what it plays): each position
 * gets its own `startedAt`, so two seated one after the other read as two matches to the painter
 * and the history, whose keys carry it.
 */
const stamp = (): number => Date.now();

/**
 * A `State` for `briscolaSetup`: a fresh two-seat game between `names` on the page's terms (one
 * game per sitting; seed 1 decides its deal, which the position then replaces) with the stock out,
 * `leader` to lead, and the deal event rewritten to the position's trump card so the history's
 * first row agrees with the trump badge.
 */
export const briscolaPosition = (p: Position): State => {
  const names = p.names ?? DEFAULT_NAMES;
  const players: readonly [Player, Player] = [
    { id: 'p1', name: names[0] },
    { id: 'p2', name: names[1] },
  ];
  const fresh = createGame(players, { gamesToWin: 1 }, mulberry32(1), stamp);
  const hands = p.hands.map((ids) => ids.map(card));
  const held = new Set(p.hands.flat());
  const rest = deckFor(fresh.options).filter((c) => !held.has(c.id));
  const half = Math.ceil(rest.length / 2 / 2) * 2;
  const piles =
    p.piles === undefined
      ? [rest.slice(0, half), rest.slice(half)]
      : p.piles.map((ids) => ids.map(card));
  const trumpCard = card(p.trumpCard);
  const seated = withPosition(fresh, hands, [], trumpCard, p.leader);
  const [deal] = fresh.events;
  return {
    ...seated,
    piles,
    trickNo: piles.reduce((sum, pile) => sum + pile.length, 0) / 2,
    events:
      deal?.kind === 'deal'
        ? [{ ...deal, data: { dealer: deal.data.dealer, trumpCard } }]
        : seated.events,
  };
};

/** The card the page's `FIRST_LEGAL` would play for the actor of `state`, computed here from the same engine. */
export const firstLegalOf = (state: State): string => {
  const actor = actorOf(state);
  if (actor === null) throw new Error('nobody to play');
  return FIRST_LEGAL(viewFor(state, actor));
};

/** `state` after the actor plays `cardId` (no rng is drawn: the stock is out in every position built here). */
export const played = (state: State, cardId: string): State => {
  const actor = actorOf(state);
  if (actor === null) throw new Error('nobody to play');
  const res = applyAction(state, actor, { type: 'play', cardId }, mulberry32(1), stamp);
  if (!res.ok) throw new Error(`${cardId} refused: ${JSON.stringify(res.error)}`);
  return res.value;
};

/** `state` after `count` plays by `FIRST_LEGAL`, and the cards played, in order. */
export const firstLegalPlays = (
  state: State,
  count: number,
): Readonly<{ plays: ReadonlyArray<string>; after: State }> =>
  Array.from({ length: count }).reduce<Readonly<{ plays: ReadonlyArray<string>; after: State }>>(
    (acc) => {
      const cardId = firstLegalOf(acc.after);
      return { plays: [...acc.plays, cardId], after: played(acc.after, cardId) };
    },
    { plays: [], after: state },
  );

// ---- geometry (design §5.6 "Geometry oracle"; ui/layout.ts is the CSS's pure twin) -------------------

export type Rect = Box;
export type CardBox = Readonly<{
  id: string | null;
  seat: string | null;
  box: Rect;
  z: number;
  lifted: boolean;
}>;
export type SeatBox = Readonly<{ id: string; box: Rect; cards: ReadonlyArray<Rect> }>;
/** A taken strip: its element, its box, its count and its chips' boxes in DOM order (the newest last). */
export type StripBox = Readonly<{
  id: string;
  box: Rect;
  count: number;
  chips: ReadonlyArray<Rect>;
}>;
export type Target = Readonly<{ sel: string; w: number; h: number }>;
export type Fits = Readonly<{
  document: boolean;
  app: boolean;
  tableScreen: boolean;
  actionsReachable: boolean;
}>;
export type TableGeometry = Readonly<{
  width: number;
  height: number;
  /** `--aspect` as `#tableScreen` carries it (the pack's). */
  aspect: number;
  players: number;
  hand: Rect;
  handArea: Rect;
  slots: ReadonlyArray<Rect>;
  handCards: ReadonlyArray<CardBox>;
  trick: Rect;
  /** The fan's cards in DOM (play) order, each with its column's z-index. */
  plays: ReadonlyArray<CardBox>;
  stock: Rect;
  stockCard: Rect | null;
  briscola: Rect | null;
  seats: ReadonlyArray<SeatBox>;
  /** Every shown seat's `.seat-taken` and my `#myTricks`. */
  strips: ReadonlyArray<StripBox>;
  targets: ReadonlyArray<Target>;
  fits: Fits;
  frame: Frame;
}>;

/** The frame around the cards: one box each, in every phase (design §5.6 `expectSameFrame`). */
export const FRAME_SELECTORS: ReadonlyArray<string> = [
  '#tableScreen .topbar',
  '#seats',
  '#tableCenter',
  '#scoreStrip',
  '#statusLine',
  '.hand-area',
  '#actions',
];
/** What a finger may land on at the table: every button shown, and a held card's slot. */
const TARGET_SELECTOR =
  '#tableScreen button, #hand .slot:not(.empty), #curtainOverlay .btn, #resultOverlay .btn, #menuOverlay .btn';

/**
 * The page-side read. A lift and a flight are transitions, and the drawn card's turn to its face
 * (`.card.flipping`, theme.css `draw-flip`: a finite animation whose first frame is edge-on, so a
 * box read mid-turn has no width) is the one animation waited out; the pulses (`awaiting`,
 * `tappable`, `to-move`) run forever and move no box, so they are not. By default it measures once
 * the running ones have settled, as a finger would, and once the flyers and hidden arrivals
 * (ui/motion.ts) have landed, 2s at most; `quick` reads at once (the fan inside the 900ms hold of
 * the settle beat).
 */
const geometryScript = (quick: boolean): string => `(async () => {
  if (!${String(quick)}) {
    const waited = (a) => a instanceof CSSTransition || (a instanceof CSSAnimation && a.animationName === 'draw-flip');
    const settling = document.getAnimations().filter(waited).map((a) => a.finished.catch(() => null));
    await Promise.race([Promise.all(settling), new Promise((done) => setTimeout(done, 1500))]);
    await new Promise((done) => {
      const t0 = performance.now();
      const tick = () => (document.querySelector('.flyer, .card.arriving, .drag-ghost') === null || performance.now() - t0 > 2000 ? done(null) : requestAnimationFrame(tick));
      tick();
    });
  }
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }; };
  const shown = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0; };
  const cardOf = (el, z) => ({ id: el.getAttribute('data-card'), seat: el.getAttribute('data-seat'), box: rect(el), z, lifted: el.classList.contains('selected') });
  const screen = document.getElementById('tableScreen');
  const one = (sel) => { const el = document.querySelector(sel); return el === null ? null : rect(el); };
  return {
    width: window.innerWidth, height: window.innerHeight,
    aspect: Number(getComputedStyle(screen).getPropertyValue('--aspect')),
    players: Number(document.getElementById('seats').getAttribute('data-players')),
    hand: rect(document.getElementById('hand')),
    handArea: one('.hand-area'),
    slots: Array.from(document.querySelectorAll('#hand .slot')).map(rect),
    handCards: Array.from(document.querySelectorAll('#hand .slot .card')).map((c) => cardOf(c, 0)),
    trick: rect(document.getElementById('trick')),
    plays: Array.from(document.querySelectorAll('#trick .play')).map((p) => cardOf(p.querySelector('.card'), Number(getComputedStyle(p).zIndex))),
    stock: rect(document.getElementById('stock')),
    stockCard: one('#stock .card'),
    briscola: shown(document.getElementById('briscola')) ? one('#briscola .card') : null,
    seats: Array.from(document.querySelectorAll('#seats .seat')).filter(shown).map((s) => ({ id: s.id, box: rect(s), cards: Array.from(s.querySelectorAll('.seat-cards .card')).filter(shown).map(rect) })),
    strips: [...Array.from(document.querySelectorAll('#seats .seat')).filter(shown).map((s) => s.querySelector('.seat-taken')), document.getElementById('myTricks')].map((el) => ({ id: el.parentElement.id === 'seats' ? el.id : el.id || el.parentElement.id, box: rect(el), count: Number(el.getAttribute('data-count')), chips: Array.from(el.querySelectorAll('.chip')).map(rect) })),
    targets: Array.from(document.querySelectorAll(${JSON.stringify(TARGET_SELECTOR)})).filter(shown).map((el) => {
      const r = rect(el);
      const name = el.id !== '' ? '#' + el.id : el.tagName.toLowerCase() + '.' + Array.from(el.classList).join('.');
      return { sel: name, w: r.w, h: r.h };
    }),
    fits: ${fitsScript(['app', 'tableScreen'], 'actions')},
    frame: ${frameScript(FRAME_SELECTORS)},
  };
})()`;

export const tableGeometry = (page: Page, quick = false): Promise<TableGeometry> =>
  page.evaluate<TableGeometry>(geometryScript(quick));

const inside = (inner: Rect, outer: Rect, tol = TOL): boolean =>
  inner.x >= outer.x - tol &&
  inner.y >= outer.y - tol &&
  inner.x + inner.w <= outer.x + outer.w + tol &&
  inner.y + inner.h <= outer.y + outer.h + tol;
const disjoint = (a: Rect, b: Rect): boolean =>
  a.x + a.w <= b.x + TOL ||
  b.x + b.w <= a.x + TOL ||
  a.y + a.h <= b.y + TOL ||
  b.y + b.h <= a.y + TOL;
const centreX = (r: Rect): number => r.x + r.w / 2;
const same = (a: number, b: number, tol = TOL): boolean => Math.abs(a - b) <= tol;

/** The three slots inside `#hand`, one size, disjoint and in increasing x; every held card in its slot (a lifted one in the hand area). */
export const expectHandLaid = (g: TableGeometry, when: string): void => {
  expect(g.slots, `${when}: three slots`).toHaveLength(3);
  const [first] = g.slots;
  if (first === undefined) return;
  g.slots.forEach((slot, i) => {
    expect(inside(slot, g.hand), `${when}: slot ${String(i)} outside #hand`).toBe(true);
    expect(
      same(slot.w, first.w) && same(slot.h, first.h),
      `${when}: slot ${String(i)} is another size`,
    ).toBe(true);
    if (i > 0) {
      const prev = g.slots[i - 1] ?? slot;
      expect(disjoint(prev, slot), `${when}: slots ${String(i - 1)} and ${String(i)} overlap`).toBe(
        true,
      );
      expect(slot.x, `${when}: slot ${String(i)} is not right of the one before`).toBeGreaterThan(
        prev.x,
      );
    }
  });
  g.handCards.forEach((c) => {
    const slot = g.slots.find((s) => inside(c.box, s, 12));
    expect(slot, `${when}: card ${String(c.id)} sits in no slot`).toBeDefined();
    expect(
      inside(c.box, g.handArea, TOL),
      `${when}: card ${String(c.id)} outside the hand area`,
    ).toBe(true);
  });
};

/** Every unrotated card (hand, stock, the seats' tiny backs) has the pack's aspect to 2%; a hand card is `--card-w` wide as the twin predicts. */
export const expectCardShapes = (g: TableGeometry, when: string): void => {
  const boxes: ReadonlyArray<readonly [string, Rect]> = [
    ...g.handCards.map((c) => [`hand ${String(c.id)}`, c.box] as const),
    ...(g.stockCard === null ? [] : [['stock', g.stockCard] as const]),
    ...g.seats.flatMap((s) => s.cards.map((r, i) => [`${s.id} card ${String(i)}`, r] as const)),
  ];
  boxes.forEach(([name, box]) => {
    expect(
      sameAspect(box, g.aspect),
      `${when}: ${name} is not ${String(g.aspect)} (${String(box.w / box.h)})`,
    ).toBe(true);
  });
  const predicted = cardWidth({ width: g.width, height: g.height }, g.aspect);
  g.handCards.forEach((c) => {
    expect(
      same(c.box.w, predicted, 1),
      `${when}: hand card ${String(c.id)} is ${String(c.box.w)} wide, --card-w predicts ${String(predicted)}`,
    ).toBe(true);
  });
};

/** The briscola lies across under the stock: the stock card's box swapped, the stock hiding 40-60% of it. */
export const expectBriscolaUnderStock = (g: TableGeometry, when: string): void => {
  if (g.briscola === null || g.stockCard === null) return;
  const predicted = briscolaBox(g.stockCard);
  expect(
    same(g.briscola.w, predicted.w, 1) && same(g.briscola.h, predicted.h, 1),
    `${when}: the briscola's box is not the stock's swapped`,
  ).toBe(true);
  const covered = coveredFraction(g.stockCard, g.briscola);
  expect(
    covered,
    `${when}: the stock hides ${String(covered)} of the briscola`,
  ).toBeGreaterThanOrEqual(0.4);
  expect(
    covered,
    `${when}: the stock hides ${String(covered)} of the briscola`,
  ).toBeLessThanOrEqual(0.6);
};

/**
 * The fan's cards inside `#trick` (a tilted card's box grows a few px past its column, and the
 * taking card lifts 6px through the hold), each right of the one before and above it in z.
 */
export const expectFan = (g: TableGeometry, when: string): void => {
  g.plays.forEach((p, i) => {
    expect(inside(p.box, g.trick, 8), `${when}: fan card ${String(p.id)} outside #trick`).toBe(
      true,
    );
    if (i === 0) return;
    const prev = g.plays[i - 1] ?? p;
    expect(
      centreX(p.box),
      `${when}: fan card ${String(p.id)} is not right of ${String(prev.id)}`,
    ).toBeGreaterThan(centreX(prev.box));
    expect(
      p.z,
      `${when}: fan card ${String(p.id)} is not above ${String(prev.id)}`,
    ).toBeGreaterThan(prev.z);
  });
};

/** Every seat's tiny cards inside its cell. */
export const expectSeats = (g: TableGeometry, when: string): void => {
  expect(g.seats, `${when}: seats shown`).toHaveLength(g.players - 1);
  g.seats.forEach((s) => {
    s.cards.forEach((r, i) => {
      expect(inside(r, s.box, 1), `${when}: card ${String(i)} of ${s.id} outside its seat`).toBe(
        true,
      );
    });
  });
};

/**
 * The taken strips (docs/design/briscola-battle.md §7 G; layout.ts is the twin): as many chips as
 * the count says, each a chip tall and the pack's aspect wide, inside its strip, left to right
 * and never past the strip's width for that layout; every strip inside the table, the seats' in
 * their cells and mine in the hand area.
 */
export const expectStrips = (g: TableGeometry, when: string): void => {
  const layout = layoutFor(g.width);
  expect(g.strips, `${when}: a strip per other seat and mine`).toHaveLength(g.players);
  g.strips.forEach((s) => {
    const mine = s.id === 'myTricks';
    const cell = mine ? g.handArea : g.seats.find((seat) => seat.id === s.id)?.box;
    expect(cell, `${when}: ${s.id} belongs to no cell`).toBeDefined();
    if (cell !== undefined)
      expect(inside(s.box, cell, 1), `${when}: strip ${s.id} outside its cell`).toBe(true);
    expect(s.chips, `${when}: ${s.id} shows ${String(s.count)} tricks`).toHaveLength(s.count);
    const stripW = STRIP_WIDTHS[layout][mine ? 'mine' : 'seat'];
    expect(
      s.box.w,
      `${when}: strip ${s.id} is ${String(s.box.w)} wide, more than ${String(stripW)}`,
    ).toBeLessThanOrEqual(stripW + TOL);
    if (s.count > 0)
      expect(
        same(s.box.w, stripWidth(s.count, stripW, g.aspect), 1),
        `${when}: strip ${s.id} is ${String(s.box.w)} wide for ${String(s.count)} chips, the twin says ${String(stripWidth(s.count, stripW, g.aspect))}`,
      ).toBe(true);
    s.chips.forEach((chip, i) => {
      expect(
        inside(chip, s.box, 1),
        `${when}: chip ${String(i)} of ${s.id} outside its strip`,
      ).toBe(true);
      expect(
        same(chip.h, CHIP_H, 1),
        `${when}: chip ${String(i)} of ${s.id} is ${String(chip.h)} tall`,
      ).toBe(true);
      expect(
        sameAspect(chip, g.aspect, 0.05),
        `${when}: chip ${String(i)} of ${s.id} is not the pack's shape`,
      ).toBe(true);
      if (i > 0)
        expect(
          chip.x,
          `${when}: chip ${String(i)} of ${s.id} is not right of the one before`,
        ).toBeGreaterThan((s.chips[i - 1]?.x ?? 0) + 1);
    });
  });
};

/** On a phone every visible tap target is at least 44px on its short side (design §5.5). */
export const expectTargets = (g: TableGeometry, when: string): void => {
  if (layoutFor(g.width) !== 'phone') return;
  const small = g.targets.filter((t) => Math.min(t.w, t.h) < 44 - TOL);
  expect(small, `${when}: targets under 44px`).toEqual([]);
};

/** No scroll where the twin says the column fits; under the fallback the document alone scrolls, with the actions reachable. */
export const expectFits = (g: TableGeometry, when: string): void => {
  const scrolls = !fits({ width: g.width, height: g.height }, g.aspect);
  expect(g.fits, `${when}: overflow`).toEqual({
    document: !scrolls,
    app: true,
    tableScreen: true,
    actionsReachable: true,
  });
};

/** The whole oracle for one state of the table. */
export const expectTableGeometry = (g: TableGeometry, when: string): void => {
  expectHandLaid(g, when);
  expectCardShapes(g, when);
  expectBriscolaUnderStock(g, when);
  expectFan(g, when);
  expectSeats(g, when);
  expectStrips(g, when);
  expectTargets(g, when);
  expectFits(g, when);
};
