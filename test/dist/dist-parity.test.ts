// docs/MIGRATION.md step 4: the switch to a built dist/ is provably zero-diff. The landing page is
// byte-identical to web/index.html (Vite leaves it alone with cssMinify off; a future Vite that
// reformats it will fail here and the owner decides). Step 7 cut fidice over and step 13 gin-rummy:
// each games/<g>/index.html is Vite's module page (never the legacy bundle), its app-[hash].js sits
// beside it, its CSS under shared/assets/, every page preloads the chunk they all share, and every
// asset a page references exists; no shared/ice.js is emitted. legacy/** stays in the repo as the
// frozen source of the oracle fixtures (legacy/README.md; test/fixtures/legacy/manifest.test.ts
// pins it) and is never served. The backgammon page (docs/design/backgammon-board.md) has no
// legacy twin: it is built and checked like the others, `LEGACY_GAMES` keeps the two that have
// one. Runs after the build (npm run test:site).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

import { ALIASES, GAMES, LEGACY_GAMES, REGISTRY } from '../../tools/games.ts';
import {
  ALIAS_PAGES,
  REPO_ROOT,
  describeDist,
  distFiles,
  distHasFile,
  readDist,
  referencesIn,
} from './dist.ts';

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const legacyPage = (game: string): string => resolve(REPO_ROOT, 'legacy', game, 'index.html');

