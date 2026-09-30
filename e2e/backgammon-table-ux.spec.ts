// The table's feel, as the owner asked for it on 2026-09-24 (docs/design/backgammon-board.md §3.7,
// §3.8, §3.9, §4.2, §4.7, §5.1), on the served page at a phone and a laptop: a legal destination
// lights its whole cell with the die badge at its centre and the triangle breathing; a second tap
// on the selected checker, or a tap on the felt, lets it go and darkens the targets; a move is a
// `.flyer` that leaves the source coin's rect and lands on the destination's (a combined move
// through an empty waypoint as one flight, a bear-off shrunk onto the newest slab, and none at
// all for the last move of a pass-and-play turn, which flips the board); a stack of five takes
// a sixth without rebuilding its coins (the top one keeps its element and takes the count badge,
// nothing flashes); a checker dragged by hand (§4.12) lights its source past the threshold, marks
// the lit cell under the pointer `drop` and commits the move on release; and a double, forced
// through the page's `window.__rng` hook, plays the `doubles` cue after `roll` once the dice have
// settled; and whose turn it is reads at a glance (the owner, 2026-09-25): `#turnArrow`, the
// mover's route drawn a checker wide off the board's left edge, and the mover's tray wear the
// mover's checker colours and switch seats when a move ends the turn. The
// roll modal itself (up for the seat to roll, dismissed by nothing, its tumble and settle) is
// e2e/backgammon-local.spec.ts's.
import type { Page } from '@playwright/test';

import {
  bgEndTurn,
  bgMove,
  bgPosition,
  bgSetup,
  bgStartLocal,
  bgTap,
  ownPlace,
  ownPointId,
  requireBoard,
  type Viewport,
} from './fixtures/backgammon.ts';
import { TOL } from './fixtures/geometry.ts';
import { PX_PER_CHAR, SLOTS, budget } from '../web/games/backgammon/src/ui/copy-budget.ts';
import { reveal } from './fixtures/shell.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const VIEWPORTS: Readonly<Record<string, Viewport>> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};

const START = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';

type Rect = Readonly<{ x: number; y: number; w: number; h: number }>;
const rectOf = (page: Page, selector: string): Promise<Rect> =>
  page.evaluate<Rect>(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
  );
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
const px = (value: string | undefined): number => parseFloat(value ?? '0');
/** The x and y translation of a computed `transform` (`matrix(a, b, c, d, tx, ty)`), 0 for `none`. */
const matrixAt = (transform: string | undefined, i: 4 | 5): number =>
  Number(/matrix\(([^)]*)\)/.exec(transform ?? '')?.[1]?.split(',')[i] ?? 0);

/** The computed style of an element (or its pseudo-element), a few properties. */
const styleOf = (
  page: Page,
  selector: string,
  pseudo: string | null,
  props: ReadonlyArray<string>,
): Promise<Readonly<Record<string, string>>> =>
  page.evaluate<Readonly<Record<string, string>>>(
    `(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(pseudo)}); return Object.fromEntries(${JSON.stringify(props)}.map((p) => [p, s.getPropertyValue(p)])); })()`,
  );

type Box = Readonly<{ left: number; top: number; width: number; height: number }>;
/** One `.flyer` as the page recorded it: its first rect, a rect per frame, and when it went. */
type Flight = Readonly<{ start: Box; samples: ReadonlyArray<Box>; removedAt: number | null }>;

/**
 * Record every `.flyer` the page adds from now on (`window.__flights`): where it starts, where it
 * is each frame until it is removed, and how long it lived.
 */
const trackFlights = (page: Page): Promise<void> =>
  page.evaluate(`(() => {
    window.__flights = [];
    const track = (el) => {
      const rec = { start: el.getBoundingClientRect().toJSON(), samples: [], removedAt: null, t0: performance.now() };
      window.__flights.push(rec);
      const tick = () => {
        if (!el.isConnected) { rec.removedAt = performance.now() - rec.t0; return; }
        rec.samples.push(el.getBoundingClientRect().toJSON());
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType === 1 && n.classList.contains('flyer')) track(n);
    }))).observe(document.body, { childList: true });
  })()`);
const flightsOf = (page: Page): Promise<ReadonlyArray<Flight>> =>
  page.evaluate<ReadonlyArray<Flight>>('window.__flights');
const landedFlights = (page: Page): Promise<number> =>
  page.evaluate<number>('window.__flights.filter((f) => f.removedAt !== null).length');
