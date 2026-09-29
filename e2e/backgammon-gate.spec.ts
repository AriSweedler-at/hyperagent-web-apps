// The turn gate on a phone held upright at the table (docs/design/backgammon-landscape.md §5D;
// web/shared/ui/shell.ts `gateOpen`, web/shared/ui/shellPaint.ts `paintGate`, painted and bound by
// web/shared/edge/boot.ts), on the served page. Under the touch context
// (`phone`: `(any-pointer: coarse)` holds) at 390x844, Start brings the first curtain up and the
// gate over it, `#app` and the curtain `inert` (a tap on the curtain's button never lands); turned
// sideways (844x390) the gate goes and the curtain is where it was; upright again it is back;
// "Play upright" keeps it down through the next curtain (reached by play, not by the
// `position/load` seam, which resets the table as a new start would); Leave and Start ask once
// more. The gate takes focus as a dialog should (its first control) and lets it go when it hides.
// A finished game is not gated: the result sheet takes taps upright, and the next game's first
// curtain asks again. On the fine-pointer `player` at the same size it never shows, turned or
// not. Taps, not clicks, on the gate's own controls under the touch context: a phone taps, and the
// gate's copy asks for a hand on the phone. Page-only (e2e/fixtures/site.ts PAGE_ONLY_SPECS):
// about the page, not its origin.
//
// The Android lock (design §5C; shell.ts `lockSideways`, web/shared/edge/orientation.ts, the owner
// 2026-09-25: "it should lock the user into place to make it sideways. Only on mobile!") rides the
// taps: on a phone whose browser can lock its rotation (`screen.orientation.lock` a function and no
// pointer that hovers: Android's Chromium family, which headless Chromium under the touch context
// is too), Start asks for fullscreen on the document, then the landscape lock; while the lock is
// held no tap asks again and the rotation hint is silent; a back gesture (fullscreen left, the
// `fullscreenchange` with no element) is the loss, the hint is due, and the next tap (the curtain's
// Roll, the roll modal's CTA, the gate's own "Go sideways") re-enters; Leave unlocks and leaves
// fullscreen. Both APIs are stubbed before the page loads (`withLock`), recording their calls on
// the window, since headless Chromium's fullscreen and rotation are not a phone's: the real
// fullscreen and rotation stay a device check for the owner.
//
// The rotation hint (shell.ts `rotationHint`, the owner 2026-09-28: "give a warning to lock the
// phone's rotation in landscape mode") rides the same flows: on a phone whose lock is refused (a
// tablet, a denied fullscreen: the adapter reports the loss a microtask after the tap), the first
// time the table is sideways with the lock gone the shell toasts `ROTATION_HINT_MSG` once (8 s),
// not again this table, and again after Leave and Start; with the function gone (every iPhone
// browser) or on the fine-pointer `player` the toast never shows it; with the lock held it stays
// silent until the lock is lost.
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

