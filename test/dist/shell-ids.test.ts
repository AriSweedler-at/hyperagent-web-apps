// Every shell page carries every shell id (docs/design/shared-shell.md §4.1 `ids.ts`, §5 B1): the
// shared painters and binders under web/shared/ui reach the document by these ids, so a page that
// renames or drops one fails here, on the built markup, before a painter throws at boot. The two
// games' own ids (gin's scorer, backgammon's board) are each game's `pageShape` row in tools/games.ts
// (test/dist/dist-parity.test.ts). Runs after the build (npm run test:site).
import { expect, test } from 'vitest';

import { SHELL_GAMES, SHELL_IDS } from '../../web/shared/ui/ids.ts';
import { describeDist, readDist } from './dist.ts';

const idsIn = (markup: string): ReadonlySet<string> =>
  new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1] ?? ''));

describeDist('the shell ids on every shell page', (root) => {
  SHELL_GAMES.forEach((game) => {
    test(`the ${game} page carries all ${String(SHELL_IDS.length)} shell ids, each once`, () => {
      const page = readDist(root, `games/${game}/index.html`);
      const present = idsIn(page);
      expect(SHELL_IDS.filter((id) => !present.has(id))).toEqual([]);
      SHELL_IDS.forEach((id) => {
        expect(page.match(new RegExp(`\\bid="${id}"`, 'g'))).toHaveLength(1);
      });
    });
  });
});
