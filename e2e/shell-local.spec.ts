// The shell half of pass and play on both shell games (docs/design/shared-shell.md §6.3), at a phone
// and a laptop: the mode switch, two names, Start; the curtain hands the phone to the first player
// and speaks to the seats in the game's words (gin tells the other to look away, backgammon names
// the turn); the reveal shows the table with the names in place; and the game is saved for "Resume
// pass & play" under the game's key with role 'local'. The game halves (the hand the curtain must
// cover, the upcard and the discard; the opening roll, the dice, the cube, the Kapará toast) stay in
// e2e/gin-local.spec.ts and e2e/backgammon-local.spec.ts. Page-only; tagged per game (see
// shell-home.spec.ts).
import { SHELL_GAMES } from '../tools/games.ts';
import { DESKTOP, PHONE, type Viewport } from './fixtures/geometry.ts';
import {
  DEFAULT_MARK,
  DEFAULT_NAMES,
  curtainTitle,
  localNames,
  readPref,
  readSave,
  reveal,
  startLocal,
} from './fixtures/shell.ts';
import { SHELL_DRIVERS } from './fixtures/online-games.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const VIEWPORTS: Readonly<Record<string, Viewport>> = { phone: PHONE, desktop: DESKTOP };

SHELL_GAMES.forEach((game) => {
  test.describe(game, { tag: `@${game}` }, () => {
    const driver = SHELL_DRIVERS[game];

    Object.entries(VIEWPORTS).forEach(([name, vp]) => {
      test.describe(name, () => {
        test('pass and play: start, the curtain hands the phone to the first player, the reveal shows the table, the game is saved', async ({
          player,
          project,
        }) => {
          const { page } = player;
          await startLocal(page, pagePath(project, game), vp);
          // The curtain hides the table from the first player until they take the phone.
          const curtain = page.locator('#curtainOverlay');
          const title = page.locator('#curtainTitle');
          await expect(title).toHaveText(curtainTitle(DEFAULT_NAMES));
          const first = (await title.innerText()).replace('Pass the phone to ', '');
          const other = first === DEFAULT_NAMES[0] ? DEFAULT_NAMES[1] : DEFAULT_NAMES[0];
          await expect(page.locator('#curtainSub')).toContainText(driver.curtainSub(first, other));
          await reveal(page);
          await expect(curtain).toBeHidden();
          await expect(page.locator('#tableScreen')).toBeVisible();
          await expect(page.locator('#myName')).toContainText(first);
          await expect(page.locator('#oppName')).toHaveText(other);
          // The game is saved for "Resume pass & play".
          await expect
            .poll(() => readSave(page, game))
            .toMatchObject({ role: 'local', ...driver.localSave });
        });
      });
    });

    // The seats' defaults are the game's (tools/games.ts SHELL `localNames`; the owner, 2026-09-25:
    // gin's Ari and Lavi, backgammon's Ari and Ethan) and a prefilled default clears on its first
    // tap ("when you click on a pre-filled name for the first time it will clear it"). At the phone
    // alone: the seats are the same inputs at both widths (shell-home.spec.ts shows them at both).
    test('pass and play untouched: Start seats the game`s default names', async ({
      player,
      project,
    }) => {
      const { page } = player;
      const names = localNames(game);
      await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
      await page.goto(pagePath(project, game));
      await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
      await expect(page.locator('#p1NameInput')).toHaveValue(names[0]);
      await expect(page.locator('#p2NameInput')).toHaveValue(names[1]);
      await page.locator('#localBtn').click();
      const title = page.locator('#curtainTitle');
      await expect(title).toHaveText(curtainTitle(names));
      const first = (await title.innerText()).replace('Pass the phone to ', '');
      await reveal(page);
      await expect(page.locator('#myName')).toContainText(first);
      await expect(page.locator('#oppName')).toHaveText(first === names[0] ? names[1] : names[0]);
    });

    test('a prefilled seat clears on its first tap, once; a typed name is seated and remembered, and a remembered name never clears', async ({
      player,
      project,
    }) => {
      const { page } = player;
      const names = localNames(game);
      await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
      await page.goto(pagePath(project, game));
      await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
      const p1 = page.locator('#p1NameInput');
      const p2 = page.locator('#p2NameInput');
      // Prefilled and marked (web/shared/ui/home.ts `fillInputs`); a tap empties the seat and takes
      // the mark, the other seat keeps its default until its own.
      await expect(p1).toHaveValue(names[0]);
      await expect(p1).toHaveAttribute(DEFAULT_MARK, '1');
      await p1.click();
      await expect(p1).toHaveValue('');
      expect(await p1.getAttribute(DEFAULT_MARK)).toBeNull();
      await expect(p2).toHaveValue(names[1]);
      await p1.pressSequentially('Zoë');
      // A second tap leaves what was typed.
      await p2.focus();
      await expect(p2).toHaveValue('');
      await p1.click();
      await expect(p1).toHaveValue('Zoë');
      await p2.pressSequentially('Max');
      // Start seats the typed names, which were remembered as typed.
      await page.locator('#localBtn').click();
      await expect(page.locator('#curtainTitle')).toHaveText(curtainTitle(['Zoë', 'Max']));
      await expect.poll(() => readPref(page, game, 'name')).toBe('Zoë');
      await expect.poll(() => readPref(page, game, 'p2Name')).toBe('Max');
      // Back on the home screen the remembered names show unmarked, and a tap leaves them.
      await page.goto(pagePath(project, game));
      await expect(page.locator('#localModeContent')).toBeVisible();
      await expect(p1).toHaveValue('Zoë');
      expect(await p1.getAttribute(DEFAULT_MARK)).toBeNull();
      await p1.click();
      await expect(p1).toHaveValue('Zoë');
      await p2.focus();
      await expect(p2).toHaveValue('Max');
    });
  });
});
