// The stories (docs/design/briscola.md §5.6): each catalogued table state served at `?story=<id>`
// shows the facts its catalogue row records (the screen, the seats, the curtain, the hand's cards
// and marks, the fan, the stock and the briscola, the sheet open), passes the geometry oracle at a
// phone and a laptop, and, for the marked ones, matches its committed per-platform screenshot
// (`<story>--<viewport>-<platform>.png` under e2e/__screenshots__/, recorded with
// `--update-snapshots` locally and by .github/workflows/stories-baselines.yml on linux). The
// harness is the shared e2e/fixtures/stories.ts (one test per story per viewport, `pages` only);
// this file holds what is briscola's: how the facts are read off the DOM and the geometry checks.
import type { Page } from '@playwright/test';

import {
  STORIES,
  storyById,
  type Story,
  type StoryFacts,
} from '../web/games/briscola/src/stories/catalogue.ts';
import { expectTableGeometry, tableGeometry } from './fixtures/briscola.ts';
import { DESKTOP, PHONE } from './fixtures/geometry.ts';
import { storiesSpec, type StoryViewport } from './fixtures/stories.ts';

/** The facts as the served DOM shows them, in the catalogue's terms. */
const readFacts = (page: Page): Promise<StoryFacts> =>
  page.evaluate<StoryFacts>(`(() => {
  const shown = (id) => !document.getElementById(id).classList.contains('hidden');
  const hand = document.getElementById('hand');
  const stock = document.getElementById('stock');
  const sheets = ['historyOverlay', 'resultOverlay'];
  return {
    screen: shown('endgameScreen') ? 'endgameScreen' : 'tableScreen',
    players: Number(document.getElementById('seats').getAttribute('data-players')),
    curtain: shown('curtainOverlay'),
    handCards: document.querySelectorAll('#hand .slot .card').length,
    handLive: hand.classList.contains('active'),
    handDown: hand.classList.contains('hidden-cards'),
    selected: document.querySelector('#hand .card.selected')?.getAttribute('data-card') ?? null,
    trickCards: document.querySelectorAll('#trick .play .card').length,
    stockCount: Number(stock.getAttribute('data-count')),
    stockEmpty: stock.classList.contains('empty'),
    briscolaGone: document.getElementById('briscola').classList.contains('gone'),
    sheet: sheets.find((id) => shown(id)) ?? 'none',
  };
})()`);

storiesSpec<Story, StoryViewport, StoryFacts>({
  game: 'briscola',
  stories: STORIES,
  storyById,
  // The phone shoots `body` (its sheets are siblings of `#app`); the laptop `#app`.
  viewports: {
    phone: { ...PHONE, shot: true, body: true },
    desktop: { ...DESKTOP, shot: true, body: false },
  },
  settled: async (page, story) => {
    // The table is laid once the three slots are there; the end screen shows no hand.
    if (story.facts.screen === 'tableScreen') await page.locator('#hand .slot').nth(2).waitFor();
  },
  readFacts,
  expectFacts: (facts, story) => {
    if (JSON.stringify(facts) !== JSON.stringify(story.facts))
      throw new Error(
        `${story.id}: the DOM shows ${JSON.stringify(facts)}, the catalogue ${JSON.stringify(story.facts)}`,
      );
  },
  geometry: async (page, story) => {
    if (story.facts.screen === 'tableScreen')
      expectTableGeometry(await tableGeometry(page), story.id);
  },
  sheetOpen: (story) => story.facts.sheet !== 'none' || story.facts.curtain,
});
