// The stories catalogue on the served page (docs/design/gin-draw-ghost-slot.md §7 and §8;
// docs/ARCHITECTURE.md "Testing pyramid" 5). Every story of web/games/gin-rummy/src/stories/
// catalogue.ts is opened through the page's `?story=<id>` hook at a phone, a laptop and a short
// phone by the shared e2e/fixtures/stories.ts `storiesSpec` (docs/design/dry-round-2.md I3), which
// asserts the facts, the stability and the screenshots against the committed per-platform baselines
// (`e2e/__screenshots__/gin-stories.spec.ts/<id>--<viewport>-<platform>.png`; a missing baseline
// fails). What is gin's stays here: the facts the catalogue derived from the engine and the picture
// as the DOM shows them (slot and card counts, the ghost cell's class, the fresh, locked, selected
// and hand-made cards, the phone row count, the Arrange button, the sort mode, the piles, the
// buttons and their state, the status line, the open sheet); the geometry (`#app` and `#hand`
// never scroll, the eleven cells are one size, a meld never splits a row, the rows on a phone are
// the ones `data-rows` announces and one on the laptop: e2e/fixtures/gin.ts `expectHandRows`; a
// three-row hand on a phone too short for it scrolls the document to a reachable actions row
// instead); the first ten slots' rectangles for `sameHandAs`; and the slot count the table is
// settled at. Re-recording: `npm run test:e2e -- e2e/gin-stories.spec.ts --project pages
// --update-snapshots` on macOS, and the `stories-baselines.yml` workflow for linux. Filter by title
// (`--grep "phone upcard-mine"`): the reporter locates every story test at the fixture's
// `test(...)`, not at a line of this file, so `gin-stories.spec.ts:<line>` selects nothing.
import { expect, type Page } from '@playwright/test';

import {
  STORIES,
  storyById,
  type Story,
  type StoryFacts,
} from '../web/games/gin-rummy/src/stories/catalogue.ts';
import { expectHandRows } from './fixtures/gin.ts';
import { storiesSpec, type StoryViewport } from './fixtures/stories.ts';

type Viewport = StoryViewport & Readonly<{ columns: 6 | 11 }>;
const VIEWPORTS: Readonly<Record<string, Viewport>> = {
  phone: { width: 390, height: 844, columns: 6, shot: true, body: true },
  desktop: { width: 1280, height: 800, columns: 11, shot: true, body: false },
  // Geometry only: an iPhone SE, where the cards shrink to their floor and a third row scrolls.
  'phone-short': { width: 375, height: 667, columns: 6, shot: false, body: false },
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

/**
 * The hand grid (`expectHandRows`), the phone rows the catalogue computed (`rows`), and the page:
 * `#app` never scrolls; the document scrolls only for a third row on a phone too short for it
 * (theme.css's `:has(#hand[data-rows="3"])` fallback), and then to a reachable actions row.
 */
const expectGeometry = async (page: Page, story: Story, vp: Viewport): Promise<void> => {
  const { rows, slots: cells } = story.facts;
  const laid = await expectHandRows(page, vp.columns, cells);
  if (vp.columns === 6) expect(laid, 'rows vs the catalogue').toBe(rows);
  const g = await page.evaluate<Geometry>(GEOMETRY);
  expect(g.app, '#app scrolls').toBe(true);
  expect(g.actionsReachable, 'the actions row is off screen').toBe(true);
  const mayScroll = vp.columns === 6 && rows === 3 && g.short;
  if (!mayScroll) expect(g.document, 'the page scrolls').toBe(true);
};

storiesSpec<Story, Viewport, StoryFacts>({
  game: 'gin-rummy',
  stories: STORIES,
  storyById,
  viewports: VIEWPORTS,
  // `slots`: eleven cells, less one per card the defender laid off onto the knocker's melds (§7b).
  settled: async (page, story) => {
    await expect(page.locator('#hand .slot')).toHaveCount(story.facts.slots);
  },
  readFacts: (page) => page.evaluate<StoryFacts>(FACTS),
  expectFacts: (facts, story) => {
    expect(facts).toEqual(story.facts);
  },
  geometry: expectGeometry,
  stable: { sameAs: (story) => story.sameHandAs, rects: RECTS },
  sheetOpen: (story) => story.facts.sheet !== 'none',
});
