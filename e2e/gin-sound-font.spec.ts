// The sound font (docs/design/sound-fonts.md §6, §10): the gin page's choice among the shared
// fonts, under its own `ginRummy_soundFont` key. Chosen through localStorage (a reload) or the
// console hook (live), remembered; a name that is no font logged and refused; a bad value left in
// storage logged at boot and dropped, so the default stands. Page only: the key and the hook are
// this page's, and both origins serve the same bytes. The second test is the phone (sound-fonts.md
// §12): a touch context starts muted, the speaker's tap turns sound on and remembers it, and the
// remembered choice survives a reload.
import { ginStartLocal } from './fixtures/gin.ts';
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

test('on a phone sound starts muted; the tap on the speaker turns it on inside the gesture and remembers it; a desktop starts on', async ({
  phone,
  player,
  project,
}) => {
  const { page } = phone;
  // The speaker lives in the table's top bar: a pass-and-play game reaches it.
  await ginStartLocal(page, pagePath(project, 'gin-rummy'), PHONE);
  expect(await page.evaluate("matchMedia('(pointer: coarse)').matches")).toBe(true);
  const speaker = page.locator('#soundBtn');
  await expect(speaker).toHaveText('🔇');
  await expect(speaker).toHaveAttribute('title', 'Sound & vibration off');
  expect(await page.evaluate('window.__gin.fx.enabled()')).toBe(false);
  expect(await page.evaluate("localStorage.getItem('ginRummy_sound')")).toBeNull();
  // The taps so far (the start, the curtain) warmed nothing while muted: no silent unlock loop is made.
  expect(await page.locator('audio[playsinline]').count()).toBe(0);
  // The unmute tap: sound on, remembered, the button repainted, the silent loop made in the gesture.
  await speaker.tap();
  await expect(speaker).toHaveText('🔊');
  expect(await page.evaluate('window.__gin.fx.enabled()')).toBe(true);
  expect(await page.evaluate("localStorage.getItem('ginRummy_sound')")).toBe('on');
  await expect(page.locator('audio[playsinline]')).toHaveCount(1);
  expect(
    await page
      .locator('audio[playsinline]')
      .evaluate((a) => (a as unknown as Readonly<{ loop: boolean }>).loop),
  ).toBe(true);
  // Muting again is remembered too.
  await speaker.tap();
  await expect(speaker).toHaveText('🔇');
  expect(await page.evaluate("localStorage.getItem('ginRummy_sound')")).toBe('off');
  await speaker.tap();
  await expect(speaker).toHaveText('🔊');
  // Remembered: the reload starts on.
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  expect(await page.evaluate('window.__gin.fx.enabled()')).toBe(true);
  expect(await page.evaluate("localStorage.getItem('ginRummy_sound')")).toBe('on');

  // The desktop (a fine pointer) keeps today's default: on from the first paint.
  await player.page.goto(pagePath(project, 'gin-rummy'));
  await expect(player.page.locator('#homeScreen')).toBeVisible();
  expect(await player.page.evaluate("matchMedia('(pointer: coarse)').matches")).toBe(false);
  expect(await player.page.evaluate('window.__gin.fx.enabled()')).toBe(true);
  expect(await player.page.evaluate("localStorage.getItem('ginRummy_sound')")).toBeNull();
});
