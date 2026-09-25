// Briscola's pass-and-play on one page (docs/design/briscola.md §5.1, §5.4, §5.6), at a phone and
// a laptop, the game's half (the shell's half of the home screen and of the start is
// e2e/shell-home.spec.ts and shell-local.spec.ts). The home screen carries the title and the shell
// tabs, and the count select brings the third and fourth names. For two, three and four players
// the deal is on the table (three cards each, the stock's count, the briscola lying under it and
// named in the badge), the first curtain names the leader and tells everyone else to look away,
// the next curtain names the next seat, a trick resolves to the engine's winner with the score
// strip ticking and the last trick on its sheet. A card dragged by hand past the threshold lifts, the
// ghost sits on the pointer with no tween (its computed transition is none and its drawn transform
// is the kernel's translate right after a move), the trick takes `drop-ready` then `drop`, and the
// release plays the card. A position seated through `window.__briscola.setup`
// plays the last three tricks to the result sheet, the match badge and, with a game already won,
// the match's end screen; the running score always equals the view's `sides`. The history sheet
// shows one row per event whose line is the engine's `summaryOf`, expands to `detailOf`'s pairs,
// and the open row survives the next trick's repaint. The sounds: the hook's cue player is spied
// and a briscola stealing a big card plays the briscola sting before the win, a lost small trick
// nothing (pass and play hears the winner's phrase, so the loser's silence is asserted on the same
// engine event through `phraseOf`). The card names (docs/design/language-packs.md §5): every play
// on the table wears its caption and the briscola its line under the stock in the language pack's
// words, a hover over a hand card at the laptop brings the tip up after 400ms, the console hook
// switches the pack live (Italian "di" to English "of") and refuses a stranger with one line, and a
// tap on the briscola opens the card view with the card large and named. The deals come from the
// seeded `Math.random` every player context installs (e2e/fixtures/seed.ts), which main.ts reads
// as `window.__rng ?? Math.random`.
import type { Page } from '@playwright/test';

import {
  cardName,
  detailOf,
  nameOf,
  summaryOf,
  type Seat,
  type SeatCount,
  type View,
} from '../web/games/briscola/src/engine/index.ts';
import { phraseOf } from '../web/games/briscola/src/ui/sound.ts';
import {
  FIRST_LEGAL,
  LOCAL_NAMES,
  briscolaCurtain,
  briscolaPosition,
  briscolaReveal,
  briscolaSetup,
  briscolaStartLocal,
  clearCues,
  closeHistory,
  cuesOf,
  expectChips,
  firstLegalPlays,
  heldCards,
  historyDetail,
  historyRows,
  openHistory,
  playCard,
  playTrick,
  playedCues,
  readEvents,
  requireView,
  spyFx,
  trickShown,
  type Viewport,
} from './fixtures/briscola.ts';
import { cardName as packName, langByName } from '../web/shared/lib/lang/packs.ts';
import { DESKTOP, PHONE } from './fixtures/geometry.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const VIEWPORTS: Readonly<Record<string, Viewport>> = { phone: PHONE, desktop: DESKTOP };

/** The suit's Italian name (the trump badge's class `s-<name>` and `#trumpName`). */
const SUIT_IT: Readonly<Record<string, string>> = {
  C: 'coppe',
  D: 'denari',
  S: 'spade',
  B: 'bastoni',
};

/** "Ann", "Ann and Cara", "Ann, Cara and Dan" (ui/local.ts `listNames`). */
const listNames = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;

/** The trick's `drop` class as a whole token: `\bdrop\b` would also match inside `drop-ready`. */
const DROP = /(^|\s)drop(\s|$)/;

/**
 * How far the drag's ghost is drawn from where the kernel put it: its computed `transition-property`
 * and the distance (px, to the tenth) between the `translate` in its inline style and the matrix
 * `getComputedStyle` reports, which is the tween's current value while one runs and the target when
 * none does.
 */
const ghostLag = (page: Page): Promise<Readonly<{ transitionProperty: string; px: number }>> =>
  page.evaluate<Readonly<{ transitionProperty: string; px: number }>>(
    `(() => {
      const g = document.querySelector('.drag-ghost');
      const cs = getComputedStyle(g);
      const cur = (/matrix\\(([^)]*)\\)/.exec(cs.transform)?.[1] ?? '0,0,0,0,0,0').split(',').map(Number).slice(4);
      const w = /translate\\(([-\\d.]+)px,\\s*([-\\d.]+)px\\)/.exec(g.style.transform);
      const want = w ? [Number(w[1]), Number(w[2])] : [0, 0];
      return { transitionProperty: cs.transitionProperty, px: Math.round(Math.hypot(want[0] - cur[0], want[1] - cur[1]) * 10) / 10 };
    })()`,
  );

