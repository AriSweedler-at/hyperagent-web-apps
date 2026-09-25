// Drives the Sheshbesh board through its DOM (docs/design/backgammon-board.md §7 "Testability"): the
// roll modal, the points, bars and trays a player taps, and the curtain's game words. The shell
// around it (the room, the join, the curtain's reveal, the pass-and-play start) is
// e2e/fixtures/shell.ts, driven once for both shell games; `bgReveal` and `bgStartLocal` stay
// exported here so the backgammon specs keep their names. The one
// thing read from the documented hook (`window.__backgammon`, docs/ARCHITECTURE.md)
// is the engine's `View` (`readBoard`), which the specs use as the oracle for what the DOM must
// show (which points may move, where a tap lands); positions are seated through its `setup`, built
// here in node from the same engine the page runs (`bgPosition`). Own numbering (1..24 from the
// mover's bearing-off edge) is the language of every helper, as it is of the rules; the ids are
// absolute (`#point-N` is `data-abs`), and `ownPointId` translates through the view's seat.
import { expect, type Page } from '@playwright/test';

import {
  createGame,
  parsePosition,
  POINT_INDICES,
  rulesOf,
  withPosition,
  type Board,
  type Dice,
  type From,
  type Pair,
  type Seat,
  type ShippedVariant,
  type State,
  type To,
  type View,
} from '../../web/games/backgammon/src/engine/index.ts';
import { mulberry32 } from '../../web/shared/lib/rng.ts';
import type { Viewport } from './geometry.ts';
import { DEFAULT_NAMES, reveal, startLocal, type Names } from './shell.ts';
import { WEBRTC_TIMEOUT } from './timeouts.ts';

export type { Viewport, Names };
export { DEFAULT_NAMES };

/** The two selects of the pass-and-play panel; absent = the page's defaults (portes, 5). */
export type LocalOptions = Readonly<{ variant?: ShippedVariant; matchLength?: 1 | 3 | 5 | 7 }>;

/** The view the page holds for the seat it shows, as `window.__backgammon.view()` returns it. */
export const readBoard = (page: Page): Promise<View | null> =>
  page.evaluate<View | null>('window.__backgammon.view()');

/** A view the page must have (the table is up); throws with the reason otherwise. */
export const requireBoard = async (page: Page): Promise<View> => {
  const view = await readBoard(page);
  if (view === null) throw new Error('the page holds no game view');
  return view;
};

// ---- online: the table ------------------------------------------------------------------------

