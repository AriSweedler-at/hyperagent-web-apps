// The reaction game on a phone (docs/design/rps-island.md §3): five rounds driven by the page's
// clock (`page.clock`: the scroll, the window and the reaction time are all timers and
// `performance.now()` readings, so a round is played to the millisecond), rigged through the
// documented hook `window.__rps.rig` so the computer's hand is known. A win at +4 with four fast
// wins saved offers Tech up (§2), Tech up is taken, then a tie, a loss and a timeout; after each the
// counter, the band and the saved `rps_progress` are what the vectors say (§6). Twice: an iPhone
// (390 × 844) and an Android phone (360 × 800), both touch contexts, so the three hands are
// thumb-height and inside the screen on either.
import type { Page } from '@playwright/test';

import { PAGE_TITLES } from '../tools/games.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

type Hand = 'rock' | 'paper' | 'scissors';
const GLYPH: Readonly<Record<Hand, string>> = { rock: '✊', paper: '✋', scissors: '✌️' };

/** The page's key and its versioned shape (web/games/rps/src/engine/codec.ts). */
const KEY = 'rps_progress';
type Stored = Readonly<{
  v: 1;
  counter: number;
  windowMs: number;
  prestige: number;
  recentWins: ReadonlyArray<number>;
  best: number | null;
}>;
/** +4 with four fast wins saved: the next fast win is the fifth, at +5, and Tech up is offered. */
const SEEDED: Stored = {
  v: 1,
  counter: 4,
  windowMs: 1000,
  prestige: 0,
  recentWins: [300, 310, 320, 330],
  best: 300,
};

/** The saved progress as the page wrote it, or null before the first save. */
const stored = async (page: Page): Promise<Stored | null> =>
  page.evaluate<Stored | null>(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);

/** A saved progress in place before the page boots (the specs run without the DOM lib: scripts are text). */
const seedStorage = async (page: Page, value: Stored): Promise<void> => {
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(value))});`,
  });
};

const SCROLL_MS = 800;

/**
 * One round: rig the computer's hand and the scroll's length, Go, run the scroll out (the resolve
 * fires at its end), wait `reactionMs` on the page's clock, then tap `player` (or let the window
 * run out when `player` is null). The page reads its reaction off `performance.now()`, which the
 * installed clock does not hold still, so the shown reaction is `reactionMs` plus the real time the
 * tap took: the specs bound it (at least `reactionMs`, under the window) and read the exact value
 * back for the saved wins.
 */
const round = async (
  page: Page,
  computer: Hand,
  player: Hand | null,
  reactionMs: number,
): Promise<void> => {
  await page.evaluate(`window.__rps.rig(${JSON.stringify({ computer, scrollMs: SCROLL_MS })})`);
  await page.locator('#goBtn').click();
  await expect(page.locator('#goBtn')).toBeHidden();
  await page.clock.runFor(SCROLL_MS);
  await expect(page.locator('#computerHand')).toHaveText(GLYPH[computer]);
  await expect(page.locator('#computerHand')).toHaveClass(/armed/);
  await expect(page.locator('#rockBtn')).toBeEnabled();
  await page.clock.runFor(reactionMs);
  if (player !== null) await page.locator(`#${player}Btn`).click();
};

/** The reaction the page shows, in ms, bounded below by what the clock ran and above by the window. */
const shownReaction = async (page: Page, atLeast: number, windowMs: number): Promise<number> => {
  await expect(page.locator('#reaction')).toHaveText(/^\d+ ms$/);
  const ms = Number(/^(\d+) ms$/.exec((await page.locator('#reaction').textContent()) ?? '')?.[1]);
  expect(ms).toBeGreaterThanOrEqual(atLeast);
  expect(ms).toBeLessThanOrEqual(windowMs);
  return ms;
};

const expectScore = async (
  page: Page,
  counter: string,
  mood: string,
  set: string,
): Promise<void> => {
  await expect(page.locator('#counter')).toHaveText(counter);
  await expect(page.locator('#app')).toHaveAttribute('data-mood', mood);
  await expect(page.locator('#counterFace')).toHaveAttribute('data-set', set);
  await expect(page.locator('#buddy')).toHaveAttribute('data-set', set);
};

const VIEWPORTS: ReadonlyArray<readonly [string, number, number]> = [
  ['an iPhone (390 × 844)', 390, 844],
  ['an Android phone (360 × 800)', 360, 800],
];

