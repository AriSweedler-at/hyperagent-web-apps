// Pass-and-play on one page: start, the curtain hands the phone to the first player, one full turn
// (take the upcard, discard), and the curtain comes back for the other player naming the move.
import { ginTakeUpcardAndDiscard } from './fixtures/gin.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

test('pass and play: start, curtain handoff, one full turn', async ({ player, project }) => {
  const { page } = player;
  await page.goto(pagePath(project, 'gin-rummy'));
  await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
  await expect(page.locator('#localModeContent')).toBeVisible();
  await page.locator('#p1NameInput').fill('Ann');
  await page.locator('#p2NameInput').fill('Bob');
  await page.locator('#localBtn').click();

  // The curtain hides the first player's cards until they take the phone.
  const curtain = page.locator('#curtainOverlay');
  const title = page.locator('#curtainTitle');
  await expect(curtain).toBeVisible();
  await expect(title).toHaveText(/^Pass the phone to (Ann|Bob)$/);
  const first = (await title.innerText()).replace('Pass the phone to ', '');
  const other = first === 'Ann' ? 'Bob' : 'Ann';
  await expect(page.locator('#curtainSub')).toContainText(`${other}, look away`);
  await page.locator('#curtainBtn').click();
  await expect(curtain).toBeHidden();
  await expect(page.locator('#tableScreen')).toBeVisible();
  await expect(page.locator('#myName')).toContainText(first);
  await expect(page.locator('#oppName')).toHaveText(other);
  await expect(page.locator('#hand .card')).toHaveCount(10);
  await expect(page.locator('#statusBanner')).toHaveClass(/mine/);
  await expect(page.locator('#statusSub')).toHaveText('Take the upcard or pass');

  // One full turn: take the upcard (it stays locked), then discard another card.
  const upcard = await page.locator('#discardPile .card').getAttribute('data-card');
  const discarded = await ginTakeUpcardAndDiscard(page);
  expect(discarded).not.toBe(upcard);

  // The turn passed: the curtain asks for the other player and names the move, and the table
  // behind it already shows the discard.
  await expect(curtain).toBeVisible();
  await expect(title).toHaveText(`Pass the phone to ${other}`);
  await expect(page.locator('#curtainLast')).toContainText(`${first} discarded the`);
  await expect(page.locator('#discardPile .card')).toHaveAttribute('data-card', discarded);

  // The game is saved for "Resume pass & play".
  const raw = await page.evaluate<string | null>("localStorage.getItem('ginRummyMP_v1')");
  const saved: unknown = JSON.parse(raw ?? 'null');
  expect(saved).toMatchObject({ role: 'local', game: { handNumber: 1 } });
});
