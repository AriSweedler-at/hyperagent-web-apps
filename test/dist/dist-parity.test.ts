// docs/MIGRATION.md step 4: the switch to a built dist/ is provably zero-diff. Each page in
// LEGACY_PAGES is byte-identical (sha256) to its legacy/ source, so is shared/ice.js, and the landing
// page is byte-identical to web/index.html (Vite leaves it alone with cssMinify off; a future Vite
// that reformats it will fail here and the owner decides). Step 7 cut fidice over: in both trees
// games/fidice/index.html is Vite's module page (never the legacy bundle), its app-[hash].js sits
// beside it and its CSS under shared/assets/, and every asset the page references exists;
// legacy/fidice/index.html stays in the repo as the frozen source of the oracle fixtures and is
// never served. Honours the same LEGACY_PAGES override as vite.config.ts for dist/. Runs after the
// builds (test:dist).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

import { DEFAULT_LEGACY_PAGES } from '../../vite.config.ts';
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

const LEGACY_FIDICE = resolve(REPO_ROOT, 'legacy', 'fidice', 'index.html');

describeDist('dist parity with legacy/ and web/', (root) => {
  test('each page in LEGACY_PAGES is byte-identical to legacy/', (context) => {
    if (root.legacyPages.length === 0) context.skip('built with LEGACY_PAGES= (no legacy pages)');
    root.legacyPages.forEach((game) => {
      const built = resolve(root.dir, 'games', game, 'index.html');
      const source = resolve(REPO_ROOT, 'legacy', game, 'index.html');
      expect(existsSync(built), built).toBe(true);
      expect(sha256(built), game).toBe(sha256(source));
    });
  });

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

  test('every default legacy page still has its legacy/ source', () => {
    DEFAULT_LEGACY_PAGES.forEach((game) => {
      expect(existsSync(resolve(REPO_ROOT, 'legacy', game, 'index.html')), game).toBe(true);
    });
  });

  test('the fidice bundle is emitted: app-[hash].js with its map beside the page, CSS under shared/assets/', () => {
    const files = distFiles(root);
    const bundles = files.filter((file) => /^games\/fidice\/app-[\w-]+\.js$/.test(file));
    expect(bundles).toHaveLength(1);
    expect(files).toContain(`${bundles[0] ?? ''}.map`);
    expect(files.filter((file) => /^shared\/assets\/[\w-]+\.css$/.test(file))).toHaveLength(1);
    expect(files.filter((file) => file.startsWith('games/fidice/'))).toHaveLength(3);
  });

  test('the fidice page is the built module page, not the legacy bundle (step 7)', () => {
    expect(root.legacyPages).not.toContain('fidice');
    const page = resolve(root.dir, 'games', 'fidice', 'index.html');
    const html = readDist(root, 'games/fidice/index.html');
    expect(sha256(page)).not.toBe(sha256(LEGACY_FIDICE));
    expect(html).toMatch(/<script type="module" crossorigin src="\.\/app-[\w-]+\.js"><\/script>/);
    expect(html).toMatch(
      /<link rel="stylesheet" crossorigin href="\.\.\/\.\.\/shared\/assets\/fidice-[\w-]+\.css">/,
    );
    // Step 9: PeerJS and the ICE loader are bundled (web/shared/edge), so the page loads neither
    // the CDN script nor shared/ice.js and defines no `window.Peer` / `window.HyperIce`.
    expect(html).not.toContain('peerjs.min.js');
    expect(html).not.toContain('shared/ice.js');
    expect(html).toContain('<div id="app"></div>');
    expect(html).not.toContain('"use strict";');
    expect(html).not.toContain('vite-ignore');
  });

  test('every relative asset the fidice page references is a file in the tree', () => {
    const page = 'games/fidice/index.html';
    const relative = referencesIn(page, readDist(root, page))
      .map(({ value }) => value)
      .filter((value) => !value.startsWith('https://'));
    expect(relative).toEqual([
      expect.stringMatching(/^\.\/app-[\w-]+\.js$/) as string,
      expect.stringMatching(/^\.\.\/\.\.\/shared\/assets\/fidice-[\w-]+\.css$/) as string,
    ]);
    relative.forEach((value) => {
      const target = value.startsWith('./')
        ? `games/fidice/${value.slice(2)}`
        : value.replace('../../', '');
      expect(distHasFile(root, target), `${value} -> ${target}`).toBe(true);
    });
  });

  test('legacy/fidice/index.html is retained as the frozen oracle source (deleted in step 13)', () => {
    expect(existsSync(LEGACY_FIDICE)).toBe(true);
    expect(readFileSync(LEGACY_FIDICE, 'utf8')).toContain('"use strict";');
  });

  test('the tree holds the legacy pages, the landing page, the fidice bundle and nothing stray at the root', () => {
    const files = distFiles(root);
    const expected = [
      '.nojekyll',
      'index.html',
      'shared/ice.js',
      'games/fidice/index.html',
      ...root.legacyPages.map((game) => `games/${game}/index.html`),
    ];
    expected.forEach((file) => {
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

// With fidice out of LEGACY_PAGES the two trees differ only by gin-rummy: the fidice page and its
// assets are the same bytes in dist/ and dist-next/, which is why the e2e project `next` no longer
// replays fidice-online (playwright.config.ts).
test('dist/ and dist-next/ carry byte-identical fidice output', (context) => {
  const present = DIST_ROOTS.filter(distPresent);
  const dist = present.find((root) => root.name === 'dist');
  const next = present.find((root) => root.name === 'dist-next');
  if (dist === undefined || next === undefined) {
    context.skip('both dist/ and dist-next/ are needed: run `npm run build && npm run build:next`');
    return;
  }
  const fidiceFiles = (root: DistRoot): ReadonlyArray<string> =>
    distFiles(root).filter(
      (file) => file.startsWith('games/fidice/') || file.startsWith('shared/assets/fidice-'),
    );
  expect(fidiceFiles(dist)).toEqual(fidiceFiles(next));
  expect(fidiceFiles(dist).length).toBeGreaterThanOrEqual(4);
  fidiceFiles(dist).forEach((file) => {
    expect(sha256(resolve(dist.dir, file)), file).toBe(sha256(resolve(next.dir, file)));
  });
});
