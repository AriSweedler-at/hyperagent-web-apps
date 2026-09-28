// The turn gate on a phone held upright at the table (docs/design/backgammon-landscape.md §5D;
// ui/state.ts `gateOpen`, render.ts `paintGate`), on the served page. Under the touch context
// (`phone`: `(any-pointer: coarse)` holds) at 390x844, Start brings the first curtain up and the
// gate over it, `#app` and the curtain `inert` (a tap on the curtain's button never lands); turned
// sideways (844x390) the gate goes and the curtain is where it was; upright again it is back;
// "Play upright" keeps it down through the next curtain (reached by play, not by the
// `position/load` seam, which resets the table as a new start would); Leave and Start ask once
// more. On the fine-pointer `player` at the same size it never shows, turned or not. Taps, not
// clicks, on the gate's own controls under the touch context: a phone taps, and the gate's copy
// asks for a hand on the phone. Page-only (e2e/fixtures/site.ts PAGE_ONLY_SPECS): about the page,
// not its origin.
import type { Page } from '@playwright/test';

import { bgMove, bgRoll, bgStartLocal, ownPlace, requireBoard } from './fixtures/backgammon.ts';
import { PHONE, type Viewport } from './fixtures/geometry.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

/** The same phone turned on its side (inset-free in headless). */
const SIDEWAYS: Viewport = { width: PHONE.height, height: PHONE.width };

/** Play the rolled turn out, the engine's first legal move each time, until the curtain rises for the other seat. */
const playTurn = async (page: Page): Promise<void> => {
  const v = await requireBoard(page);
  const [first] = v.legal;
  // No move left (a forfeited roll, R14): the curtain rises by itself after the beat.
  if (first === undefined) return;
  await bgMove(page, ownPlace(v, first.from), ownPlace(v, first.to));
  if (await page.locator('#curtainOverlay').isVisible()) return;
  await playTurn(page);
};

const gateUp = async (page: Page): Promise<void> => {
  await expect(page.locator('#turnGate')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  await expect(page.locator('#curtainOverlay')).toHaveAttribute('inert', '');
};
const gateDown = async (page: Page): Promise<void> => {
  await expect(page.locator('#turnGate')).toBeHidden();
  await expect(page.locator('#app')).not.toHaveAttribute('inert');
  await expect(page.locator('#curtainOverlay')).not.toHaveAttribute('inert');
};

test('a phone upright at the table: the gate over the curtain, inert beneath; sideways it goes; upright it is back; Play upright holds through the next curtain; Leave and Start ask again', async ({
  phone,
  project,
}) => {
  const { page } = phone;
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE);
  await gateUp(page);
  await expect(page.locator('#turnGateTitle')).toHaveText('Turn your phone sideways');
  await expect(page.locator('#turnGateKeepBtn')).toHaveText('Play upright');
  // "Go sideways" is the Android lock PR's: shipped hidden.
  await expect(page.locator('#turnGateGoBtn')).toBeHidden();
  const title = await page.locator('#curtainTitle').innerText();
  // The curtain's button takes no tap through the gate: the gate intercepts, nothing is revealed.
  await expect(page.locator('#curtainBtn').tap({ timeout: 1500 })).rejects.toThrow();
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  // Turned sideways: the gate goes by itself, the curtain is where it was.
  await page.setViewportSize(SIDEWAYS);
  await gateDown(page);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await expect(page.locator('#curtainTitle')).toHaveText(title);
  // Upright again: back.
  await page.setViewportSize(PHONE);
  await gateUp(page);
  // "Play upright": down for this table, through the next curtain.
  await page.locator('#turnGateKeepBtn').tap();
  await gateDown(page);
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await bgRoll(page);
  await playTurn(page);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await gateDown(page);
  // Leave (the menu's row, past the confirm), then Start: the table's choice went with the table.
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.locator('#menuBtn').tap();
  await page.locator('#menuLeaveBtn').tap();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#turnGate')).toBeHidden();
  await page.locator('#localBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await gateUp(page);
});

test('a fine pointer at a phone`s size (the desktop window, the goldens) never sees the gate, turned or not', async ({
  player,
  project,
}) => {
  const { page } = player;
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await gateDown(page);
  await page.setViewportSize(SIDEWAYS);
  await gateDown(page);
  await page.setViewportSize(PHONE);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await gateDown(page);
});
