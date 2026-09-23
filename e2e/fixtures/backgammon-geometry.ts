// The board's geometry as a player's finger meets it (scratchpad/bg/design.md §2.6 "Geometry
// oracle"; gin's e2e/fixtures/gin.ts `expectHandRows` and e2e/gin-geometry.spec.ts shape). One
// `page.evaluate` reads every rect in document coordinates (so a scrolled page compares with an
// unscrolled one); the assertions are pure over that record: every point inside the board, the
// 24 pairwise disjoint and one size, in the visual order `rowOrder` (ui/board/layout.ts, the CSS's
// pure twin) states for the layout and the seat, every stack's visible coins inside its place and
// no more than five, every tap target at least 44px on its short side on a phone, and no scroll
// where the viewport fits (the document scrolls only under the fallback, design §2.3.1).
import { expect, type Page } from '@playwright/test';

import {
  layoutFor,
  rowOrder,
  type Area,
  type Layout,
} from '../../web/games/backgammon/src/ui/board/layout.ts';
import type { Box } from './boxes.ts';

export type Rect = Box;
export type Stack = Readonly<{ rect: Rect; count: number; visible: ReadonlyArray<Rect> }>;
export type Target = Readonly<{ sel: string; w: number; h: number }>;
export type Fits = Readonly<{
  document: boolean;
  app: boolean;
  tableScreen: boolean;
  controlsReachable: boolean;
}>;
export type Frame = Readonly<Record<string, Rect | null>>;
export type BoardGeometry = Readonly<{
  width: number;
  height: number;
  seat: string | null;
  board: Rect;
  /** `point-1`..`point-24`, the bars and the trays, each with its coins (slabs in a tray). */
  places: Readonly<Record<string, Stack>>;
  /** `#dice` (the roll slot inside the board). */
  dice: Rect;
  /** Every visible tap target of the table screen: the places, the dice faces, the buttons, the chips. */
  targets: ReadonlyArray<Target>;
  fits: Fits;
  frame: Frame;
}>;

/** The frame around the board: one box each, in every phase (design §2.6 `expectSameFrame`). */
export const FRAME_SELECTORS: ReadonlyArray<string> = [
  '#tableScreen .topbar',
  '#statusLine',
  '#board',
  '#controls',
];
const PLACE_IDS: ReadonlyArray<string> = [
  ...Array.from({ length: 24 }, (_, i) => `point-${String(i + 1)}`),
  'barTop',
  'barBottom',
  'offLight',
  'offDark',
];
/** What a finger may land on at the table; `#diceMini`'s faces are display-only and excluded (design §2.5). */
const TARGET_SELECTOR =
  '#tableScreen .point, #tableScreen .bar, #tableScreen .off, #dice .die, #tableScreen .btn, #tableScreen .icon-btn, #tableScreen .chip, #curtainOverlay .btn, #resultOverlay .btn';

const GEOMETRY = `(async () => {
  // A seat flip slides every stack to its new end of the point (the coins transition): measure
  // once the running transitions have settled, as a player's finger would. Only transitions:
  // the pulses and the dice tumble are keyframe animations, some of them endless.
  const settling = document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => null));
  await Promise.race([Promise.all(settling), new Promise((done) => setTimeout(done, 1500))]);
  // A moved checker flies as a clone while its own coin waits hidden (ui/board/fly.ts): wait for
  // the flight (and any drag ghost) to land, 1.5s at most.
  await new Promise((done) => {
    const t0 = performance.now();
    const tick = () => (document.querySelector('.flyer, .arriving, .drag-ghost') === null || performance.now() - t0 > 1500 ? done(null) : requestAnimationFrame(tick));
    tick();
  });
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }; };
  const shown = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0; };
  const stack = (id) => {
    const el = document.getElementById(id);
    const coins = Array.from(el.querySelectorAll('.checker, .slab'));
    return { rect: rect(el), count: coins.length, visible: coins.filter(shown).map(rect) };
  };
  const fits = (id) => { const el = document.getElementById(id); return el.scrollHeight <= el.clientHeight + 1; };
  const before = window.scrollY;
  window.scrollTo(0, document.documentElement.scrollHeight);
  const controls = document.getElementById('controls').getBoundingClientRect();
  window.scrollTo(0, before);
  const board = document.getElementById('board');
  return {
    width: window.innerWidth, height: window.innerHeight,
    seat: board.getAttribute('data-seat'),
    board: rect(board),
    places: Object.fromEntries(${JSON.stringify(PLACE_IDS)}.map((id) => [id, stack(id)])),
    dice: rect(document.getElementById('dice')),
    targets: Array.from(document.querySelectorAll(${JSON.stringify(TARGET_SELECTOR)})).filter(shown).map((el) => {
      const r = rect(el);
      const name = el.id !== '' ? '#' + el.id : el.tagName.toLowerCase() + '.' + Array.from(el.classList).join('.');
      return { sel: name, w: r.w, h: r.h };
    }),
    fits: {
      document: document.documentElement.scrollHeight <= window.innerHeight + 1,
      app: fits('app'), tableScreen: fits('tableScreen'),
      controlsReachable: controls.bottom <= window.innerHeight + 0.5,
    },
    frame: Object.fromEntries(${JSON.stringify(FRAME_SELECTORS)}.map((sel) => {
      const el = document.querySelector(sel);
      return [sel, el === null ? null : rect(el)];
    })),
  };
})()`;

export const boardGeometry = (page: Page): Promise<BoardGeometry> =>
  page.evaluate<BoardGeometry>(GEOMETRY);

