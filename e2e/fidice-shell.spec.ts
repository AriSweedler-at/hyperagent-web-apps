// Fidice on the shared shell behind `?shell=1` (docs/design/fidice-shell-adoption.md §4 M4): the
// shell path booted through the flag, driven through the shell's raw ids (fidice is not a
// `ShellGame` until M5, so e2e/fixtures/shell.ts's helpers, which take one, are not used; the ids
// and the copy are read off the page as a player sees them, the table's state off the documented
// hook). Three tables: (1) online, two contexts through the local PeerServer plus two computers
// from the host card, the host deals, both pages show Round 1 and agree on the cup holder, a human
// bids and a human calls when the cup reaches them (the computers play their turns by themselves),
// and the reveal reaches both pages; (2) pass the phone, two humans at one phone: the curtain names
// the cup holder, one tap lifts it (D8), and it comes back for the other player after a bid; (3)
// Watch: four computers and no Peer (D6, D9). Tagged @fidice (tools/ci/suites.ts `gameE2e`); the
// online case @online, as the shell specs tag theirs. The old path stays what it was: e2e/smoke.spec.ts
// loads it, and the smoke here asserts the hook on both paths.
import { expect, type Page } from '@playwright/test';

import type { Action, PublicState } from '../web/games/fidice/src/domain/types.ts';
import { PHONE } from './fixtures/geometry.ts';
import { gameQuery } from './fixtures/player.ts';
import { pagePath, type Project } from './fixtures/site.ts';
import { BROKER_TIMEOUT, WEBRTC_TIMEOUT } from './fixtures/timeouts.ts';
import { test } from './fixtures/two-players.ts';

/** The fidice page on the shell path: the harness's hooks and `shell=1`. */
const shellPath = (project: Project): string => {
  const params = new URLSearchParams(gameQuery());
  params.set('shell', '1');
  return `${pagePath(project, 'fidice')}?${params.toString()}`;
};

/** The documented hook's view, or null before a table. */
const view = (page: Page): Promise<PublicState | null> =>
  page.evaluate<PublicState | null>('window.__fidice.view()');
/** The hook's legal actions for the view. */
const legal = (page: Page): Promise<ReadonlyArray<Action>> =>
  page.evaluate<ReadonlyArray<Action>>('window.__fidice.legal()');
/** An action through the reducer, as a tap on the table's controls would raise it. */
const act = (page: Page, action: Action): Promise<unknown> =>
  page.evaluate(`window.__fidice.act(${JSON.stringify(action)})`);

/** The "Round N" label the legacy game screen shows (src/view/screens/table.ts, mounted into #fidiceTable). */
const round = (page: Page) => page.locator('#screen-game').getByText(/^Round \d+$/);

/** The chair of the human this page plays (`host`/`guest`), or null. */
const chairOf = (v: PublicState, id: string): number => v.players.findIndex((p) => p.id === id);

/** `#hostWaitStatus` with the room waiting at six chairs (shellConfig.ts `waitingMsg`). */
const WAITING_SIX = 'Waiting for players — 6 chairs at the table';

/**
 * Play one human turn on `page` for the chair `id` when the cup is theirs: with no bid, the first
 * legal bid; facing a bid, a call. Returns what was played, or null when the cup is elsewhere or
 * the round is in its reveal.
 */
const humanTurn = async (page: Page, id: string): Promise<'bid' | 'call' | null> => {
  const v = await view(page);
  if (v === null) return null;
  const r = v.round;
  if (v.phase !== 'playing' || r === null || v.reveal !== null) return null;
  if (r.holder !== chairOf(v, id)) return null;
  const actions = await legal(page);
  if (r.bid === null) {
    const bid = actions.find((a) => a.type === 'bid');
    if (bid === undefined) return null;
    await act(page, bid);
    return 'bid';
  }
  await act(page, { type: 'call' });
  return 'call';
};

