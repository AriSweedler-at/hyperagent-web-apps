// A finished pass-and-play Sheshbesh match is recorded (the owner, 2026-09-25: "after a game is
// finished (either online or pass-and-play) the datetime & score should be recorded, including the
// victor. p1 on the device should be considered the user, so those games get shown as victories
// or losses"): positions seated through `window.__backgammon.setup` (the shell's `position/load`)
// put the first player one bear-off from the match, then, after a Rematch, the second player; the
// documented hook's `recentGames()` (web/shared/edge/boot.ts) lists the win, then the loss first
// (newest first), each with the match score and the victor; the history sheet shows the lines
// (web/shared/ui/recentGames.ts); a reload keeps both (`backgammon_recentGames`).
import type { Page } from '@playwright/test';

import { bgMove, bgPosition, bgSetup, bgStartLocal } from './fixtures/backgammon.ts';
import { DESKTOP } from './fixtures/geometry.ts';
import { DEFAULT_NAMES, readPref, reveal } from './fixtures/shell.ts';
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

/** The finished matches the page remembers, newest first. */
const readRecent = (page: Page): Promise<ReadonlyArray<Recorded>> =>
  page.evaluate<ReadonlyArray<Recorded>>('window.__backgammon.recentGames()');

/** Light (seat 0, the first name) bears off with 6-5 from own 4 and 2: 2/off is a gammon. */
const LIGHT_WINS = 'L: 4:1 2:1 | D: 24:2 1:13 | bar 0/0 | off 13/0';
/** The mirror: Dark (seat 1) bears off from its own 4 and 2, Light's fifteen well away. */
const DARK_WINS = 'L: 24:2 1:13 | D: 4:1 2:1 | bar 0/0 | off 0/13';

test('the bear-off that takes the match records a win for the first player; the rematch the second player takes records a loss, newest first; the sheet lists both; a reload keeps them', async ({
  player,
  project,
}) => {
  const { page } = player;
  await bgStartLocal(page, pagePath(project, 'backgammon'), DESKTOP);
  await reveal(page);
  expect(await readRecent(page)).toEqual([]);

  // Ann at 3–0 in a match to 5: the gammon makes it 5–0, the match.
  await bgSetup(page, bgPosition({ text: LIGHT_WINS, turn: 0, dice: [6, 5], score: [3, 0] }));
  await bgMove(page, 4, 'off');
  expect(await readRecent(page)).toEqual([]);
  await bgMove(page, 2, 'off');
  await expect(page.locator('#endgameScreen')).toBeVisible();
  await expect(page.locator('#resultTitle')).toHaveText('Ann takes the match 5–0');
  const won = await readRecent(page);
  expect(won).toHaveLength(1);
  expect(won[0]).toMatchObject({
    mode: 'local',
    players: [...DEFAULT_NAMES],
    score: '5–0',
    winner: 0,
    outcome: 'win',
  });
  // The history sheet (the table's button is the desktop's; the reducer's intent opens it anywhere).
  await page.evaluate('window.__backgammon.dispatch({ type: "history/toggle" })');
  await expect(page.locator('#historyOverlay')).toBeVisible();
  await expect(page.locator('#recentGames .recent-game')).toHaveCount(1);
  await expect(page.locator('#recentGames .recent-game')).toHaveAttribute('data-outcome', 'win');
  await expect(page.locator('#recentGames .recent-game-score')).toHaveText('5–0');
  await page.locator('#closeHistoryBtn').click();
  await expect(page.locator('#historyOverlay')).toBeHidden();
  // Repaints of the finished match record nothing more.
  await page.evaluate('window.__backgammon.render()');
  expect(await readRecent(page)).toEqual(won);

  // Rematch, then Bob at 0–3 bears off: 0–5, Bob's match, a loss for the device's first player.
  await expect(page.locator('#nextGameBtn')).toHaveText('Rematch');
  await page.locator('#nextGameBtn').click();
  await expect(page.locator('#tableScreen')).toBeVisible();
  await bgSetup(page, bgPosition({ text: DARK_WINS, turn: 1, dice: [6, 5], score: [0, 3] }));
  await bgMove(page, 4, 'off');
  await bgMove(page, 2, 'off');
  await expect(page.locator('#endgameScreen')).toBeVisible();
  // The end screen names the winner's points first; the record keeps seat order.
  await expect(page.locator('#resultTitle')).toHaveText('Bob takes the match 5–0');
  const lost = await readRecent(page);
  expect(lost).toHaveLength(2);
  expect(lost[0]).toMatchObject({
    mode: 'local',
    players: [...DEFAULT_NAMES],
    score: '0–5',
    winner: 1,
    outcome: 'loss',
  });
  expect(lost[1]).toEqual(won[0]);
  await page.evaluate('window.__backgammon.dispatch({ type: "history/toggle" })');
  await expect(page.locator('#recentGames .recent-game')).toHaveCount(2);
  await expect(page.locator('#recentGames .recent-game').first()).toHaveAttribute(
    'data-outcome',
    'loss',
  );
  await expect(page.locator('#recentGames .recent-game').nth(1)).toHaveAttribute(
    'data-outcome',
    'win',
  );
  await expect(page.locator('#recentGames .recent-game-outcome').first()).toHaveText('L');

  // A reload: the finished match is not resumed, both records are (browser storage), the hook lists them.
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#resumeBox')).toBeHidden();
  expect(await readRecent(page)).toEqual(lost);
  expect(JSON.parse((await readPref(page, 'backgammon', 'recentGames')) ?? 'null')).toEqual(lost);
});