/** `#curtainSub` for the seat `incoming`: everyone else, told to look away. */
const lookAway = (v: View, incoming: Seat): string =>
  `${listNames(v.players.filter((_, seat) => seat !== incoming).map((p) => p.name))}, look away`;

/** The stock at the deal: the trump card included, three cards each dealt (34 / 30 / 28). */
const DEALT_STOCK: Readonly<Record<SeatCount, number>> = { 2: 34, 3: 30, 4: 28 };

/** `#gameBadge` at the first game: the wins per side, in side order. */
const firstBadge = (n: SeatCount): string => `Game 1 · ${n === 3 ? '0–0–0' : '0–0'} · best of 3`;

/** The points of every `.score-cell`, in side order (design D9: per player at 2 and 3, per team at 4). */
const stripPoints = (page: Page): Promise<ReadonlyArray<number>> =>
  page.evaluate<ReadonlyArray<number>>(
    `Array.from(document.querySelectorAll('#scoreStrip .score-cell .sc-points')).map((e) => Number(e.textContent))`,
  );

/** The strip agrees with the view: one cell per side, its points the side's. */
const expectStrip = async (page: Page, v: View): Promise<void> => {
  await expect(page.locator('#scoreStrip')).toHaveAttribute(
    'data-mode',
    v.options.seatCount === 4 ? 'teams' : 'players',
  );
  await expect.poll(() => stripPoints(page)).toEqual([...v.sides]);
  const top = Math.max(...v.sides);
  const leaders = v.sides.filter((s) => s === top).length;
  await expect(page.locator('#scoreStrip .score-cell.leading')).toHaveCount(leaders === 1 ? 1 : 0);
};

/** The curtain lifted if the trick's winner is not the seat that laid its last card. */
const revealIfCurtain = async (page: Page): Promise<void> => {
  if (await page.locator('#curtainOverlay').isVisible()) await briscolaReveal(page);
};

