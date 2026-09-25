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
import { DEFAULT_NAMES, curtainTitle, readSave, reveal, startLocal } from './fixtures/shell.ts';
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
  });
});
