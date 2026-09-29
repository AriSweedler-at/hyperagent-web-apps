// The board's geometry as a real-click test (docs/design/backgammon-board.md §7 "Geometry oracle"):
// pass-and-play on one page at a phone, a laptop, a short phone and two phones held sideways. At
// every state of a turn (under the curtain, to roll with the modal up, rolled, after a move, with
// the die-chip tray open, under the next curtain, at the game over) the 24 points tile the board
// without overlap in the order ui/board/layout.ts `rowOrder` states for the layout and the seat,
// every stack shows at most five coins inside its place, every tap target is at least 44px on a
// phone, nothing scrolls where the viewport fits, and the frame around the board (the layout's
// boxes: topbar, status line, board, controls upright; the strips, the badge and the rail buttons
// sideways) keeps the boxes it had at the start. The short phone (375x667, under the 806px floor)
// exercises the fallback: the document scrolls and the controls are reachable at the bottom of
// that scroll. The two sideways cases run on the `phone` fixture (a touch context, so
// `(any-pointer: coarse)` matches and theme.css lays the board flat, design §3.1 landscape): an
// iPhone 12 at 844x390 (the chrome in a rail beside the board) and an SE at 667x375 (under 714px
// the chrome keeps its rows). Both seats are checked through `window.__backgammon.setup`: the seat
// mapping (`#board[data-seat]`, `data-own`) and the row order flip with the mover, and a
// seven-stack shows five coins.
import type { Page } from '@playwright/test';

import {
  POINT_INDICES,
  canEndTurn,
  rulesOf,
  type Seat,
} from '../web/games/backgammon/src/engine/index.ts';
import {
  bgEndTurn,
  bgMove,
  bgPosition,
  bgRoll,
  bgSetup,
  bgStartLocal,
  bgTap,
  ownPlace,
  requireBoard,
} from './fixtures/backgammon.ts';
import {
  boardGeometry,
  expectBoardGeometry,
  frameSelectors,
  layoutOf,
} from './fixtures/backgammon-geometry.ts';
import {
  DESKTOP,
  PHONE,
  PHONE_LANDSCAPE,
  PHONE_SHORT,
  expectSameFrame,
  type Frame,
  type Viewport,
} from './fixtures/geometry.ts';
import { reveal } from './fixtures/shell.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

/** `touch`: the `phone` fixture (a touch context, a coarse pointer) instead of the mouse `player`. */
type Case = Viewport & Readonly<{ scrolls: boolean; touch?: true }>;
const VIEWPORTS: Readonly<Record<string, Case>> = {
  phone: { ...PHONE, scrolls: false },
  desktop: { ...DESKTOP, scrolls: false },
  // An iPhone SE: the 44px point floor needs 806px, so the document scrolls instead of clipping.
  'phone-short': { ...PHONE_SHORT, scrolls: true },
  // An iPhone 12 sideways: the flat board at 54px points, the chrome in a 44px rail on the right.
  'phone-landscape': { ...PHONE_LANDSCAPE, scrolls: false, touch: true },
  // An iPhone SE sideways: under 714px the rail cannot stand beside the board, so the chrome keeps
  // its rows above and below (44.2px points, 94.5 long), still on one screen.
  'phone-landscape-rows': { width: 667, height: 375, scrolls: false, touch: true },
};

/** Light's 6-point holds seven (the count badge, five drawn); a legal 6-5 for either seat. */
const STACKS = 'L: 24:2 13:5 8:1 6:7 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';
/** Light bears off with 6-5 from own 4: both dice suffice, so the tap opens the tray (design §4.3); then 2/off ends the game. */
const BOTH_SUFFICE = 'L: 4:1 2:1 | D: 24:2 1:13 | bar 0/0 | off 13/0';

/** The seat whose view the page shows. */
const seatShown = async (page: Page): Promise<Seat> => (await requireBoard(page)).me.idx;

