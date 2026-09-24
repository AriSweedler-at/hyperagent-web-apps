// The table's feel, as the owner asked for it on 2026-09-24 (docs/design/backgammon-board.md §3.7,
// §3.8, §3.9, §4.2, §4.7, §5.1), on the served page at a phone and a laptop: a legal destination
// lights its whole cell with the die badge at its centre and the triangle breathing; a second tap
// on the selected checker, or a tap on the felt, lets it go and darkens the targets; a move is a
// `.flyer` that leaves the source coin's rect and lands on the destination's; a stack of five takes
// a sixth without rebuilding its coins (the top one keeps its element and takes the count badge,
// nothing flashes); and a double, forced through the page's `window.__rng` hook, plays the
// `doubles` cue after `roll` once the dice have settled. The roll modal itself (up for the seat to
// roll, dismissed by nothing, its tumble and settle) is e2e/backgammon-local.spec.ts's.
import type { Page } from '@playwright/test';

import {
  bgMove,
  bgPosition,
  bgReveal,
  bgSetup,
  bgStartLocal,
  bgTap,
  ownPointId,
  requireBoard,
  type Viewport,
} from './fixtures/backgammon.ts';
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
      await bgReveal(page);
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
      await bgReveal(page);
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

    test('a move flies: the clone leaves the source coin and lands on the destination coin, in FLY_MS', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await bgReveal(page);
      const v = await seated(page, 0);
      // The source is tapped first: the selected coin lifts 4px, and the clone leaves from there.
      await bgTap(page, 8);
      await expect(page.locator(`#${ownPointId(v, 8)}`)).toHaveClass(/\bselected\b/);
      await page.waitForTimeout(200);
      const from = await rectOf(page, `#${ownPointId(v, 8)} .checker.top`);
      // Record every `.flyer` the page adds: where it starts and where it is each frame until it goes.
      await page.evaluate(`(() => {
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
      await bgMove(page, 8, 5);
      await expect
        .poll(() =>
          page.evaluate<number>('window.__flights.filter((f) => f.removedAt !== null).length'),
        )
        .toBe(1);
      const to = await rectOf(page, `#${ownPointId(v, 5)} .checker.top`);
      const [flight] = await page.evaluate<
        ReadonlyArray<
          Readonly<{
            start: Rect & Readonly<{ left: number; top: number; width: number; height: number }>;
            samples: ReadonlyArray<
              Readonly<{ left: number; top: number; width: number; height: number }>
            >;
            removedAt: number;
          }>
        >
      >('window.__flights');
      if (flight === undefined) throw new Error('no flight was recorded');
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
      const last = flight.samples.at(-1);
      if (last === undefined) throw new Error('the flight was never sampled');
      expect(near(last.left, to.x, 8), `landed x ${String(last.left)} vs ${String(to.x)}`).toBe(
        true,
      );
      expect(near(last.top, to.y, 8), `landed y ${String(last.top)} vs ${String(to.y)}`).toBe(true);
      expect(flight.samples.length).toBeGreaterThan(2);
      expect(flight.removedAt).toBeLessThan(700);
      // The destination's own coin is back in view, no clone left over.
      await expect(page.locator('.flyer, .checker.arriving')).toHaveCount(0);
    });

    test('a stack of five takes a sixth in place: the coins keep their elements, the top one takes the badge, nothing flashes', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await bgReveal(page);
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
      await bgReveal(page);
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
