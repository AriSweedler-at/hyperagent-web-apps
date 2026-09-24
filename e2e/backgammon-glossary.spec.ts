// Glossary links on the Sheshbesh page (docs/design/glossary-links.md §4), at a phone and a
// laptop: a tap on "gammon" in the About copy lands on the Rules tab with the Scoring rule in the
// viewport and flashing; a `#rule-<id>` deep link at boot opens the Rules tab at that rule; a tap
// on jargon inside a rule (Goal names bearing off) moves to that rule; and over a table the same
// tap opens the rules overlay at the rule. Page-only: both origins serve the same bytes.
import type { Page } from '@playwright/test';

import { bgStartLocal, type Viewport } from './fixtures/backgammon.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

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
    test('About: a tap on "gammon" opens the Rules tab at Scoring, flashed; a rule links onward', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(pagePath(project, 'backgammon'));
      await page.locator('#tabAboutBtn').click();
      await expect(page.locator('#aboutPanel')).toBeVisible();
      const gammon = page.locator('#aboutCopy a.jargon', { hasText: 'gammon' });
      await expect(gammon).toHaveAttribute('data-rule', 'scoring');
      await gammon.click();
      await expect(page.locator('#rulesPanel')).toBeVisible();
      await expect(page.locator('#tabRulesBtn')).toHaveClass(/\bactive\b/);
      await expect(page.locator('#aboutPanel')).toBeHidden();
      await expectRevealed(page, 'rulesList', 'scoring');
      // The address bar is untouched by a tap (only a deep link carries the hash).
      expect(new URL(page.url()).hash).toBe('');
      // Inside a rule: Goal names bearing off.
      await page.locator('#rulesList #rule-goal a.jargon[data-rule="bearing-off"]').click();
      await expectRevealed(page, 'rulesList', 'bearing-off');
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
      await page.goto(`${pagePath(project, 'backgammon')}#rule-blocks`);
      await expect(page.locator('#rulesPanel')).toBeVisible();
      await expect(page.locator('#tabRulesBtn')).toHaveClass(/\bactive\b/);
      await expect(page.locator('#rulesList #rule-blocks')).toBeInViewport();
      expect(new URL(page.url()).hash).toBe('#rule-blocks');
    });

    test('over a table, jargon in the rules overlay moves within the overlay', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp, ['Ann', 'Bob'], {
        variant: 'backgammon',
      });
      // The curtain is up for the starter; its button lifts it, then the menu opens the rules.
      await page.locator('#curtainBtn').click();
      await page.locator('#menuBtn').click();
      await page.locator('#menuRulesBtn').click();
      await expect(page.locator('#rulesOverlay')).toBeVisible();
      // "cube" and "doubling" both point at the cube rule: the first is the word itself.
      await page
        .locator('#rulesOverlayList #rule-crawford a.jargon[data-rule="cube"]')
        .first()
        .click();
      await expect(page.locator('#rulesOverlay')).toBeVisible();
      await expectRevealed(page, 'rulesOverlayList', 'cube');
      await expect(page.locator('#homeScreen')).toBeHidden();
    });
  });
});
