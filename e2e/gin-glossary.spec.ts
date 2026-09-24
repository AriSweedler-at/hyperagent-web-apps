// Glossary links on the Gin Rummy page (docs/design/glossary-links.md §4), at a phone and a
// laptop: the tab bar holds Play, Rules, Score and About and fits the phone's width; a tap on
// "knock" in the About copy lands on the Rules tab with the Knock rule in the viewport and
// flashing; a `#rule-<id>` deep link at boot opens the Rules tab at that rule; and over a table,
// jargon inside the rules overlay moves within the overlay. Page-only: both origins serve the
// same bytes.
import type { Page } from '@playwright/test';

import { ginStartLocal } from './fixtures/gin.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

type Viewport = Readonly<{ width: number; height: number }>;
const VIEWPORTS: Readonly<Record<string, Viewport>> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

/** The rule `id` is on screen in the given rules list and wears the flash. */
const expectRevealed = async (page: Page, list: string, id: string): Promise<void> => {
  const rule = page.locator(`#${list} #rule-${id}`);
  await expect(rule).toBeInViewport();
  await expect(rule).toHaveClass(/\brule-flash\b/);
};

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test('the four tabs fit the bar; About: a tap on "knock" opens Rules at Knock, flashed; a rule links onward', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(pagePath(project, 'gin-rummy'));
      await expect(page.locator('#topTabbar .tab-btn')).toHaveText([
        'Play',
        'Rules',
        'Score',
        'About',
      ]);
      // Nothing overflows the bar: every tab's box lies inside it.
      const bar = await page.locator('#topTabbar').boundingBox();
      // A string expression: the e2e project has no DOM types.
      const boxes = await page.evaluate<
        ReadonlyArray<Readonly<{ left: number; right: number; overflows: boolean }>>
      >(
        `Array.from(document.querySelectorAll('#topTabbar .tab-btn')).map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, overflows: el.scrollWidth > el.clientWidth };
        })`,
      );
      if (bar === null) throw new Error('the tab bar has no box');
      expect(boxes).toHaveLength(4);
      boxes.forEach((b) => {
        expect(b.left).toBeGreaterThanOrEqual(bar.x - 0.5);
        expect(b.right).toBeLessThanOrEqual(bar.x + bar.width + 0.5);
        expect(b.overflows).toBe(false);
      });

      await page.locator('#tabAboutBtn').click();
      await expect(page.locator('#aboutPanel')).toBeVisible();
      await expect(page.locator('#playPanel')).toBeHidden();
      const knock = page.locator('#aboutCopy a.jargon[data-rule="knock"]').first();
      await expect(knock).toHaveText('knocks');
      await knock.click();
      await expect(page.locator('#rulesPanel')).toBeVisible();
      await expect(page.locator('#tabRulesBtn')).toHaveClass(/\bactive\b/);
      await expect(page.locator('#aboutPanel')).toBeHidden();
      await expectRevealed(page, 'rulesList', 'knock');
      // The address bar is untouched by a tap (only a deep link carries the hash).
      expect(new URL(page.url()).hash).toBe('');
      // Inside a rule: Knock names deadwood.
      await page.locator('#rulesList #rule-knock a.jargon[data-rule="deadwood"]').click();
      await expectRevealed(page, 'rulesList', 'deadwood');
      // The tab choice is remembered like a tap on the tab itself.
      await page.reload();
      await expect(page.locator('#rulesPanel')).toBeVisible();
    });

    test('a #rule-<id> deep link at boot opens the Rules tab at that rule', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${pagePath(project, 'gin-rummy')}#rule-undercut`);
      await expect(page.locator('#rulesPanel')).toBeVisible();
      await expect(page.locator('#tabRulesBtn')).toHaveClass(/\bactive\b/);
      await expect(page.locator('#rulesList #rule-undercut')).toBeInViewport();
      expect(new URL(page.url()).hash).toBe('#rule-undercut');
    });

    test('over a table, jargon in the rules overlay moves within the overlay', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await ginStartLocal(page, pagePath(project, 'gin-rummy'), vp);
      await page.locator('#rulesBtnGame').click();
      await expect(page.locator('#rulesOverlay')).toBeVisible();
      await page.locator('#rulesOverlayList #rule-gin a.jargon[data-rule="layoff"]').click();
      await expect(page.locator('#rulesOverlay')).toBeVisible();
      await expectRevealed(page, 'rulesOverlayList', 'layoff');
      await expect(page.locator('#homeScreen')).toBeHidden();
    });
  });
});
