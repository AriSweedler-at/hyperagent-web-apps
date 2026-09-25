// The table's geometry as a real-click test (docs/design/briscola.md §5.6 "Geometry oracle"):
// pass-and-play on one page at a phone and a laptop for two, three and four seats. At every state
// of a trick (under the first curtain, revealed, a card lifted, one card played with the next
// curtain up, the whole trick held and settled) every hand card sits in its slot and the three
// slots are one size, disjoint and left to right inside `#hand`; every
// unrotated card has the pack's aspect (`--aspect` on `#tableScreen`) to 2% and a hand card is as
// wide as ui/layout.ts (the CSS's pure twin) predicts for the viewport; the briscola lies across
// under the stock, its box the stock's swapped, 40-60% hidden; the fan's cards sit inside `#trick`
// left to right and rising in z; the taken strips hold a chip per trick inside their cells, the
// winner's one chip after the first trick; every tap target is at least 44px on a phone; nothing scrolls
// where the twin says the column fits; and the frame around the cards (topbar, seats, centre band,
// strip, status line, hand area, actions) keeps the boxes it had at the start.
import {
  LOCAL_NAMES,
  briscolaCurtain,
  briscolaReveal,
  briscolaStartLocal,
  expectTableGeometry,
  playCard,
  playTrick,
  requireView,
  tableGeometry,
  FIRST_LEGAL,
  type Viewport,
} from './fixtures/briscola.ts';
import { DESKTOP, PHONE, expectSameFrame, type Frame } from './fixtures/geometry.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const VIEWPORTS: Readonly<Record<string, Viewport>> = { phone: PHONE, desktop: DESKTOP };

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    ([2, 3, 4] as const).forEach((n) => {
      test(`${String(n)} seats: the cards keep the pack's shape in their slots, the briscola lies under the stock, the fan rises, targets are 44px, nothing clips, the frame holds`, async ({
        player,
        project,
      }) => {
        const { page } = player;
        await briscolaStartLocal(page, pagePath(project, 'briscola'), vp, LOCAL_NAMES[n]);
        const start = await tableGeometry(page);
        expect(start.players).toBe(n);
        expect(start.aspect).toBeGreaterThan(0);
        expectTableGeometry(start, 'curtain');
        const check = async (when: string): Promise<Frame> => {
          const g = await tableGeometry(page);
          expectTableGeometry(g, when);
          expectSameFrame(g.frame, start.frame, when);
          return g.frame;
        };

        // Revealed: three face-up cards; a lift raises one without moving the other two.
        await briscolaReveal(page);
        const revealed = await tableGeometry(page);
        expectTableGeometry(revealed, 'revealed');
        expectSameFrame(revealed.frame, start.frame, 'revealed');
        expect(revealed.handCards).toHaveLength(3);
        const v = await requireView(page);
        const first = FIRST_LEGAL(v);
        await page.locator(`#hand .card[data-card="${first}"]`).click();
        await expect(page.locator(`#hand .card[data-card="${first}"]`)).toHaveClass(/\bselected\b/);
        const lifted = await tableGeometry(page);
        expectTableGeometry(lifted, 'lifted');
        expectSameFrame(lifted.frame, start.frame, 'lifted');
        lifted.handCards.forEach((c) => {
          const before = revealed.handCards.find((b) => b.id === c.id);
          expect(before, `card ${String(c.id)} before the lift`).toBeDefined();
          if (before === undefined) return;
          expect(Math.abs(c.box.x - before.box.x)).toBeLessThanOrEqual(0.5);
          if (c.id === first) expect(c.box.y).toBeLessThan(before.box.y - 4);
          else expect(Math.abs(c.box.y - before.box.y)).toBeLessThanOrEqual(0.5);
        });

        // One card played: the fan holds it, the next seat's curtain is up, two slots stayed put.
        await page.locator('#playBtn').click();
        await expect(page.locator(`#trick .card[data-card="${first}"]`)).toHaveCount(1);
        await briscolaCurtain(page);
        const played = await tableGeometry(page);
        expectTableGeometry(played, 'one played');
        expectSameFrame(played.frame, start.frame, 'one played');
        expect(played.plays).toHaveLength(1);
        expect(played.handCards).toHaveLength(3);

        // The whole trick, held: the fan is full, then settled: the fan is empty, the stock shorter.
        await playTrick(page);
        await check('settled');
        const settled = await requireView(page);
        expect(settled.trickNo).toBe(1);
        await expect(page.locator('#trick .play')).toHaveCount(0);
        if (await page.locator('#curtainOverlay').isVisible()) await briscolaReveal(page);
        const after = await tableGeometry(page);
        expectTableGeometry(after, 'winner revealed');
        expectSameFrame(after.frame, start.frame, 'winner revealed');
        // The taken trick is one chip in the winner's strip (the phone is in the winner's hands
        // now, so the strip is mine) and none anywhere else; the frame did not move for it.
        const winner = await requireView(page);
        expect(winner.me.idx).toBe(settled.lastTrick?.winner);
        const mine = after.strips.find((s) => s.id === 'myTricks');
        expect(mine?.count).toBe(1);
        expect(mine?.chips).toHaveLength(1);
        after.strips
          .filter((s) => s.id !== 'myTricks')
          .forEach((s) => {
            expect(s.count, `${s.id} took nothing`).toBe(0);
          });
      });
    });

    test('two seats: the fan through the hold, a second trick and the third seat cell stays hidden', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await briscolaStartLocal(page, pagePath(project, 'briscola'), vp);
      await briscolaReveal(page);
      const start = await tableGeometry(page);
      expectTableGeometry(start, 'revealed');
      // The trick is played card by card and the fan measured with both cards on the table (the
      // hold keeps them for 900ms: the read lands inside it).
      const v = await requireView(page);
      await playCard(page, FIRST_LEGAL(v));
      await briscolaReveal(page);
      const second = await requireView(page);
      await playCard(page, FIRST_LEGAL(second));
      const held = await tableGeometry(page, true);
      expect(held.plays).toHaveLength(2);
      expectTableGeometry(held, 'held');
      expectSameFrame(held.frame, start.frame, 'held');
      await expect(page.locator('#seats .seat:not([hidden])')).toHaveCount(1);
      await expect(page.locator('#seatR2')).toBeVisible();
      await expect(page.locator('#seatR1')).toBeHidden();
      await expect(page.locator('#seatR3')).toBeHidden();
    });
  });
});