/** The one flight recorded, its start and its last frame; throws when there is not exactly one. */
const theFlight = async (page: Page): Promise<Readonly<{ flight: Flight; last: Box }>> => {
  const flights = await flightsOf(page);
  const [flight] = flights;
  if (flight === undefined || flights.length !== 1)
    throw new Error(`${String(flights.length)} flights were recorded, not one`);
  const last = flight.samples.at(-1);
  if (last === undefined) throw new Error('the flight was never sampled');
  return { flight, last };
};

/**
 * Light to play 3-1 from the start for `seat`'s perspective: own 8 and own 6 can move (two sources,
 * so nothing is auto-selected); a tap on own 8 lights own 5 (the 3), own 7 (the 1) and own 4 (both).
 */
const seated = async (page: Page, seat: 0 | 1) =>
  bgSetup(page, bgPosition({ text: START, turn: seat, dice: [3, 1] }));

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test('a target lights its whole cell, the die badge sits at its centre, the triangle breathes; both seats', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      const check = async (seat: 0 | 1): Promise<void> => {
        const v = await seated(page, seat);
        expect(v.me.idx).toBe(seat);
        const cell = `#${ownPointId(v, 5)}`;
        const dark = await styleOf(page, cell, null, ['background-color', 'box-shadow']);
        expect(dark['background-color']).toBe('rgba(0, 0, 0, 0)');
        await bgTap(page, 8);
        await expect(page.locator(cell)).toHaveClass(/\btarget\b/);
        await expect(page.locator(cell)).toHaveAttribute('data-die', '3');
        // The cell: a wash and a ring, not the transparent cell it was (design §3.7).
        const lit = await styleOf(page, cell, null, ['background-color', 'box-shadow']);
        expect(lit['background-color']).not.toBe('rgba(0, 0, 0, 0)');
        expect(lit['box-shadow']).not.toBe('none');
        expect(lit['box-shadow']).not.toBe(dark['box-shadow']);
        // The badge (`::after`): its box is centred in the cell, `left/top: 50%` and a
        // `translate(-50%, -50%)` of its own 24px, so its centre is the cell's within 2px.
        const box = await rectOf(page, cell);
        const badge = await styleOf(page, cell, '::after', [
          'left',
          'top',
          'width',
          'height',
          'transform',
          'content',
        ]);
        expect(badge['content']).toBe('"3"');
        const bx = px(badge['left']) + px(badge['width']) / 2 + matrixAt(badge['transform'], 4);
        const by = px(badge['top']) + px(badge['height']) / 2 + matrixAt(badge['transform'], 5);
        expect(near(bx, box.w / 2, 2), `badge x ${String(bx)} vs ${String(box.w / 2)}`).toBe(true);
        expect(near(by, box.h / 2, 2), `badge y ${String(by)} vs ${String(box.h / 2)}`).toBe(true);
        // The triangle (`::before`) breathes: the glow animation runs and its filter moves.
        const t0 = await styleOf(page, cell, '::before', ['animation-name', 'filter']);
        expect(t0['animation-name']).toBe('target-glow');
        await page.waitForTimeout(600);
        const t1 = await styleOf(page, cell, '::before', ['filter']);
        expect(t1['filter']).not.toBe(t0['filter']);
        // The tray and the other target (own 7 with the 1) are lit the same way.
        await expect(page.locator(`#${ownPointId(v, 7)}`)).toHaveClass(/\btarget\b/);
      };
      await check(0);
      await check(1);
    });

    test('a second tap on the selected checker deselects it and darkens its targets; a tap on the felt does too', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      const v = await seated(page, 0);
      const eight = page.locator(`#${ownPointId(v, 8)}`);
      const targets = page.locator('#board .target, #board .target-2');
      await bgTap(page, 8);
      await expect(eight).toHaveClass(/\bselected\b/);
      await expect(targets).toHaveCount(3);
      // The same checker again: let go, nothing lit (design §4.2 rule 2).
      await bgTap(page, 8);
      await expect(eight).not.toHaveClass(/\bselected\b/);
      await expect(eight).toHaveAttribute('aria-pressed', 'false');
      await expect(targets).toHaveCount(0);
      // Another source moves the selection (rule 5).
      await bgTap(page, 8);
      await bgTap(page, 6);
      await expect(eight).not.toHaveClass(/\bselected\b/);
      await expect(page.locator(`#${ownPointId(v, 6)}`)).toHaveClass(/\bselected\b/);
      // The felt (the board's own frame, no place under the finger): let go (rule 2b).
      await page.locator('#board').click({ position: { x: 3, y: 3 } });
      await expect(page.locator('#board .selected')).toHaveCount(0);
      await expect(targets).toHaveCount(0);
      expect((await requireBoard(page)).played).toEqual([]);
    });

    test('a checker dragged by hand: past the threshold the source lights, over a lit target the cell takes the drop mark, the release makes the move', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      const v = await seated(page, 0);
      const eight = page.locator(`#${ownPointId(v, 8)}`);
      const five = page.locator(`#${ownPointId(v, 5)}`);
      const ghost = page.locator('.drag-ghost');
      // The coins of a freshly seated position slide into place (`.checker`'s 160ms transform
      // transition, the stacking side flips with the seat): measured once they stand still.
      await page.waitForTimeout(200);
      const from = await eight.locator('.checker.top').boundingBox();
      const to = await five.boundingBox();
      if (from === null || to === null) throw new Error('the checker or the 5-point has no box');
      const grab = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
      await page.mouse.move(grab.x, grab.y);
      await page.mouse.down();
      // Under DRAG_THRESHOLD (8px) the press is a tap in the making: nothing lit, no ghost.
      await page.mouse.move(grab.x + 4, grab.y);
      await expect(ghost).toHaveCount(0);
      await expect(eight).not.toHaveClass(/\bselected\b/);
      // Past it the drag begins (design §4.12): the source is selected, its targets light, and the
      // ghost, the checker's clone, sits on the body.
      await page.mouse.move(grab.x + 12, grab.y + 12, { steps: 2 });
      await expect(ghost).toHaveCount(1);
      await expect(eight).toHaveClass(/\bselected\b/);
      await expect(five).toHaveClass(/\btarget\b/);
      await expect(five).not.toHaveClass(/\bdrop\b/);
      // Over the lit 5-point the cell takes the `drop` mark.
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
      await expect(five).toHaveClass(/\bdrop\b/);
      // Released there: the default chain is committed (8/5 with the 3), the ghost is gone, the
      // marks are cleared, and the coin stands on the 5-point.
      await page.mouse.up();
      await expect.poll(async () => (await requireBoard(page)).played.length).toBe(1);
      const after = await requireBoard(page);
      const [move] = after.played;
      if (move === undefined) throw new Error('no move played');
      expect([ownPlace(after, move.from), ownPlace(after, move.to), move.die]).toEqual([8, 5, 3]);
      await expect(ghost).toHaveCount(0);
      await expect(page.locator('#board .drop')).toHaveCount(0);
      await expect(page.locator('#board .selected')).toHaveCount(0);
      await expect(page.locator('.flyer, .checker.arriving, .checker.settling')).toHaveCount(0);
      await expect(five.locator('.checker')).toHaveCount(1);
      await expect(eight.locator('.checker')).toHaveCount(2);
    });

    test('a move flies: the clone leaves the source coin and lands on the destination coin, in FLY_MS', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      const v = await seated(page, 0);
      // The source is tapped first: the selected coin lifts 4px, and the clone leaves from there.
      await bgTap(page, 8);
      await expect(page.locator(`#${ownPointId(v, 8)}`)).toHaveClass(/\bselected\b/);
      await page.waitForTimeout(200);
      const from = await rectOf(page, `#${ownPointId(v, 8)} .checker.top`);
      await trackFlights(page);
      await bgMove(page, 8, 5);
      await expect.poll(() => landedFlights(page)).toBe(1);
      const to = await rectOf(page, `#${ownPointId(v, 5)} .checker.top`);
      const { flight, last } = await theFlight(page);
      // It starts over the source coin, its last frame is over the destination coin, and it is
      // gone within FLY_MS plus the fallback slack (design §3.8: 200ms, not the 260ms it was).
      expect(
        near(flight.start.left, from.x, 2),
        `start x ${String(flight.start.left)} vs source ${String(from.x)}`,
      ).toBe(true);
      expect(
        near(flight.start.top, from.y, 2),
        `start y ${String(flight.start.top)} vs source ${String(from.y)}`,
      ).toBe(true);
      expect(near(last.left, to.x, 8), `landed x ${String(last.left)} vs ${String(to.x)}`).toBe(
        true,
      );
      expect(near(last.top, to.y, 8), `landed y ${String(last.top)} vs ${String(to.y)}`).toBe(true);
      expect(flight.samples.length).toBeGreaterThan(2);
      expect(flight.removedAt).toBeLessThan(700);
      // The destination's own coin is back in view, no clone left over.
      await expect(page.locator('.flyer, .checker.arriving')).toHaveCount(0);
    });

    test('a combined move through an empty waypoint flies once, from the source coin to the final point', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      // 2-2 from the start: own 13 to own 9 in one tap on the `target-2`, through own 11, which
      // is empty before and after (design §3.9: the legs fold into one flight).
      const v = await bgSetup(page, bgPosition({ text: START, turn: 0, dice: [2, 2] }));
      const thirteen = `#${ownPointId(v, 13)}`;
      const nine = page.locator(`#${ownPointId(v, 9)}`);
      await expect(page.locator(`#${ownPointId(v, 11)} .checker`)).toHaveCount(0);
      await bgTap(page, 13);
      await expect(page.locator(thirteen)).toHaveClass(/\bselected\b/);
      await expect(nine).toHaveClass(/\btarget-2\b/);
      await page.waitForTimeout(200);
      const from = await rectOf(page, `${thirteen} .checker.top`);
      await trackFlights(page);
      await nine.click();
      await expect.poll(async () => (await requireBoard(page)).played.length).toBe(2);
      await expect.poll(() => landedFlights(page)).toBe(1);
      const to = await rectOf(page, `#${ownPointId(v, 9)} .checker.top`);
      const { flight, last } = await theFlight(page);
      expect(near(flight.start.left, from.x, 2), `start x ${String(flight.start.left)}`).toBe(true);
      expect(near(flight.start.top, from.y, 2), `start y ${String(flight.start.top)}`).toBe(true);
      expect(near(last.left, to.x, 8), `landed x ${String(last.left)} vs ${String(to.x)}`).toBe(
        true,
      );
      expect(near(last.top, to.y, 8), `landed y ${String(last.top)} vs ${String(to.y)}`).toBe(true);
      await expect(page.locator(`#${ownPointId(v, 11)} .checker`)).toHaveCount(0);
      await expect(page.locator('.flyer, .checker.arriving')).toHaveCount(0);
    });

    test('a bear-off flies to the newest slab and lands on it, shrunk about its corner', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      // Light bearing off with 6-5: the 6 takes the coin on own 6 to the tray (T10).
      const v = await bgSetup(
        page,
        bgPosition({
          text: 'L: 6:2 5:2 4:2 3:2 2:2 1:2 | D: 13:15 | bar 0/0 | off 3/0',
          turn: 0,
          dice: [6, 5],
        }),
      );
      await expect(page.locator('#offLight .slab')).toHaveCount(3);
      await bgTap(page, 6);
      await expect(page.locator(`#${ownPointId(v, 6)}`)).toHaveClass(/\bselected\b/);
      await page.waitForTimeout(200);
      await trackFlights(page);
      await bgMove(page, 6, 'off');
      await expect(page.locator('#offLight .slab')).toHaveCount(4);
      await expect.poll(() => landedFlights(page)).toBe(1);
      const slab = await rectOf(page, '#offLight .slab:last-child');
      const { last } = await theFlight(page);
      // The clone's last frame is the slab: same centre, same size (the transform scales about
      // the top-left corner the translate was computed from, design §3.9; about the centre it
      // would sit half the coin-to-slab difference off, 17px on a phone).
      const cx = last.left + last.width / 2;
      const cy = last.top + last.height / 2;
      expect(
        near(cx, slab.x + slab.w / 2, 4),
        `centre x ${String(cx)} vs slab ${String(slab.x + slab.w / 2)}`,
      ).toBe(true);
      expect(
        near(cy, slab.y + slab.h / 2, 4),
        `centre y ${String(cy)} vs slab ${String(slab.y + slab.h / 2)}`,
      ).toBe(true);
      expect(near(last.width, slab.w, 3), `width ${String(last.width)} vs ${String(slab.w)}`).toBe(
        true,
      );
      expect(
        near(last.height, slab.h, 3),
        `height ${String(last.height)} vs ${String(slab.h)}`,
      ).toBe(true);
      await expect(page.locator('.flyer, .arriving')).toHaveCount(0);
    });

    test('pass-and-play: the last move of a turn flies on the mover`s own board; End turn flips it cold to the next seat', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      const v = await seated(page, 0);
      await bgMove(page, 8, 5);
      await trackFlights(page);
      // The 1: 6/5 uses the dice up; the turn is held for End turn (design §1 "Turn end"), so the
      // move flies on Light's own board like any other and the board stays Light's frame.
      const held = await bgMove(page, 6, 5);
      expect(held.turn).toBe(0);
      expect(held.me.idx).toBe(0);
      await expect(page.locator('#doneBtn')).toBeVisible();
      await expect(page.locator('#curtainOverlay')).toBeHidden();
      await expect.poll(() => landedFlights(page)).toBe(1);
      // End turn: the curtain rises for Dark and the board is Dark's frame, painted cold: no clone
      // crossed the flipped board (it would have landed on the mirrored point, design §3.9); the
      // moved coins simply stand on Light's 5-point, none hidden.
      const next = await bgEndTurn(page);
      expect(next.turn).toBe(1);
      expect(next.me.idx).toBe(1);
      await expect(page.locator('#curtainOverlay')).toBeVisible();
      await expect(page.locator('#board')).toHaveAttribute('data-seat', '1');
      await page.waitForTimeout(300);
      expect((await flightsOf(page)).length).toBe(1);
      await expect(page.locator(`#${ownPointId(v, 5)} .checker`)).toHaveCount(2);
      await expect(page.locator('.flyer, .checker.arriving, .checker.settling')).toHaveCount(0);
    });

    test('End turn (design §1 "Turn end"): hidden mid-turn, the primary button beside Undo once the dice are used up, 44px, inside the viewport, never over Undo; Undo takes it away', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      await seated(page, 0);
      const done = page.locator('#doneBtn');
      const undo = page.locator('#undoBtn');
      await expect(done).toBeHidden();
      await bgMove(page, 8, 5);
      await expect(done).toBeHidden();
      await bgMove(page, 6, 5);
      await expect(done).toBeVisible();
      await expect(done).toHaveText('End turn');
      await expect(done).toHaveClass(/\bbtn-primary\b/);
      await expect(undo).toBeEnabled();
      const [doneBox, undoBox] = await Promise.all([
        rectOf(page, '#doneBtn'),
        rectOf(page, '#undoBtn'),
      ]);
      // A 44px tap target (design §6) that stays on the screen, never over Undo.
      expect(Math.min(doneBox.w, doneBox.h)).toBeGreaterThanOrEqual(44 - TOL);
      expect(doneBox.x).toBeGreaterThanOrEqual(0);
      expect(doneBox.y).toBeGreaterThanOrEqual(0);
      expect(doneBox.x + doneBox.w).toBeLessThanOrEqual(vp.width + TOL);
      expect(doneBox.y + doneBox.h).toBeLessThanOrEqual(vp.height + TOL);
      const overlap =
        doneBox.x < undoBox.x + undoBox.w &&
        undoBox.x < doneBox.x + doneBox.w &&
        doneBox.y < undoBox.y + undoBox.h &&
        undoBox.y < doneBox.y + doneBox.h;
      expect(overlap).toBe(false);
      // Undo takes the whole turn back and the button goes; the moves again bring it back.
      await undo.click();
      await expect.poll(async () => (await requireBoard(page)).played.length).toBe(0);
      await expect(done).toBeHidden();
      await bgMove(page, 8, 5);
      await bgMove(page, 6, 5);
      await expect(done).toBeVisible();
      await bgEndTurn(page);
      await expect(done).toBeHidden();
    });

    test('a stack of five takes a sixth in place: the coins keep their elements, the top one takes the badge, nothing flashes', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      // Light to play 2-1 from the start: 8/6 with the 2 puts a sixth coin on own 6.
      const v = await bgSetup(page, bgPosition({ text: START, turn: 0, dice: [2, 1] }));
      const six = `#${ownPointId(v, 6)}`;
      await expect(page.locator(`${six} .checker`)).toHaveCount(5);
      // Stamp every coin once and watch the point: a rebuild would remove nodes and lose stamps;
      // the top coin hidden under `arriving` would be the flash.
      await page.evaluate(`(() => {
        const point = document.querySelector(${JSON.stringify(six)});
        Array.from(point.querySelectorAll('.checker')).forEach((c, i) => c.setAttribute('data-probe', String(i)));
        window.__stack = { removed: 0, added: 0, topHidden: false };
        const top = point.querySelector('.checker.top');
        new MutationObserver((muts) => muts.forEach((m) => {
          window.__stack.removed += m.removedNodes.length;
          window.__stack.added += m.addedNodes.length;
        })).observe(point, { childList: true });
        new MutationObserver(() => {
          if (top.classList.contains('arriving') || getComputedStyle(top).visibility === 'hidden') window.__stack.topHidden = true;
        }).observe(top, { attributes: true, attributeFilter: ['class'] });
      })()`);
      await bgMove(page, 8, 6);
      await expect(page.locator(`${six} .checker`)).toHaveCount(6);
      await expect(page.locator(`${six} .checker.top`)).toHaveAttribute('data-count', '6');
      await expect(page.locator('.flyer, .checker.arriving, .checker.settling')).toHaveCount(0);
      // The five stamped coins are the same elements, the top one among them; one coin was added
      // and none removed; the top coin was never hidden.
      const after = await page.evaluate<
        Readonly<{
          probes: ReadonlyArray<string | null>;
          topProbe: string | null;
          stack: Readonly<{ removed: number; added: number; topHidden: boolean }>;
          visible: number;
        }>
      >(`(() => {
        const point = document.querySelector(${JSON.stringify(six)});
        const coins = Array.from(point.querySelectorAll('.checker'));
        return {
          probes: coins.map((c) => c.getAttribute('data-probe')),
          topProbe: point.querySelector('.checker.top').getAttribute('data-probe'),
          stack: window.__stack,
          visible: coins.filter((c) => getComputedStyle(c).display !== 'none').length,
        };
      })()`);
      expect(after.probes).toEqual(['0', '1', '2', '3', '4', null]);
      expect(after.topProbe).toBe('4');
      expect(after.stack).toEqual({ removed: 0, added: 1, topHidden: false });
      expect(after.visible).toBe(5);
      // Settled, two frames apart the point paints the same pixels (the endless glow of a source
      // that can still move is paused first: it is the only thing meant to change).
      await page.evaluate('document.getAnimations().forEach((a) => a.pause())');
      const point = page.locator(six);
      const shot1 = await point.screenshot();
      await page.evaluate('new Promise((done) => requestAnimationFrame(() => done(null)))');
      const shot2 = await point.screenshot();
      expect(shot1.equals(shot2)).toBe(true);
    });

    test("whose turn: the route arrow sits a checker wide off the board's left edge; it and the lit tray wear the mover's checker colours and switch seats when a move ends the turn", async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      await seated(page, 0);
      const arrow = page.locator('#turnArrow');
      const offLight = page.locator('#offLight');
      const offDark = page.locator('#offDark');
      // Light to move in Light's view: the arrow draws the near route in Light's colour
      // (`data-seat="0"`), Light's tray wears the wash and the hairline Dark's plain tray has not
      // (design §3.7).
      await expect(arrow).toBeVisible();
      await expect(arrow).toHaveAttribute('data-seat', '0');
      await expect(arrow).toHaveAttribute('data-side', 'near');
      await expect(offLight).toHaveClass(/\bto-move\b/);
      await expect(offDark).not.toHaveClass(/\bto-move\b/);
      // The owner, 2026-09-25: "about the size of a checker and off to the left of the board":
      // the glyph's box is a checker's, wholly left of the frame, at the board's middle.
      const [arrowBox, board, checker] = await Promise.all([
        rectOf(page, '#turnArrow'),
        rectOf(page, '#board'),
        rectOf(page, '#point-6 .checker'),
      ]);
      expect(arrowBox.w).toBeCloseTo(checker.w, 0);
      expect(arrowBox.h).toBeCloseTo(checker.h, 0);
      expect(arrowBox.x + arrowBox.w).toBeLessThanOrEqual(board.x + 0.5);
      expect(arrowBox.x).toBeGreaterThanOrEqual(0);
      expect(arrowBox.y + arrowBox.h / 2).toBeCloseTo(board.y + board.h / 2, 0);
      const lightArrow = await styleOf(page, '#turnArrow', null, ['stroke']);
      const lit = await styleOf(page, '#offLight', null, ['background-color', 'box-shadow']);
      const plain = await styleOf(page, '#offDark', null, ['background-color', 'box-shadow']);
      expect(lit['background-color']).not.toBe(plain['background-color']);
      expect(lit['box-shadow']).not.toBe(plain['box-shadow']);
      // 8/5 6/5 ends the turn: the phone goes to Dark, whose view the board shows (the curtain up
      // over it). The arrow recolours to Dark's checker (still near: the mover is the viewer) and
      // the lit tray is Dark's; Light's is plain again.
      await bgMove(page, 8, 5);
      await bgMove(page, 6, 5);
      // The dice used, the turn is held (design §1 "Turn end"): the arrow is still Light's.
      await expect(arrow).toHaveAttribute('data-seat', '0');
      const next = await bgEndTurn(page);
      expect(next.turn).toBe(1);
      await expect(arrow).toHaveAttribute('data-seat', '1');
      await expect(arrow).toHaveAttribute('data-side', 'near');
      await expect(offDark).toHaveClass(/\bto-move\b/);
      await expect(offLight).not.toHaveClass(/\bto-move\b/);
      // The colour turns over 200ms (design §3.7): read once the transition has settled.
      const arrowColour = (prop: string): Promise<string> =>
        styleOf(page, '#turnArrow', null, [prop]).then((s) => s[prop] ?? '');
      await expect.poll(() => arrowColour('stroke')).not.toBe(lightArrow['stroke']);
      const dark = await styleOf(page, '#offDark', null, ['background-color', 'box-shadow']);
      expect(dark['background-color']).not.toBe(plain['background-color']);
      expect(dark['background-color']).not.toBe(lit['background-color']);
      expect(await styleOf(page, '#offLight', null, ['background-color'])).toEqual({
        'background-color': plain['background-color'],
      });
    });

    test('a double: the excited cue plays after the roll cue, once the dice have settled', async ({
      player,
      project,
    }) => {
      const { page } = player;
      // The page reads `window.__rng` at boot (main.ts); a wrapper lets the spec pin the next
      // faces once the game is on (the opening roll still comes from the seeded Math.random).
      await page.addInitScript({
        content:
          'window.__rng = () => (window.__rngFixed === undefined ? Math.random() : window.__rngFixed);',
      });
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      await bgSetup(page, bgPosition({ text: START, turn: 0 }));
      // The fx hook is the page's cue player: wrap `play` to record what the reducer raises.
      await page.evaluate(`(() => {
        const fx = window.__backgammon.fx;
        const play = fx.play.bind(fx);
        window.__cues = [];
        fx.play = (cue, font) => { window.__cues.push(cue); play(cue, font); };
        window.__rngFixed = 0.99;
      })()`);
      await expect(page.locator('#rollOverlay')).toBeVisible();
      await page.locator('#rollModalBtn').click();
      await expect(page.locator('#board')).toHaveAttribute('data-rolling', '1');
      expect((await requireBoard(page)).dice).toEqual([6, 6]);
      // While the dice tumble only the roll has sounded.
      expect(await page.evaluate<ReadonlyArray<string>>('window.__cues')).toEqual(['roll']);
      await expect(page.locator('#board')).toHaveAttribute('data-rolled', '1');
      await expect
        .poll(() => page.evaluate<ReadonlyArray<string>>('window.__cues'))
        .toEqual(['roll', 'doubles']);
      await expect(page.locator('#dice .die.die-6')).toHaveCount(4);
    });
  });
});

