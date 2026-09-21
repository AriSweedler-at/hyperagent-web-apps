// The stories catalogue on the served page (docs/design/gin-draw-ghost-slot.md §7 and §8;
// docs/ARCHITECTURE.md "Testing pyramid" 5). Every story of web/games/gin-rummy/src/stories/
// catalogue.ts is opened through the page's `?story=<id>` hook at a phone, a laptop and a short
// phone, and four things are asserted from the DOM a player sees: the facts the catalogue derived
// from the engine (slot and card counts, the ghost cell's class, the fresh, locked and selected
// cards, the piles, the buttons and their state, the status line); the geometry (`#app` and
// `#hand` never scroll, the eleven cells are one size, in two rows of six and five on a phone and
// one row on the laptop); the stability the owner asked for (a story with `sameHandAs` holds the
// same card at the same pixel rectangle in each of the first ten slots as that story, so a draw
// moves nothing); and, at the two screenshot viewports, a screenshot compared against the committed
// per-platform baseline (`e2e/__screenshots__/gin-stories.spec.ts/<id>--<viewport>-<platform>.png`,
// playwright.config.ts `snapshotPathTemplate`). A missing baseline fails: CI is never green with no
// visual coverage. Re-recording: `npm run test:e2e -- e2e/gin-stories.spec.ts --project pages
// --update-snapshots` on macOS, and the `stories-baselines.yml` workflow for linux. Runs once, on
// `pages`: both origins serve the same bytes.
import { expect, test, type Page } from '@playwright/test';

import {
  STORIES,
  storyById,
  type StoryFacts,
} from '../web/games/gin-rummy/src/stories/catalogue.ts';
import { ALLOWED_FAILURES } from './fixtures/offline.ts';
import { pagePath } from './fixtures/site.ts';
import { watchPage } from './fixtures/watch.ts';

type Viewport = Readonly<{ width: number; height: number; rows: 1 | 2; shot: boolean }>;
const VIEWPORTS: Readonly<Record<string, Viewport>> = {
  phone: { width: 390, height: 844, rows: 2, shot: true },
  desktop: { width: 1280, height: 800, rows: 1, shot: true },
  // Geometry only: an iPhone SE, where the cards shrink to their floor.
  'phone-short': { width: 375, height: 667, rows: 2, shot: false },
};

/** The facts as the served DOM shows them, in the catalogue's terms. */
const FACTS = `(() => {
  const all = (s) => Array.from(document.querySelectorAll(s));
  const one = (s) => { const els = all(s); return els.length === 0 ? null : els.map((e) => e.getAttribute('data-card')).join(','); };
  const ghost = document.querySelector('#hand .slot.ghost');
  const kind = ghost === null ? 'none' : (['open', 'pending', 'shown'].find((k) => ghost.classList.contains(k)) ?? 'hidden');
  const stock = document.getElementById('stockPile').classList;
  const disc = document.getElementById('discardPile').classList;
  return {
    slots: all('#hand .slot').length,
    handCards: all('#hand .slot .card[data-card]').length,
    ghost: kind,
    freshId: one('#hand .card.fresh'),
    lockedId: one('#hand .card.locked'),
    selectedId: one('#hand .card.selected'),
    stock: stock.contains('tappable') ? 'tappable' : 'idle',
    discard: disc.contains('tappable') ? 'tappable' : disc.contains('blocked') ? 'blocked' : 'idle',
    actions: all('#actions [data-act]').map((b) => ({ act: b.getAttribute('data-act'), enabled: !b.disabled })),
    statusSub: document.getElementById('statusSub').textContent,
  };
})()`;
/** Nothing scrolls, and every slot cell's size and top. */
const GEOMETRY = `(() => {
  const fits = (id) => { const el = document.getElementById(id); return el.scrollHeight <= el.clientHeight + 1; };
  const slots = Array.from(document.querySelectorAll('#hand .slot')).map((s) => s.getBoundingClientRect());
  return { app: fits('app'), hand: fits('hand'), sizes: slots.map((r) => [r.width, r.height]), tops: slots.map((r) => r.top) };
})()`;
/** `data-card -> [x, y, w, h]` of the cards in the first ten slots. */
const RECTS = `Object.fromEntries(Array.from(document.querySelectorAll('#hand .slot')).slice(0, 10).map((s) => {
  const c = s.querySelector('.card');
  const r = c.getBoundingClientRect();
  return [c.getAttribute('data-card'), [r.x, r.y, r.width, r.height]];
}))`;

