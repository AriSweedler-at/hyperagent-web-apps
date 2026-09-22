// The stories catalogue on the served page (docs/design/gin-draw-ghost-slot.md §7 and §8;
// docs/ARCHITECTURE.md "Testing pyramid" 5). Every story of web/games/gin-rummy/src/stories/
// catalogue.ts is opened through the page's `?story=<id>` hook at a phone, a laptop and a short
// phone, and four things are asserted from the DOM a player sees: the facts the catalogue derived
// from the engine and the picture (slot and card counts, the ghost cell's class, the fresh, locked,
// selected and hand-made cards, the phone row count, the Arrange button, the sort mode, the piles,
// the buttons and their state, the status line, the open sheet); the geometry (`#app` and `#hand`
// never scroll, the eleven cells are one size, a meld never splits a row, the rows on a phone are
// the ones `data-rows` announces and one on the laptop: e2e/fixtures/gin.ts `expectHandRows`; a
// three-row hand on a phone too short for it scrolls the document to a reachable actions row
// instead); the stability the owner asked for (a story with `sameHandAs` holds the same card at
// the same pixel rectangle in each of the first ten slots as that story, so a draw and an accept
// move nothing); and, at the two screenshot viewports, a screenshot compared against the committed
// per-platform baseline (`e2e/__screenshots__/gin-stories.spec.ts/<id>--<viewport>-<platform>.png`,
// playwright.config.ts `snapshotPathTemplate`); a story with a sheet open shoots `body` at both
// viewports, since the overlays are siblings of `#app`. A missing baseline fails: CI is never
// green with no visual coverage. Re-recording: `npm run test:e2e -- e2e/gin-stories.spec.ts --project pages
// --update-snapshots` on macOS, and the `stories-baselines.yml` workflow for linux. Runs once, on
// `pages`: both origins serve the same bytes.
import { expect, test, type Page } from '@playwright/test';

import {
  STORIES,
  storyById,
  type StoryFacts,
} from '../web/games/gin-rummy/src/stories/catalogue.ts';
import { expectHandRows } from './fixtures/gin.ts';
import { ALLOWED_FAILURES } from './fixtures/offline.ts';
import { pagePath } from './fixtures/site.ts';
import { watchPage } from './fixtures/watch.ts';

type Viewport = Readonly<{ width: number; height: number; columns: 6 | 11; shot: boolean }>;
const VIEWPORTS: Readonly<Record<string, Viewport>> = {
  phone: { width: 390, height: 844, columns: 6, shot: true },
  desktop: { width: 1280, height: 800, columns: 11, shot: true },
  // Geometry only: an iPhone SE, where the cards shrink to their floor and a third row scrolls.
  'phone-short': { width: 375, height: 667, columns: 6, shot: false },
};

