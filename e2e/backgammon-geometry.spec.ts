// The board's geometry as a real-click test (docs/design/backgammon-board.md §7 "Geometry oracle"):
// pass-and-play on one page at a phone, a laptop and a short phone. At every state of a turn
// (under the curtain, to roll, rolled, after a move, with the die-chip tray open, under the next
// curtain, at the game over) the 24 points tile the board without overlap in the order
// ui/board/layout.ts `rowOrder` states for the layout and the seat, every stack shows at most five
// coins inside its place, every tap target is at least 44px on a phone, nothing scrolls where the
// viewport fits, and the frame around the board (topbar, status line, board, controls) keeps the
// boxes it had at the start. The short phone (375x667, under the 806px floor) exercises the
// fallback: the document scrolls and the controls are reachable at the bottom of that scroll. Both
// seats are checked through `window.__backgammon.setup`: the seat mapping (`#board[data-seat]`,
// `data-own`) and the row order flip with the mover, and a seven-stack shows five coins.
import type { Page } from '@playwright/test';

import { POINT_INDICES, rulesOf, type Seat } from '../web/games/backgammon/src/engine/index.ts';
import {
  bgMove,
  bgPosition,
  bgReveal,
  bgRoll,
  bgSetup,
  bgStartLocal,
  bgTap,
  ownPlace,
  requireBoard,
  type Viewport,
} from './fixtures/backgammon.ts';
import {
  boardGeometry,
  expectBoardGeometry,
  expectSameFrame,
  type Frame,
} from './fixtures/backgammon-geometry.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

type Case = Viewport & Readonly<{ scrolls: boolean }>;
const VIEWPORTS: Readonly<Record<string, Case>> = {
  phone: { width: 390, height: 844, scrolls: false },
  desktop: { width: 1280, height: 800, scrolls: false },
  // An iPhone SE: the 44px point floor needs 806px, so the document scrolls instead of clipping.
  'phone-short': { width: 375, height: 667, scrolls: true },
};

/** Light's 6-point holds seven (the count badge, five drawn); a legal 6-5 for either seat. */
const STACKS = 'L: 24:2 13:5 8:1 6:7 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';
/** Light bears off with 6-5 from own 4: both dice suffice, so the tap opens the tray (design §4.3); then 2/off ends the game. */
const BOTH_SUFFICE = 'L: 4:1 2:1 | D: 24:2 1:13 | bar 0/0 | off 13/0';

/** The seat whose view the page shows. */
const seatShown = async (page: Page): Promise<Seat> => (await requireBoard(page)).me.idx;

/** Play the engine's first legal move (one die) until the turn passes to the other seat. */
const finishTurn = async (page: Page): Promise<void> => {
  const v = await requireBoard(page);
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
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      const start = await boardGeometry(page);
      expectBoardGeometry(start, await seatShown(page), vp.scrolls, 'curtain');
      const check = async (when: string, seat?: Seat): Promise<Frame> => {
        const g = await boardGeometry(page);
        expectBoardGeometry(g, seat ?? (await seatShown(page)), vp.scrolls, when);
        expectSameFrame(g.frame, start.frame, when);
        return g.frame;
      };

      // The curtain's tap reveals and rolls (design §4.9): the board comes up mid-roll.
      await bgReveal(page);
      const v = await requireBoard(page);
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
      await expect(page.locator('#rollBtn')).toBeVisible();
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
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await bgReveal(page);
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
