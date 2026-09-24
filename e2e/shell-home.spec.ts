// The shell's home screen on both shell games (docs/design/shared-shell.md §6.3), at a phone and a
// laptop: the title and the heading, the tab bar (theme.css "top tabs") with Play active, Online the
// default mode and pass and play beside it, the mode pick and the tab picks persisted under the
// game's own keys (`<prefix>playMode`, `<prefix>homeTab`), the pass-and-play panel's fields at their
// defaults, Rules and About. The Play tab's submenu opens two ways: a long press (650 ms),
// `#playSubmenu.force-open`, its pick landing on the Play tab in that mode; and on a desktop a hover
// from another tab, where the pointer can cross the gap down onto an option without the menu
// closing (the regression: a 6px gap under the tab lost the hover and the hidden menu's
// pointer-events: none kept it hidden), while on the Play tab the mode switch is the bar's second
// row and the hover menu stays away. What a game's own panel adds (backgammon's online selects, its
// rules count) stays in that game's spec. Page-only: about the page, not its origin. Each game's
// describe carries the game's tag (`@gin-rummy`, `@backgammon`): tools/ci/suites.ts assigns the
// describe to that game's e2e job by it, and a CLI --grep composes with it.
import type { Page } from '@playwright/test';

import { REGISTRY, SHELL, SHELL_GAMES } from '../tools/games.ts';
import { DESKTOP, PHONE, type Viewport } from './fixtures/geometry.ts';
import { DEFAULT_NAME, readPref } from './fixtures/shell.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const VIEWPORTS: Readonly<Record<string, Viewport>> = { phone: PHONE, desktop: DESKTOP };

/** Hold the pointer on the Play tab past the long-press timer: the submenu opens (backgammon-board.md §5.1). */
const longPressPlay = async (page: Page): Promise<void> => {
  const tab = page.locator('#tabPlayBtn');
  const box = await tab.boundingBox();
  if (box === null) throw new Error('the Play tab has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
};

SHELL_GAMES.forEach((game) => {
  test.describe(game, { tag: `@${game}` }, () => {
    const spec = REGISTRY[game];
    const shell = SHELL[game];

    Object.entries(VIEWPORTS).forEach(([name, vp]) => {
      test.describe(name, () => {
        test('home: the title, the heading, the tab bar; Online the default, pass and play beside it, the pick persisted; the tabs', async ({
          player,
          project,
        }) => {
          const { page } = player;
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(pagePath(project, game));
          await expect(page).toHaveTitle(spec.title);
          await expect(page.locator('#homeScreen h1')).toHaveText(shell.heading);
          await expect(page.locator('#topTabbar .tab-btn')).toHaveText(shell.tabs);
          await expect(page.locator('#tabPlayBtn')).toHaveClass(/\bactive\b/);
          // Online is the default mode (storage.ts DEFAULT_PLAY_MODE in both games): its panel is up
          // with the name; the switch flips to pass and play, and the pick is remembered.
          await expect(page.locator('#playModeSwitch')).toBeVisible();
          await expect(page.locator('#playModeSwitch .mode-btn')).toHaveText(shell.modes);
          await expect(page.locator('#playModeSwitch .mode-btn[data-mode="online"]')).toHaveClass(
            /\bactive\b/,
          );
          await expect(page.locator('#onlineModeContent')).toBeVisible();
          await expect(page.locator('#localModeContent')).toBeHidden();
          await expect(page.locator('#nameInput')).toHaveValue(DEFAULT_NAME);
          await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
          await expect(page.locator('#localModeContent')).toBeVisible();
          await expect(page.locator('#onlineModeContent')).toBeHidden();
          await expect(page.locator('#playModeSwitch .mode-btn[data-mode="local"]')).toHaveClass(
            /\bactive\b/,
          );
          await expect.poll(() => readPref(page, game, 'playMode')).toBe('local');
          // The second seat starts empty (an empty name plays as the page's placeholder), and the
          // panel's own fields at their defaults.
          await expect(page.locator('#p2NameInput')).toHaveValue('');
          await Promise.all(
            shell.localFields.map(([id, value]) =>
              expect(page.locator(`#${id}`)).toHaveValue(value),
            ),
          );
          await page.locator('#tabRulesBtn').click();
          await expect(page.locator('#rulesPanel')).toBeVisible();
          await expect.poll(() => readPref(page, game, 'homeTab')).toBe('rules');
          await page.locator('#tabAboutBtn').click();
          await expect(page.locator('#aboutPanel')).toBeVisible();
          await expect(page.locator('#playPanel')).toBeHidden();
          await expect.poll(() => readPref(page, game, 'homeTab')).toBe('about');
        });

        test('home: a long press on Play opens the submenu; its options are the modes; a pick lands on the Play tab', async ({
          player,
          project,
        }) => {
          const { page } = player;
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(pagePath(project, game));
          await page.locator('#tabRulesBtn').click();
          await expect(page.locator('#rulesPanel')).toBeVisible();
          const submenu = page.locator('#playSubmenu');
          await longPressPlay(page);
          await expect(submenu).toHaveClass(/\bforce-open\b/);
          await expect(submenu.locator('button')).toHaveText(shell.modes);
          await expect(submenu.locator('button[data-mode="online"]')).toBeVisible();
          await expect(submenu.locator('button[data-mode="local"]')).toBeVisible();
          await submenu.locator('button[data-mode="local"]').click();
          await expect(submenu).not.toHaveClass(/\bforce-open\b/);
          await expect(page.locator('#playPanel')).toBeVisible();
          await expect(page.locator('#localModeContent')).toBeVisible();
          await expect(page.locator('#tabPlayBtn')).toHaveClass(/\bactive\b/);
        });
      });
    });

    test('home: hover Play from Rules, walk down onto pass and play, pick it', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
      await page.goto(pagePath(project, game));
      await page.locator('#tabRulesBtn').click();
      await expect(page.locator('#rulesPanel')).toBeVisible();
      const submenu = page.locator('#playSubmenu');
      await expect(submenu).toBeHidden();
      const tab = page.locator('#tabPlayBtn');
      await tab.hover();
      await expect(submenu).toBeVisible();

      // One pixel at a time from the tab's bottom edge to the middle of the second option.
      const option = submenu.locator('button[data-mode="local"]');
      const tabBox = await tab.boundingBox();
      const optionBox = await option.boundingBox();
      if (tabBox === null || optionBox === null) throw new Error('tab or option has no box');
      const x = tabBox.x + 24;
      const from = tabBox.y + tabBox.height - 1;
      const to = optionBox.y + optionBox.height / 2;
      await page.mouse.move(x, from);
      await page.mouse.move(x, to, { steps: Math.ceil(to - from) });
      await expect(submenu).toBeVisible();
      await expect(option).toHaveClass(/^(?!.*active)/);

      await option.click();
      await expect(page.locator('#playPanel')).toBeVisible();
      await expect(page.locator('#localModeContent')).toBeVisible();
      await expect(page.locator('#playModeSwitch .mode-btn[data-mode="local"]')).toHaveClass(
        /active/,
      );
      // On the Play tab the mode row is the menu: the pointer still sits under the tab, nothing opens.
      await expect(submenu).toBeHidden();
      await tab.hover();
      await expect(submenu).toBeHidden();
    });
  });
});
