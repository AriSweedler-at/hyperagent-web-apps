// The arrangement controls over catalogued states (docs/design/gin-arrangement-and-discards.md
// §5, §11; the owner's 2026-09-21 additions), through the `?story=<id>&live` hook, which binds
// the page's controls to the reducer over the story's App and drops every effect: the meld
// chooser (a pick changes exactly one group set and sticks), the Arrange sheet (a sort mode
// rearranges at once and marks itself active), and the long press (a meld made by hand, marked,
// and dissolved by a second press). Both viewports; `pages` only, the same bytes on both origins.
import { expect, test, type Page } from '@playwright/test';

import { storyById } from '../web/games/gin-rummy/src/stories/catalogue.ts';
import { expectHandRows, ginLongPress } from './fixtures/gin.ts';
import { ALLOWED_FAILURES } from './fixtures/offline.ts';
import { pagePath } from './fixtures/site.ts';
import { watchPage } from './fixtures/watch.ts';

/** The card ids of each `.group`, in order. */
const GROUPS = `Array.from(document.querySelectorAll('#hand .group')).map((g) => Array.from(g.querySelectorAll('.card')).map((c) => c.getAttribute('data-card')))`;
/** The card ids of the loose (`.slot.dead` outside a group) cells, in order. */
const LOOSE = `Array.from(document.querySelectorAll('#hand > .slot.dead .card')).map((c) => c.getAttribute('data-card'))`;
const HUMAN = `Array.from(document.querySelectorAll('#hand .slot.human .card')).map((c) => c.getAttribute('data-card'))`;
type Ids = ReadonlyArray<string>;

const openLive = async (page: Page, id: string): Promise<void> => {
  await page.goto(`${pagePath('pages', 'gin-rummy')}?story=${id}&live`);
  await expect(page.locator('#tableScreen')).toBeVisible();
  await expect(page.locator('#hand .slot')).toHaveCount(11);
};

