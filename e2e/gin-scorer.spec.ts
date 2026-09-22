// The standalone scorer (Score tab): its two players are pass-and-play's two names (typed in
// either place, shown in the other, kept in localStorage under `ginRummy_name`/`ginRummy_p2Name`);
// start a session for them, record one hand through the board's controls, and the totals and hand
// counter update; the session persists.
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

test('scorer: add a round via the scorer tab and the totals update', async ({
  player,
  project,
}) => {
  const { page } = player;
  await page.goto(pagePath(project, 'gin-rummy'));
  await page.locator('#tabScoreBtn').click();
  await expect(page.locator('#scorePanel')).toBeVisible();
  const names = page.locator('#scPlayers input');
  await expect(names).toHaveCount(2);
  await expect(page.locator('#scAddPlayerBtn')).toHaveCount(0);
  await names.nth(0).fill('Ann');
  await names.nth(1).fill('Bob');
  // The same two names as pass-and-play, live and across a reload.
  await expect(page.locator('#p1NameInput')).toHaveValue('Ann');
  await expect(page.locator('#p2NameInput')).toHaveValue('Bob');
  await expect(page.locator('#nameInput')).toHaveValue('Ann');
  await page.locator('#tabPlayBtn').click();
  await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
  await page.locator('#p2NameInput').fill('Bo');
  await page.locator('#tabScoreBtn').click();
  await expect(names.nth(1)).toHaveValue('Bo');
  await page.reload();
  await page.locator('#tabScoreBtn').click();
  await expect(names.nth(0)).toHaveValue('Ann');
  await expect(names.nth(1)).toHaveValue('Bo');
  await names.nth(1).fill('Bob');
  await expect(page.locator('#scTargetInput')).toHaveValue('100');
  await page.locator('#scStartBtn').click();

  await expect(page.locator('#scGameScreen')).toBeVisible();
  const cards = page.locator('#scBoard .player-card');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('#scRoundBadge')).toHaveText('Hand 1');
  await expect(page.locator('#scTargetBadge')).toHaveText('to 100');
  await expect(cards.locator('.player-total')).toHaveText(['0', '0']);

  // Ann knocked with 5 deadwood against Bob's 20: Ann scores the 15 difference.
  await cards.nth(0).locator('.chip[data-k="knock"]').click();
  await expect(cards.nth(0).locator('.chip[data-k="knock"]')).toHaveClass(/active/);
  await cards.nth(0).locator('input.dw').fill('5');
  await cards.nth(1).locator('input.dw').fill('20');
  await page.locator('#scSubmitBtn').click();

  const result = page.locator('#scResOverlay');
  await expect(result).toBeVisible();
  await expect(page.locator('#scResTitle')).toHaveText('Hand 1 results');
  await expect(page.locator('#scResSub')).toContainText('Ann — Knock (5 deadwood)');
  const rows = page.locator('#scResList .standing-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Ann');
  await expect(rows.nth(0).locator('.standing-total')).toHaveText('+15');
  await expect(rows.nth(1)).toContainText('Bob');
  await expect(rows.nth(1).locator('.standing-total')).toHaveText('0');
  await page.locator('#scResContinue').click();
  await expect(result).toBeHidden();

  await expect(page.locator('#scRoundBadge')).toHaveText('Hand 2');
  await expect(cards.locator('.player-total')).toHaveText(['15', '0']);
  await expect(cards.nth(0)).toHaveClass(/leader/);
  await expect(cards.nth(0).locator('.player-name')).toContainText('Ann');
  await expect(cards.nth(0).locator('input.dw')).toHaveValue('0');
  await expect(cards.nth(1).locator('input.dw')).toHaveValue('0');

  // Persisted for "Resume scoring".
  const raw = await page.evaluate<string | null>("localStorage.getItem('ginRummyScorerState_v2')");
  const saved: unknown = JSON.parse(raw ?? 'null');
  expect(saved).toMatchObject({ target: 100, rounds: [{ knockType: 'knock' }] });
});