// ---- sideways: the strip centres its text, the copy fits its slot (design §2.4, §3.1) ---------------

/** A name at the shell's cap (NAME_MAX, 20 characters): the widest a name column and a name-bearing line get. */
const LONG_NAMES = ['Konstantinopoulos XX', 'Konstantinopoulos YY'] as const;

type GlyphBox = Readonly<{ sel: string; top: number; bottom: number; centre: number }>;
type StripGlyphs = Readonly<{
  trims: boolean;
  rowCentre: number;
  hairline: number;
  boardTop: number;
  items: ReadonlyArray<GlyphBox>;
}>;
/**
 * Each strip item's glyph box: its border box less its block paddings, which under
 * `text-box: trim-both cap alphabetic` (theme.css, the landscape block) is the letters' own box,
 * cap height to baseline; whether the browser trims at all; the row's centre; the trim's hairline
 * (the frame's inner edge: shell.css's `--frame-band` and `--frame-hairline-w` from the viewport's
 * top) and the board's top edge, the air's two far ends.
 */
const stripGlyphs = (page: Page): Promise<StripGlyphs> =>
  page.evaluate(`(() => {
    const sels = ['.opp-strip .name', '.opp-strip .pips', '#gameBadge', '#statusLine', '.me-strip .name', '.me-strip .pips'];
    const items = sels.map((sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const top = r.top + parseFloat(cs.paddingTop);
      const bottom = r.bottom - parseFloat(cs.paddingBottom);
      return { sel, top, bottom, centre: (top + bottom) / 2 };
    });
    const root = getComputedStyle(document.documentElement);
    const hairline = parseFloat(root.getPropertyValue('--frame-band')) + parseFloat(root.getPropertyValue('--frame-hairline-w'));
    const boardTop = document.getElementById('board').getBoundingClientRect().top;
    const screen = document.getElementById('tableScreen').getBoundingClientRect();
    const rowCentre = screen.top + parseFloat(getComputedStyle(document.getElementById('tableScreen')).getPropertyValue('--strip-h')) / 2;
    return { trims: CSS.supports('text-box-trim', 'trim-both'), rowCentre, hairline, boardTop, items };
  })()`);