const TOL = 0.5;
const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x - TOL &&
  inner.y >= outer.y - TOL &&
  inner.x + inner.w <= outer.x + outer.w + TOL &&
  inner.y + inner.h <= outer.y + outer.h + TOL;
const disjoint = (a: Rect, b: Rect): boolean =>
  a.x + a.w <= b.x + TOL ||
  b.x + b.w <= a.x + TOL ||
  a.y + a.h <= b.y + TOL ||
  b.y + b.h <= a.y + TOL;
const centre = (r: Rect): Readonly<{ x: number; y: number }> => ({
  x: r.x + r.w / 2,
  y: r.y + r.h / 2,
});
const same = (a: number, b: number): boolean => Math.abs(a - b) <= TOL;

/** The rect of an area in the record: a place's, or the dice slot's. */
const rectOf = (g: BoardGeometry, area: Area): Rect =>
  area === 'dice' ? g.dice : (g.places[area]?.rect ?? { x: NaN, y: NaN, w: 0, h: 0 });

const POINT_IDS: ReadonlyArray<string> = PLACE_IDS.slice(0, 24);

/** Every point inside the board, the 24 pairwise disjoint and one size. */
export const expectPointsTiled = (g: BoardGeometry, when: string): void => {
  const points = POINT_IDS.map((id) => [id, rectOf(g, id as Area)] as const);
  points.forEach(([id, r]) => {
    expect(inside(r, g.board), `${when}: ${id} outside #board`).toBe(true);
  });
  points.forEach(([idA, a], i) => {
    points.slice(i + 1).forEach(([idB, b]) => {
      expect(disjoint(a, b), `${when}: ${idA} overlaps ${idB}`).toBe(true);
    });
  });
  const [first] = points;
  if (first === undefined) return;
  points.forEach(([id, r]) => {
    expect(same(r.w, first[1].w) && same(r.h, first[1].h), `${when}: ${id} is another size`).toBe(
      true,
    );
  });
};

/**
 * The visual order is `rowOrder`'s for this layout and seat (design §2.6): within a row the
 * places run left to right in the order given; every place of a row sits below every place of
 * the row before. The phone's fourteen rows include the bar band (barTop, dice, barBottom) and the
 * tray row; the desktop's two rows hold the bars and trays at their ends.
 */
export const expectRowOrder = (g: BoardGeometry, seat: 0 | 1, when: string): void => {
  const layout: Layout = layoutFor(g.width);
  expect(g.seat, `${when}: #board[data-seat]`).toBe(String(seat));
  const rows = rowOrder(layout, seat).map((row) =>
    row.map((area) => [area, centre(rectOf(g, area))] as const),
  );
  rows.forEach((row, ri) => {
    row.slice(1).forEach(([area, c], i) => {
      const [prevArea, prev] = row[i] ?? [area, c];
      expect(
        c.x,
        `${when}: ${area} is not right of ${prevArea} (row ${String(ri + 1)})`,
      ).toBeGreaterThan(prev.x);
    });
    const above = rows[ri - 1] ?? [];
    row.forEach(([area, c]) => {
      above.forEach(([upper, u]) => {
        expect(c.y, `${when}: ${area} is not below ${upper}`).toBeGreaterThan(u.y);
      });
    });
  });
};

/** Every stack's coins: `min(n, 5)` visible (the sixth onward is the count badge), each inside its place. */
export const expectStacks = (g: BoardGeometry, when: string): void => {
  Object.entries(g.places).forEach(([id, s]) => {
    const shown = id.startsWith('off') ? s.count : Math.min(s.count, 5);
    expect(
      s.visible.length,
      `${when}: ${id} shows ${String(s.visible.length)} of ${String(s.count)}`,
    ).toBe(shown);
    s.visible.forEach((coin, i) => {
      expect(inside(coin, s.rect), `${when}: coin ${String(i)} of ${id} outside its place`).toBe(
        true,
      );
    });
  });
};

/** On a phone every visible tap target is at least 44px on its short side (design §2.5). */
export const expectTargets = (g: BoardGeometry, when: string): void => {
  if (layoutFor(g.width) !== 'phone') return;
  const small = g.targets.filter((t) => Math.min(t.w, t.h) < 44 - TOL);
  expect(small, `${when}: targets under 44px`).toEqual([]);
};

/** No scroll anywhere, or under the fallback (`scrolls`) only the document's, with the controls reachable. */
export const expectFits = (g: BoardGeometry, scrolls: boolean, when: string): void => {
  expect(g.fits, `${when}: overflow`).toEqual({
    document: !scrolls,
    app: true,
    tableScreen: true,
    controlsReachable: true,
  });
};

/** Every box of the frame is where it was, to half a pixel. */
export const expectSameFrame = (now: Frame, start: Frame, when: string): void => {
  FRAME_SELECTORS.forEach((sel) => {
    const a = now[sel];
    const b = start[sel];
    expect(a, `${sel} missing at ${when}`).not.toBeNull();
    expect(b, `${sel} missing at the start`).not.toBeNull();
    if (a === null || b === null || a === undefined || b === undefined) return;
    (['x', 'y', 'w', 'h'] as const).forEach((side) => {
      expect(
        Math.abs(a[side] - b[side]),
        `${sel} changed (${side}) at ${when}`,
      ).toBeLessThanOrEqual(TOL);
    });
  });
};

/** The whole oracle for one state of the table. */
export const expectBoardGeometry = (
  g: BoardGeometry,
  seat: 0 | 1,
  scrolls: boolean,
  when: string,
): void => {
  expectPointsTiled(g, when);
  expectRowOrder(g, seat, when);
  expectStacks(g, when);
  expectTargets(g, when);
  expectFits(g, scrolls, when);
};