/** The cell of a seat other than mine (`#seatR1..3[data-seat]`). */
const seatCell = (page: Page, seat: Seat): ReturnType<Page['locator']> =>
  page.locator(`#seats .seat[data-seat="${String(seat)}"]:not([hidden])`);

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test('home: the title, the shell tabs and modes, the count select brings the third and fourth names', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(pagePath(project, 'briscola'));
      await expect(page).toHaveTitle('Briscola — cards');
      await expect(page.locator('#homeScreen h1')).toHaveText('Briscola');
      await expect(page.locator('#topTabbar .tab-btn')).toHaveText(['Play', 'Rules', 'About']);
      await expect(page.locator('#playModeSwitch .mode-btn')).toHaveText([
        'Online',
        'Pass the phone',
      ]);
      // Online: the count select offers two, three and four; three and four ship disabled (D16).
      await expect(page.locator('#playersSel')).toHaveValue('2');
      await expect(page.locator('#playersSel option[value="3"]')).toBeDisabled();
      await expect(page.locator('#playersSel option[value="4"]')).toBeDisabled();
      await expect(page.locator('#hostBtn')).toHaveClass(/\bbtn-go\b/);
      // Pass the phone: two names, the count select, the extra names shown with the count.
      await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
      await expect(page.locator('#localModeContent')).toBeVisible();
      await expect(page.locator('#localPlayersSel')).toHaveValue('2');
      await expect(page.locator('#moreNames')).toBeHidden();
      await expect(page.locator('#localBtn')).toHaveClass(/\bbtn-go\b/);
      await page.locator('#localPlayersSel').selectOption('3');
      await expect(page.locator('#moreNames')).toBeVisible();
      await expect(page.locator('#p3NameInput')).toBeVisible();
      await expect(page.locator('#p4NameInput')).toBeHidden();
      // The removed two is a house rule: folded under its summary until opened.
      await expect(page.locator('#localRemovedTwoSel')).toBeHidden();
      await page.locator('#localModeContent details.house-rules > summary').click();
      await expect(page.locator('#localRemovedTwoSel')).toBeVisible();
      await expect(page.locator('#localRemovedTwoSel')).toHaveValue('C');
      await page.locator('#localPlayersSel').selectOption('4');
      await expect(page.locator('#p4NameInput')).toBeVisible();
      await page.locator('#localPlayersSel').selectOption('2');
      await expect(page.locator('#moreNames')).toBeHidden();
    });

    ([2, 3, 4] as const).forEach((n) => {
      test(`pass and play for ${String(n)}: the deal, the briscola under the stock, the curtains name the next player, a trick resolves to the engine's winner, the strip ticks, the last trick peeks`, async ({
        player,
        project,
      }) => {
        const { page } = player;
        const names = LOCAL_NAMES[n];
        await briscolaStartLocal(page, pagePath(project, 'briscola'), vp, names);
        const v = await requireView(page);
        expect(v.options.seatCount).toBe(n);
        expect(v.players.map((p) => p.name)).toEqual([...names]);
        expect(v.stockCount).toBe(DEALT_STOCK[n]);
        // The leader (the seat after the dealer) holds the phone first, under the curtain.
        const leader = v.turn;
        expect(v.me.idx).toBe(leader);
        expect(v.isMyTurn).toBe(true);
        const curtain = await briscolaCurtain(page);
        expect(curtain).toEqual({
          title: `Pass the phone to ${nameOf(v.players, leader)}`,
          sub: lookAway(v, leader),
          last: `${nameOf(v.players, v.dealer)} dealt · the briscola is the ${cardName(v.trumpCard)}`,
          button: 'Show my cards',
        });
        // The handoff to a room is offered at two players alone (D17).
        await expect(page.locator('#curtainHandoffBtn')).toBeVisible({ visible: n === 2 });
        await expect(page.locator('#hand')).toHaveClass(/\bhidden-cards\b/);

        // The table under the curtain: the stock's count, the briscola lying under it, the badge.
        await expect(page.locator('#stockCount')).toHaveText(`Stock · ${String(DEALT_STOCK[n])}`);
        await expect(page.locator('#stock')).toHaveAttribute('data-count', String(DEALT_STOCK[n]));
        await expect(page.locator('#stock .card.back')).toHaveCount(1);
        await expect(page.locator('#briscola .card')).toHaveAttribute('data-card', v.trumpCard.id);
        await expect(page.locator('#briscola')).not.toHaveClass(/\bgone\b/);
        const suit = SUIT_IT[v.trumpCard.s] ?? '';
        await expect(page.locator('#trumpBadge')).toHaveClass(new RegExp(`\\bs-${suit}\\b`));
        await expect(page.locator('#trumpName')).toHaveText(suit);
        await expect(page.locator('#gameBadge')).toHaveText(firstBadge(n));
        await expect(page.locator('#seats')).toHaveAttribute('data-players', String(n));
        await expect(page.locator('#trick')).toHaveAttribute('data-players', String(n));
        await expect(page.locator('#seats .seat:not([hidden])')).toHaveCount(n - 1);
        // Every other seat has a cell with three tiny backs and no trick yet.
        await Promise.all(
          v.others.map(async (o) => {
            const cell = seatCell(page, o.idx);
            await expect(cell.locator('.seat-name')).toHaveText(o.name);
            await expect(cell.locator('.seat-cards .card')).toHaveCount(3);
            await expect(cell.locator('.seat-taken')).toHaveAttribute('data-count', '0');
          }),
        );

        // The reveal: three cards face up, the hand live, the status mine.
        await briscolaReveal(page);
        await expect(page.locator('#hand')).toHaveClass(/\bactive\b/);
        await expect(page.locator('#hand')).not.toHaveClass(/\bhidden-cards\b/);
        expect(await heldCards(page)).toEqual(v.me.hand.map((c) => c.id));
        await expect(page.locator('#hand .card.playable')).toHaveCount(3);
        await expect(page.locator('#myName')).toHaveText(nameOf(v.players, leader));
        await expect(page.locator('#statusText')).toHaveText('Your turn — play a card');
        await expect(page.locator('#trick')).toHaveAttribute('data-lead', 'You lead');
        await expect(page.locator('#playBtn')).toBeDisabled();
        // No trick taken yet: every strip of chips is empty.
        await expectChips(page, v);

        // The leader plays: the fan shows the card with its chip; the phone passes to the next seat.
        const first = FIRST_LEGAL(v);
        await playCard(page, first);
        expect(await trickShown(page)).toEqual([[first, String(leader)]]);
        await expect(page.locator('#trick .play .who')).toHaveText([nameOf(v.players, leader)]);
        const next = ((leader + 1) % n) as Seat;
        const second = await briscolaCurtain(page);
        expect(second.title).toBe(`Pass the phone to ${nameOf(v.players, next)}`);
        expect(second.sub).toBe(lookAway(v, next));
        // Under the curtain the incoming seat's own view: its hand down, the leader's card on the table.
        const nextView = await requireView(page);
        expect(nextView.me.idx).toBe(next);
        expect(nextView.trick.map((p) => p.card.id)).toEqual([first]);
        await expect(page.locator('#hand')).toHaveClass(/\bhidden-cards\b/);
        await expect(page.locator('#hand')).toHaveClass(/\binert\b/);

        // The rest of the trick, then the beat: the engine's winner takes it, the strip ticks.
        const settled = await playTrick(page);
        const trick = settled.lastTrick;
        if (trick === null) throw new Error('no trick resolved');
        expect(trick.no).toBe(1);
        expect(trick.cards).toHaveLength(n);
        expect(trick.cards[0]?.seat).toBe(leader);
        expect(settled.trickNo).toBe(1);
        expect(settled.leader).toBe(trick.winner);
        expect(settled.stockCount).toBe(DEALT_STOCK[n] - n);
        await expect(page.locator('#stockCount')).toHaveText(
          `Stock · ${String(DEALT_STOCK[n] - n)}`,
        );
        await expect(page.locator('#trick .play')).toHaveCount(0);
        await expectStrip(page, settled);
        expect(settled.taken[trick.winner]).toBe(trick.points);
        expect(settled.tricks[trick.winner]).toBe(1);
        // The winner leads next: its curtain unless it already holds the phone (the last to play).
        const holder = trick.cards[n - 1]?.seat;
        if (trick.winner !== holder) {
          const third = await briscolaCurtain(page);
          expect(third.title).toBe(`Pass the phone to ${nameOf(v.players, trick.winner)}`);
          expect(third.last).toBe(`You took the trick · ${String(trick.points)} points`);
          await briscolaReveal(page);
        }
        const shown = await requireView(page);
        expect(shown.me.idx).toBe(trick.winner);
        await expect(page.locator('#myTaken')).toHaveText(`You: ${String(trick.points)}`);
        // The trick stays on the table as one face-down chip in the winner's strip (mine, here),
        // nothing in the others'.
        await expectChips(page, shown);
        await expect(page.locator('#myTricks .chip')).toHaveCount(1);
        await expect(page.locator('#statusText')).toHaveText('Your turn — play a card');
        await Promise.all(
          shown.others.map(async (o) => {
            const cell = seatCell(page, o.idx);
            await expect(cell.locator('.seat-cards .card')).toHaveCount(3);
            await expect(cell.locator('.seat-taken')).toHaveAttribute(
              'data-count',
              String(shown.tricks[o.idx]),
            );
          }),
        );
      });
    });

    test('a card dragged by hand (design §5.4): past the threshold the ghost follows the pointer with no tween, the trick lights, over it the trick takes the drop mark, the release plays the card', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await briscolaStartLocal(page, pagePath(project, 'briscola'), vp);
      await briscolaReveal(page);
      const v = await requireView(page);
      const [cardId] = v.legal;
      if (cardId === undefined) throw new Error('the leader has no legal card');
      const card = page.locator(`#hand .card[data-card="${cardId}"]`);
      const trick = page.locator('#trick');
      const ghost = page.locator('.drag-ghost');
      await expect(card).toHaveClass(/\bplayable\b/);
      const from = await card.boundingBox();
      const to = await trick.boundingBox();
      if (from === null || to === null) throw new Error('the card or the trick has no box');
      const grab = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
      await page.mouse.move(grab.x, grab.y);
      await page.mouse.down();
      // Under DRAG_THRESHOLD (8px) the press is a tap in the making: no ghost, nothing lit.
      await page.mouse.move(grab.x + 4, grab.y);
      await expect(ghost).toHaveCount(0);
      await expect(trick).not.toHaveClass(/\bdrop-ready\b/);
      // Past it the drag begins: the reducer lifts the card (`dragging`), the trick shows it may
      // take a drop, and the ghost, the card's clone, sits on the body.
      await page.mouse.move(grab.x + 12, grab.y - 12, { steps: 2 });
      await expect(ghost).toHaveCount(1);
      await expect(card).toHaveClass(/\bdragging\b/);
      await expect(trick).toHaveClass(/\bdrop-ready\b/);
      await expect(trick).not.toHaveClass(DROP);
      // The ghost is on the finger, not tweening toward it: `.card`'s 160ms transform transition,
      // which the clone inherits, is reset on `.drag-ghost`, so right after a move the transform
      // drawn is the translate the kernel wrote (a tween would still be at the old place).
      expect(await ghostLag(page)).toEqual({ transitionProperty: 'none', px: 0 });
      // Over the band it takes the `drop` mark; the ghost is still on the finger.
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
      await expect(trick).toHaveClass(DROP);
      expect(await ghostLag(page)).toEqual({ transitionProperty: 'none', px: 0 });
      // Released there: the card is played (no glide: the repaint places it), the ghost is gone,
      // the marks are cleared.
      await page.mouse.up();
      await expect(page.locator(`#trick .card[data-card="${cardId}"]`)).toHaveCount(1);
      expect(await trickShown(page)).toEqual([[cardId, String(v.me.idx)]]);
      await expect(ghost).toHaveCount(0);
      await expect(trick).not.toHaveClass(/\bdrop-ready\b/);
      await expect(page.locator('#hand .card.dragging')).toHaveCount(0);
      expect(await heldCards(page)).not.toContain(cardId);
    });

    test("a seated position plays the last three tricks to the result sheet and the match badge; the running score is the view's", async ({
      player,
      project,
    }) => {
      const { page } = player;
      await briscolaStartLocal(page, pagePath(project, 'briscola'), vp);
      await briscolaReveal(page);
      // Ann holds the asso, tre and re di bastoni against Bob's small coppe; spade is the trump,
      // so nothing trumps and Ann takes 25 from the hands over the deck-order piles (71 and 24).
      const state = briscolaPosition({
        hands: [
          ['AB', '3B', 'RB'],
          ['2C', '4C', '5C'],
        ],
        trumpCard: '7S',
        leader: 0,
      });
      const v = await briscolaSetup(page, state);
      expect(v.me.idx).toBe(0);
      expect(v.stockCount).toBe(0);
      await expect(page.locator('#statusText')).toHaveText('Last three tricks — your turn');
      await expect(page.locator('#stock')).toHaveClass(/\bempty\b/);
      await expect(page.locator('#stock .card')).toHaveCount(0);
      await expect(page.locator('#briscola')).toHaveClass(/\bgone\b/);
      await expect(page.locator('#trumpName')).toHaveText('spade');
      await expectStrip(page, v);
      // The same policy in node gives the expected plays and the game's end.
      const { plays, after } = firstLegalPlays(state, 6);
      expect(plays).toEqual(['AB', '2C', '3B', '4C', 'RB', '5C']);
      expect(after.phase).toBe('over');
      expect(after.result).toEqual({ winner: 0, totals: [96, 24], draw: false });

      // The seated piles are seventeen tricks already, nine Ann's and eight Bob's, and the strips
      // show every one of them: ten and more chips in a row, the step pressed under 6px in Bob's cell.
      expect(v.tricks).toEqual([9, 8]);
      await expectChips(page, v);
      const one = await playTrick(page);
      expect(one.lastTrick?.cards.map((p) => p.card.id)).toEqual(plays.slice(0, 2));
      await expectStrip(page, one);
      // Ann (me, the winner of every trick here) stacks a chip per trick on her nine: ten, then
      // eleven, then twelve; Bob's eight stay.
      expect(one.tricks).toEqual([10, 8]);
      await expectChips(page, one);
      await expect(page.locator('#myTricks .chip')).toHaveCount(10);
      // "Last three tricks" is said once, with the hands full; two cards left is an ordinary turn.
      await expect(page.locator('#statusText')).toHaveText('Your turn — play a card');
      const two = await playTrick(page);
      expect(two.lastTrick?.winner).toBe(0);
      await expectStrip(page, two);
      expect(two.tricks).toEqual([11, 8]);
      await expectChips(page, two);
      await expect(page.locator('#myTricks .chip')).toHaveCount(11);
      const over = await playTrick(page);
      expect(over.phase).toBe('over');
      expect(over.result).toEqual(after.result);
      expect(over.sides).toEqual([96, 24]);
      await expectStrip(page, over);
      expect(over.tricks).toEqual([12, 8]);
      await expectChips(page, over);
      // The result sheet, the badge, the status line all read the result.
      await expect(page.locator('#resultOverlay')).toBeVisible();
      await expect(page.locator('#rsTitle')).toHaveText('Ann wins the game');
      await expect(page.locator('#rsSub')).toHaveText('96–24');
      await expect(page.locator('#rsScore .score-row')).toHaveText([/^Ann\s*96$/, /^Bob\s*24$/]);
      await expect(page.locator('#rsMatch')).toHaveText('Games: Ann 1 · Bob 0 · best of 3');
      await expect(page.locator('#rsNextBtn')).toHaveText('Next game');
      await expect(page.locator('#gameBadge')).toHaveText('Game 1 · 1–0 · best of 3');
      // A look at the table: the sheet closes, the status reads the result, the chip brings it back.
      await page.locator('#rsPeekBtn').click();
      await expect(page.locator('#resultOverlay')).toBeHidden();
      await expect(page.locator('#statusText')).toHaveText('Ann wins 96–24');
      await expect(page.locator('#resultChipBtn')).toBeVisible();
      await page.locator('#resultChipBtn').click();
      await expect(page.locator('#resultOverlay')).toBeVisible();
      // Next game: the deal passes, the badge counts the win, the curtain names the new leader.
      await page.locator('#rsNextBtn').click();
      await expect(page.locator('#resultOverlay')).toBeHidden();
      await expect.poll(async () => (await requireView(page)).gameNo).toBe(2);
      const second = await requireView(page);
      expect(second.dealer).toBe((v.dealer + 1) % 2);
      expect(second.stockCount).toBe(34);
      expect(second.match.wins).toEqual([1, 0]);
      await expect(page.locator('#gameBadge')).toHaveText('Game 2 · 1–0 · best of 3');
      await expect(page.locator('#stockCount')).toHaveText('Stock · 34');
      const curtain = await briscolaCurtain(page);
      expect(curtain.title).toBe(`Pass the phone to ${nameOf(second.players, second.turn)}`);
      expect(curtain.last).toBe(
        `${nameOf(second.players, second.dealer)} dealt · the briscola is the ${cardName(second.trumpCard)}`,
      );
      await expectStrip(page, second);
    });

    test('a game that decides the match: the end screen with Bravi!, one row per game, Rematch', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await briscolaStartLocal(page, pagePath(project, 'briscola'), vp);
      await briscolaReveal(page);
      const state = briscolaPosition({
        hands: [
          ['AB', '3B', 'RB'],
          ['2C', '4C', '5C'],
        ],
        trumpCard: '7S',
        leader: 0,
        wins: [1, 0],
      });
      await briscolaSetup(page, state);
      await expect(page.locator('#gameBadge')).toHaveText('Game 1 · 1–0 · best of 3');
      await playTrick(page);
      await playTrick(page);
      const over = await playTrick(page);
      expect(over.matchOver).toBe(true);
      await expect(page.locator('#endgameScreen')).toBeVisible();
      await expect(page.locator('#tableScreen')).toBeHidden();
      await expect(page.locator('#resultTitle')).toHaveText('Bravi! Ann takes the match 2–0');
      await expect(page.locator('#resultSub')).toHaveText('1 game');
      await expect(page.locator('#matchScore .score-row')).toHaveCount(1);
      await expect(page.locator('#matchScore .score-row')).toContainText('Ann');
      await expect(page.locator('#nextGameBtn')).toHaveText('Rematch');
      await expect(page.locator('#leaveBtn')).toBeVisible();
      const [last] = over.events.slice(-1);
      expect(last?.kind).toBe('result');
      if (last?.kind === 'result') expect(last.data.decided).toBe(true);
    });

    test('history: one short row per event, the last reads summaryOf, a tap expands detailOf, the open row survives a repaint of the same list', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await briscolaStartLocal(page, pagePath(project, 'briscola'), vp);
      const v = await requireView(page);
      const n = v.options.seatCount;
      const settled = await playTrick(page);
      await revealIfCurtain(page);
      const events = await readEvents(page);
      expect(events.map((e) => e.kind)).toEqual(['deal', 'trick']);
      const last = events[events.length - 1];
      if (last === undefined) throw new Error('no event');

      await openHistory(page);
      const rows = await historyRows(page);
      expect(rows.map((r) => r.summary)).toEqual(
        events.map((e) => summaryOf(e, settled.players, n)),
      );
      expect(rows.map((r) => [r.id, r.kind, r.open])).toEqual(
        events.map((e) => [String(e.id), e.kind, false]),
      );
      const trickRow = page.locator(`#historyList .history-row[data-id="${String(last.id)}"]`);
      await expect(trickRow).toHaveAttribute('data-seat', String(settled.lastTrick?.winner));
      await expect(trickRow).toHaveAttribute('data-value', /^(pointless|small|big|huge)$/);
      // A tap on the line expands the detail: label/value pairs from the same event.
      await trickRow.locator('summary').click();
      await expect(trickRow).toHaveJSProperty('open', true);
      expect(await historyDetail(page, last.id)).toEqual(detailOf(last, settled.players, n));
      const [led] = detailOf(last, settled.players, n);
      expect(led?.[0]).toBe('Led');
      // The sheet closed and opened again, a card lifted in between (a repaint of the same list):
      // the row is still open (the list is keyed on its last event).
      await closeHistory(page);
      await page.locator(`#hand .card[data-card="${FIRST_LEGAL(settled)}"]`).click();
      await expect(page.locator('#hand .card.selected')).toHaveCount(1);
      await openHistory(page);
      expect((await historyRows(page)).map((r) => r.open)).toEqual([false, true]);
      await closeHistory(page);
    });

    test("history: the open row survives the next trick (the shared panel appends the new event's row after the ones there)", async ({
      player,
      project,
    }) => {
      // web/shared/ui/history.ts `paintHistory`: under one stream name a new event is appended, so
      // the `<details>` the player opened before the trick is still open when its row arrives.
      const { page } = player;
      await briscolaStartLocal(page, pagePath(project, 'briscola'), vp);
      const v = await requireView(page);
      const n = v.options.seatCount;
      await playTrick(page);
      await revealIfCurtain(page);
      await openHistory(page);
      await page.locator('#historyList .history-row[data-id="1"] summary').click();
      await expect(page.locator('#historyList .history-row[data-id="1"]')).toHaveJSProperty(
        'open',
        true,
      );
      await closeHistory(page);
      const again = await playTrick(page);
      await revealIfCurtain(page);
      const more = await readEvents(page);
      expect(more).toHaveLength(3);
      await openHistory(page);
      const after = await historyRows(page);
      expect(after.map((r) => r.summary)).toEqual(more.map((e) => summaryOf(e, again.players, n)));
      expect(after.map((r) => r.open)).toEqual([false, true, false]);
    });

    test('sound: a briscola taking a big card plays the sting then the win, as phraseOf binds the event; a small trick lost plays nothing', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await briscolaStartLocal(page, pagePath(project, 'briscola'), vp);
      await briscolaReveal(page);
      // Ann leads the 2 di bastoni, a trump; Bob's asso di coppe falls to it (big, no steal: the
      // led suit is the trump's). Then Ann's fante di coppe takes Bob's 5 di denari (small).
      const state = briscolaPosition({
        hands: [
          ['2B', 'FC', '6D'],
          ['AC', '5D', '7S'],
        ],
        trumpCard: '4B',
        leader: 0,
      });
      const v = await briscolaSetup(page, state);
      expect(v.me.idx).toBe(0);
      await spyFx(page);
      // What is not the event's phrase: the lift, the card laid, a draw, and the curtain's turn
      // chime (the shell's `yourTurn` as the phone changes hands).
      const noise = (c: string): boolean =>
        ['tap', 'move.play', 'draw.stock', 'yourTurn'].includes(c);
      const big = await playTrick(page);
      expect(big.lastTrick).toMatchObject({ winner: 0, points: 11 });
      const [bigEvent] = big.events.filter((e) => e.kind === 'trick').slice(-1);
      if (bigEvent?.kind !== 'trick') throw new Error('no trick event');
      expect(bigEvent.data).toMatchObject({ briscola: true, steal: false, valueClass: 'big' });
      const cues = await playedCues(page);
      // Both plays chimed (the phone holder's own), then the event's phrase, step by step in order:
      // the briscola sting first, the big trick's win after.
      expect(cues.filter((c) => c === 'move.play')).toHaveLength(2);
      const phrase = cues.filter((c) => !noise(c));
      const bound = cuesOf(phraseOf(bigEvent, { idx: 0, side: 0 }, 'local'));
      expect(phrase).toEqual(bound);
      expect(phrase[0]).toBe('move.briscola');
      expect(phrase[1]).toMatch(/^(good|great)\.trick\.big/);
      expect(phrase).toHaveLength(2);

      // A small trick: the shared phone hears the winner's cell, never a loss; its loser online
      // hears nothing (the same event, bound for seat 1).
      await clearCues(page);
      const small = await playTrick(page);
      expect(small.lastTrick).toMatchObject({ winner: 0, points: 2 });
      const [smallEvent] = small.events.filter((e) => e.kind === 'trick').slice(-1);
      if (smallEvent?.kind !== 'trick') throw new Error('no trick event');
      expect(smallEvent.data.valueClass).toBe('small');
      const smallCues = (await playedCues(page)).filter((c) => !noise(c));
      expect(smallCues).toEqual(cuesOf(phraseOf(smallEvent, { idx: 0, side: 0 }, 'local')));
      expect(smallCues.length).toBeGreaterThan(0);
      expect(smallCues.some((c) => c.startsWith('bad.'))).toBe(false);
      expect(phraseOf(smallEvent, { idx: 1, side: 1 }, 'guest')).toBeNull();
      expect(phraseOf(smallEvent, { idx: 1, side: 1 }, 'host')).toBeNull();
      // The big trick's loser online hears a loss and no briscola step.
      const lost = cuesOf(phraseOf(bigEvent, { idx: 1, side: 1 }, 'guest'));
      expect(lost.length).toBeGreaterThan(0);
      expect(lost.every((c) => c.startsWith('bad.'))).toBe(true);
    });
  });
});

