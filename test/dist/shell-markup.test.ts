// The committed shell pages are what the shared partials render (docs/design/dry-round-2.md §3 row
// G2, §5 Wave F row F2; the drift idiom of backgammon-grid.test.ts): web/games/<g>/index.html is
// pinned, byte for byte (every shell game's: tools/games.ts SHELL_GAMES, fidice's among them since
// M2 of docs/design/fidice-shell-adoption.md composed it), to that tool composing
// web/shared/markup/shell/*.html with the game's page.ts (Prettier's output of it where Prettier
// owns the file), so an edit to a partial or
// a page.ts fails here until `node --experimental-strip-types tools/shell-markup.ts --write` is
// re-run, and an edit to the committed page alone fails until it is moved into the page.ts block or
// the partial that spells it (--write overwrites the page). The partials' ids, with the ones the
// games' blocks place (BLOCK_IDS: the options' three, the table's controls and the two screens;
// SCREEN_IDS: the leave button, on the table in gin and the endgame in backgammon), are exactly
// SHELL_IDS: what the shared painters reach by id is what the shared markup spells, once. Reads the
// tree, not dist/, so it runs on any checkout; it is the site suite's like the other guards over
// every page at once (tools/ci/suites.ts).
import { describe, expect, test } from 'vitest';

import { SHELL_GAMES } from '../../tools/games.ts';
import { committedPage, composePage, readTemplates } from '../../tools/shell-markup.ts';
import { BLOCK_IDS, PARTIALS, SCREEN_IDS, idsIn } from '../../web/shared/markup/shell.ts';
import { SHELL_IDS } from '../../web/shared/ui/ids.ts';

describe('the shell pages are what the partials render', () => {
  test.each(SHELL_GAMES)('%s: index.html is composePage(game), byte for byte', async (game) => {
    expect(await composePage(game)).toBe(committedPage(game));
  });

  test('the partials spell every shell id once, the blocks the rest: together, SHELL_IDS', () => {
    const templates = readTemplates();
    const inPartials = PARTIALS.flatMap((name) => idsIn(templates[name]));
    const inBlocks = [...Object.values(BLOCK_IDS).flat(), ...SCREEN_IDS];
    expect([...inPartials, ...inBlocks].sort()).toEqual([...SHELL_IDS].sort());
  });
});