/** The host starts the match; both tables appear (online shows no curtain). */
export const bgHostStarts = async (host: Page, guest: Page): Promise<void> => {
  await expect(host.locator('#startGameBtn')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
  await host.locator('#startGameBtn').click();
  await expect(host.locator('#tableScreen')).toBeVisible();
  await expect(guest.locator('#tableScreen')).toBeVisible();
  await expect(host.locator('#curtainOverlay')).toBeHidden();
  await expect(guest.locator('#curtainOverlay')).toBeHidden();
};

/** What both boards must agree on: the position, whose turn, the phase, the dice and the log so far. */
export const boardKey = (v: View | null): string =>
  v === null
    ? 'none'
    : JSON.stringify([v.gameNo, v.phase, v.turn, v.dice, v.board, v.log.length, v.played.length]);

/** The guest's board shows what the host's does (its frame arrives a beat later); resolves with the host's view. */
export const bgBoardsAgree = async (host: Page, guest: Page): Promise<View> => {
  const view = await requireBoard(host);
  await expect.poll(async () => boardKey(await readBoard(guest))).toBe(boardKey(view));
  return view;
};

// ---- the table -------------------------------------------------------------------------------

/** `#point-N` of the viewer's own point `own` (1..24), through the view's seat and variant frame. */
export const ownPointId = (view: View, own: number): string =>
  `point-${String(rulesOf(view.variant).absOf(view.me.idx, own) + 1)}`;

/** The viewer's own number of `#point-N`. */
export const ownOfId = (view: View, id: string): number => {
  const n = Number(id.replace('point-', '')) - 1;
  const abs = POINT_INDICES.find((i) => i === n);
  if (abs === undefined) throw new Error(`${id} is not a point`);
  return rulesOf(view.variant).ownOf(view.me.idx, abs);
};

/** The viewer's bar and tray ids: the bottom bar is always mine; the trays are per colour. */
export const myBarId = (): string => 'barBottom';
export const myOffId = (view: View): string => (view.me.idx === 0 ? 'offLight' : 'offDark');
export const theirOffId = (view: View): string => (view.me.idx === 0 ? 'offDark' : 'offLight');

/**
 * What the curtain says (design §4.9): the incoming player's name in the title, the last turn
 * beneath, and the button that reveals (the roll is the modal's, design §4.7).
 */
export type Curtain = Readonly<{
  title: string;
  sub: string;
  last: string;
  button: string;
}>;
export const bgCurtain = async (page: Page): Promise<Curtain> => {
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  return {
    title: await page.locator('#curtainTitle').innerText(),
    sub: await page.locator('#curtainSub').innerText(),
    last: await page.locator('#curtainLast').innerText(),
    button: await page.locator('#curtainBtn').innerText(),
  };
};

/** Hand the phone over: the seat behind the curtain taps its button; the curtain goes (the shell's). */
export const bgReveal = reveal;

/**
 * Start pass-and-play (the shell's `startLocal`: Ann and Bob unless `names` says otherwise, at
 * `viewport` on the page at `url`) with the panel's selects as `options` says. Resolves with the
 * first curtain up: the opening roll is resolved and the winner is named on it.
 */
export const bgStartLocal = (
  page: Page,
  url: string,
  viewport: Viewport,
  names: Names = DEFAULT_NAMES,
  options: LocalOptions = {},
): Promise<void> =>
  startLocal(page, url, viewport, names, async (p) => {
    if (options.variant !== undefined)
      await p.locator('#localVariantSel').selectOption(options.variant);
    if (options.matchLength !== undefined)
      await p.locator('#localMatchLengthSel').selectOption(String(options.matchLength));
  });

/**
 * Roll from the roll modal (design §4.7, `#rollOverlay` up for the seat to roll): the button
 * rolls, the dice tumble (`#board[data-rolling]`) and settle (`#board[data-rolled]`), the modal
 * goes, the phase is `moving` and the dice show faces.
 */
export const bgRoll = async (page: Page): Promise<View> => {
  const modal = page.locator('#rollOverlay');
  await expect(modal).toBeVisible();
  await page.locator('#rollModalBtn').click();
  await expect(page.locator('#board')).toHaveAttribute('data-rolled', '1');
  await expect(modal).toBeHidden();
  await expect.poll(async () => (await readBoard(page))?.phase).toBe('moving');
  const view = await requireBoard(page);
  // A double shows four faces (design §2.2 `#dice`).
  await expect(page.locator('#dice .die:not(.blank)')).toHaveCount(
    view.dice?.[0] === view.dice?.[1] ? 4 : 2,
  );
  return view;
};

/** A place as a player names it: an own point, my bar, or my tray. */
export type Place = number | 'bar' | 'off';
const placeId = (view: View, place: Place): string =>
  place === 'bar' ? myBarId() : place === 'off' ? myOffId(view) : ownPointId(view, place);
/** An engine move's end (absolute, or the bar/tray) as the viewer names it. */
export const ownPlace = (view: View, place: From | To): Place =>
  place === 'bar' || place === 'off' ? place : rulesOf(view.variant).ownOf(view.me.idx, place);

/** Tap a place on the board (the whole point, bar half or tray is the target, design §6). */
export const bgTap = async (page: Page, place: Place): Promise<void> => {
  const view = await requireBoard(page);
  await page.locator(`#${placeId(view, place)}`).click();
};

/**
 * One move by two taps: the source lights `selected`, the destination wears `target` or
 * `target-2` (a combined move), and the tap on it commits. Resolves once the view shows more
 * played moves than before (a combined move adds two), with the view after the move; when the
 * move ended the turn the view is the next player's, so `played` is read against `lastPlay`.
 */
export const bgMove = async (page: Page, from: Place, to: Place): Promise<View> => {
  const before = await requireBoard(page);
  const played = before.played.length;
  const source = page.locator(`#${placeId(before, from)}`);
  // A tap on the selected source deselects it (design §4.2 rule 2): tap only what is not lit.
  const lit = await page.evaluate<boolean>(
    `document.getElementById(${JSON.stringify(placeId(before, from))}).classList.contains('selected')`,
  );
  if (!lit) await source.click();
  await expect(source).toHaveClass(/\bselected\b/);
  const dest = page.locator(`#${placeId(before, to)}`);
  await expect(dest).toHaveClass(/\btarget(-2)?\b/);
  await dest.click();
  // Two ways to the same point, or both dice bearing the checker off: the die-chip tray asks
  // which (design §4.3); the first chip (the higher die first) is this helper's answer.
  const choosing = await page.evaluate<boolean>(
    "document.getElementById('controls').classList.contains('choosing')",
  );
  if (choosing) await page.locator('#moveChips .chip[data-index="0"]').click();
  await expect
    .poll(async () => {
      const v = await readBoard(page);
      if (v === null) return -1;
      return v.turn === before.turn && v.phase === 'moving' ? v.played.length : v.lastPlay.length;
    })
    .toBeGreaterThan(played);
  return requireBoard(page);
};

/** Undo the turn so far (`#undoBtn` enabled): the board is back at the roll, nothing played. */
export const bgUndo = async (page: Page): Promise<View> => {
  const undo = page.locator('#undoBtn');
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => (await readBoard(page))?.played.length).toBe(0);
  return requireBoard(page);
};