/** The facts as the served DOM shows them, in the catalogue's terms. */
const FACTS = `(() => {
  const all = (s) => Array.from(document.querySelectorAll(s));
  const one = (s) => { const els = all(s); return els.length === 0 ? null : els.map((e) => e.getAttribute('data-card')).join(','); };
  const ghost = document.querySelector('#hand .slot.ghost');
  const kind = ghost === null ? 'none' : (['open', 'pending', 'shown'].find((k) => ghost.classList.contains(k)) ?? 'hidden');
  const stock = document.getElementById('stockPile').classList;
  const disc = document.getElementById('discardPile').classList;
  const open = (id) => !document.getElementById(id).classList.contains('hidden');
  const sheet = open('meldOverlay') ? 'meldOverlay' : open('arrangeOverlay') ? 'arrangeOverlay' : open('discardsOverlay') ? 'discardsOverlay' : open('roundResultOverlay') ? 'roundResultOverlay' : 'none';
  const laidOff = sheet === 'roundResultOverlay' ? { laidOff: all('#rrBody .meld-group.laid .card').map((c) => c.getAttribute('data-card')) } : {};
  const ids = (s) => all(s).map((c) => c.getAttribute('data-card'));
  const dc = sheet === 'discardsOverlay' ? { dc: { seen: ids('#discardsGrid .dc.seen'), held: ids('#discardsGrid .dc.held'), top: ids('#discardsGrid .dc.top')[0] ?? null, withHand: document.getElementById('discardsHandToggle').checked } } : {};
  const melds = document.getElementById('tableMelds');
  const layoff = melds.classList.contains('hidden') ? {} : { layoff: { melds: all('#tableMelds .meld-group').map((g) => Array.from(g.querySelectorAll('.card')).map((c) => c.getAttribute('data-card'))), laid: ids('#tableMelds .card.laid') } };
  const arrangeBtn = document.getElementById('arrangeBtn');
  const activeSort = document.querySelector('#arrangeModes button.active');
  return {
    slots: all('#hand .slot').length,
    handCards: all('#hand .slot .card[data-card]').length,
    ghost: kind,
    freshId: one('#hand .card.fresh'),
    lockedId: one('#hand .card.locked'),
    selectedId: one('#hand .card.selected'),
    human: all('#hand .slot.human .card').map((c) => c.getAttribute('data-card')),
    rows: Number(document.getElementById('hand').getAttribute('data-rows')),
    arrange: arrangeBtn.disabled ? 'off' : arrangeBtn.classList.contains('due') ? 'due' : 'idle',
    sort: activeSort === null ? 'suit' : activeSort.getAttribute('data-sort'),
    stock: stock.contains('tappable') ? 'tappable' : 'idle',
    discard: disc.contains('tappable') ? 'tappable' : disc.contains('blocked') ? 'blocked' : 'idle',
    actions: all('#actions [data-act]').map((b) => ({ act: b.getAttribute('data-act'), enabled: !b.disabled })),
    statusSub: document.getElementById('statusSub').textContent,
    sheet,
    ...laidOff,
    ...dc,
    ...layoff,
  };
})()`;
/** `#app` holds its content, and the actions row is on screen once the window is scrolled to its end. */
const GEOMETRY = `(() => {
  const app = document.getElementById('app');
  const before = window.scrollY;
  window.scrollTo(0, document.documentElement.scrollHeight);
  const actions = document.getElementById('actions').getBoundingClientRect();
  window.scrollTo(0, before);
  return {
    app: app.scrollHeight <= app.clientHeight + 1,
    document: document.documentElement.scrollHeight <= window.innerHeight + 1,
    actionsReachable: actions.bottom <= window.innerHeight + 0.5,
    short: window.innerHeight <= 736,
  };
})()`;
/** `data-card -> [x, y, w, h]` of the cards in the first ten slots. */
const RECTS = `Object.fromEntries(Array.from(document.querySelectorAll('#hand .slot')).slice(0, 10).map((s) => {
  const c = s.querySelector('.card');
  const r = c.getBoundingClientRect();
  return [c.getAttribute('data-card'), [r.x, r.y, r.width, r.height]];
}))`;

type Geometry = Readonly<{
  app: boolean;
  document: boolean;
  actionsReachable: boolean;
  short: boolean;
}>;
type Rects = Readonly<Record<string, readonly [number, number, number, number]>>;

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.5;

/** `slots`: eleven cells, less one per card the defender laid off onto the knocker's melds (§7b). */
const openStory = async (page: Page, id: string, slots = 11): Promise<void> => {
  await page.goto(`${pagePath('pages', 'gin-rummy')}?story=${id}`);
  await expect(page.locator('#tableScreen')).toBeVisible();
  await expect(page.locator('#hand .slot')).toHaveCount(slots);
};

/**
 * The hand grid (`expectHandRows`), the phone rows the catalogue computed (`rows`), and the page:
 * `#app` never scrolls; the document scrolls only for a third row on a phone too short for it
 * (theme.css's `:has(#hand[data-rows="3"])` fallback), and then to a reachable actions row.
 */
const expectGeometry = async (
  page: Page,
  vp: Viewport,
  rows: number,
  cells: number,
): Promise<void> => {
  const laid = await expectHandRows(page, vp.columns, cells);
  if (vp.columns === 6) expect(laid, 'rows vs the catalogue').toBe(rows);
  const g = await page.evaluate<Geometry>(GEOMETRY);
  expect(g.app, '#app scrolls').toBe(true);
  expect(g.actionsReachable, 'the actions row is off screen').toBe(true);
  const mayScroll = vp.columns === 6 && rows === 3 && g.short;
  if (!mayScroll) expect(g.document, 'the page scrolls').toBe(true);
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
        await openStory(page, story.id, story.facts.slots);

        // The facts, the geometry, and the owner's sentence: the same card in the same place.
        expect(await page.evaluate<StoryFacts>(FACTS)).toEqual(story.facts);
        await expectGeometry(page, vp, story.facts.rows, story.facts.slots);
        if (story.sameHandAs !== undefined) {
          const other = storyById(story.sameHandAs);
          expect(other, story.sameHandAs).not.toBeNull();
          const mine = await page.evaluate<Rects>(RECTS);
          await openStory(page, story.sameHandAs);
          expectSameRects(mine, await page.evaluate<Rects>(RECTS), story.id);
          await openStory(page, story.id, story.facts.slots);
        }

        if (vp.shot && story.screenshot) {
          const target = name === 'phone' || story.facts.sheet !== 'none' ? 'body' : '#app';
          await expect(page.locator(target)).toHaveScreenshot(`${story.id}--${name}.png`, {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.002,
          });
        }
        expect(watched.errors(), 'uncaught exceptions').toEqual([]);
        expect(watched.failures(), 'failed requests').toEqual([]);
      });
    });
  });
});
