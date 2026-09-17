// Every page on both emulated origins (and the ported pages on the dark `next` build): the right
// title, shared/ice.js and PeerJS loaded, zero uncaught exceptions and zero failed requests outside
// the allowlist (e2e/fixtures/offline.ts). The landing page's card links must also resolve on the
// origin they are clicked from: on the proxy that means the Worker's /games/XXX -> /XXX redirect;
// on `next` only the links to pages dist-next/ holds are followed.
import { EXPECTED_TITLES, PAGES, pagePath, pagesOn } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

PAGES.forEach((name) => {
  test(`${name}: loads cleanly`, async ({ player, project }) => {
    test.skip(!pagesOn(project).includes(name), `${name} is not built into dist-next/`);
    const { page, watched } = player;
    await page.goto(pagePath(project, name));
    await expect(page).toHaveTitle(EXPECTED_TITLES[name]);
    await page.waitForLoadState('networkidle');
    if (name !== 'landing') {
      await expect(page.locator('#app')).toBeVisible();
      await expect.poll(() => page.evaluate<string>('typeof window.HyperIce')).toBe('object');
      await expect.poll(() => page.evaluate<string>('typeof Peer')).toBe('function');
      const ice = watched.responses().filter((response) => response.url.endsWith('shared/ice.js'));
      expect(
        ice.map((response) => response.status),
        'shared/ice.js response',
      ).toEqual([200]);
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
  expect(hrefs).toEqual(['games/gin-rummy/', 'games/fidice/']);
  const built = hrefs.filter((href) => pagesOn(project).some((name) => href === `games/${name}/`));
  expect(built.length).toBe(pagesOn(project).length - 1);
  await Promise.all(
    built.map(async (href) => {
      const target = new URL(href ?? '', page.url()).toString();
      const response = await page.request.get(target);
      expect(response.status(), target).toBe(200);
      expect(await response.text(), target).toContain('<title>');
    }),
  );
});