const VIEWPORTS = {
  phone: { width: 390, height: 844, columns: 6 },
  desktop: { width: 1280, height: 800, columns: 11 },
} as const;

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('the meld chooser: a pick moves only its groups and stays after the sheet closes', async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'pages', 'runs once: the same bytes on both origins');
      const watched = watchPage(page, ALLOWED_FAILURES);
      const story = storyById('accepted-two-ways');
      const options = story?.app.view?.meldOptions ?? [];
      expect(options.length).toBeGreaterThanOrEqual(2);
      await openLive(page, 'accepted-two-ways');
      await expect(page.locator('#deadwoodInfo .alt-badge')).toHaveText(
        `⇄ ${String(options.length)} ways`,
      );
      await expect(page.locator('#deadwoodInfo')).toHaveClass(/tappable-dw/);

      await page.locator('#deadwoodInfo').click();
      await expect(page.locator('#meldOverlay')).toBeVisible();
      await expect(page.locator('#meldOptionList .rr-panel')).toHaveCount(options.length);
      await expect(page.locator('#meldOptionList .rr-panel', { hasText: '(in use)' })).toHaveCount(
        1,
      );
      // The option not in use: only that one carries the "Use this arrangement" button.
      const active = story?.app.view?.activeMeldSig;
      const pick = options.findIndex((o) => o.sig !== active);
      const chosen = options[pick];
      if (chosen === undefined) throw new Error('every option is in use');
      await page.locator(`#meldOptionList [data-meld-opt="${String(pick)}"]`).click();
      await expect(page.locator('#meldOverlay')).toBeHidden();
      // The pick is the arrangement now: its melds are the groups, hand-made, and Arrange is idle.
      const groups = await page.evaluate<ReadonlyArray<Ids>>(GROUPS);
      expect(groups.map((g) => [...g].sort())).toEqual(
        chosen.melds.map((m) => m.map((c) => c.id).sort()),
      );
      expect(await page.evaluate<Ids>(HUMAN)).toEqual(groups.flat());
      await expect(page.locator('#arrangeBtn')).not.toHaveClass(/due/);
      await expectHandRows(page, vp.columns);
      await page.locator('#deadwoodInfo').click();
      await expect(
        page.locator('#meldOptionList .rr-panel', { hasText: '(in use)' }).locator('.rr-head'),
      ).toContainText(`Option ${String(pick + 1)}`);
      await page.locator('#closeMeldBtn').click();
      await expect(page.locator('#meldOverlay')).toBeHidden();
      expect(await page.evaluate<ReadonlyArray<Ids>>(GROUPS)).toEqual(groups);
      expect(watched.errors(), 'uncaught exceptions').toEqual([]);
    });

    test('the Arrange sheet: a sort mode rearranges the loose cards at once and is marked active; manual keeps them', async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'pages', 'runs once: the same bytes on both origins');
      const watched = watchPage(page, ALLOWED_FAILURES);
      await openLive(page, 'accepted-fresh');
      await expect(page.locator('#arrangeBtn')).toHaveClass(/due/);
      const story = storyById('sorted-by-rank');
      const hand = story?.app.view?.me.hand ?? [];
      const rankOf = new Map(hand.map((c) => [c.id, c.r]));
      const suitOf = new Map(hand.map((c) => [c.id, 'SHDC'.indexOf(c.s)]));

      await page.locator('#arrangeBtn').click();
      await expect(page.locator('#arrangeOverlay')).toBeVisible();
      await expect(page.locator('#arrangeModes .btn.active')).toHaveAttribute('data-sort', 'suit');
      await page.locator('#arrangeModes [data-sort="rank"]').click();
      await expect(page.locator('#arrangeOverlay')).toBeHidden();
      await expect(page.locator('#arrangeBtn')).not.toHaveClass(/due/);
      const byRank = (await page.evaluate<Ids>(LOOSE)).map((id) => rankOf.get(id) ?? 0);
      expect([...byRank].sort((a, b) => a - b)).toEqual(byRank);
      await expectHandRows(page, vp.columns);

      await page.locator('#arrangeBtn').click();
      await expect(page.locator('#arrangeModes .btn.active')).toHaveAttribute('data-sort', 'rank');
      await page.locator('#arrangeModes [data-sort="suit"]').click();
      const bySuit = (await page.evaluate<Ids>(LOOSE)).map((id) => suitOf.get(id) ?? 0);
      expect([...bySuit].sort((a, b) => a - b)).toEqual(bySuit);

      // The melds never move: the same groups in the same order under every mode.
      const arranged = storyById('arranged-after-accept');
      expect(await page.evaluate<ReadonlyArray<Ids>>(GROUPS)).toEqual(
        (arranged?.app.picture?.groups ?? []).map((g) => g.map((c) => c.id)),
      );
      // Manual keeps the loose cards exactly where they are.
      const loose = await page.evaluate<Ids>(LOOSE);
      await page.locator('#arrangeBtn').click();
      await page.locator('#arrangeModes [data-sort="manual"]').click();
      await expect(page.locator('#arrangeOverlay')).toBeHidden();
      expect(await page.evaluate<Ids>(LOOSE)).toEqual(loose);
      await page.locator('#arrangeBtn').click();
      await expect(page.locator('#arrangeModes .btn.active')).toHaveAttribute(
        'data-sort',
        'manual',
      );
      await page.locator('#closeArrangeBtn').click();
      expect(watched.errors(), 'uncaught exceptions').toEqual([]);
    });

    test('a long press makes a meld by hand and marks it; a second press dissolves it; a card that melds nothing toasts', async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'pages', 'runs once: the same bytes on both origins');
      const watched = watchPage(page, ALLOWED_FAILURES);
      const story = storyById('human-meld');
      const expected = story?.facts.human ?? [];
      expect(expected.length).toBeGreaterThanOrEqual(3);
      const first = expected[0] ?? '';
      await openLive(page, 'accepted-two-ways');
      expect(await page.evaluate<Ids>(HUMAN)).toEqual([]);

      await ginLongPress(page, first);
      await expect(page.locator('#hand .slot.human .card')).toHaveCount(expected.length);
      expect(await page.evaluate<Ids>(HUMAN)).toEqual(expected);
      // The click after the press selected nothing.
      await expect(page.locator('#hand .card.selected')).toHaveCount(0);
      await expectHandRows(page, vp.columns);

      await ginLongPress(page, first);
      await expect(page.locator('#hand .slot.human')).toHaveCount(0);
      await expect(page.locator('#hand .card.selected')).toHaveCount(0);

      // A loose card that joins no meld: the toast, nothing marked.
      const loose = story?.app.picture?.loose ?? [];
      const alone = loose.find((c) => {
        const held = story?.app.view?.me.hand ?? [];
        const sameRank = held.filter((o) => o.r === c.r).length;
        const neighbours = held.filter((o) => o.s === c.s && Math.abs(o.r - c.r) === 1).length;
        return sameRank < 3 && neighbours === 0;
      });
      if (alone !== undefined) {
        await ginLongPress(page, alone.id);
        await expect(page.locator('#toast')).toHaveText('No meld to make with that card.');
        await expect(page.locator('#hand .slot.human')).toHaveCount(0);
      }
      // A plain tap still selects.
      await page.locator(`#hand .card[data-card="${first}"]`).click();
      await expect(page.locator(`#hand .card[data-card="${first}"]`)).toHaveClass(/selected/);
      expect(watched.errors(), 'uncaught exceptions').toEqual([]);
    });
  });
});