/** The widest px per character the status line's font reaches over the copy it shows, and the badge's over its widest text. */
const measuredPxPerChar = (page: Page): Promise<Readonly<{ body: number; badge: number }>> =>
  page.evaluate(`(() => {
    const c = document.createElement('canvas').getContext('2d');
    const fontOf = (sel) => { const cs = getComputedStyle(document.querySelector(sel)); return cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; };
    const widest = (sel, lines) => { c.font = fontOf(sel); return Math.max(...lines.map((t) => c.measureText(t).width / t.length)); };
    return {
      body: widest('#statusText', ['Dice used · End turn', 'Buen mazal! Roll', '3-1 · last move', '6-5 · the 6 is dead', 'Konstantino… to roll', 'Konst… to move · 6-5', 'Either die bears off']),
      badge: widest('#gameBadge', ['Game 13 · 6–6 · to 7', 'Game 1 · 0–0 · to 5']),
    };
  })()`);

const SIDEWAYS: Readonly<Record<string, Viewport>> = {
  'rail, 844x390': { width: 844, height: 390 },
  'rail floor': { width: 780, height: 304 },
  'rows, the SE': { width: 667, height: 375 },
  'rows, 640 wide': { width: 640, height: 360 },
};

Object.entries(SIDEWAYS).forEach(([name, vp]) => {
  test.describe(`sideways, ${name}`, () => {
    test('the strip centres its glyphs on the row and shares a baseline, as far under the trim as over the board; the last-move line fits the status slot; px per character is as the budget table says', async ({
      phone,
      project,
    }) => {
      const { page } = phone;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp, LONG_NAMES);
      await reveal(page);
      // One die left after 8/5 with the 3: `3-1 · last move` (board.ts), the line the owner saw cut.
      await bgSetup(page, bgPosition({ text: START, turn: 0, dice: [3, 1], names: LONG_NAMES }));
      await bgMove(page, 8, 5);
      await expect(page.locator('#statusText')).toHaveText('3-1 · last move');
      const fits = await page.evaluate<Readonly<{ scroll: number; client: number }>>(
        `(() => { const l = document.getElementById('statusLine'); return { scroll: l.scrollWidth, client: l.clientWidth }; })()`,
      );
      expect(
        fits.scroll,
        `#statusLine ellipsizes at ${String(vp.width)}x${String(vp.height)}: ${String(fits.scroll)}px of text in ${String(fits.client)}px`,
      ).toBeLessThanOrEqual(fits.client);
      // The budget's px per character (copy-budget.ts PX_PER_CHAR) against the served fonts, within 10%:
      // past that, update the constant there with its derivation and re-derive the budgets.
      const px = await measuredPxPerChar(page);
      const within = (measured: number, pinned: number, which: string): void => {
        expect(
          Math.abs(measured - pinned) / pinned,
          `PX_PER_CHAR.${which} is ${String(pinned)} but the served font measures ${measured.toFixed(2)}px per character: update copy-budget.ts (the constant and its comment) and re-derive the budgets`,
        ).toBeLessThanOrEqual(0.1);
      };
      within(px.body, PX_PER_CHAR.body, 'body');
      within(px.badge, PX_PER_CHAR.badge, 'badge');
      expect('3-1 · last move'.length).toBeLessThanOrEqual(budget(SLOTS.stripStatus));
      // The strip's text is centred by the browser (theme.css, the landscape block): every item's
      // glyph box is centred on the 24px row within half a pixel, and the same-size items (the
      // names, the pips, the status) share one baseline; the badge's smaller type is centred too.
      const strip = await stripGlyphs(page);
      expect(strip.trims, 'the harness Chromium trims text boxes (text-box-trim)').toBe(true);
      strip.items.forEach((it) => {
        expect(
          Math.abs(it.centre - strip.rowCentre),
          `${it.sel}'s glyph box is centred at ${it.centre.toFixed(2)}, the row at ${strip.rowCentre.toFixed(2)}`,
        ).toBeLessThanOrEqual(0.5);
      });
      // And the air is the same on both sides of the letters (the owner, 2026-09-28: "equal padding
      // above and below the text ... get the browser to do this the right way"): the row stands
      // `--air` under the trim's hairline and the board `--air` under the row (one token, theme.css
      // `body.fixed-screen #app` and `#tableScreen { row-gap }`), so from the hairline to each glyph
      // box's top is what from its bottom to the board's top edge is, within half a pixel, in both
      // schemes.
      strip.items.forEach((it) => {
        const above = it.top - strip.hairline;
        const below = strip.boardTop - it.bottom;
        expect(
          Math.abs(above - below),
          `${it.sel}: ${above.toFixed(2)}px from the hairline to the letters, ${below.toFixed(2)} from the letters to the board`,
        ).toBeLessThanOrEqual(0.5);
      });
      const baselines = strip.items.filter((it) => it.sel !== '#gameBadge').map((it) => it.bottom);
      baselines.forEach((b) => {
        expect(
          Math.abs(b - (baselines[0] ?? b)),
          `baselines: ${baselines.map((x) => x.toFixed(2)).join(', ')}`,
        ).toBeLessThanOrEqual(0.5);
      });
    });
  });
});
