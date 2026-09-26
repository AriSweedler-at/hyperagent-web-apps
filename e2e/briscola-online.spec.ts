// Briscola online for three and four (docs/design/n-seat-sessions.md §7, §6.12; the design's §4
// with four players a free-for-all): one browser context per seat through the local PeerServer.
// The host opens a table at three or four, the guests sit down by code in turn and every waiting
// room lists the seats filling (its own row marked); at three a spare peer is told the table is
// full and the table is unchanged; the host deals and every device shows its own seat's hand and
// the shared trick; a whole trick, each card from its player's page, settles everywhere to the same
// record; the last guest reloads (the host pauses the trick and names it) and is back in the same
// seat from its save, by name (D6); then the game plays to its end through the hook and the result
// sheet is up on every device with the same winner. Tagged @briscola and @online (see
// shell-home.spec.ts and shell-online.spec.ts); the two-seat table is shell-online's row. Four
// contexts is the heaviest spec of the suite, so each case is marked slow.
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
import { WEBRTC_TIMEOUT } from './fixtures/timeouts.ts';
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

const TABLES: ReadonlyArray<SeatCount> = [3, 4];

test.describe('briscola', { tag: '@briscola' }, () => {
  TABLES.forEach((n) => {
    test(
      `${String(n)} peers: the host opens at ${String(n)}, the guests sit down by code${n === 3 ? ' (a fourth is refused)' : ''}, every device sees its own hand and the shared trick, a trick resolves everywhere, a guest back from a reload lands in its seat by name, the result reaches all`,
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

          // At three, a fourth peer is told the table is full and seats nobody.
          if (n === 3) {
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
          }

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

          // The last guest reloads: the host pauses the trick and names who is missing; back from
          // its save (the offer, one tap) it lands in the same seat by name, and the trick goes on.
          const seat = n - 1;
          const back = at(guests, n - 2, 'guest');
          await back.page.reload();
          await expect(host.page.locator('#statusText')).toContainText(
            `Waiting for ${at(TABLE_NAMES, seat, 'name')} to reconnect`,
            { timeout: WEBRTC_TIMEOUT },
          );
          await expect(host.page.locator(`#seats .seat[data-seat="${String(seat)}"]`)).toHaveClass(
            /\bgone\b/,
          );
          await expect(back.page.locator('#homeScreen')).toBeVisible();
          await expect(back.page.locator('#resumeBtn')).toHaveText(resumeLabel.guest(code));
          await back.page.locator('#resumeBtn').click();
          await expect(back.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
          expect((await requireView(back.page)).me.idx).toBe(seat);
          await expect(
            host.page.locator(`#seats .seat[data-seat="${String(seat)}"]`),
          ).not.toHaveClass(/\bgone\b/);
          await expect(host.page.locator('#statusText')).not.toContainText('reconnect');

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
