// The viewports and the frame oracle the geometry specs share (docs/design/shared-shell.md §5 A5,
// §6.1): a phone, a laptop and a short phone spelled once, and the two page-side scripts that read
// boxes in document coordinates (so a scrolled page compares with an unscrolled one) and whether
// anything clips. e2e/gin-geometry.spec.ts and e2e/fixtures/backgammon-geometry.ts each held a
// copy of these before the shared-shell plan moved them here; the specs' own selectors, phases
// and extra facts (gin's `tallHand`, backgammon's board oracle) stay where they were.
import { expect, type Page } from '@playwright/test';

import type { Box } from './boxes.ts';

export type Viewport = Readonly<{ width: number; height: number }>;
/** An iPhone 12-class phone. */
export const PHONE: Viewport = { width: 390, height: 844 };
/** A laptop window. */
export const DESKTOP: Viewport = { width: 1280, height: 800 };
/** An iPhone SE: under both games' floor heights, so the document scrolls instead of clipping. */
export const PHONE_SHORT: Viewport = { width: 375, height: 667 };

/** Half a pixel: the rounding between two reads of one layout. */
export const TOL = 0.5;

/** One box per selector (null where the page has no such element), in document coordinates. */
export type Frame = Readonly<Record<string, Box | null>>;

/**
 * Page-side: the boxes of `selectors` in document coordinates, so a scrolled page compares with an
 * unscrolled one. An expression: evaluate it alone or splice it into a larger script.
 */
export const frameScript = (selectors: ReadonlyArray<string>): string =>
  `Object.fromEntries(${JSON.stringify(selectors)}.map((sel) => {
  const el = document.querySelector(sel);
  if (el === null) return [sel, null];
  const r = el.getBoundingClientRect();
  return [sel, { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }];
}))`;

export const readFrame = (page: Page, selectors: ReadonlyArray<string>): Promise<Frame> =>
  page.evaluate<Frame>(frameScript(selectors));

/**
 * Page-side: nothing is clipped. `document` is false only where the page is allowed to scroll,
 * each of `ids` holds its content inside its own box, and `<reachable>Reachable` says the element
 * `reachable` (gin's actions row, backgammon's controls) is on screen once the window is scrolled
 * to its end; the scroll position is put back before the expression returns.
 */
export const fitsScript = (ids: ReadonlyArray<string>, reachable: string): string => `(() => {
  const fits = (id) => { const el = document.getElementById(id); return el.scrollHeight <= el.clientHeight + 1; };
  const before = window.scrollY;
  window.scrollTo(0, document.documentElement.scrollHeight);
  const end = document.getElementById(${JSON.stringify(reachable)}).getBoundingClientRect();
  window.scrollTo(0, before);
  return {
    document: document.documentElement.scrollHeight <= window.innerHeight + 1,
    ...Object.fromEntries(${JSON.stringify(ids)}.map((id) => [id, fits(id)])),
    ${JSON.stringify(`${reachable}Reachable`)}: end.bottom <= window.innerHeight + 0.5,
  };
})()`;

/** Every box of `selectors` (by default every box `start` recorded) is where it was, to half a pixel. */
export const expectSameFrame = (
  now: Frame,
  start: Frame,
  when: string,
  selectors: ReadonlyArray<string> = Object.keys(start),
): void => {
  selectors.forEach((sel) => {
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
