// Every page on both emulated origins: the right title, the page's networking in place (both game
// pages are typed since docs/MIGRATION.md step 13: the documented hook booted, PeerJS and ICE
// arrive bundled and no classic script is requested), zero uncaught exceptions and zero failed
// requests outside the allowlist (e2e/fixtures/offline.ts). The landing page's card links must
// also resolve on the origin they are clicked from, in one request: on the proxy the Worker serves
// the landing page with its `games/XXX/` hrefs already rewritten to /XXX/ (worker.ts "Landing
// links"), so a click never takes the /games/XXX -> /XXX redirect, which stays for old links.
import { ALIASES, LANDING_HREFS, LANDING_PAGES, PAGE_HOOKS } from '../tools/games.ts';
import { gameQuery } from './fixtures/player.ts';
import {
  EXPECTED_TITLES,
  PAGES,
  PAGES_BASE_PATH,
  type Project,
  baseUrl,
  folderPath,
  pagePath,
  titleOf,
} from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

PAGES.forEach((name) => {
  test(`${name}: loads cleanly`, async ({ player, project }) => {
    const { page, watched } = player;
    await page.goto(pagePath(project, name));
    await expect(page).toHaveTitle(EXPECTED_TITLES[name]);
    await page.waitForLoadState('networkidle');
    if (name !== 'landing') await expect(page.locator('#app')).toBeVisible();
    const ice = watched.responses().filter((response) => response.url.endsWith('shared/ice.js'));
    if (name !== 'landing') {
      // docs/MIGRATION.md steps 9 and 12: no classic scripts; the documented hook shows the boot finished.
      await expect.poll(() => page.evaluate<string>(`typeof ${PAGE_HOOKS[name]}`)).toBe('object');
      expect(await page.evaluate<string>('typeof Peer')).toBe('undefined');
      expect(await page.evaluate<string>('typeof window.HyperIce')).toBe('undefined');
      expect(ice, 'shared/ice.js must not be requested').toEqual([]);
      expect(
        watched.responses().filter((response) => response.url.includes('peerjs.min.js')),
        'the PeerJS CDN bundle must not be requested',
      ).toEqual([]);
    }
    expect(watched.errors(), 'uncaught exceptions').toEqual([]);
    expect(watched.failures(), 'failed requests').toEqual([]);
  });
});

/** The card hrefs as each origin serves them: relative on Pages, short on the proxy (rewritten by the Worker as it serves `/`). */
const cardHrefs = (project: Project): ReadonlyArray<string> =>
  project === 'proxy' ? LANDING_PAGES.map((page) => `/${page}/`) : LANDING_HREFS;

test('landing: every card link resolves on this origin', async ({ player, project }) => {
  const { page } = player;
  await page.goto(pagePath(project, 'landing'));
  const cards = await page.locator('a.card').all();
  const hrefs = await Promise.all(cards.map((card) => card.getAttribute('href')));
  expect(hrefs).toEqual(cardHrefs(project));
  await Promise.all(
    hrefs.map(async (href) => {
      const target = new URL(href ?? '', page.url()).toString();
      const response = await page.request.get(target);
      expect(response.status(), target).toBe(200);
      expect(await response.text(), target).toContain('<title>');
    }),
  );
});

// A card click is one document request that lands on the game's page at this origin's own path:
// no redirect hop (`redirectedFrom()` is null), so the address bar and the history hold the short
// URL alone on the proxy. The same on Pages, where the relative href resolves in place.
LANDING_PAGES.forEach((game) => {
  test(`landing: the ${game} card lands on the game in one request`, async ({
    player,
    project,
  }) => {
    const { page } = player;
    await page.goto(pagePath(project, 'landing'));
    const expected = new URL(folderPath(project, game), baseUrl(project)).pathname;
    const [document] = await Promise.all([
      page.waitForResponse((response) => response.request().resourceType() === 'document'),
      page.locator(`a.card[href$="/${game}/"]`).click(),
    ]);
    expect(new URL(document.url()).pathname).toBe(expected);
    expect(document.status()).toBe(200);
    expect(document.request().redirectedFrom(), 'a redirect hop before the page').toBeNull();
    await expect(page).toHaveTitle(titleOf(game));
    expect(new URL(page.url()).pathname).toBe(expected);
  });
});

