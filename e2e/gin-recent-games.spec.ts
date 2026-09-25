// A finished pass-and-play gin game is recorded (the owner, 2026-09-25: "after a game is finished
// (either online or pass-and-play) the datetime & score should be recorded, including the victor.
// p1 on the device should be considered the user, so those games get shown as victories or
// losses"): a one-point game (the pass-and-play target input), rounds through the `window.__gin`
// driver of e2e/fixtures/gin-play.ts until one is scored, Continue takes both seats to the game
// over, and the documented hook's `recentGames()` (web/shared/edge/boot.ts) lists one record with
// the two totals, the winner and the first player's outcome; the end screen's history sheet shows
// the line (web/shared/ui/recentGames.ts); a reload keeps the record (`ginRummy_recentGames`).
import type { Page } from '@playwright/test';

import { DESKTOP } from './fixtures/geometry.ts';
import { playToRoundOver, readView } from './fixtures/gin-play.ts';
import { DEFAULT_NAMES, readPref, startLocal } from './fixtures/shell.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

/** One record as the hook lists it (web/shared/lib/recentGames.ts `RecentGame`). */
type Recorded = Readonly<{
  at: number;
  mode: string;
  players: ReadonlyArray<string>;
  score: string;
  winner: number | null;
  outcome: string;
}>;

/** The finished games the page remembers, newest first. */
const readRecent = (page: Page): Promise<ReadonlyArray<Recorded>> =>
  page.evaluate<ReadonlyArray<Recorded>>('window.__gin.recentGames()');

/** The view's end: the phase, the winner and the two totals, as the hook exposes them. */
const readEnd = (
  page: Page,
): Promise<Readonly<{ phase: string; winner: number | null; totals: ReadonlyArray<number> }>> =>
  page.evaluate(
    '(() => { const v = window.__gin.app.shell.view; return { phase: v.phase, winner: v.winner, totals: v.players.map((p) => p.total) }; })()',
  );

/** Rounds until one is scored (a void hand is continued), four at most. */
const untilScored = async (page: Page, round = 1): Promise<void> => {
  await playToRoundOver(page);
  const view = await readView(page);
  if (view?.result?.void === false || round === 4) return;
  await page.locator('#rrContinueBtn').click();
  await expect(page.locator('#roundResultOverlay')).toBeHidden();
  await untilScored(page, round + 1);
};

test('a one-point game: the scored hand ends it; recorded once with the totals, the victor and the first player`s outcome; listed in the history sheet; kept across a reload', async ({
  player,
  project,
}) => {
  const { page } = player;
  await startLocal(page, pagePath(project, 'gin-rummy'), DESKTOP, DEFAULT_NAMES, async (p) => {
    await p.locator('#localTargetInput').fill('1');
  });
  expect(await readRecent(page)).toEqual([]);
  await untilScored(page);
  // The round is over but the game is not: nothing recorded yet.
  expect((await readEnd(page)).phase).toBe('roundOver');
  expect(await readRecent(page)).toEqual([]);
  // Continue: both seats are ready, a total has reached the target, the game is over.
  await page.locator('#rrContinueBtn').click();
  await expect(page.locator('#endgameScreen')).toBeVisible();
  const end = await readEnd(page);
  expect(end.phase).toBe('gameOver');
  const recent = await readRecent(page);
  expect(recent).toHaveLength(1);
  const [record] = recent;
  expect(record).toMatchObject({
    mode: 'local',
    players: [...DEFAULT_NAMES],
    score: `${String(end.totals[0])}–${String(end.totals[1])}`,
    winner: end.winner,
    outcome: end.winner === 0 ? 'win' : 'loss',
  });
  expect(record?.at).toBeGreaterThan(0);
  // The end screen's history (the result sheet put away first: it sits over the end screen): the
  // hands, then the one finished game under them.
  await page.locator('#rrHideBtn').click();
  await expect(page.locator('#roundResultOverlay')).toBeHidden();
  await page.locator('#historyBtnEnd').click();
  await expect(page.locator('#historyOverlay')).toBeVisible();
  const line = page.locator('#recentGames .recent-game');
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute('data-outcome', record?.outcome ?? '');
  await expect(line.locator('.recent-game-score')).toHaveText(record?.score ?? '');
  await expect(line.locator('.recent-game-players')).toHaveText(DEFAULT_NAMES.join(' · '));
  await expect(line.locator('.recent-game-outcome')).toHaveText(
    record?.outcome === 'win' ? 'W' : 'L',
  );
  // Another paint of the same finished game records nothing more.
  await page.locator('#closeHistoryBtn').click();
  await page.evaluate('window.__gin.render()');
  expect(await readRecent(page)).toEqual(recent);
  // A reload: the finished game is not resumed, the record is (browser storage), the hook lists it.
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#resumeBox')).toBeHidden();
  expect(await readRecent(page)).toEqual(recent);
  expect(JSON.parse((await readPref(page, 'gin-rummy', 'recentGames')) ?? 'null')).toEqual(recent);
});
