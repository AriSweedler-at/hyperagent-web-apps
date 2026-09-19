// docs/MIGRATION.md step 4: the switch to a built dist/ is provably zero-diff. The landing page is
// byte-identical to web/index.html (Vite leaves it alone with cssMinify off; a future Vite that
// reformats it will fail here and the owner decides). Step 7 cut fidice over and step 13 gin-rummy:
// in both trees each games/<g>/index.html is Vite's module page (never the legacy bundle), its
// app-[hash].js sits beside it, its CSS under shared/assets/, both pages preload the same shared
// chunk, and every asset a page references exists. legacy/** stays in the repo as the frozen source
// of the oracle fixtures (legacy/README.md; test/fixtures/legacy/manifest.test.ts pins it) and is
// never served. Runs after the builds (test:dist).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

import {
  DIST_ROOTS,
  REPO_ROOT,
  describeDist,
  distFiles,
  distHasFile,
  distPresent,
  readDist,
  referencesIn,
  type DistRoot,
} from './dist.ts';

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const GAMES = ['gin-rummy', 'fidice'] as const;
const legacyPage = (game: string): string => resolve(REPO_ROOT, 'legacy', game, 'index.html');

describeDist('dist parity with legacy/ and web/', (root) => {
  test('shared/ice.js is byte-identical to legacy/ (copied on every build)', () => {
    expect(sha256(resolve(root.dir, 'shared', 'ice.js'))).toBe(
      sha256(resolve(REPO_ROOT, 'legacy', 'shared', 'ice.js')),
    );
  });

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
      expect(sha256(resolve(root.dir, 'games', game, 'index.html'))).not.toBe(
        sha256(legacyPage(game)),
      );
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
      // and its CSS, in that order.
      const page = `games/${game}/index.html`;
      const relative = referencesIn(page, readDist(root, page))
        .map(({ value }) => value)
        .filter((value) => !value.startsWith('https://'));
      expect(relative[0]).toMatch(/^\.\/app-[\w-]+\.js$/);
      expect(relative.at(-1)).toMatch(
        new RegExp(`^\\.\\./\\.\\./shared/assets/${game}-[\\w-]+\\.css$`),
      );
      const chunks = relative.slice(1, -1);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      chunks.forEach((value) => {
        expect(value).toMatch(/^\.\.\/\.\.\/shared\/assets\/[\w-]+\.js$/);
      });
      relative.forEach((value) => {
        const target = value.startsWith('./')
          ? `games/${game}/${value.slice(2)}`
          : value.replace('../../', '');
        expect(distHasFile(root, target), `${value} -> ${target}`).toBe(true);
      });
    });
  });

  test('the fidice page is a vdom mount point; the gin page keeps the legacy markup with empty rules slots', () => {
    expect(readDist(root, 'games/fidice/index.html')).toContain('<div id="app"></div>');
    const gin = readDist(root, 'games/gin-rummy/index.html');
    // The legacy ids intact, with the two rules slots empty (filled from ui/rules.ts at boot).
    ['id="app"', 'id="homeScreen"', 'id="tableScreen"', 'id="scResOverlay"', 'id="toast"'].forEach(
      (id) => {
        expect(gin).toContain(id);
      },
    );
    expect(gin).toContain('<ul class="rules-list" id="rulesList"></ul>');
    expect(gin).toContain('<ul class="rules-list" id="rulesOverlayList"></ul>');
    expect(gin).not.toContain('<strong>Goal:</strong>');
    expect(gin).toContain('<title>Gin Rummy</title>');
  });

  test('both module pages preload the same shared chunk(s) under shared/assets/', () => {
    const preloads = (page: string): ReadonlyArray<string> =>
      referencesIn(page, readDist(root, page))
        .map(({ value }) => value)
        .filter((value) => /^\.\.\/\.\.\/shared\/assets\/[\w-]+\.js$/.test(value));
    const fidice = preloads('games/fidice/index.html');
    expect(fidice.length).toBeGreaterThanOrEqual(1);
    expect(preloads('games/gin-rummy/index.html')).toEqual(fidice);
    expect(readDist(root, 'games/fidice/index.html')).toContain(
      '<link rel="modulepreload" crossorigin href="../../shared/assets/',
    );
  });

  test('legacy/ is retained, unserved, as the frozen oracle source (legacy/README.md)', () => {
    GAMES.forEach((game) => {
      expect(existsSync(legacyPage(game)), game).toBe(true);
      // The classic PeerJS CDN script both legacy pages carried, which the built pages must not.
      expect(readFileSync(legacyPage(game), 'utf8')).toContain('peerjs.min.js');
    });
    expect(existsSync(resolve(REPO_ROOT, 'legacy', 'shared', 'ice.js'))).toBe(true);
    expect(existsSync(resolve(REPO_ROOT, 'legacy', 'README.md'))).toBe(true);
  });

  test('the tree holds the landing page, both game pages and nothing stray at the root', () => {
    const files = distFiles(root);
    [
      '.nojekyll',
      'index.html',
      'shared/ice.js',
      ...GAMES.map((game) => `games/${game}/index.html`),
    ].forEach((file) => {
      expect(files, file).toContain(file);
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

// With no page left in LEGACY_PAGES the two trees are the same build: every file is byte-identical.
test('dist/ and dist-next/ are byte-identical', (context) => {
  const present = DIST_ROOTS.filter(distPresent);
  const dist = present.find((root) => root.name === 'dist');
  const next = present.find((root) => root.name === 'dist-next');
  if (dist === undefined || next === undefined) {
    context.skip('both dist/ and dist-next/ are needed: run `npm run build && npm run build:next`');
    return;
  }
  const files = (root: DistRoot): ReadonlyArray<string> => distFiles(root);
  expect(files(dist)).toEqual(files(next));
  expect(files(dist).length).toBeGreaterThanOrEqual(8);
  files(dist).forEach((file) => {
    expect(sha256(resolve(dist.dir, file)), file).toBe(sha256(resolve(next.dir, file)));
  });
});