/** The gate is up; `lockable` says whether the device can lock, which shows "Go sideways" and gives it the focus. */
const gateUp = async (page: Page, lockable = true): Promise<void> => {
  await expect(page.locator('#turnGate')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  await expect(page.locator('#curtainOverlay')).toHaveAttribute('inert', '');
  if (lockable) {
    await expect(page.locator('#turnGateGoBtn')).toBeVisible();
    await expect(page.locator('#turnGateGoBtn')).toBeFocused();
  } else {
    await expect(page.locator('#turnGateGoBtn')).toBeHidden();
    await expect(page.locator('#turnGateKeepBtn')).toBeFocused();
  }
};
const gateDown = async (page: Page): Promise<void> => {
  await expect(page.locator('#turnGate')).toBeHidden();
  await expect(page.locator('#app')).not.toHaveAttribute('inert');
  await expect(page.locator('#curtainOverlay')).not.toHaveAttribute('inert');
};

/**
 * `screen.orientation.lock`/`unlock` and the document's fullscreen before the page loads, every
 * call recorded on `window.__lockCalls` (`request`, `lock:<orientation>`, `unlock`, `exit`).
 * `held`: the lock resolves (Android); `refused`: it rejects (a tablet, desktop Chromium);
 * `absent`: no `lock` at all (every iPhone browser). Fullscreen flips `window.__fullscreen.on`
 * and fires `fullscreenchange` as the browser does, so the boot's listener sees the element set on
 * entry and null on exit; `backGesture` below is the exit the browser makes on its own.
 */
type LockMode = 'held' | 'refused' | 'absent';
const withLock = async (page: Page, mode: LockMode): Promise<void> => {
  const lock =
    mode === 'absent'
      ? 'undefined'
      : `(o) => { calls.push('lock:' + o); return ${mode === 'held' ? 'Promise.resolve()' : "Promise.reject(new Error('refused'))"}; }`;
  // A string, as the geometry scripts are: the e2e tsconfig has no DOM lib to name `ScreenOrientation`.
  await page.addInitScript(`(() => {
    const calls = [];
    const state = { on: false };
    window.__lockCalls = calls;
    window.__fullscreen = state;
    const change = () => { queueMicrotask(() => document.dispatchEvent(new Event('fullscreenchange'))); };
    Object.defineProperty(ScreenOrientation.prototype, 'lock', { value: ${lock}, configurable: true });
    Object.defineProperty(ScreenOrientation.prototype, 'unlock', { value: () => { calls.push('unlock'); }, configurable: true });
    Object.defineProperty(Element.prototype, 'requestFullscreen', { value: function () { calls.push('request'); state.on = true; change(); return Promise.resolve(); }, configurable: true });
    Object.defineProperty(Document.prototype, 'exitFullscreen', { value: function () { calls.push('exit'); state.on = false; change(); return Promise.resolve(); }, configurable: true });
    Object.defineProperty(Document.prototype, 'fullscreenElement', { get: () => (state.on ? document.documentElement : null), configurable: true });
  })();`);
};
/** The calls the stubs recorded so far. */
const lockCalls = (page: Page): Promise<ReadonlyArray<string>> =>
  page.evaluate<ReadonlyArray<string>>('window.__lockCalls');
/** The browser left fullscreen on its own (Android's back gesture): the spec unlocks with it. */
const backGesture = (page: Page): Promise<unknown> =>
  page.evaluate(
    "(() => { window.__fullscreen.on = false; document.dispatchEvent(new Event('fullscreenchange')); })()",
  );
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

test('a phone upright at the table: the gate over the curtain, inert beneath; sideways it goes; upright it is back; Play upright holds through the next curtain and asks for no lock; Leave and Start ask again', async ({
  phone,
  project,
}) => {
  const { page } = phone;
  // The lock refused (a tablet): the loss lands a moment after the tap and the gate opens, with
  // "Go sideways" shown since the device can lock. A held lock turns the phone and shows no gate
  // (the Android test below).
  await withLock(page, 'refused');
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE);
  await gateUp(page);
  await expect(page.locator('#turnGateTitle')).toHaveText('Turn your phone sideways');
  await expect(page.locator('#turnGateGoBtn')).toHaveText('Go sideways');
  await expect(page.locator('#turnGateKeepBtn')).toHaveText('Play upright');
  const title = await page.locator('#curtainTitle').innerText();
  // The curtain's button takes no tap through the gate: the gate intercepts, nothing is revealed.
  await expect(page.locator('#curtainBtn').tap({ timeout: 1500 })).rejects.toThrow();
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  // Turned sideways: the gate goes by itself (and lets focus go), the curtain is where it was.
  await page.setViewportSize(PHONE_LANDSCAPE);
  await gateDown(page);
  await expect(page.locator('#turnGateGoBtn')).not.toBeFocused();
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await expect(page.locator('#curtainTitle')).toHaveText(title);
  // Upright again: back.
  await page.setViewportSize(PHONE);
  await gateUp(page);
  // "Play upright": down for this table, through the next curtain, and the table's choice: the
  // curtain's Roll and the roll modal's CTA ask for no lock (the Start tap's attempt is all).
  await page.locator('#turnGateKeepBtn').tap();
  await gateDown(page);
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await bgRoll(page);
  await bgPlayTurn(page);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await gateDown(page);
  expect(await lockCalls(page)).toEqual(['request', 'lock:landscape']);
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
  await withLock(page, 'refused');
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

test('Android: Start asks for fullscreen then the landscape lock, with no gate over the curtain while it is held; no tap asks again and the hint is silent; a back gesture loses it, the hint is due, and the curtain`s Roll, the roll modal`s CTA and Go sideways each re-enter; Leave unlocks and leaves fullscreen; Play upright after a loss holds against the next tap', async ({
  phone,
  project,
}) => {
  const { page } = phone;
  await withLock(page, 'held');
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE);
  // The Start tap: fullscreen on the document, then the lock, in that order, once; the tap is
  // turning the phone, so no gate over the curtain (the stub leaves the viewport to the test).
  await gateDown(page);
  await expect.poll(() => lockCalls(page)).toEqual(['request', 'lock:landscape']);
  // The phone turns (the lock's work, here the viewport's): still no gate; no hint while held.
  await page.setViewportSize(PHONE_LANDSCAPE);
  await gateDown(page);
  await toastStill(page);
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  expect(await lockCalls(page)).toEqual(['request', 'lock:landscape']);
  await toastStill(page);
  // The back gesture: the lock is lost, and the hint says how to keep the phone sideways.
  await backGesture(page);
  await toastUp(page, ROTATION_HINT_MSG);
  // The roll modal's CTA is the next tap: it re-enters.
  await bgRoll(page);
  await expect
    .poll(() => lockCalls(page))
    .toEqual(['request', 'lock:landscape', 'request', 'lock:landscape']);
  await bgPlayTurn(page);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  // Lost again: the curtain's Roll re-enters; the hint was shown for this table already.
  await backGesture(page);
  await toastDown(page);
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await expect.poll(async () => (await lockCalls(page)).length).toBe(6);
  await toastStill(page);
  // Upright with the lock lost: the gate is back, and Go sideways is the tap that re-enters; the
  // gate goes with the tap.
  await backGesture(page);
  await page.setViewportSize(PHONE);
  await gateUp(page);
  await page.locator('#turnGateGoBtn').tap();
  await expect
    .poll(async () => (await lockCalls(page)).slice(6))
    .toEqual(['request', 'lock:landscape']);
  await gateDown(page);
  // Leave: unlock, then out of fullscreen.
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.locator('#menuBtn').tap();
  await page.locator('#menuLeaveBtn').tap();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect.poll(async () => (await lockCalls(page)).slice(8)).toEqual(['unlock', 'exit']);
  // The next Start locks again.
  await page.locator('#localBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await expect
    .poll(async () => (await lockCalls(page)).slice(10))
    .toEqual(['request', 'lock:landscape']);
  // Lost, still upright: the gate is back; "Play upright" is the table's choice, so neither the
  // curtain's Roll nor the roll modal's CTA asks for the lock again.
  await backGesture(page);
  await gateUp(page);
  await page.locator('#turnGateKeepBtn').tap();
  await gateDown(page);
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await bgRoll(page);
  expect((await lockCalls(page)).length).toBe(12);
});

test('a phone whose lock is refused (Android`s function, a tablet`s no: the loss reported a moment after the tap) is told once to lock its rotation, at the turn of the phone at the table, not under the gate; not again this table; again after Leave and Start', async ({
  phone,
  project,
}) => {
  const { page } = phone;
  await withLock(page, 'refused');
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE);
  await gateUp(page);
  // The attempt was made and refused; not under the gate: the table came up upright.
  await expect.poll(() => lockCalls(page)).toEqual(['request', 'lock:landscape']);
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

test('a phone whose browser cannot lock its rotation (every iPhone: no `screen.orientation.lock`) is never told and never asked: no Go sideways, no fullscreen, turned or not', async ({
  phone,
  project,
}) => {
  const { page } = phone;
  await withLock(page, 'absent');
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE);
  await gateUp(page, false);
  expect(await lockCalls(page)).toEqual([]);
  await page.setViewportSize(PHONE_LANDSCAPE);
  await gateDown(page);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await toastDown(page);
  await expect(page.locator('#toast')).not.toContainText('Auto-rotate');
  await page.locator('#curtainBtn').tap();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  await toastDown(page);
  await expect(page.locator('#toast')).not.toContainText('Auto-rotate');
  expect(await lockCalls(page)).toEqual([]);
});

test('a fine pointer at a phone`s size (the desktop window) with a lock to offer is never told and never asked: the phone`s shape, not the window`s', async ({
  player,
  project,
}) => {
  const { page } = player;
  await withLock(page, 'held');
  await bgStartLocal(page, pagePath(project, 'backgammon'), PHONE);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await page.setViewportSize(PHONE_LANDSCAPE);
  await gateDown(page);
  await toastDown(page);
  await expect(page.locator('#toast')).not.toContainText('Auto-rotate');
  expect(await lockCalls(page)).toEqual([]);
});