// ---- card names (docs/design/language-packs.md §5) --------------------------------------------------

const IT = langByName('it');
const EN = langByName('en');
const LANG_KEY = 'briscola_lang';
const named = (lang: typeof IT, id: string): string => packName(lang, 'italian40', id) ?? '';

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(`${name} card names`, () => {
    test('every play wears its caption and the briscola its line, in Italian then in English through the hook; a tap on the briscola opens the card view', async ({
      player,
      project,
    }) => {
      const { page } = player;
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await briscolaStartLocal(page, pagePath(project, 'briscola'), vp);
      const v = await requireView(page);
      expect(await page.evaluate('window.__briscola.langName()')).toBe('it');
      expect(await page.evaluate(`localStorage.getItem('${LANG_KEY}')`)).toBeNull();
      // The briscola's line under the stock, and its face labelled, in Italian.
      await expect(page.locator('#briscolaName')).toHaveText(named(IT, v.trumpCard.id));
      await expect(page.locator('#briscolaName')).toHaveText(/ di /);
      await expect(page.locator('#briscola .card')).toHaveAttribute(
        'aria-label',
        named(IT, v.trumpCard.id),
      );
      // A card played: its caption under the chip.
      await briscolaReveal(page);
      const first = FIRST_LEGAL(v);
      await playCard(page, first);
      await expect(page.locator('#trick .play .card-name')).toHaveText([named(IT, first)]);
      await expect(page.locator(`#trick .card[data-card="${first}"]`)).toHaveAttribute(
        'aria-label',
        named(IT, first),
      );
      // The hook switches the language live and remembers it: the caption and the line read English.
      await page.evaluate("window.__briscola.lang('en')");
      expect(await page.evaluate('window.__briscola.langName()')).toBe('en');
      expect(await page.evaluate(`localStorage.getItem('${LANG_KEY}')`)).toBe('en');
      await expect(page.locator('#trick .play .card-name')).toHaveText([named(EN, first)]);
      await expect(page.locator('#trick .play .card-name')).toHaveText([/ of /]);
      await expect(page.locator('#briscolaName')).toHaveText(named(EN, v.trumpCard.id));
      // A stranger is refused with one line; nothing changes.
      await page.evaluate("window.__briscola.lang('fr')");
      expect(errors).toEqual([
        'briscola_lang: "fr" is not a language pack; kept the current one. One of: it, en, en-plates.',
      ]);
      expect(await page.evaluate('window.__briscola.langName()')).toBe('en');
      // The briscola tapped (the exchange is off): the card view shows it large and named; Close puts it away.
      await revealIfCurtain(page);
      await page.locator('#briscola .card').click();
      await expect(page.locator('#cardViewOverlay')).toBeVisible();
      await expect(page.locator('#cardViewFace .card')).toHaveAttribute(
        'data-card',
        v.trumpCard.id,
      );
      await expect(page.locator('#cardViewName')).toHaveText(named(EN, v.trumpCard.id));
      const face = await page.locator('#cardViewFace .card').boundingBox();
      expect(face?.width ?? 0).toBeGreaterThanOrEqual(Math.min(240, vp.width * 0.6) - 1);
      await page.locator('#closeCardViewBtn').click();
      await expect(page.locator('#cardViewOverlay')).toBeHidden();
      // Escape closes it too.
      await page.locator('#briscola .card').click();
      await expect(page.locator('#cardViewOverlay')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#cardViewOverlay')).toBeHidden();
      // A stored stranger is logged at boot and dropped: Italian stands.
      await page.evaluate(`localStorage.setItem('${LANG_KEY}', 'tartan')`);
      await page.reload();
      await expect(
        page.locator('#homeScreen, #tableScreen, #curtainOverlay').first(),
      ).toBeVisible();
      await expect.poll(() => errors.length).toBe(2);
      expect(errors[1]).toContain('"tartan" is not a language pack');
      expect(await page.evaluate(`localStorage.getItem('${LANG_KEY}')`)).toBeNull();
    });
  });
});

