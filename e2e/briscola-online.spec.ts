// Briscola online for three and four (docs/design/n-seat-sessions.md §7, §6.12; the design's §4
// with four players a free-for-all): one browser context per seat through the local PeerServer.
// The host opens a table at three or four, the guests sit down by code in turn and every waiting
// room lists the seats filling (its own row marked); a spare peer is told the table is full and
// the table is unchanged; the host deals and every device shows its own seat's hand and the shared
// trick; a whole trick, each card from its player's page, settles everywhere to the same record;
// the last guest reloads (every other device pauses the trick and names it, its dot off) and is
// back in the same seat from its save, by name (D6), every dot on again; the host reloads with
// every guest and the guests come back in reverse seat order (the resumed room seats each by the
// name it saved, so nobody swaps seats or is renamed, and the next trick plays from the right
// pages); then the game plays to its end through the hook and the result sheet is up on every
// device with the same winner. Tagged @briscola and @online (see shell-home.spec.ts and
// shell-online.spec.ts); the two-seat table is shell-online's row. Four contexts is the heaviest
// spec of the suite, so each case is marked slow, and it is page-only (e2e/fixtures/site.ts).
import type { Page } from '@playwright/test';

import type { SeatCount } from '../web/games/briscola/src/engine/index.ts';
import {
  TABLE_NAMES,
  briscolaHostTable,
  briscolaJoinTable,
  briscolaRefused,
  playOutOnline,
  playTrickOnline,
  readView,
  requireView,
  seatListShown,
  tableFullStatus,
} from './fixtures/briscola.ts';
import { closePeers, peers } from './fixtures/online-games.ts';
import { newPlayer, openGame } from './fixtures/player.ts';
import { resumeLabel } from './fixtures/shell.ts';
import { BROKER_TIMEOUT, WEBRTC_TIMEOUT } from './fixtures/timeouts.ts';
import { expect, test } from './fixtures/two-players.ts';

/** The element at `i`, or a test bug. */
const at = <T>(list: ReadonlyArray<T>, i: number, what: string): T => {
  const item = list[i];
  if (item === undefined) throw new Error(`no ${what} at ${String(i)}`);
  return item;
};

/** Every seat of a table of `n` as its list shows it, all up, the viewer's own marked. */
const fullTable = (n: number, you: number): ReadonlyArray<readonly [number, boolean, boolean]> =>
  Array.from({ length: n }, (_, seat) => [seat, true, seat === you] as const);

/** Every seat cell shown on `page` has its dot on: nobody reads as down there. */
const dotsOn = async (page: Page, n: number): Promise<void> => {
  await expect(page.locator('#seats .seat:not([hidden]) .conn-dot.on')).toHaveCount(n - 1);
  await expect(page.locator('#seats .seat:not([hidden]) .conn-dot.off')).toHaveCount(0);
};

const TABLES: ReadonlyArray<SeatCount> = [3, 4];

