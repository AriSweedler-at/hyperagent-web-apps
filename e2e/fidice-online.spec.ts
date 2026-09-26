// Fidice's own spec on its shell path (docs/design/fidice-shell-adoption.md §4 M5; the eight
// e2e/shell-*.spec.ts play the shell itself under the @fidice tag): what the shared specs' two-seat
// tables cannot show. (1) The N-seat table: a host, two guests (three contexts) and a computer
// through the shared sessions, the host deals, Round 1 on every page with the cup at the same
// seat, the humans bid and call when the cup reaches them (the computer plays its turns by itself)
// until the round's reveal, which every page shows; (2) pass the phone, two humans at one phone:
// the curtain names the cup holder, one tap lifts it (D8), and it comes back for the other player
// after a bid; (3) Watch: four computers and no Peer (D6, D9); and (4) the smoke of both paths:
// the documented hook boots on the live page and on `?shell=1`, and the flag is remembered. The
// page is opened through `gamePath` (e2e/fixtures/player.ts PAGE_QUERY puts fidice on its shell
// path); e2e/smoke.spec.ts keeps loading the bare live page. Page-only (e2e/fixtures/site.ts
// PAGE_ONLY_SPECS): about the seats, not the origin. Tagged @fidice (tools/ci/suites.ts `gameE2e`);
// the table case @online, as the shell specs tag theirs.
import { PHONE } from './fixtures/geometry.ts';
import {
  fidiceBid,
  fidiceRound,
  fidiceSameRound,
  humanTurn,
  readView,
  requireView,
} from './fixtures/fidice.ts';
import { closePeers, peers } from './fixtures/online-games.ts';
import { gamePath, gameQuery, openGame } from './fixtures/player.ts';
import { hostStarts, join, roomCode, startLocal } from './fixtures/shell.ts';
import { pagePath } from './fixtures/site.ts';
import { BROKER_TIMEOUT } from './fixtures/timeouts.ts';
import { expect, test } from './fixtures/two-players.ts';

const HOST = 'Host';
const GUESTS = ['Guest 1', 'Guest 2'] as const;
/** `#hostWaitStatus` with the room waiting at the card's six chairs (shellConfig.ts `waitingMsg`). */
const WAITING_SIX = 'Waiting for players — 6 chairs at the table';

