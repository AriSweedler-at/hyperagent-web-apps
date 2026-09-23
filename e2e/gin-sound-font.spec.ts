// The sound font (docs/design/sound-fonts.md §6, §10): the gin page's choice among the shared
// fonts, under its own `ginRummy_soundFont` key. Chosen through localStorage (a reload) or the
// console hook (live), remembered; a name that is no font logged and refused; a bad value left in
// storage logged at boot and dropped, so the default stands. Page only: the key and the hook are
// this page's, and both origins serve the same bytes.
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const PHONE = { width: 390, height: 844 };
const KEY = 'ginRummy_soundFont';

test('the sound font: from storage after a reload, live from the console, remembered; bad names refused and bad stored values dropped', async ({
  player,
  project,
}) => {
  const { page } = player;
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize(PHONE);
  await page.goto(pagePath(project, 'gin-rummy'));
  await expect(page.locator('#homeScreen')).toBeVisible();
  expect(await page.evaluate('window.__gin.soundFontName()')).toBe('default');
  expect(await page.evaluate(`localStorage.getItem('${KEY}')`)).toBeNull();

  // A font set in storage is the page's after a reload.
  await page.evaluate(`localStorage.setItem('${KEY}', 'arcade')`);
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  expect(await page.evaluate('window.__gin.soundFontName()')).toBe('arcade');

  // The console hook switches it live and remembers it.
  await page.evaluate("window.__gin.soundFont('felt')");
  expect(await page.evaluate('window.__gin.soundFontName()')).toBe('felt');
  expect(await page.evaluate(`localStorage.getItem('${KEY}')`)).toBe('felt');

  // A bad name is logged and refused: nothing changes, in the page or in storage.
  await page.evaluate("window.__gin.soundFont('plaid')");
  expect(errors.at(-1)).toBe(
    'ginRummy_soundFont: "plaid" is not a sound font; kept the current one. One of: default, felt, arcade.',
  );
  expect(await page.evaluate('window.__gin.soundFontName()')).toBe('felt');
  expect(await page.evaluate(`localStorage.getItem('${KEY}')`)).toBe('felt');

  // A bad value left in storage is logged at boot and dropped, so the default stands.
  await page.evaluate(`localStorage.setItem('${KEY}', 'tartan')`);
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  expect(errors.at(-1)).toContain('"tartan" is not a sound font');
  expect(await page.evaluate(`localStorage.getItem('${KEY}')`)).toBeNull();
  expect(await page.evaluate('window.__gin.soundFontName()')).toBe('default');

  // The card back's key is untouched throughout: the two preferences are separate keys.
  expect(await page.evaluate("localStorage.getItem('ginRummy_cardBack')")).toBeNull();
});
