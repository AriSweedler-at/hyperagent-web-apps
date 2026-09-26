// Every page on both emulated origins: the right title, the page's networking in place (both game
// pages are typed since docs/MIGRATION.md step 13: the documented hook booted, PeerJS and ICE
// arrive bundled and no classic script is requested), zero uncaught exceptions and zero failed
// requests outside the allowlist (e2e/fixtures/offline.ts). The landing page's card links must
// also resolve on the origin they are clicked from: on the proxy that means the Worker's
// /games/XXX -> /XXX redirect.
import { ALIASES, HOOKS, LANDING_HREFS } from '../tools/games.ts';
import { gameQuery } from './fixtures/player.ts';
import {
  EXPECTED_TITLES,
  PAGES,
  PAGES_BASE_PATH,
  folderPath,
  pagePath,
  titleOf,
} from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

PAGES.forEach((name) => {
  test(`${name}: loads cleanly`, async ({ player, project }) => {
    const { page, watched } = player;
    // The bare page, no query: the page as a visitor loads it. For fidice that is the live legacy
    // path (the shell specs open its shell path through e2e/fixtures/player.ts PAGE_QUERY), so the
    // live path keeps a load check until M6 of docs/design/fidice-shell-adoption.md flips it.
    await page.goto(pagePath(project, name));
    await expect(page).toHaveTitle(EXPECTED_TITLES[name]);
    await page.waitForLoadState('networkidle');
    if (name !== 'landing') await expect(page.locator('#app')).toBeVisible();
    const ice = watched.responses().filter((response) => response.url.endsWith('shared/ice.js'));
    if (name !== 'landing') {
      // docs/MIGRATION.md steps 9 and 12: no classic scripts; the documented hook shows the boot finished.
      await expect.poll(() => page.evaluate<string>(`typeof ${HOOKS[name]}`)).toBe('object');
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

test('landing: every card link resolves on this origin', async ({ player, project }) => {
  const { page } = player;
  await page.goto(pagePath(project, 'landing'));
  const cards = await page.locator('a.card').all();
  const hrefs = await Promise.all(cards.map((card) => card.getAttribute('href')));
  expect(hrefs).toEqual(LANDING_HREFS);
  await Promise.all(
    hrefs.map(async (href) => {
      const target = new URL(href ?? '', page.url()).toString();
      const response = await page.request.get(target);
      expect(response.status(), target).toBe(200);
      expect(await response.text(), target).toContain('<title>');
    }),
  );
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