type Geometry = Readonly<{
  app: boolean;
  hand: boolean;
  sizes: ReadonlyArray<readonly [number, number]>;
  tops: ReadonlyArray<number>;
}>;
type Rects = Readonly<Record<string, readonly [number, number, number, number]>>;

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.5;

const openStory = async (page: Page, id: string): Promise<void> => {
  await page.goto(`${pagePath('pages', 'gin-rummy')}?story=${id}`);
  await expect(page.locator('#tableScreen')).toBeVisible();
  await expect(page.locator('#hand .slot')).toHaveCount(11);
};

const expectGeometry = async (page: Page, vp: Viewport): Promise<void> => {
  const g = await page.evaluate<Geometry>(GEOMETRY);
  expect(g.app, '#app scrolls').toBe(true);
  expect(g.hand, '#hand scrolls').toBe(true);
  expect(g.sizes).toHaveLength(11);
  const [first] = g.sizes;
  if (first === undefined) return;
  g.sizes.forEach(([w, h], i) => {
    expect(
      near(w, first[0]) && near(h, first[1]),
      `slot ${String(i)} is ${String(w)}x${String(h)}`,
    ).toBe(true);
  });
  const tops = g.tops.map((t) => Math.round(t));
  if (vp.rows === 1) {
    expect(new Set(tops).size, 'one row').toBe(1);
    return;
  }
  expect(new Set(tops.slice(0, 6)).size, 'the first six share a top').toBe(1);
  expect(new Set(tops.slice(6)).size, 'the last five share a top').toBe(1);
  expect(tops[6], 'two rows').toBeGreaterThan(tops[0] ?? 0);
};

const expectSameRects = (now: Rects, then: Rects, id: string): void => {
  expect(Object.keys(now).sort(), `${id}: the first ten cards`).toEqual(Object.keys(then).sort());
  Object.entries(then).forEach(([card, rect]) => {
    const here = now[card];
    expect(here, `${id}: card ${card}`).toBeDefined();
    if (here === undefined) return;
    rect.forEach((side, i) => {
      expect(
        near(here[i] ?? NaN, side),
        `${id}: card ${card} moved (${['x', 'y', 'w', 'h'][i] ?? ''})`,
      ).toBe(true);
    });
  });
};

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    STORIES.forEach((story) => {
      test(story.id, async ({ page }, testInfo) => {
        test.skip(
          testInfo.project.name !== 'pages',
          'runs once: the stories are the same bytes on both origins',
        );
        const watched = watchPage(page, ALLOWED_FAILURES);
        await openStory(page, story.id);

        // The facts, the geometry, and the owner's sentence: the same card in the same place.
        expect(await page.evaluate<StoryFacts>(FACTS)).toEqual(story.facts);
        await expectGeometry(page, vp);
        if (story.sameHandAs !== undefined) {
          const other = storyById(story.sameHandAs);
          expect(other, story.sameHandAs).not.toBeNull();
          const mine = await page.evaluate<Rects>(RECTS);
          await openStory(page, story.sameHandAs);
          expectSameRects(mine, await page.evaluate<Rects>(RECTS), story.id);
          await openStory(page, story.id);
        }

        if (vp.shot && story.screenshot) {
          await expect(page.locator(name === 'phone' ? 'body' : '#app')).toHaveScreenshot(
            `${story.id}--${name}.png`,
            { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 },
          );
        }
        expect(watched.errors(), 'uncaught exceptions').toEqual([]);
        expect(watched.failures(), 'failed requests').toEqual([]);
      });
    });
  });
});