describeDist('dist parity with legacy/ and web/', (root) => {
  test('index.html (the landing page) is byte-identical to web/index.html', () => {
    expect(readDist(root, 'index.html')).toBe(
      readFileSync(resolve(REPO_ROOT, 'web', 'index.html'), 'utf8'),
    );
    expect(sha256(resolve(root.dir, 'index.html'))).toBe(
      sha256(resolve(REPO_ROOT, 'web', 'index.html')),
    );
  });

  test('.nojekyll from web/public lands at the root of the tree', () => {
    expect(distFiles(root)).toContain('.nojekyll');
  });

  GAMES.forEach((game) => {
    test(`the ${game} bundle is emitted: app-[hash].js with its map beside the page, CSS under shared/assets/`, () => {
      const files = distFiles(root);
      const bundles = files.filter((file) =>
        new RegExp(`^games/${game}/app-[\\w-]+\\.js$`).test(file),
      );
      expect(bundles).toHaveLength(1);
      expect(files).toContain(`${bundles[0] ?? ''}.map`);
      expect(
        files.filter((file) => new RegExp(`^shared/assets/${game}-[\\w-]+\\.css$`).test(file)),
      ).toHaveLength(1);
      expect(files.filter((file) => file.startsWith(`games/${game}/`))).toHaveLength(3);
    });

    test(`the ${game} page is the built module page, not the legacy bundle`, () => {
      const html = readDist(root, `games/${game}/index.html`);
      if (LEGACY_GAMES.includes(game)) {
        expect(sha256(resolve(root.dir, 'games', game, 'index.html'))).not.toBe(
          sha256(legacyPage(game)),
        );
      }
      expect(html).toMatch(/<script type="module" crossorigin src="\.\/app-[\w-]+\.js"><\/script>/);
      expect(html).toMatch(
        new RegExp(
          `<link rel="stylesheet" crossorigin href="\\.\\./\\.\\./shared/assets/${game}-[\\w-]+\\.css">`,
        ),
      );
      // Steps 9 and 12: PeerJS and the ICE loader are bundled (web/shared/edge), so the page loads
      // neither the CDN script nor shared/ice.js and defines no `window.Peer` / `window.HyperIce`.
      expect(html).not.toContain('peerjs.min.js');
      expect(html).not.toContain('shared/ice.js');
      expect(html).not.toContain('"use strict";');
      expect(html).not.toContain('vite-ignore');
    });

    test(`every relative asset the ${game} page references is a file in the tree`, () => {
      // Its bundle, the shared chunk(s) it preloads (what both module pages import: PeerJS and the
      // shared edges, split out since the gin page joined the build in docs/MIGRATION.md step 12),
      // the shared chunk's CSS (web/shared/styles, step 14) and its own CSS, in that order: the
      // shared sheets cascade before the game's theme, as the source page links them.
      const page = `games/${game}/index.html`;
      const references = referencesIn(page, readDist(root, page))
        .map(({ value }) => value)
        .filter((value) => !value.startsWith('https://'));
      // The site's one icon (web/public/shared/favicon.*), linked by every page.
      const icons = references.filter((value) => value.includes('/favicon.'));
      expect(icons).toEqual(['../../shared/favicon.svg', '../../shared/favicon.ico']);
      const relative = references.filter((value) => !icons.includes(value));
      expect(relative[0]).toMatch(/^\.\/app-[\w-]+\.js$/);
      expect(relative.at(-1)).toMatch(
        new RegExp(`^\\.\\./\\.\\./shared/assets/${game}-[\\w-]+\\.css$`),
      );
      expect(relative.at(-2)).toMatch(/^\.\.\/\.\.\/shared\/assets\/[\w-]+\.css$/);
      const chunks = relative.slice(1, -2);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      chunks.forEach((value) => {
        expect(value).toMatch(/^\.\.\/\.\.\/shared\/assets\/[\w-]+\.js$/);
      });
      references.forEach((value) => {
        const target = value.startsWith('./')
          ? `games/${game}/${value.slice(2)}`
          : value.replace('../../', '');
        expect(distHasFile(root, target), `${value} -> ${target}`).toBe(true);
      });
    });
  });

  // The shape of each page as tools/games.ts REGISTRY spells it: the title, the ids of its static
  // screens (fidice ships one mount point, `#app`, and paints the rest; gin keeps the legacy ids;
  // backgammon is gin-shaped with the 24 points), and, where the row says so, the two rules lists
  // empty (filled from ui/rules.ts at boot) with no rules prose baked into the markup.
  GAMES.forEach((game) => {
    const { title, pageShape } = REGISTRY[game];
    test(`the ${game} page carries its title and its ids${pageShape.rulesSlots ? ', with empty rules slots' : ''}`, () => {
      const page = readDist(root, `games/${game}/index.html`);
      expect(page).toContain(`<title>${title}</title>`);
      pageShape.ids.forEach((id) => {
        expect(page).toContain(`id="${id}"`);
      });
      if (!pageShape.rulesSlots) return;
      expect(page).toContain('<ul class="rules-list" id="rulesList"></ul>');
      expect(page).toContain('<ul class="rules-list" id="rulesOverlayList"></ul>');
      expect(page).not.toContain('<strong>Goal:</strong>');
    });
  });

  test('every module page preloads the chunk all of them share and links the one shared stylesheet; a chunk under shared/assets/ is preloaded by two pages at least', () => {
    // A game's own CSS is `<game>-[hash].css`; everything else under shared/assets/ is shared.
    const own = GAMES.map((game) => `/${game}-`);
    const shared = (game: string, ext: string): ReadonlyArray<string> =>
      referencesIn(`games/${game}/index.html`, readDist(root, `games/${game}/index.html`))
        .map(({ value }) => value)
        .filter((value) => new RegExp(`^\\.\\./\\.\\./shared/assets/[\\w-]+\\.${ext}$`).test(value))
        .filter((value) => !own.some((prefix) => value.includes(prefix)));
    const chunks = Object.fromEntries(GAMES.map((game) => [game, shared(game, 'js')]));
    const preloadedBy = (chunk: string): ReadonlyArray<string> =>
      GAMES.filter((game) => chunks[game]?.includes(chunk) === true);
    // PeerJS and the shared edges every page imports (steps 9 and 12) are one chunk for all three.
    const common = Object.values(chunks)
      .flat()
      .filter((chunk) => preloadedBy(chunk).length === GAMES.length);
    expect(new Set(common).size).toBeGreaterThanOrEqual(1);
    // Rolldown splits a module out of the bundles only when more than one page imports it (the DOM
    // edge, web/shared/edge/dom.ts, became such a chunk when backgammon joined gin in painting
    // through it; fidice has its own vdom), so a chunk preloaded by one page alone is a split gone
    // wrong: that page's code has left its bundle.
    [...new Set(Object.values(chunks).flat())].forEach((chunk) => {
      expect(preloadedBy(chunk).length, chunk).toBeGreaterThanOrEqual(2);
    });
    // web/shared/styles/{tokens,base}.css, linked by every page, are emitted once (step 14).
    const sharedCss = shared('fidice', 'css');
    expect(sharedCss).toHaveLength(1);
    GAMES.forEach((game) => {
      expect(shared(game, 'css'), game).toEqual(sharedCss);
      expect(readDist(root, `games/${game}/index.html`), game).toContain(
        '<link rel="modulepreload" crossorigin href="../../shared/assets/',
      );
    });
  });

  test('legacy/ is retained, unserved, as the frozen oracle source (legacy/README.md)', () => {
    LEGACY_GAMES.forEach((game) => {
      expect(existsSync(legacyPage(game)), game).toBe(true);
      // The classic PeerJS CDN script both legacy pages carried, which the built pages must not.
      expect(readFileSync(legacyPage(game), 'utf8')).toContain('peerjs.min.js');
    });
    expect(existsSync(resolve(REPO_ROOT, 'legacy', 'shared', 'ice.js'))).toBe(true);
    expect(existsSync(resolve(REPO_ROOT, 'legacy', 'README.md'))).toBe(true);
  });

  test('the tree holds the landing page, every game page and nothing stray at the root', () => {
    const files = distFiles(root);
    ['.nojekyll', 'index.html', ...GAMES.map((game) => `games/${game}/index.html`)].forEach(
      (file) => {
        expect(files, file).toContain(file);
      },
    );
    // The classic ICE loader went with the last legacy page (step 13); it is bundled now.
    expect(files).not.toContain('shared/ice.js');
    // games/ holds one folder per game and one per alias (tools/games.ts ALIASES), nothing else;
    // an alias folder is its stub alone, never a bundle or a map (it is not a game page).
    const folders = [
      ...new Set(
        files.filter((file) => file.startsWith('games/')).map((file) => file.split('/')[1]),
      ),
    ];
    expect(folders.sort()).toEqual([...GAMES, ...Object.keys(ALIASES)].sort());
    ALIAS_PAGES.forEach(({ alias, page }) => {
      expect(files.filter((file) => file.startsWith(`games/${alias}/`))).toEqual([page]);
    });
    // Root-level files: the landing page, .nojekyll and (once it has a script) the landing's own
    // app-[hash].js with its map. Nothing else may sit beside them.
    const stray = files
      .filter((file) => !file.includes('/'))
      .filter((file) => !['.nojekyll', 'index.html'].includes(file))
      .filter((file) => !/^app-[\w-]+\.js(\.map)?$/.test(file));
    expect(stray).toEqual([]);
  });
});