test.describe('briscola', { tag: '@briscola' }, () => {
  TABLES.forEach((n) => {
    test(
      `${String(n)} peers: the host opens at ${String(n)}, the guests sit down by code, a spare is refused, every device sees its own hand and the shared trick, a trick resolves everywhere, a guest back from a reload lands in its seat by name while the others paused for it, the host reloads and the guests return in reverse order to their own seats, the result reaches all`,
      { tag: '@online' },
      async ({ project, browser }, testInfo) => {
        test.slow();
        const table = await peers(browser, testInfo, n);
        try {
          const { host, guests, all } = table;
          const pages = all.map((p) => p.page);
          await Promise.all(all.map((p) => openGame(p, project, 'briscola')));
          const code = await briscolaHostTable(host.page, TABLE_NAMES[0], n);

          // The guests sit down in turn: the seats fill in join order, every room listing them.
          await guests.reduce(async (earlier, guest, i) => {
            await earlier;
            await briscolaJoinTable(guest.page, at(TABLE_NAMES, i + 1, 'name'), code);
          }, Promise.resolve());
          await expect(host.page.locator('#startGameBtn')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
          expect(await seatListShown(host.page, 'seatList')).toEqual(fullTable(n, 0));
          await Promise.all(
            guests.map(async (guest, i) => {
              await expect(guest.page.locator('#guestWaitStatus')).toHaveText(tableFullStatus(n));
              expect(await seatListShown(guest.page, 'guestSeatList')).toEqual(fullTable(n, i + 1));
            }),
          );

          // One peer more is told the table is full and seats nobody (the host probes every seat
          // first, so this takes a heartbeat; the hold's deadline bounds it).
          const spare = await newPlayer(browser, 'guest', {
            ...testInfo,
            titlePath: [...testInfo.titlePath, 'spare'],
          });
          try {
            await openGame(spare, project, 'briscola');
            await briscolaRefused(spare.page, 'Eve', code);
          } finally {
            await spare.context.close();
          }
          expect(spare.watched.errors(), 'spare uncaught exceptions').toEqual([]);
          expect(await seatListShown(host.page, 'seatList')).toEqual(fullTable(n, 0));
          await expect(host.page.locator('#startGameBtn')).toBeVisible();

          // The host deals: every device at the table, its own seat's three cards, the same deal.
          await host.page.locator('#startGameBtn').click();
          const opening = await requireView(host.page);
          expect(opening).toMatchObject({ me: { idx: 0 }, gameNo: 1, phase: 'trick' });
          await Promise.all(
            pages.map(async (page, seat) => {
              await expect(page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
              await expect
                .poll(async () => (await readView(page))?.startedAt)
                .toBe(opening.startedAt);
              const v = await requireView(page);
              expect(v).toMatchObject({
                me: { idx: seat },
                gameNo: 1,
                phase: 'trick',
                turn: opening.turn,
                trumpCard: opening.trumpCard,
                stockCount: opening.stockCount,
                options: { seatCount: n },
              });
              expect(v.me.hand).toHaveLength(3);
              expect(v.players.map((p) => p.name)).toEqual(TABLE_NAMES.slice(0, n));
              await expect(page.locator('#hand .card')).toHaveCount(3);
              await expect(page.locator('#seats .seat:not([hidden])')).toHaveCount(n - 1);
              await expect(page.locator('#scoreStrip .score-cell')).toHaveCount(n);
              await expect(page.locator('#curtainOverlay')).toBeHidden();
            }),
          );

          // A whole trick, each card from its player's own page: settled everywhere to one record.
          const settled = await playTrickOnline(pages);
          const first = at(settled, 0, 'view');
          settled.forEach((v, seat) => {
            expect(v.me.idx).toBe(seat);
            expect(v.lastTrick?.no).toBe(1);
            expect(v.lastTrick).toEqual(first.lastTrick);
            expect(v.trick).toEqual([]);
            expect(v.taken).toEqual(first.taken);
          });

          // The last guest reloads: every other device pauses the trick and names who is missing
          // (the host from its seats, the guests from the table the host sends round), its dot off
          // and their hands inert; back from its save (the offer, one tap) it lands in the same
          // seat by name, every dot is on again, and the trick goes on.
          const seat = n - 1;
          const back = at(guests, n - 2, 'guest');
          const others = pages.filter((_, i) => i !== seat);
          const cell = `#seats .seat[data-seat="${String(seat)}"]`;
          await back.page.reload();
          await Promise.all(
            others.map(async (page) => {
              await expect(page.locator('#statusText')).toContainText(
                `Waiting for ${at(TABLE_NAMES, seat, 'name')} to reconnect`,
                { timeout: WEBRTC_TIMEOUT },
              );
              await expect(page.locator(cell)).toHaveClass(/\bgone\b/);
              await expect(page.locator(`${cell} .conn-dot`)).toHaveClass(/\boff\b/);
              await expect(page.locator('#hand')).toHaveClass(/\binert\b/);
            }),
          );
          await expect(back.page.locator('#homeScreen')).toBeVisible();
          await expect(back.page.locator('#resumeBtn')).toHaveText(resumeLabel.guest(code));
          await back.page.locator('#resumeBtn').click();
          await expect(back.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
          expect((await requireView(back.page)).me.idx).toBe(seat);
          await Promise.all(
            others.map(async (page) => {
              await expect(page.locator(cell)).not.toHaveClass(/\bgone\b/);
              await expect(page.locator('#statusText')).not.toContainText('reconnect');
            }),
          );
          await Promise.all(pages.map((page) => dotsOn(page, n)));

          // The host reloads, and so does every guest; the host resumes first, then the guests in
          // reverse seat order. The resumed room seeds each seat with the name it saved (D6), so
          // each guest is back in its own seat with its own name and hand, and the next trick
          // plays from the right pages.
          const paused = await requireView(host.page);
          await Promise.all(guests.map((guest) => guest.page.reload()));
          await host.page.reload();
          await expect(host.page.locator('#homeScreen')).toBeVisible();
          await expect(host.page.locator('#resumeBtn')).toHaveText(resumeLabel.host(code));
          await host.page.locator('#resumeBtn').click();
          await expect(host.page.locator('#hostWaitScreen')).toBeVisible();
          await expect(host.page.locator('#roomCode')).toHaveText(code);
          await expect(host.page.locator('#hostWaitStatus')).toContainText('reopened', {
            timeout: BROKER_TIMEOUT,
          });
          await [...guests].reverse().reduce(async (earlier, guest) => {
            await earlier;
            await expect(guest.page.locator('#homeScreen')).toBeVisible();
            await expect(guest.page.locator('#resumeBtn')).toHaveText(resumeLabel.guest(code));
            await guest.page.locator('#resumeBtn').click();
            await expect(guest.page.locator('#tableScreen')).toBeVisible({
              timeout: WEBRTC_TIMEOUT,
            });
          }, Promise.resolve());
          await Promise.all(
            pages.map(async (page, idx) => {
              await expect.poll(async () => (await readView(page))?.me.idx).toBe(idx);
              const v = await requireView(page);
              expect(v.me.name).toBe(at(TABLE_NAMES, idx, 'name'));
              expect(v.players.map((p) => p.name)).toEqual(TABLE_NAMES.slice(0, n));
              expect(v.trickNo).toBe(paused.trickNo);
              expect(v.taken).toEqual(paused.taken);
              await expect(page.locator('#statusText')).not.toContainText('reconnect', {
                timeout: WEBRTC_TIMEOUT,
              });
              await dotsOn(page, n);
            }),
          );
          const second = await playTrickOnline(pages);
          second.forEach((v, idx) => {
            expect(v.me.idx).toBe(idx);
            expect(v.lastTrick?.no).toBe(2);
            expect(v.lastTrick).toEqual(at(second, 0, 'view').lastTrick);
          });

          // The game to its end through the hook: the result on every device, the same winner.
          const over = await playOutOnline(pages);
          const result = at(over, 0, 'view').result;
          expect(result).not.toBeNull();
          over.forEach((v) => {
            expect(v.phase).toBe('over');
            expect(v.result).toEqual(result);
            expect(v.result?.totals).toHaveLength(n);
            expect(v.result?.totals.reduce((sum, points) => sum + points, 0)).toBe(120);
          });
          await Promise.all(
            pages.map(async (page) => {
              await expect(page.locator('#resultOverlay')).toBeVisible();
              await expect(page.locator('#rsScore .score-row')).toHaveCount(n);
            }),
          );
          const titles = await Promise.all(
            pages.map((page) => page.locator('#rsTitle').innerText()),
          );
          expect(new Set(titles).size).toBe(1);
        } finally {
          await closePeers(table);
        }
      },
    );
  });
});
