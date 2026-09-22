// The home screen's tab bar (theme.css "top tabs"): on a desktop, hovering the Play tab from
// another tab opens its submenu, the pointer can cross the gap down onto an option without the
// menu closing (the regression: a 6px gap under the tab lost the hover and the hidden menu's
// pointer-events: none kept it hidden), and a pick lands on the Play tab in that mode, where the
// mode switch is the bar's second row and the hover menu stays away.
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

test('home: hover Play from Rules, walk down onto Pass & Play, pick it', async ({
  player,
  project,
}) => {
  const { page } = player;
  await page.goto(pagePath(project, 'gin-rummy'));
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
  await expect(page.locator('#playModeSwitch .mode-btn[data-mode="local"]')).toHaveClass(/active/);
  // On the Play tab the mode row is the menu: the pointer still sits under the tab, nothing opens.
  await expect(submenu).toBeHidden();
  await tab.hover();
  await expect(submenu).toBeHidden();
});