/**
 * Seat a position through `window.__backgammon.setup` (pass-and-play only; ui/state.ts
 * `sandbox/load`): the actor's view comes up with no curtain. Resolves once the page shows it.
 */
export const bgSetup = async (page: Page, state: State): Promise<View> => {
  // The harness has no DOM types (tsconfig.node.json): the hook is called by source, as gin's is.
  await page.evaluate(`window.__backgammon.setup(${JSON.stringify(state)})`);
  const seated = (v: View | State | null): string =>
    v === null ? '' : JSON.stringify([v.board, v.turn, v.phase, v.dice]);
  await expect.poll(async () => seated(await readBoard(page))).toBe(seated(state));
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  // Whatever the previous position's last paint left in the air has landed: a spec's first tap
  // never races a clone or a coin still hidden under it (as the parity driver's `settleBg` waits).
  await expect(page.locator('.flyer, .checker.arriving, .checker.settling')).toHaveCount(0);
  return requireBoard(page);
};

/** A position for `bgSetup`, in the engine's notation (`L: 8:3 6:5 | D: 24:2 | bar 0/0 | off 0/0`, own numbers per side). */
export type Position = Readonly<{
  text: string;
  /** Whose turn; with `dice` they are mid-roll (`moving`), without they are to roll. */
  turn: Seat;
  dice?: Dice;
  variant?: ShippedVariant;
  matchLength?: number;
  /** The match score so far, [light, dark]; games already played are not recorded. */
  score?: Pair<number>;
  names?: Names;
}>;

/** The board of a position string; a malformed one is a test bug and throws. */
export const bgBoard = (text: string, variant: ShippedVariant = 'portes'): Board => {
  const parsed = parsePosition(text, rulesOf(variant));
  if (!parsed.ok) throw new Error(`bad position "${text}": ${parsed.error}`);
  return parsed.value;
};

/**
 * The clock for the states built here (the page's own clock stamps what it plays): each position
 * gets its own `startedAt`, so two seated one after the other read as two games to the painter
 * (`flightsBetween`) and the second paints cold instead of "undoing" the first's moves.
 */
const stamp = (): number => Date.now();

/**
 * A `State` for `bgSetup`: a fresh match between `names` (seed 1 decides its opening, which the
 * position then replaces) at the given position, turn and dice, under `variant` (portes) to
 * `matchLength` (5), with `score` already on the board when given.
 */
export const bgPosition = (p: Position): State => {
  const variant = p.variant ?? 'portes';
  const names = p.names ?? DEFAULT_NAMES;
  const fresh = createGame(
    [
      { id: 'p1', name: names[0] },
      { id: 'p2', name: names[1] },
    ],
    { matchLength: p.matchLength ?? 5, rotation: [variant] },
    mulberry32(1),
    stamp,
  );
  const seated = withPosition(fresh, bgBoard(p.text, variant), p.turn, p.dice ?? null);
  return p.score === undefined ? seated : { ...seated, match: { ...seated.match, score: p.score } };
};
