// The far seat's flip on a phone lying flat between two players (docs/design/backgammon-landscape.md
// §6 item 7; web/shared/ui/shell.ts `flipped`, shellPaint.ts `paintFlip`, shell.css
// `body[data-flip="1"] { rotate: 180deg }`), on the served page under the touch context (`phone`)
// held sideways at 844x390. The menu's toggle (`#menuFlipToggle`, off by default) is remembered
// under `backgammon_flipTable`; with it on, the body makes a half turn whenever seat 1 is the one
// looking at the phone: under the curtain that rises for them, and while their view is shown after
// the reveal; seat 0's curtain and view turn it back. Taps land through the turn (the browser
// hit-tests through the transform): the curtain's button, the roll, a move by two taps; a drag's
// ghost sits on the finger (web/shared/edge/drag.ts reflects its box and the pointer into the
// turned body, dom.ts `bodySpace`/`bodyPoint`), and the move lands. Page-only
// (e2e/fixtures/site.ts PAGE_ONLY_SPECS): about the page, not its origin.
import type { Page } from '@playwright/test';

import {
  bgMove,
  bgPlayTurn,
  bgPosition,
  bgRoll,
  bgSetup,
  bgStartLocal,
  ownPlace,
  ownPointId,
  requireBoard,
} from './fixtures/backgammon.ts';
import { PHONE_LANDSCAPE } from './fixtures/geometry.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const START = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';

const flippedBody = async (page: Page, on: boolean): Promise<void> => {
  if (on) await expect(page.locator('body')).toHaveAttribute('data-flip', '1');
  else await expect(page.locator('body')).not.toHaveAttribute('data-flip');
};

/** The menu's toggle, past the curtain (the menu button sits under it): reveal first when up. */
const setFlip = async (page: Page, on: boolean): Promise<void> => {
  await page.locator('#menuBtn').tap();
  await expect(page.locator('#menuOverlay')).toBeVisible();
  const toggle = page.locator('#menuFlipToggle');
  if ((await toggle.isChecked()) !== on) await toggle.tap();
  await expect(toggle).toBeChecked({ checked: on });
  await page.locator('#closeMenuBtn').tap();
  await expect(page.locator('#menuOverlay')).toBeHidden();
};

test('the setting off by default and remembered; on, the body turns for seat 1 under its curtain and while they hold the phone, back for seat 0; taps and a move land through the turn; the toggle writes its key', async ({
  phone,
  project,
}) => {
  const { page } = phone;
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE_LANDSCAPE);
  // Off by default: the starter's curtain, whoever it names, leaves the body upright.
  await flippedBody(page, false);
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await setFlip(page, true);
  expect(await page.evaluate<string | null>("localStorage.getItem('backgammon_flipTable')")).toBe(
    'on',
  );
  // Seat 1 to play with the curtain down (a loaded position seats the actor): the body turns.
  const dark = await bgSetup(page, bgPosition({ text: START, turn: 1, dice: [3, 1] }));
  expect(dark.me.idx).toBe(1);
  await flippedBody(page, true);
  // A move by two taps lands through the turn: 8/5 with the 3, in seat 1's own numbering.
  const moved = await bgMove(page, 8, 5);
  expect(moved.played.map((m) => [ownPlace(moved, m.from), ownPlace(moved, m.to), m.die])).toEqual([
    [8, 5, 3],
  ]);
  await expect(page.locator(`#${ownPointId(moved, 5)} .checker`)).toHaveCount(1);
  await flippedBody(page, true);
  // The rest of the turn: the curtain rises for seat 0 and the body is upright before seat 0 reveals.
  await bgPlayTurn(page);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await expect(page.locator('#curtainTitle')).toHaveText('Pass the phone to Ann');
  await flippedBody(page, false);
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await flippedBody(page, false);
  // Seat 0 rolls and plays: the curtain for seat 1 comes up turned, and stays turned past the reveal.
  await bgRoll(page);
  await bgPlayTurn(page);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await expect(page.locator('#curtainTitle')).toHaveText('Pass the phone to Bob');
  await flippedBody(page, true);
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await flippedBody(page, true);
  const rolled = await bgRoll(page);
  expect(rolled.me.idx).toBe(1);
  // Off again from the menu: the body is upright at once, seat 1 still looking.
  await setFlip(page, false);
  await flippedBody(page, false);
  expect(await page.evaluate<string | null>("localStorage.getItem('backgammon_flipTable')")).toBe(
    'off',
  );
});

test('a drag under the turn: the ghost sits on the finger, not its reflection, and the release makes the move', async ({
  phone,
  project,
}) => {
  const { page } = phone;
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE_LANDSCAPE);
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await setFlip(page, true);
  const v = await bgSetup(page, bgPosition({ text: START, turn: 1, dice: [3, 1] }));
  await flippedBody(page, true);
  const eight = page.locator(`#${ownPointId(v, 8)}`);
  const five = page.locator(`#${ownPointId(v, 5)}`);
  const ghost = page.locator('.drag-ghost');
  // The coins of a freshly seated position slide into place: measured once they stand still.
  await page.waitForTimeout(200);
  const from = await eight.locator('.checker.top').boundingBox();
  const to = await five.boundingBox();
  if (from === null || to === null) throw new Error('the checker or the 5-point has no box');
  const grab = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 12, grab.y + 12, { steps: 2 });
  await expect(ghost).toHaveCount(1);
  await expect(eight).toHaveClass(/\bselected\b/);
  // The ghost's box, as rendered through the turn, is the checker's box moved with the finger
  // (the drag began at the first step past the 8px threshold, so the ghost trails the 12px of
  // travel by that much): within the travel of where the checker stood, never its point
  // reflection through the screen's centre, hundreds of pixels away.
  const box = await ghost.boundingBox();
  if (box === null) throw new Error('the ghost has no box');
  expect(box.x - from.x).toBeGreaterThanOrEqual(0);
  expect(box.x - from.x).toBeLessThanOrEqual(13);
  expect(box.y - from.y).toBeGreaterThanOrEqual(0);
  expect(box.y - from.y).toBeLessThanOrEqual(13);
  expect(Math.abs(box.width - from.width)).toBeLessThan(1);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
  await expect(five).toHaveClass(/\bdrop\b/);
  await page.mouse.up();
  await expect.poll(async () => (await requireBoard(page)).played.length).toBe(1);
  await expect(ghost).toHaveCount(0);
  await expect(five.locator('.checker')).toHaveCount(1);
  await flippedBody(page, true);
});