test.describe('desktop card tip', () => {
  test('a hover over a hand card shows its Italian name after the delay; the hook switches it to English; leaving hides it', async ({
    player,
    project,
  }) => {
    const { page } = player;
    await briscolaStartLocal(page, pagePath(project, 'briscola'), DESKTOP);
    await briscolaReveal(page);
    const v = await requireView(page);
    const first = FIRST_LEGAL(v);
    const tip = page.locator('#cardTip');
    await expect(tip).toBeHidden();
    await page.locator(`#hand .card[data-card="${first}"]`).hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(named(IT, first));
    await expect(tip).toHaveText(/ di /);
    await expect(tip).toHaveAttribute('data-card', first);
    // Over the card, above it: the tip's box ends where the card's begins.
    const card = await page.locator(`#hand .card[data-card="${first}"]`).boundingBox();
    const box = await tip.boundingBox();
    expect(box).not.toBeNull();
    expect(card).not.toBeNull();
    if (box !== null && card !== null) {
      expect(box.y + box.height).toBeLessThanOrEqual(card.y + 1);
      expect(Math.abs(box.x + box.width / 2 - (card.x + card.width / 2))).toBeLessThanOrEqual(2);
    }
    await page.evaluate("window.__briscola.lang('en')");
    await expect(tip).toHaveText(named(EN, first));
    await expect(tip).toHaveText(/ of /);
    // The pointer leaves the hand: the tip goes.
    await page.mouse.move(8, 8);
    await expect(tip).toBeHidden();
    // The face-up briscola wiggles out of the deck on hover: a transform beyond the rest.
    // The harness has no DOM types (tsconfig.node.json): the style is read by source, as the hooks are.
    const transform = (): Promise<string> =>
      page.evaluate<string>(
        "getComputedStyle(document.querySelector('#briscola .card')).transform",
      );
    const before = await transform();
    await page.locator('#briscola .card').hover();
    await expect.poll(transform).not.toBe(before);
  });
});
