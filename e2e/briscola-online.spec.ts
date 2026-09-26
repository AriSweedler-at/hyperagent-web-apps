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
// The second describe is the live intent mirror at two (docs/design/briscola-battle.md §4), each
// way: one seat's hover, raise and play over its own hand, each shown on the other as the matching
// back of `#seatR2` lifting, ringing and clearing; and a touch raising with no hover before it,
// since a touch's `pointerover` is not a hover (§4.2). The guest's way and the touch case are fixmes
// with the two gaps this spec found (GUEST_LANE_FIXME, TOUCH_FIXME).
import type { Locator, Page } from '@playwright/test';

import type { SeatCount, View } from '../web/games/briscola/src/engine/index.ts';
import {
  FIRST_LEGAL,
  TABLE_NAMES,
  briscolaHostTable,
  briscolaJoinTable,
  briscolaRefused,
  playCard,
  playOutOnline,
  playTrickOnline,
  readView,
  requireView,
  seatListShown,
  tableFullStatus,
} from './fixtures/briscola.ts';
import { closePeers, peers } from './fixtures/online-games.ts';
import { newPlayer, openGame, type Player } from './fixtures/player.ts';
import { resumeLabel } from './fixtures/shell.ts';
import type { Project } from './fixtures/site.ts';
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

/** The two seats of a two-seat table, by role: the host is seat 0, the guest seat 1. */
type Side = 'host' | 'guest';
type Pair = Readonly<Record<Side, Player>>;
const SEAT_OF: Readonly<Record<Side, 0 | 1>> = { host: 0, guest: 1 };
const otherSide = (side: Side): Side => (side === 'host' ? 'guest' : 'host');

/**
 * The two-seat table dealt: the host opens at two (the beat off), the guest sits down, the host
 * deals, and both tables are up. Resolves with the host's opening view.
 */
