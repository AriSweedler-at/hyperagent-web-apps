// Every page on both emulated origins: the right title, the page's networking in place (both game
// pages are typed since docs/MIGRATION.md step 13: the documented hook booted, PeerJS and ICE
// arrive bundled and no classic script is requested), zero uncaught exceptions and zero failed
// requests outside the allowlist (e2e/fixtures/offline.ts). The landing page's card links must
// also resolve on the origin they are clicked from: on the proxy that means the Worker's
// /games/XXX -> /XXX redirect.
import { EXPECTED_TITLES, PAGES, pagePath } from './fixtures/site.ts';
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
      const hook = name === 'fidice' ? 'window.__fidice' : 'window.__gin';
      await expect.poll(() => page.evaluate<string>(`typeof ${hook}`)).toBe('object');
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
  expect(hrefs).toEqual(['games/gin-rummy/', 'games/fidice/']);
  await Promise.all(
    hrefs.map(async (href) => {
      const target = new URL(href ?? '', page.url()).toString();
      const response = await page.request.get(target);
      expect(response.status(), target).toBe(200);
      expect(await response.text(), target).toContain('<title>');
    }),
  );
});
