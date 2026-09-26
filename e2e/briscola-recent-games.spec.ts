// A finished pass-and-play Briscola game is recorded (the owner, 2026-09-25: "after a game is
// finished (either online or pass-and-play) the datetime & score should be recorded, including the
// victor. p1 on the device should be considered the user, so those games get shown as victories
// or losses"): a position seated through `window.__briscola.setup` at the last three tricks, and
// the documented hook's `recentGames()` (web/shared/edge/boot.ts) lists one record with every
// name, the points per side and the winning side (one game per sitting: the result sheet, never a
// match's end screen); the history sheet shows the line under the game's events
// (web/shared/ui/recentGames.ts); a reload keeps the record (`briscola_recentGames`).
import type { Page } from '@playwright/test';

import {
  briscolaPosition,
  briscolaReveal,
  briscolaSetup,
  briscolaStartLocal,
  playTrick,
} from './fixtures/briscola.ts';
import { DESKTOP } from './fixtures/geometry.ts';
import { readPref } from './fixtures/shell.ts';
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
  page.evaluate<ReadonlyArray<Recorded>>('window.__briscola.recentGames()');

test('a finished game records a win for the first player with every name and the points; the sheet lists it; a reload keeps it', async ({
  player,
  project,
}) => {
  const { page } = player;
  await briscolaStartLocal(page, pagePath(project, 'briscola'), DESKTOP);
  await briscolaReveal(page);
  expect(await readRecent(page)).toEqual([]);
  // The first player holds the bastoni honours against low coppe: 96–24 over the deck-order piles.
  await briscolaSetup(
    page,
    briscolaPosition({
      hands: [
        ['AB', '3B', 'RB'],
        ['2C', '4C', '5C'],
      ],
      trumpCard: '7S',
      leader: 0,
    }),
  );
  await playTrick(page);
  await playTrick(page);
  const over = await playTrick(page);
  expect(over.phase).toBe('over');
  expect(over.result).toEqual({ winner: 0, totals: [96, 24], draw: false });
  await expect(page.locator('#resultOverlay')).toBeVisible();
  await expect(page.locator('#endgameScreen')).toBeHidden();
  const recent = await readRecent(page);
  expect(recent).toHaveLength(1);
  expect(recent[0]).toMatchObject({
    mode: 'local',
    players: over.players.map((p) => p.name),
    score: '96–24',
    winner: 0,
    outcome: 'win',
  });
  // The history sheet (the reducer's intent opens it over the result sheet): the game's events,
  // then the one finished game under them.
  await page.evaluate('window.__briscola.dispatch({ type: "history/open" })');
  await expect(page.locator('#historyOverlay')).toBeVisible();
  const line = page.locator('#recentGames .recent-game');
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute('data-outcome', 'win');
  await expect(line.locator('.recent-game-score')).toHaveText('96–24');
  await expect(line.locator('.recent-game-players')).toHaveText(
    over.players.map((p) => p.name).join(' · '),
  );
  // A reload: the finished game is not resumed, the record is (browser storage), the hook lists it.
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#resumeBox')).toBeHidden();
  expect(await readRecent(page)).toEqual(recent);
  expect(JSON.parse((await readPref(page, 'briscola', 'recentGames')) ?? 'null')).toEqual(recent);
});
