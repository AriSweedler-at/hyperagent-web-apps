// The turn gate on a phone held upright at the table (docs/design/backgammon-landscape.md §5D;
// web/shared/ui/shell.ts `gateOpen`, web/shared/ui/shellPaint.ts `paintGate`, painted and bound by
// web/shared/edge/boot.ts), on the served page. Under the touch context
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
//
// The rotation hint (shell.ts `rotationHint`, the owner 2026-09-28: "give a warning to lock the
// phone's rotation in landscape mode") rides the same gate flows: on a phone whose browser can lock
// its rotation (`screen.orientation.lock` a function: Android's Chromium family, stubbed here
// before the page loads, since headless Chromium is one), the first time the table is painted
// sideways the shell toasts `ROTATION_HINT_MSG` once (8 s), not again this table, and again after
// Leave and Start; with the function gone (every iPhone browser) or on the fine-pointer `player`
// the toast never shows it.
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
import { ROTATION_HINT_MSG } from '../web/shared/ui/shell.ts';

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

/**
 * `screen.orientation.lock` before the page loads: a function (Android's Chromium family; headless
 * Chromium has one too, so the positive case does not lean on that) or gone (every iPhone browser).
 */
const withLock = async (page: Page, present: boolean): Promise<void> => {
  // A string, as the geometry scripts are: the e2e tsconfig has no DOM lib to name `ScreenOrientation`.
  await page.addInitScript(
    `Object.defineProperty(ScreenOrientation.prototype, 'lock', { value: ${present ? '() => Promise.resolve()' : 'undefined'}, configurable: true });`,
  );
};
/** `#toast` is up with `text` (the `show` class: `#toast` keeps its text after it hides). */
const toastUp = async (page: Page, text: string): Promise<void> => {
  await expect(page.locator('#toast')).toHaveText(text);
  await expect(page.locator('#toast')).toHaveClass(/\bshow\b/);
};
/** `#toast` is down, waited for: the hint's 8 s may still be running. */
const toastDown = async (page: Page): Promise<void> => {
  await expect(page.locator('#toast')).not.toHaveClass(/\bshow\b/);
};
/**
 * `#toast` stays down, looked at once (1 s), where "nothing more" is meant: the hint's effect runs
 * inside the dispatch the tap or the move triggered, before the repaint the assertion just
 * resolved waited for, so a hint re-fired there is up already and fails here; `toastDown`'s
 * retried 10 s would let the 8 s hint expire into a pass.
 */
const toastStill = async (page: Page): Promise<void> => {
  await expect(page.locator('#toast')).not.toHaveClass(/\bshow\b/, { timeout: 1000 });
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

test('a phone whose browser can lock its rotation (Android: `screen.orientation.lock` is a function) is told once to lock it, at the turn of the phone at the table, not under the gate; not again this table; again after Leave and Start', async ({
  phone,
  project,
}) => {
  const { page } = phone;
  await withLock(page, true);
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE);
  await gateUp(page);
  // Not under the gate: the table came up upright.
  await toastStill(page);
  // The turn: the gate goes and the hint comes, before any move.
  await page.setViewportSize(PHONE_LANDSCAPE);
  await gateDown(page);
  await toastUp(page, ROTATION_HINT_MSG);
  // It goes by itself (8 s), and the curtain, a roll and a turn (paints all) bring nothing more.
  await toastDown(page);
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await toastStill(page);
  await bgRoll(page);
  await toastStill(page);
  await bgPlayTurn(page);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await toastStill(page);
  // Leave, then Start, still sideways: the next table asks once more, at its first paint.
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.locator('#menuBtn').tap();
  await page.locator('#menuLeaveBtn').tap();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await page.locator('#localBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await toastUp(page, ROTATION_HINT_MSG);
});

test('a phone whose browser cannot lock its rotation (every iPhone: no `screen.orientation.lock`) is never told, turned or not', async ({
  phone,
  project,
}) => {
  const { page } = phone;
  await withLock(page, false);
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE);
  await gateUp(page);
  await page.setViewportSize(PHONE_LANDSCAPE);
  await gateDown(page);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await toastDown(page);
  await expect(page.locator('#toast')).not.toContainText('Auto-rotate');
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await toastDown(page);
  await expect(page.locator('#toast')).not.toContainText('Auto-rotate');
});

test('a fine pointer at a phone`s size (the desktop window) with a lock to offer is never told: the phone`s shape, not the window`s', async ({
  player,
  project,
}) => {
  const { page } = player;
  await withLock(page, true);
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await page.setViewportSize(PHONE_LANDSCAPE);
  await gateDown(page);
  await toastDown(page);
  await expect(page.locator('#toast')).not.toContainText('Auto-rotate');
});