const dealTwo = async (pair: Pair, project: Project): Promise<View> => {
  const { host, guest } = pair;
  await Promise.all([host, guest].map((p) => openGame(p, project, 'briscola')));
  const code = await briscolaHostTable(host.page, TABLE_NAMES[0], 2);
  await briscolaJoinTable(guest.page, TABLE_NAMES[1], code);
  await expect(host.page.locator('#startGameBtn')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
  await host.page.locator('#startGameBtn').click();
  await expect(host.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
  await expect(guest.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
  const opening = await requireView(host.page);
  expect(opening).toMatchObject({ me: { idx: 0 }, phase: 'trick', options: { seatCount: 2 } });
  return opening;
};

/**
 * The sender's hand made live (the sender is the device whose hand is live, briscola-battle.md
 * §4.2): when the other seat leads the trick, it plays first. Resolves with the sender's first
 * legal card and its engine-order slot, which names the back the receiver lifts for it (§4.1).
 */
const senderToAct = async (
  pair: Pair,
  sender: Side,
  opening: View,
): Promise<Readonly<{ cardId: string; slot: number }>> => {
  const me = pair[sender].page;
  if (opening.turn !== SEAT_OF[sender]) {
    const other = pair[otherSide(sender)].page;
    await playCard(other, FIRST_LEGAL(await requireView(other)));
  }
  await expect.poll(async () => (await readView(me))?.isMyTurn).toBe(true);
  const v = await requireView(me);
  const cardId = FIRST_LEGAL(v);
  const slot = v.me.hand.findIndex((c) => c.id === cardId);
  expect(slot).toBeGreaterThanOrEqual(0);
  return { cardId, slot };
};

/** The other seat's backs as a page shows them: `#seatR2` is the one other cell at two (ui/layout.ts). */
const backs = (page: Page): Locator => page.locator('#seatR2 .seat-cards > .card');
/** The backs of `#seatR2` carrying the lift class `cls`. */
const lifted = (page: Page, cls: 'intent-hover' | 'intent-raised'): Locator =>
  page.locator(`#seatR2 .seat-cards > .card.${cls}`);

/**
 * Every lift class that appears on a back of `#seatR2` from now on, in order, repeats folded
 * (`window.__lifts`): a MutationObserver on the class attribute, since a lift that came and went
 * between two polls would otherwise be missed.
 */
const WATCH_LIFTS = `(() => {
  const seen = [];
  window.__lifts = seen;
  new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target;
      if (!(el instanceof Element)) continue;
      for (const cls of ['intent-hover', 'intent-raised']) {
        if (el.classList.contains(cls) && seen[seen.length - 1] !== cls) seen.push(cls);
      }
    }
  }).observe(document.getElementById('seatR2'), {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
})()`;
const watchLifts = (page: Page): Promise<void> => page.evaluate(WATCH_LIFTS);
const liftsSeen = (page: Page): Promise<ReadonlyArray<string>> =>
  page.evaluate<ReadonlyArray<string>>('window.__lifts');

/** A frame reaches the receiver within the 60 ms trailing throttle (§4.2) plus the wire and a paint; this bounds it. */
const INTENT_TIMEOUT = 3000;

/**
 * Why the guest's way is a fixme (found by this spec, 2026-09-26): the guest's frame never leaves
 * its page. web/games/briscola/main.ts's `net` names no `isEphemeral`, so the boot's `send`
 * (web/shared/edge/boot.ts) routes by `isGuestFrame` alone, which an intent frame is not (`join`
 * and `action` only): a guest drops it, and the host sends its own only because it is not a guest
 * frame either. The fix is `isEphemeral` beside `isGuestFrame` in that `net`; then this comes off.
 */
const GUEST_LANE_FIXME =
  'the guest never sends its intent frame: web/games/briscola/main.ts `net` lacks `isEphemeral`, so the boot routes it by `isGuestFrame` and drops it (the host to the guest carries)';

/**
 * Why the touch case is a fixme (found by this spec, 2026-09-26): a tap focuses the slot it lands
 * on (`tabindex="0"` while playable), and `bindHover` counts `focusin` as a hover for keyboard
 * parity, so the receiver paints `intent-hover` for a throttle window before `intent-raised`: the
 * phantom hover D13 gated `pointerover` against, back in through focus. The fix gates the focus
 * path on the pointer type of the press that focused it; then this comes off and the sequence
 * assertion stands as written.
 */
const TOUCH_FIXME =
  'a tap focuses the slot and `focusin` counts as a hover (render.ts bindHover), so the receiver paints `intent-hover` before `intent-raised`; D13 (touch sends no hover) needs the focus path gated too';

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

  // The live intent mirror (docs/design/briscola-battle.md §4) at two, each way: the frame names
  // the engine-order slot (§4.1), so the back that lifts on the receiver is the card's index in the
  // sender's `me.hand`, whatever its place in the fan; the hover lift yields to the raise's ring
  // (§4.4), and the play clears both. The guest's way is a fixme (GUEST_LANE_FIXME above).
  test.describe('live intent mirror', () => {
    (['host', 'guest'] as const).forEach((sender) => {
      const receiver = otherSide(sender);
      test(
        `${sender} to ${receiver}: the ${sender} hovers a hand card and the ${receiver} lifts that back, raises it and the ${receiver} rings it, plays it and the ${receiver} clears both`,
        { tag: '@online' },
        async ({ players, project }) => {
          test.fixme(sender === 'guest', GUEST_LANE_FIXME);
          const me = players[sender].page;
          const peer = players[receiver].page;
          const opening = await dealTwo(players, project);
          const { cardId, slot } = await senderToAct(players, sender, opening);
          const card = me.locator(`#hand .card[data-card="${cardId}"]`);
          await expect(card).toHaveClass(/\bplayable\b/);
          await expect(backs(peer)).toHaveCount(3);
          const back = backs(peer).nth(slot);

          // Hover: that back, and no other, lifts on the receiver.
          await card.hover();
          await expect(back).toHaveClass(/\bintent-hover\b/, { timeout: INTENT_TIMEOUT });
          await expect(lifted(peer, 'intent-hover')).toHaveCount(1);
          await expect(lifted(peer, 'intent-raised')).toHaveCount(0);

          // Raise: a click selects the card; the receiver rings that back and the hover lift yields.
          await card.click();
          await expect(card).toHaveClass(/\bselected\b/);
          await expect(back).toHaveClass(/\bintent-raised\b/, { timeout: INTENT_TIMEOUT });
          await expect(back).not.toHaveClass(/\bintent-hover\b/);
          await expect(lifted(peer, 'intent-raised')).toHaveCount(1);

          // Play: the card reaches the fan; the receiver clears both lifts.
          await me.locator('#playBtn').click();
          await expect(me.locator(`#trick .card[data-card="${cardId}"]`)).toHaveCount(1);
          await expect(lifted(peer, 'intent-raised')).toHaveCount(0, { timeout: INTENT_TIMEOUT });
          await expect(lifted(peer, 'intent-hover')).toHaveCount(0);
        },
      );
    });

    // A touch is no hover (§4.2): its `pointerover` precedes every tap (W3C Pointer Events §3.3.3),
    // so the sender ignores it, and the first the receiver sees of a tap is the raise. The host
    // holds the phone: the way that carries (GUEST_LANE_FIXME). A fixme until the focus path is
    // gated too (TOUCH_FIXME): today the sequence seen is ['intent-hover', 'intent-raised'].
    test(
      'a touch raises with no hover before it: the host on a phone taps a hand card, the guest rings that back and never lifted one',
      { tag: '@online' },
      async ({ browser, project }, testInfo) => {
        test.fixme(true, TOUCH_FIXME);
        const pair: Pair = {
          host: await newPlayer(browser, 'host', testInfo, { phone: true }),
          guest: await newPlayer(browser, 'guest', testInfo),
        };
        const peer = pair.guest.page;
        try {
          const opening = await dealTwo(pair, project);
          const { cardId, slot } = await senderToAct(pair, 'host', opening);
          const card = pair.host.page.locator(`#hand .card[data-card="${cardId}"]`);
          await expect(card).toHaveClass(/\bplayable\b/);
          await expect(backs(peer)).toHaveCount(3);
          await watchLifts(peer);
          await card.tap();
          await expect(card).toHaveClass(/\bselected\b/);
          await expect(backs(peer).nth(slot)).toHaveClass(/\bintent-raised\b/, {
            timeout: INTENT_TIMEOUT,
          });
          expect(await liftsSeen(peer)).toEqual(['intent-raised']);
        } finally {
          await Promise.all([pair.host.context.close(), pair.guest.context.close()]);
        }
        expect(pair.host.watched.errors(), 'host uncaught exceptions').toEqual([]);
        expect(pair.guest.watched.errors(), 'guest uncaught exceptions').toEqual([]);
      },
    );
  });
});
