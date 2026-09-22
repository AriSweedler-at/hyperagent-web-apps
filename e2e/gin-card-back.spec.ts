// The card back (docs/design/gin-card-backs.md): one picture scaled to the card, so the stock and
// the opponent's strip show the same image; a preset chosen through localStorage (a reload) or the
// console hook (live), remembered; a value naming no preset logged and refused, and dropped from
// storage at boot so the default stands.
import type { Page } from '@playwright/test';

import { ginStartLocal } from './fixtures/gin.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const PHONE = { width: 390, height: 844 };
const BACKS = `(() => {
  const style = (el) => getComputedStyle(el);
  const stock = document.querySelector('#stockPile .card.back');
  const tiny = document.querySelector('#oppCards .card.back');
  return {
    body: document.body.getAttribute('data-card-back'),
    stockImage: style(stock).backgroundImage,
    tinyImage: style(tiny).backgroundImage,
    same: style(stock).backgroundImage === style(tiny).backgroundImage,
    size: style(stock).backgroundSize,
    stockWidth: stock.getBoundingClientRect().width,
    tinyWidth: tiny.getBoundingClientRect().width,
  };
})()`;
type Backs = Readonly<{
  body: string | null;
  stockImage: string;
  tinyImage: string;
  same: boolean;
  size: string;
  stockWidth: number;
  tinyWidth: number;
}>;
const backs = (page: Page): Promise<Backs> => page.evaluate<Backs>(BACKS);

test('the card back: one scaled picture on every face-down card; a preset from storage, live from the console; bad values refused', async ({
  player,
  project,
}) => {
  const { page } = player;
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await ginStartLocal(page, pagePath(project, 'gin-rummy'), PHONE);
  const before = await backs(page);
  expect(before.body).toBe('default');
  expect(before.same).toBe(true);
  expect(before.size).toBe('100% 100%');
  expect(before.stockImage).toContain('url("data:image/svg+xml');
  expect(before.stockWidth).toBeGreaterThan(before.tinyWidth * 2);

  // A preset set in storage shows after a reload, on the stock and the strip alike.
  await page.evaluate("localStorage.setItem('ginRummy_cardBack', 'yu-gi-oh')");
  await page.reload();
  await page.locator('#resumeBtn').click();
  await expect(page.locator('#tableScreen')).toBeVisible();
  const swapped = await backs(page);
  expect(swapped.body).toBe('yu-gi-oh');
  expect(swapped.same).toBe(true);
  expect(swapped.stockImage).not.toBe(before.stockImage);

  // The console hook switches it live and remembers it; `empty` draws no picture.
  await page.evaluate("window.__gin.cardBack('blue-stripe')");
  await expect.poll(() => backs(page).then((b) => b.body)).toBe('blue-stripe');
  expect(await page.evaluate("localStorage.getItem('ginRummy_cardBack')")).toBe('blue-stripe');
  await page.evaluate("window.__gin.cardBack('empty')");
  await expect.poll(() => backs(page).then((b) => b.stockImage)).toBe('none');

  // A bad name is logged and refused: nothing changes, in the page or in storage.
  await page.evaluate("window.__gin.cardBack('plaid')");
  expect(errors.at(-1)).toContain('"plaid" is not a card back');
  expect((await backs(page)).body).toBe('empty');
  expect(await page.evaluate("localStorage.getItem('ginRummy_cardBack')")).toBe('empty');

  // A bad value left in storage is logged at boot and dropped, so the default stands.
  await page.evaluate("localStorage.setItem('ginRummy_cardBack', 'tartan')");
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  expect(errors.at(-1)).toContain('"tartan" is not a card back');
  expect(await page.evaluate("localStorage.getItem('ginRummy_cardBack')")).toBeNull();
  expect(await page.evaluate("document.body.getAttribute('data-card-back')")).toBe('default');
});
