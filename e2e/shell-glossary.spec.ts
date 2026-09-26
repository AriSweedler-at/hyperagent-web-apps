// Glossary links on both shell games' pages (docs/design/glossary-links.md §4; dry-round-2.md I4),
// at a phone and a laptop: a tap on a jargon word in the About copy ("knocks" on gin, "gammon" on
// backgammon) lands on the Rules tab with that rule in the viewport and flashing, and the address
// bar untouched; a tap on jargon inside a rule moves to that rule; the tab choice is remembered
// across a reload like a tap on the tab itself; a `#rule-<id>` deep link at boot opens the Rules
// tab at that rule with the hash kept; and over a table, jargon inside the rules overlay moves
// within the overlay, the home screen staying hidden. The words, the rule ids and the way to a
// table's rules overlay are the game's `glossary` row in e2e/fixtures/online-games.ts. Page-only:
// both origins serve the same bytes. Tagged per game (see shell-home.spec.ts).
import type { Page } from '@playwright/test';

import { SHELL_GAMES } from '../tools/games.ts';
import { DESKTOP, PHONE, type Viewport } from './fixtures/geometry.ts';
import { SHELL_DRIVERS } from './fixtures/online-games.ts';
import { gamePath } from './fixtures/player.ts';
import { expect, test } from './fixtures/two-players.ts';

const VIEWPORTS: Readonly<Record<string, Viewport>> = { phone: PHONE, desktop: DESKTOP };

/** The rule `id` is on screen in the given rules list and wears the flash. */
const expectRevealed = async (page: Page, list: string, id: string): Promise<void> => {
  const rule = page.locator(`#${list} #rule-${id}`);
  await expect(rule).toBeInViewport();
  await expect(rule).toHaveClass(/\brule-flash\b/);
};

/**
 * The jargon link in rule `from` of the rules list `list` that names rule `to`. A rule may name
 * another by two of its words (backgammon's Goal: "bear them off" and "bear off"; the cube: "cube"
 * and "doubling"), each linked on its first occurrence: the first link is the one tapped.
 */
const innerLink = (page: Page, list: string, from: string, to: string) =>
  page.locator(`#${list} #rule-${from} a.jargon[data-rule="${to}"]`).first();

SHELL_GAMES.forEach((game) => {
  test.describe(game, { tag: `@${game}` }, () => {
    const { glossary } = SHELL_DRIVERS[game];

    Object.entries(VIEWPORTS).forEach(([name, vp]) => {
      test.describe(name, () => {
        test('About: a tap on jargon opens the Rules tab at its rule, flashed; a rule links onward; the tab is remembered', async ({
          player,
          project,
        }) => {
          const { page } = player;
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(gamePath(project, game));
          await page.locator('#tabAboutBtn').click();
          await expect(page.locator('#aboutPanel')).toBeVisible();
          await expect(page.locator('#playPanel')).toBeHidden();
          // The link whose text is the word itself (the rule may be linked under other words too).
          const term = page.locator('#aboutCopy a.jargon', {
            hasText: new RegExp(`^${glossary.aboutTerm}$`),
          });
          await expect(term).toHaveText(glossary.aboutTerm);
          await expect(term).toHaveAttribute('data-rule', glossary.aboutRule);
          await term.click();
          await expect(page.locator('#rulesPanel')).toBeVisible();
          await expect(page.locator('#tabRulesBtn')).toHaveClass(/\bactive\b/);
          await expect(page.locator('#aboutPanel')).toBeHidden();
          await expectRevealed(page, 'rulesList', glossary.aboutRule);
          // The address bar is untouched by a tap (only a deep link carries the hash).
          expect(new URL(page.url()).hash).toBe('');
          // Inside a rule: `innerFrom` names `innerTo`.
          await innerLink(page, 'rulesList', glossary.innerFrom, glossary.innerTo).click();
          await expectRevealed(page, 'rulesList', glossary.innerTo);
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
          await page.goto(`${gamePath(project, game)}#rule-${glossary.deepLink}`);
          await expect(page.locator('#rulesPanel')).toBeVisible();
          await expect(page.locator('#tabRulesBtn')).toHaveClass(/\bactive\b/);
          await expect(page.locator(`#rulesList #rule-${glossary.deepLink}`)).toBeInViewport();
          expect(new URL(page.url()).hash).toBe(`#rule-${glossary.deepLink}`);
        });

        test('over a table, jargon in the rules overlay moves within the overlay', async ({
          player,
          project,
        }) => {
          const { page } = player;
          await glossary.openRulesOverTable(page, gamePath(project, game), vp);
          await expect(page.locator('#rulesOverlay')).toBeVisible();
          await innerLink(
            page,
            'rulesOverlayList',
            glossary.overlayFrom,
            glossary.overlayTo,
          ).click();
          await expect(page.locator('#rulesOverlay')).toBeVisible();
          await expectRevealed(page, 'rulesOverlayList', glossary.overlayTo);
          await expect(page.locator('#homeScreen')).toBeHidden();
        });
      });
    });
  });
});