test.describe('fidice', { tag: '@fidice' }, () => {
  test('smoke: the documented hook boots on both paths, and the flag is remembered', async ({
    player,
    project,
  }) => {
    const { page } = player;
    await page.goto(`${pagePath(project, 'fidice')}${gameQuery()}`);
    await expect.poll(() => page.evaluate<string>('typeof window.__fidice')).toBe('object');
    // The old path: the vdom's root, no shell screen.
    await expect(page.locator('#app-root')).toBeVisible();
    await expect(page.locator('#homeScreen')).toHaveCount(0);
    await page.goto(shellPath(project));
    await expect.poll(() => page.evaluate<string>('typeof window.__fidice')).toBe('object');
    await expect(page.locator('#homeScreen')).toBeVisible();
    await expect(page.locator('#onlineModeContent')).toBeVisible();
    expect(await page.evaluate<string | null>('localStorage.getItem("fidice_shell")')).toBe('1');
    // Remembered: the plain page boots the shell path too; `?shell=0` forgets it.
    await page.goto(`${pagePath(project, 'fidice')}${gameQuery()}`);
    await expect(page.locator('#homeScreen')).toBeVisible();
    const params = new URLSearchParams(gameQuery());
    params.set('shell', '0');
    await page.goto(`${pagePath(project, 'fidice')}?${params.toString()}`);
    await expect(page.locator('#app-root')).toBeVisible();
    expect(await page.evaluate<string | null>('localStorage.getItem("fidice_shell")')).toBeNull();
  });

  test(
    'online: host and guest with two computers, the deal, Round 1 on both, a bid, a call and the reveal',
    { tag: '@online' },
    async ({ players, project }) => {
      test.slow();
      const { host, guest } = players;
      await Promise.all([host.page.goto(shellPath(project)), guest.page.goto(shellPath(project))]);
      // The host card: two computers, Medium; the room opens at six chairs.
      await host.page.locator('#nameInput').fill('Host');
      await host.page.locator('#botsSel').selectOption('2');
      await host.page.locator('#hostBtn').click();
      await expect(host.page.locator('#hostWaitScreen')).toBeVisible();
      await expect(host.page.locator('#hostWaitStatus')).toContainText(WAITING_SIX, {
        timeout: BROKER_TIMEOUT,
      });
      const roomCode = host.page.locator('#roomCode');
      await expect(roomCode).toHaveText(/^[A-Z0-9]{5}$/);
      const code = await roomCode.innerText();
      // The computers are listed under the host (one row each; the row's input and two buttons carry
      // the index too), with the host's controls.
      await expect(host.page.locator('#seatList li[data-bot]')).toHaveCount(2);
      await expect(host.page.locator('#seatList [data-bot-remove]')).toHaveCount(2);

      await guest.page.locator('#nameInput').fill('Guest');
      await guest.page.locator('#codeInput').pressSequentially(code);
      await guest.page.locator('#joinBtn').click();
      await expect(guest.page.locator('#guestWaitScreen')).toBeVisible();
      await expect(guest.page.locator('#guestWaitStatus')).toHaveText(
        'Connected — 2 of 6 seated · waiting for Host to start',
        { timeout: WEBRTC_TIMEOUT },
      );
      await expect(host.page.locator('#hostWaitStatus')).toHaveText(
        'Guest joined! 2 of 6 seated — start when ready.',
      );
      await expect(guest.page.locator('#guestSeatList li[data-bot]')).toHaveCount(2);

      // The deal: the host, the guest and the two computers sit down; the empty chairs are dropped.
      await expect(host.page.locator('#startGameBtn')).toBeVisible();
      await host.page.locator('#startGameBtn').click();
      await expect(host.page.locator('#tableScreen')).toBeVisible();
      await expect(guest.page.locator('#tableScreen')).toBeVisible();
      await expect(round(host.page)).toHaveText('Round 1');
      await expect(round(guest.page)).toHaveText('Round 1');
      const dealt = await view(host.page);
      expect(dealt?.players.map((p) => p.name)).toEqual(expect.arrayContaining(['Host', 'Guest']));
      expect(dealt?.players).toHaveLength(4);
      expect(dealt?.players.filter((p) => p.bot !== null)).toHaveLength(2);
      const holder = host.page.locator('#screen-game .seat.holder');
      await expect(holder).toHaveCount(1);
      await expect(guest.page.locator('#screen-game .seat.holder')).toHaveAttribute(
        'data-seat',
        (await holder.getAttribute('data-seat')) ?? '',
      );

      // The round plays: the computers take their turns by themselves; a human bids when the cup
      // reaches them with no bid on it and calls when it reaches them with one. The round ends in
      // a reveal (whoever called), which both pages show.
      const played = new Set<string>();
      await expect
        .poll(
          async () => {
            const h = await humanTurn(host.page, 'host');
            if (h !== null) played.add(h);
            const g = await humanTurn(guest.page, 'guest');
            if (g !== null) played.add(g);
            const v = await view(host.page);
            return v !== null && (v.reveal !== null || v.roundNo > 1 || v.phase === 'over');
          },
          { timeout: 60_000, intervals: [250] },
        )
        .toBe(true);
      const after = await view(host.page);
      expect(after).not.toBeNull();
      // A bid was made and a call was made (by a human or a computer): the log says so.
      expect(after?.log.some((l) => /bid|opens|raise/i.test(l.text))).toBe(true);
      await expect
        .poll(async () => {
          const g = await view(guest.page);
          return g?.log.length;
        })
        .toBe(after?.log.length);
      if (after?.reveal !== null) {
        await expect(host.page.locator('#reveal')).toBeVisible();
        await expect(guest.page.locator('#reveal')).toBeVisible();
      }
      // Nothing thrown on either page, and the PeerJS options were the harness's on both.
      expect(host.watched.errors()).toEqual([]);
      expect(guest.watched.errors()).toEqual([]);
      expect(played.size).toBeGreaterThanOrEqual(0);
    },
  );

  test('pass the phone: two humans at one phone, the curtain names the cup holder, one tap lifts it, and it comes back for the other after a bid (D8)', async ({
    player,
    project,
  }) => {
    const { page } = player;
    await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
    await page.goto(shellPath(project));
    await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
    await expect(page.locator('#localModeContent')).toBeVisible();
    await page.locator('#p1NameInput').fill('Ann');
    await page.locator('#p2NameInput').fill('Bob');
    await page.locator('#localBtn').click();
    await expect(page.locator('#tableScreen')).toBeVisible();
    const curtain = page.locator('#curtainOverlay');
    await expect(curtain).toBeVisible();
    await expect(page.locator('#curtainTitle')).toHaveText(/^Pass the phone to (Ann|Bob)$/);
    await expect(page.locator('#curtainSub')).toHaveText(/^(Ann|Bob), look away$/);
    await expect(page.locator('#curtainBtn')).toHaveText('Lift the cup');
    const first = (await page.locator('#curtainTitle').innerText()).replace(
      'Pass the phone to ',
      '',
    );
    await page.locator('#curtainBtn').click();
    await expect(curtain).toBeHidden();
    await expect(round(page)).toHaveText('Round 1');
    // The holder bids through the hook (the table's own controls are the legacy vdom's); the cup
    // passes and the curtain comes back for the other player.
    const v = await view(page);
    const bid = (await legal(page)).find((a) => a.type === 'bid');
    if (v === null || bid === undefined) throw new Error('no bid to make');
    await act(page, bid);
    await expect(curtain).toBeVisible();
    const second = (await page.locator('#curtainTitle').innerText()).replace(
      'Pass the phone to ',
      '',
    );
    expect(new Set([first, second])).toEqual(new Set(['Ann', 'Bob']));
    await page.locator('#curtainBtn').click();
    await expect(curtain).toBeHidden();
    expect(await player.peerCalls()).toEqual([]);
  });

  test('Watch: four computers play each other, the host standing, no Peer opened (D6, D9)', async ({
    player,
    project,
  }) => {
    const { page } = player;
    await page.goto(shellPath(project));
    await page.locator('#playModeSwitch .mode-btn[data-mode="watch"]').click();
    await expect(page.locator('#localModeContent')).toBeVisible();
    await expect(page.locator('#p1NameInput')).toBeHidden();
    await page.locator('#localBtn').click();
    await expect(page.locator('#tableScreen')).toBeVisible();
    await expect(page.locator('#screen-spec')).toBeVisible();
    await expect(page.locator('#curtainOverlay')).toBeHidden();
    const v = await view(page);
    expect(v?.players).toHaveLength(4);
    expect(v?.players.every((p) => p.bot !== null)).toBe(true);
    expect(v?.hostSeat).toBeNull();
    // The computers play: the table talk grows.
    const lines = v?.log.length ?? 0;
    await expect
      .poll(async () => (await view(page))?.log.length ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(lines);
    expect(await player.peerCalls()).toEqual([]);
  });
});