VIEWPORTS.forEach(([name, width, height]) => {
  test(`five rounds on ${name}: win into Tech up, tech up, tie, loss, timeout`, async ({
    phone,
    project,
  }) => {
    const { page } = phone;
    await page.setViewportSize({ width, height });
    await seedStorage(page, SEEDED);
    // The clock is installed before the page and paused once it has booted: from here time moves
    // only by `runFor`, so the scroll, the window and the auto-next fire when the spec says.
    await page.clock.install({ time: new Date('2026-09-29T12:00:00Z') });
    await page.goto(pagePath(project, 'rps'));
    await expect(page).toHaveTitle(PAGE_TITLES.rps);
    await expect.poll(() => page.evaluate<string>('typeof window.__rps')).toBe('object');
    await page.clock.pauseAt(new Date('2026-09-29T12:00:05Z'));

    // The saved progress paints: +4, happy, the buddy on its happy loop, the island slot empty.
    await expectScore(page, '+4', 'happy', 'happy');
    await expect(page.locator('#windowMs')).toHaveText('Window 1000 ms');
    await expect(page.locator('#islandSlot')).toBeEmpty();
    // Thumb-reachable: every hand is a 44 px+ target inside the screen, and the buttons too.
    const boxes = await Promise.all(
      ['#rockBtn', '#paperBtn', '#scissorsBtn', '#goBtn'].map((id) =>
        page.locator(id).boundingBox(),
      ),
    );
    boxes.forEach((box) => {
      expect(box).not.toBeNull();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    });

    // 1. A win at 350 ms: +5, very happy, the fifth fast win, Tech up on offer (so no auto next).
    await round(page, 'scissors', 'rock', 350);
    await expect(page.locator('#verdict')).toHaveText('You win');
    const win = await shownReaction(page, 350, 1000);
    await expectScore(page, '+5', 'veryHappy', 'very-happy');
    await expect(page.locator('#techUpBtn')).toBeVisible();
    await expect(page.locator('#techUpCost')).toHaveText('1000 → 750 ms');
    await expect(page.locator('#stopBtn')).toBeHidden();
    expect(await stored(page)).toEqual({
      ...SEEDED,
      counter: 5,
      recentWins: [300, 310, 320, 330, win],
    });
    // Nothing starts by itself while the offer stands.
    await page.clock.runFor(2000);
    await expect(page.locator('#goBtn')).toBeVisible();
    await expect(page.locator('#techUpBtn')).toBeVisible();

    // 2. Tech up: window 750, counter 0, prestige 1, the wins cleared, the best kept.
    await page.locator('#techUpBtn').click();
    await expectScore(page, '0', 'neutral', 'neutral');
    await expect(page.locator('#windowMs')).toHaveText('Window 750 ms');
    await expect(page.locator('#prestige')).toHaveText('Prestige 1');
    await expect(page.locator('#best')).toHaveText('Best 300 ms');
    await expect(page.locator('#techUpBtn')).toBeHidden();
    expect(await stored(page)).toEqual({
      v: 1,
      counter: 0,
      windowMs: 750,
      prestige: 1,
      recentWins: [],
      best: 300,
    });

    // 3. A tie: nothing moves, and the next round is pending (Stop shows).
    await round(page, 'paper', 'paper', 200);
    await expect(page.locator('#verdict')).toHaveText('Tie');
    await shownReaction(page, 200, 750);
    await expectScore(page, '0', 'neutral', 'neutral');
    await expect(page.locator('#stopBtn')).toBeVisible();
    expect((await stored(page))?.counter).toBe(0);
    expect((await stored(page))?.windowMs).toBe(750);

    // 4. A loss at 300 ms: −1, still neutral, the window slows to 825.
    await round(page, 'rock', 'scissors', 300);
    await expect(page.locator('#verdict')).toHaveText('You lose');
    await shownReaction(page, 300, 750);
    await expectScore(page, '−1', 'neutral', 'neutral');
    await expect(page.locator('#windowMs')).toHaveText('Window 825 ms');
    expect(await stored(page)).toMatchObject({ counter: -1, windowMs: 825, prestige: 1 });

    // 5. A timeout: no tap within 825 ms is a loss, −2 and sad, the window 908; the hands disarm.
    await round(page, 'rock', null, 826);
    await expect(page.locator('#verdict')).toHaveText('Too slow');
    await expect(page.locator('#reaction')).toHaveText('No tap within 825 ms');
    await expectScore(page, '−2', 'sad', 'sad');
    await expect(page.locator('#windowMs')).toHaveText('Window 908 ms');
    await expect(page.locator('#rockBtn')).toBeDisabled();
    expect(await stored(page)).toEqual({
      v: 1,
      counter: -2,
      windowMs: 908,
      prestige: 1,
      recentWins: [],
      best: 300,
    });

    // The next round starts by itself 1.4 s after a verdict; Stop holds it.
    await page.locator('#stopBtn').click();
    await page.clock.runFor(3000);
    await expect(page.locator('#goBtn')).toBeVisible();
    await expect(page.locator('#computerHand')).not.toHaveClass(/scrolling/);
  });
});

test('Reset progress asks first, then starts over', async ({ phone, project }) => {
  const { page } = phone;
  await seedStorage(page, { ...SEEDED, counter: -5, windowMs: 238, prestige: 3 });
  await page.goto(pagePath(project, 'rps'));
  await expectScore(page, '−5', 'verySad', 'very-sad');
  await expect(page.locator('#status')).toHaveText('As fast as it gets: 238 ms.');
  // Dismissed: nothing changes.
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.locator('#resetBtn').click();
  await expectScore(page, '−5', 'verySad', 'very-sad');
  // Accepted: the start, saved.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('#resetBtn').click();
  await expectScore(page, '0', 'neutral', 'neutral');
  await expect(page.locator('#windowMs')).toHaveText('Window 1000 ms');
  await expect(page.locator('#prestige')).toHaveText('No prestige yet');
  await expect(page.locator('#best')).toHaveText('No best yet');
  expect(await stored(page)).toEqual({
    v: 1,
    counter: 0,
    windowMs: 1000,
    prestige: 0,
    recentWins: [],
    best: null,
  });
});
