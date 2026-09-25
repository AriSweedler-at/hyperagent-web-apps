// The sandbox (docs/design/gin-sandbox.md): hidden until the first player is named "sandbox",
// then a third play mode whose map deals a pass-and-play game exactly as written. A preset deals
// its hand and its pile; a bad map says what is wrong and deals nothing; the console's
// `__gin.sandbox(map)` deals too, with the stock's named top the next draw, and
// `__gin.sandboxMap()` reads the table back as a map.
import { reveal } from './fixtures/shell.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const TWO_WAYS = '6S 7S 8S 7H 7D 2C 9H JD QC KH';
const CONSOLE_MAP =
  'p1: AS 3H 5D 7C 9S JH KD 2C 4H 8S\\np2: 2D 4S 6H 8C 10S QD KH 3C 5S 7D\\ndiscard: 6C\\nstock: KC';

test('sandbox: unlocked by the name, a preset deals its map, a bad map is refused, the console deals too', async ({
  player,
  project,
}) => {
  const { page } = player;
  await page.goto(pagePath(project, 'gin-rummy'));
  const sandboxBtn = page.locator('#playModeSwitch .mode-btn[data-mode="sandbox"]');
  await expect(sandboxBtn).toBeHidden();
  await page.locator('#nameInput').fill('sandbox');
  await expect(sandboxBtn).toBeVisible();
  // The sandbox's game takes the pass-and-play names: the second is typed there first.
  await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
  await page.locator('#p2NameInput').fill('Bob');
  await sandboxBtn.click();
  await expect(page.locator('#sandboxModeContent')).toBeVisible();
  await expect(page.locator('#sbPreset option')).toHaveCount(12);

  // The help sheet opens and closes.
  await page.locator('#sbHelpBtn').click();
  await expect(page.locator('#sandboxHelpOverlay')).toBeVisible();
  await page.locator('#closeSandboxHelpBtn').click();
  await expect(page.locator('#sandboxHelpOverlay')).toBeHidden();

  // A bad map: the error under the editor, nothing dealt.
  await page.locator('#sbMap').fill('hello');
  await page.locator('#sbStartBtn').click();
  await expect(page.locator('#sbError')).toContainText('Unknown line "hello"');
  await expect(page.locator('#homeScreen')).toBeVisible();

  // A preset: its map in the editor, dealt exactly.
  await page.locator('#sbPreset').selectOption('two-ways-tie');
  await expect(page.locator('#sbMap')).toHaveValue(new RegExp(`^p1: ${TWO_WAYS}\\n`));
  await expect(page.locator('#sbError')).toHaveText('');
  await page.locator('#sbStartBtn').click();
  await reveal(page);
  await expect(page.locator('#hand .card')).toHaveCount(10);
  const held = await page.evaluate<ReadonlyArray<string | null>>(
    "Array.from(document.querySelectorAll('#hand .card')).map((e) => e.getAttribute('data-card')).sort()",
  );
  expect(held).toEqual(TWO_WAYS.split(' ').sort());
  await expect(page.locator('#discardPile .card')).toHaveAttribute('data-card', '5S');
  await expect(page.locator('#statusSub')).toHaveText('Tap the stock or the discard pile');
  await expect(page.locator('#oppName')).toHaveText('Bob');

  // The console: the named stock top is the next draw; the table reads back as a map.
  await page.evaluate(`window.__gin.sandbox('${CONSOLE_MAP}')`);
  await reveal(page);
  await page.locator('#stockPile').click();
  await expect(page.locator('#hand .slot.ghost.shown .card')).toHaveAttribute('data-card', 'KC');
  const back = await page.evaluate<string | null>('window.__gin.sandboxMap()');
  expect(back).toContain(
    'p1: AS 3H 5D 7C 9S JH KD 2C 4H 8S KC\np2: 2D 4S 6H 8C 10S QD KH 3C 5S 7D\n',
  );
  expect(back).toContain('\nphase: discard\ndrawn: KC\n');
});
