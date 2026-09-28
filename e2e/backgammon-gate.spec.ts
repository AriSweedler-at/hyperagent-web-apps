// The turn gate on a phone held upright at the table (docs/design/backgammon-landscape.md §5D;
// ui/state.ts `gateOpen`, render.ts `paintGate`), on the served page. Under the touch context
// (`phone`: `(any-pointer: coarse)` holds) at 390x844, Start brings the first curtain up and the
// gate over it, `#app` and the curtain `inert` (a tap on the curtain's button never lands); turned
// sideways (844x390) the gate goes and the curtain is where it was; upright again it is back;
// "Play upright" keeps it down through the next curtain (reached by play, not by the
// `position/load` seam, which resets the table as a new start would); Leave and Start ask once
// more. The gate takes focus as a dialog should (`#turnGateKeepBtn`) and lets it go when it hides.
// A finished game is not gated: the result sheet takes taps upright, and the next game's first
// curtain asks again. On the fine-pointer `player` at the same size it never shows, turned or
// not. Taps, not clicks, on the gate's own controls under the touch context: a phone taps, and the
// gate's copy asks for a hand on the phone. Page-only (e2e/fixtures/site.ts PAGE_ONLY_SPECS):
// about the page, not its origin.
import type { Page } from '@playwright/test';

import {
  bgPlayTurn,
  bgPosition,
  bgRoll,
  bgSetup,
  bgStartLocal,
  myOffId,
  ownPointId,
} from './fixtures/backgammon.ts';
import { PHONE, PHONE_LANDSCAPE } from './fixtures/geometry.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const gateUp = async (page: Page): Promise<void> => {
  await expect(page.locator('#turnGate')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  await expect(page.locator('#curtainOverlay')).toHaveAttribute('inert', '');
  await expect(page.locator('#turnGateKeepBtn')).toBeFocused();
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
  // Turned sideways: the gate goes by itself (and lets focus go), the curtain is where it was.
  await page.setViewportSize(PHONE_LANDSCAPE);
  await gateDown(page);
  await expect(page.locator('#turnGateKeepBtn')).not.toBeFocused();
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
  await bgPlayTurn(page);
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

test('a finished game is not gated: the result sheet takes taps upright; the next game`s first curtain asks again', async ({
  phone,
  project,
}) => {
  const { page } = phone;
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE);
  await gateUp(page);
  // Sideways, the last checker of a 5-point match's first game is borne off: the sheet comes up.
  await page.setViewportSize(PHONE_LANDSCAPE);
  await gateDown(page);
  const view = await bgSetup(
    page,
    bgPosition({ text: 'L: 1:1 | D: 13:2 | bar 0/0 | off 14/13', turn: 0, dice: [6, 6] }),
  );
  await page.locator(`#${ownPointId(view, 1)}`).tap();
  await page.locator(`#${myOffId(view)}`).tap();
  await expect(page.locator('#resultOverlay')).toBeVisible();
  // Upright: no gate over the result; Next game takes the tap.
  await page.setViewportSize(PHONE);
  await expect(page.locator('#turnGate')).toBeHidden();
  await expect(page.locator('#app')).not.toHaveAttribute('inert');
  await expect(page.locator('#resultOverlay')).not.toHaveAttribute('inert');
  await page.locator('#rsNextBtn').tap();
  await expect(page.locator('#resultOverlay')).toBeHidden();
  // The next game's first curtain, and the gate with it.
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
  await page.setViewportSize(PHONE_LANDSCAPE);
  await gateDown(page);
  await page.setViewportSize(PHONE);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await gateDown(page);
});