// An alias (tools/games.ts ALIASES) is a game's page under a second name. On the Pages origin the
// stub web/games/<alias>/index.html forwards to ../<game>/ with the query intact, so the address
// bar ends at the game's own path; on the proxy the Worker serves /<alias>/ from the game's folder
// in place, so the address bar keeps the alias. Either way the page that loads is the game's: its
// title, and a clean load. The page reads and strips ?join= itself (a room nobody hosts, on the
// harness's broker), so the pathname is asserted and not the query.
// Needs the game's page in dist: written while the backgammon page was landing in its own PR, so
// on a checkout without web/games/backgammon/index.html this test fails until that PR is in.
Object.entries(ALIASES).forEach(([alias, game]) => {
  test(`${alias}: is the ${game} page under another name`, async ({ player, project }) => {
    const { page, watched } = player;
    // The join code beside the harness's `?peer=` and `?ice=` hooks, as an invite link opens.
    const query = new URLSearchParams(gameQuery());
    query.set('join', 'ABCD');
    await page.goto(`${folderPath(project, alias)}?${query.toString()}`);
    const expected = project === 'proxy' ? `/${alias}/` : `${PAGES_BASE_PATH}games/${game}/`;
    await expect.poll(() => new URL(page.url()).pathname).toBe(expected);
    await expect(page).toHaveTitle(titleOf(game));
    await page.waitForLoadState('networkidle');
    expect(watched.failures(), 'failed requests').toEqual([]);
  });
});

// The landing page fits a phone without scrolling and keeps fitting once four more games join
// the grid (web/index.html: one tile per game, an emoji and a name, no blurb, two columns at a
// phone's width). One context of the spec's own per phone: a touch viewport with the project's
// baseURL passed by hand, as e2e/backgammon-devices.spec.ts does. The next four games are counted
// before they exist: the tallest tile is cloned four times into the grid and the page must still
// not scroll, so a new game is a new card and never a redesign.
const PHONES: ReadonlyArray<{ name: string; width: number; height: number }> = [
  { name: '390x844', width: 390, height: 844 },
  { name: '360x780', width: 360, height: 780 },
];
/** How far the document overruns the viewport: `<= 0` is a page that never scrolls. */
const SCROLL_OVERRUN = 'document.documentElement.scrollHeight - window.innerHeight';
/** The grid's column count as laid out, and the shortest tile: two columns of 44px targets on a phone. */
const GRID_SHAPE = `(() => {
  const grid = document.querySelector('.grid');
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const heights = [...document.querySelectorAll('a.card')].map((card) => card.offsetHeight);
  return { columns, shortest: Math.min(...heights) };
})()`;
/** Clone the tallest tile four times into the grid (the next four games) and count the cards. */
const FOUR_MORE_GAMES = `(() => {
  const grid = document.querySelector('.grid');
  const cards = [...document.querySelectorAll('a.card')];
  const tallest = cards.reduce((a, b) => (b.offsetHeight > a.offsetHeight ? b : a));
  for (let i = 0; i < 4; i += 1) grid.append(tallest.cloneNode(true));
  return document.querySelectorAll('a.card').length;
})()`;

PHONES.forEach(({ name, width, height }) => {
  test(`landing: fits ${name} without scrolling, four more games included`, async ({
    browser,
    project,
  }) => {
    const context = await browser.newContext({
      baseURL: baseUrl(project),
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    try {
      await page.goto(pagePath(project, 'landing'));
      await expect(page.locator('a.card')).toHaveCount(LANDING_PAGES.length);
      const shape = await page.evaluate<{ columns: number; shortest: number }>(GRID_SHAPE);
      expect(shape.columns, 'two columns on a phone').toBe(2);
      expect(shape.shortest, 'every tile a 44px target').toBeGreaterThanOrEqual(44);
      expect(await page.evaluate<number>(SCROLL_OVERRUN), 'as shipped').toBeLessThanOrEqual(0);
      expect(await page.evaluate<number>(FOUR_MORE_GAMES)).toBe(LANDING_PAGES.length + 4);
      expect(await page.evaluate<number>(SCROLL_OVERRUN), 'four more games').toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });
});