test.describe('fidice', { tag: '@fidice' }, () => {
  test('smoke: the documented hook boots on both paths, and the flag is remembered', async ({
    player,
    project,
  }) => {
    const { page } = player;
    // The live page: the vdom's root, no shell screen.
    await page.goto(`${pagePath(project, 'fidice')}${gameQuery()}`);
    await expect.poll(() => page.evaluate<string>('typeof window.__fidice')).toBe('object');
    await expect(page.locator('#app-root')).toBeVisible();
    await expect(page.locator('#homeScreen')).toHaveCount(0);
    // The shell path (`gamePath` carries the flag), remembered.
    await page.goto(gamePath(project, 'fidice'));
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
    'the N-seat table: a host, two guests and a computer; the deal, Round 1 everywhere, the humans bid and call to the reveal',
    { tag: '@online' },
    async ({ project, browser }, testInfo) => {
      test.slow();
      const table = await peers(browser, testInfo, 3);
      try {
        const { host } = table;
        const [g1, g2] = table.guests;
        if (g1 === undefined || g2 === undefined) throw new Error('two guests');
        await Promise.all(table.all.map((p) => openGame(p, project, 'fidice')));
        // The host card at its defaults but one computer, Medium: the room opens at six chairs
        // (e2e/fixtures/shell.ts `hostRoom` would set the shell specs' two, so the card is driven
        // here), the computer listed under the host with its controls.
        await host.page.locator('#nameInput').fill(HOST);
        await host.page.locator('#botsSel').selectOption('1');
        await host.page.locator('#hostBtn').click();
        await expect(host.page.locator('#hostWaitScreen')).toBeVisible();
        await expect(host.page.locator('#hostWaitStatus')).toContainText(WAITING_SIX, {
          timeout: BROKER_TIMEOUT,
        });
        const code = await roomCode(host.page, 'fidice');
        await expect(host.page.locator('#seatList li[data-bot]')).toHaveCount(1);
        await expect(host.page.locator('#seatList [data-bot-remove]')).toHaveCount(1);
        await join(g1.page, 'fidice', GUESTS[0], code);
        await join(g2.page, 'fidice', GUESTS[1], code);
        await expect(host.page.locator('#hostWaitStatus')).toHaveText(
          `${GUESTS[1]} joined! 3 of 6 seated — start when ready.`,
        );
        await expect(g2.page.locator('#guestWaitStatus')).toHaveText(
          `Connected — 3 of 6 seated · waiting for ${HOST} to start`,
        );
        await expect(g1.page.locator('#guestSeatList li[data-bot]')).toHaveCount(1);

        // The deal: the three humans and the computer sit down; the empty chairs are dropped.
        await hostStarts(host.page, g1.page);
        await expect(g2.page.locator('#tableScreen')).toBeVisible();
        const pages = table.all.map((p) => p.page);
        await fidiceSameRound(pages, 'Round 1');
        const dealt = await requireView(host.page);
        expect(dealt.players).toHaveLength(4);
        expect(dealt.players.filter((p) => p.bot !== null)).toHaveLength(1);
        expect(dealt.players.map((p) => p.name)).toEqual(
          expect.arrayContaining([HOST, GUESTS[0], GUESTS[1]]),
        );
        // The names strip: each page names its own chair.
        await expect(host.page.locator('#myName')).toHaveText(HOST);
        await expect(g1.page.locator('#myName')).toHaveText(GUESTS[0]);
        await expect(g2.page.locator('#myName')).toHaveText(GUESTS[1]);
        await expect(g2.page.locator('#oppName')).toContainText(HOST);

        // The round plays: the computer takes its turns by itself; a human bids when the cup
        // reaches them with no bid on it and calls when it reaches them with one. The round ends
        // in a reveal (whoever called), which every page shows.
        const played = new Set<string>();
        const humans = [
          [host.page, HOST],
          [g1.page, GUESTS[0]],
          [g2.page, GUESTS[1]],
        ] as const;
        await expect
          .poll(
            async () => {
              await humans.reduce(async (done, [page, name]) => {
                await done;
                const turn = await humanTurn(page, name);
                if (turn !== null) played.add(turn);
              }, Promise.resolve());
              const v = await readView(host.page);
              return v !== null && (v.reveal !== null || v.roundNo > 1 || v.phase === 'over');
            },
            { timeout: 60_000, intervals: [250] },
          )
          .toBe(true);
        const after = await requireView(host.page);
        // A bid was made (the log says so), and every page has the same table talk.
        expect(after.log.some((l) => /bid|opens|raise/i.test(l.text))).toBe(true);
        await Promise.all(
          table.guests.map((g) =>
            expect.poll(async () => (await readView(g.page))?.log.length).toBe(after.log.length),
          ),
        );
        if (after.reveal !== null)
          await Promise.all(pages.map((page) => expect(page.locator('#reveal')).toBeVisible()));
        expect(played.size).toBeGreaterThanOrEqual(1);
      } finally {
        await closePeers(table);
      }
    },
  );

  test('pass the phone: two humans at one phone, the curtain names the cup holder, one tap lifts it, and it comes back for the other after a bid (D8)', async ({
    player,
    project,
  }) => {
    const { page } = player;
    await startLocal(page, gamePath(project, 'fidice'), PHONE, ['Ann', 'Bob']);
    const curtain = page.locator('#curtainOverlay');
    await expect(page.locator('#curtainTitle')).toHaveText(/^Pass the phone to (Ann|Bob)$/);
    await expect(page.locator('#curtainSub')).toHaveText(/^(Ann|Bob), look away$/);
    await expect(page.locator('#curtainBtn')).toHaveText('Lift the cup');
    const first = (await page.locator('#curtainTitle').innerText()).replace(
      'Pass the phone to ',
      '',
    );
    await page.locator('#curtainBtn').click();
    await expect(curtain).toBeHidden();
    await expect(fidiceRound(page)).toHaveText('Round 1');
    await expect(page.locator('#myName')).toHaveText(first);
    // The holder bids through the hook (the table's own controls are the legacy vdom's); the cup
    // passes and the curtain comes back for the other player.
    await fidiceBid(page);
    await expect(curtain).toBeVisible();
    const second = (await page.locator('#curtainTitle').innerText()).replace(
      'Pass the phone to ',
      '',
    );
    expect(new Set([first, second])).toEqual(new Set(['Ann', 'Bob']));
    await page.locator('#curtainBtn').click();
    await expect(curtain).toBeHidden();
    await expect(page.locator('#myName')).toHaveText(second);
    expect(await player.peerCalls()).toEqual([]);
  });

  test('Watch: four computers play each other, the host standing, no Peer opened (D6, D9)', async ({
    player,
    project,
  }) => {
    const { page } = player;
    await page.goto(gamePath(project, 'fidice'));
    await page.locator('#playModeSwitch .mode-btn[data-mode="watch"]').click();
    await expect(page.locator('#localModeContent')).toBeVisible();
    await expect(page.locator('#p1NameInput')).toBeHidden();
    await page.locator('#localBtn').click();
    await expect(page.locator('#tableScreen')).toBeVisible();
    await expect(page.locator('#screen-spec')).toBeVisible();
    await expect(page.locator('#curtainOverlay')).toBeHidden();
    await expect(page.locator('#myName')).toHaveText('Watching');
    const v = await requireView(page);
    expect(v.players).toHaveLength(4);
    expect(v.players.every((p) => p.bot !== null)).toBe(true);
    expect(v.hostSeat).toBeNull();
    // The computers play: the table talk grows.
    const lines = v.log.length;
    await expect
      .poll(async () => (await readView(page))?.log.length ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(lines);
    expect(await player.peerCalls()).toEqual([]);
  });
});