/** Play the engine's first legal move (one die) until the dice are used up, then End turn: the turn passes to the other seat. */
const finishTurn = async (page: Page): Promise<void> => {
  const v = await requireBoard(page);
  if (canEndTurn(v)) {
    await bgEndTurn(page);
    return;
  }
  const [first] = v.legal;
  if (!v.isMyTurn || v.phase !== 'moving' || first === undefined) return;
  await bgMove(page, ownPlace(v, first.from), ownPlace(v, first.to));
  if (await page.locator('#curtainOverlay').isVisible()) return;
  return finishTurn(page);
};

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test('the points tile the board in rowOrder, targets are 44px, nothing clips, the frame holds', async ({
      player,
      phone,
      project,
    }) => {
      const { page } = vp.touch === true ? phone : player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      const start = await boardGeometry(page);
      expectBoardGeometry(start, await seatShown(page), vp.scrolls, 'curtain');
      const check = async (when: string, seat?: Seat): Promise<Frame> => {
        const g = await boardGeometry(page);
        expectBoardGeometry(g, seat ?? (await seatShown(page)), vp.scrolls, when);
        expectSameFrame(g.frame, start.frame, when, frameSelectors(layoutOf(g), g.width));
        return g.frame;
      };

      // The curtain's tap reveals (design §4.9); the roll modal is up over the board, and its
      // button rolls (design §4.7): the frame holds through both.
      await reveal(page);
      await expect(page.locator('#rollOverlay')).toBeVisible();
      await check('modal up');
      const v = await bgRoll(page);
      expect(v.phase).toBe('moving');
      await check('rolled');
      const [first] = v.legal;
      if (first === undefined) throw new Error('no legal move after the roll');
      await bgMove(page, ownPlace(v, first.from), ownPlace(v, first.to));
      await check('after a move');
      await finishTurn(page);
      await expect(page.locator('#curtainOverlay')).toBeVisible();
      await check('next turn, under the curtain');

      // To roll (a position seated before its roll: the button and the blank dice), the die-chip
      // tray, then the game over: the sheet is over the board and the frame holds throughout.
      await bgSetup(page, bgPosition({ text: BOTH_SUFFICE, turn: 0 }));
      await expect(page.locator('#rollOverlay')).toBeVisible();
      await check('to roll', 0);
      await bgRoll(page);
      await bgSetup(page, bgPosition({ text: BOTH_SUFFICE, turn: 0, dice: [6, 5] }));
      await bgTap(page, 'off');
      await expect(page.locator('#controls')).toHaveClass(/\bchoosing\b/);
      await expect(page.locator('#moveChips .chip')).toHaveCount(2);
      await check('tray open', 0);
      await page.locator('#moveChips .chip[data-index="0"]').click();
      await bgMove(page, 2, 'off');
      await expect(page.locator('#resultOverlay')).toBeVisible();
      await check('game over', 0);
    });

    test('both seats: the seat mapping and the row order follow the mover; a seven-stack shows five', async ({
      player,
      phone,
      project,
    }) => {
      const { page } = vp.touch === true ? phone : player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      const frame = rulesOf('portes');
      const expectSeat = async (seat: Seat): Promise<void> => {
        const g = await boardGeometry(page);
        expectBoardGeometry(g, seat, vp.scrolls, `seat ${String(seat)}`);
        const owns = await page.evaluate<ReadonlyArray<string | null>>(
          `Array.from(document.querySelectorAll('#board .point')).map((p) => p.getAttribute('data-own'))`,
        );
        expect(owns).toEqual(POINT_INDICES.map((abs) => String(frame.ownOf(seat, abs))));
        // Light's own 6 (abs 5, `#point-6`) holds seven: the top coin carries the count, five are drawn.
        await expect(page.locator('#point-6 .checker.top')).toHaveAttribute('data-count', '7');
        await expect(page.locator('#point-6 .checker:visible')).toHaveCount(5);
      };
      await bgSetup(page, bgPosition({ text: STACKS, turn: 0, dice: [6, 5] }));
      await expectSeat(0);
      await bgSetup(page, bgPosition({ text: STACKS, turn: 1, dice: [6, 5] }));
      await expectSeat(1);
    });
  });
});
