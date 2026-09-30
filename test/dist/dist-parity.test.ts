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

import { PUBLIC_DIR as BUDDY_DIR } from '../../tools/buddy-frames.ts';
import {
  ALIASES,
  GAMES,
  LEGACY_GAMES,
  REGISTRY,
  SHELL_GAMES,
  SOLO,
  SOLO_PAGES,
  TOOL_NAMES,
} from '../../tools/games.ts';
import { isManifestGame, shippedFiles } from '../../tools/icons.ts';
import { OWN_SHEET, SHEETS_MAX, isShellGame } from './classes.ts';
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

/**
 * The served files a solo page's folder carries beside its page and bundle: the reaction game's
 * buddy frames (docs/design/rps-buddy.md §3, web/public/games/rps/buddy/), copied verbatim.
 */
const SOLO_ASSETS: Readonly<Record<(typeof SOLO_PAGES)[number], ReadonlyArray<string>>> = {
  rps: [`${BUDDY_DIR.replace('web/public/', '')}/`],
};

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
      // The page, its bundle and the map, for a shell game the link-preview splash Vite copies from
      // web/public/games/<g>/ (docs/design/link-previews.md §2) and, for a game that installs
      // (tools/icons.ts MANIFEST_GAMES), its manifest and icons from the same folder; nothing else.
      const splash = isShellGame(game) ? [`games/${game}/splash.png`] : [];
      const installable = isManifestGame(game) ? shippedFiles(game) : [];
      expect(files.filter((file) => file.startsWith(`games/${game}/`)).sort()).toEqual(
        [
          `games/${game}/index.html`,
          bundles[0] ?? '',
          `${bundles[0] ?? ''}.map`,
          ...splash,
          ...installable,
        ].sort(),
      );
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
      // the shared chunk's CSS (web/shared/styles, step 14), a shell-games-only sheet when one is
      // linked (allowed, not required: OWN_SHEET) and its own CSS, in that order: the shared sheets
      // cascade before the game's theme, as the source page links them.
      const page = `games/${game}/index.html`;
      const references = referencesIn(page, readDist(root, page))
        .map(({ value }) => value)
        .filter((value) => !value.startsWith('https://'));
      // The site's one icon (web/public/shared/favicon.*), linked by every page.
      const icons = references.filter((value) => value.includes('/favicon.'));
      expect(icons).toEqual(['../../shared/favicon.svg', '../../shared/favicon.ico']);
      // An installable game's manifest (tools/icons.ts MANIFEST_GAMES), linked from the head like the
      // icon and copied from web/public/games/<g>/ as written (checked below with the rest); the icons
      // it names are the manifest's references, not the page's (test/dist/manifest.test.ts follows them).
      // Its Home Screen icon (`apple-touch-icon`: iOS reads the link, never the manifest) is the page's
      // own reference, from the same folder (manifest.test.ts holds its size and both origins).
      const manifests = references.filter((value) => value.endsWith('.webmanifest'));
      expect(manifests).toEqual(isManifestGame(game) ? ['./manifest.webmanifest'] : []);
      const touchIcons = references.filter((value) => value.endsWith('/apple-touch-icon.png'));
      expect(touchIcons).toEqual(isManifestGame(game) ? ['./icons/apple-touch-icon.png'] : []);
      const relative = references.filter(
        (value) =>
          !icons.includes(value) && !manifests.includes(value) && !touchIcons.includes(value),
      );
      expect(relative[0]).toMatch(/^\.\/app-[\w-]+\.js$/);
      const sheets = relative.filter((value) => value.endsWith('.css'));
      expect(relative.slice(-sheets.length)).toEqual(sheets);
      expect(sheets.length).toBeGreaterThanOrEqual(2);
      expect(sheets.length).toBeLessThanOrEqual(SHEETS_MAX(game));
      expect(sheets.at(-1)).toMatch(
        new RegExp(`^\\.\\./\\.\\./shared/assets/${game}-[\\w-]+\\.css$`),
      );
      sheets.slice(0, -1).forEach((value) => {
        expect(value).toMatch(/^\.\.\/\.\.\/shared\/assets\/[\w-]+\.css$/);
        expect(value).not.toMatch(OWN_SHEET);
      });
      const chunks = relative.slice(1, -sheets.length);
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

  // A solo page (tools/games.ts SOLO_PAGES; docs/design/rps-island.md D1): built like a game (its
  // bundle and map beside the page, its own CSS under shared/assets/), its title and ids as its
  // row spells them, no PeerJS, and its served assets beside it. It links no shared sheet (its
  // theme imports the tokens and the primitives, so the games' shared CSS chunk stays one file).
  SOLO_PAGES.forEach((page) => {
    const { title, pageShape } = SOLO[page];
    test(`the ${page} page is built beside its bundle, carries its title and ids, and its assets`, () => {
      const files = distFiles(root);
      const bundles = files.filter((file) =>
        new RegExp(`^games/${page}/app-[\\w-]+\\.js$`).test(file),
      );
      expect(bundles).toHaveLength(1);
      expect(files).toContain(`${bundles[0] ?? ''}.map`);
      expect(
        files.filter((file) => new RegExp(`^shared/assets/${page}-[\\w-]+\\.css$`).test(file)),
      ).toHaveLength(1);
      const assets = SOLO_ASSETS[page];
      const own = files.filter(
        (file) =>
          file.startsWith(`games/${page}/`) && !assets.some((under) => file.startsWith(under)),
      );
      expect(own.sort()).toEqual(
        [`games/${page}/index.html`, bundles[0] ?? '', `${bundles[0] ?? ''}.map`].sort(),
      );
      assets.forEach((under) => {
        expect(files.filter((file) => file.startsWith(under)).length, under).toBeGreaterThan(0);
      });
      const html = readDist(root, `games/${page}/index.html`);
      expect(html).toContain(`<title>${title}</title>`);
      pageShape.ids.forEach((id) => {
        expect(html).toContain(`id="${id}"`);
      });
      expect(html).toMatch(/<script type="module" crossorigin src="\.\/app-[\w-]+\.js"><\/script>/);
      expect(html).not.toContain('peerjs.min.js');
      expect(html).not.toContain('shared/ice.js');
      const references = referencesIn(`games/${page}/index.html`, html)
        .map(({ value }) => value)
        .filter((value) => !value.startsWith('https://'));
      expect(references.filter((value) => value.includes('/favicon.'))).toEqual([
        '../../shared/favicon.svg',
        '../../shared/favicon.ico',
      ]);
      const sheets = references.filter((value) => value.endsWith('.css'));
      expect(sheets).toEqual([
        expect.stringMatching(
          new RegExp(`^\\.\\./\\.\\./shared/assets/${page}-[\\w-]+\\.css$`),
        ) as string,
      ]);
      references.forEach((value) => {
        const target = value.startsWith('./')
          ? `games/${page}/${value.slice(2)}`
          : value.replace('../../', '');
        expect(distHasFile(root, target), `${value} -> ${target}`).toBe(true);
      });
    });
  });

  // The shape of each page as tools/games.ts REGISTRY spells it: the title, the ids of its static
  // screens (fidice's composed shell page's since M2 of docs/design/fidice-shell-adoption.md, dark
  // while its legacy app paints into `#app`; gin keeps the legacy ids;
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

  test('every module page preloads the chunk all of them share and links the stylesheet all of them share; a chunk under shared/assets/ is preloaded by two pages at least', () => {
    // Every module page under games/ in dist: the games, the solo pages (rps) and the tool pages
    // (tools/games.ts SOLO_PAGES, TOOL_NAMES; one whose page is not built is skipped), since
    // Rolldown splits a chunk for any two pages that import it, a solo or tool page counting as
    // much as a game's (rps and the sandbox share the App Clip module; backgammon's rail and the
    // sandbox the safe-area map).
    const pages: ReadonlyArray<string> = [
      ...GAMES,
      ...[...SOLO_PAGES, ...TOOL_NAMES].filter((page) =>
        existsSync(resolve(root.dir, `games/${page}/index.html`)),
      ),
    ];
    // A page's own CSS is `<page>-[hash].css`; everything else under shared/assets/ is shared.
    const own = pages.map((page) => `/${page}-`);
    const shared = (page: string, ext: string): ReadonlyArray<string> =>
      referencesIn(`games/${page}/index.html`, readDist(root, `games/${page}/index.html`))
        .map(({ value }) => value)
        .filter((value) => new RegExp(`^\\.\\./\\.\\./shared/assets/[\\w-]+\\.${ext}$`).test(value))
        .filter((value) => !own.some((prefix) => value.includes(prefix)));
    const chunks = Object.fromEntries(pages.map((page) => [page, shared(page, 'js')]));
    const preloadedBy = (chunk: string): ReadonlyArray<string> =>
      pages.filter((page) => chunks[page]?.includes(chunk) === true);
    // PeerJS and the shared edges every game imports (steps 9 and 12) are one chunk for all the
    // games (a solo or tool page need not carry it).
    const common = GAMES.flatMap((game) => chunks[game] ?? []).filter((chunk) =>
      GAMES.every((game) => chunks[game]?.includes(chunk) === true),
    );
    expect(new Set(common).size).toBeGreaterThanOrEqual(1);
    // Rolldown splits a module out of the bundles only when more than one page imports it (the DOM
    // edge, web/shared/edge/dom.ts, became such a chunk when backgammon joined gin in painting
    // through it; fidice has its own vdom; web/shared/lib/safeArea.ts when backgammon's rail joined
    // the sandbox in reading the safe-area map), so a chunk preloaded by one page alone is a split
    // gone wrong: that page's code has left its bundle. A chunk shared by a game and a solo or tool
    // page counts: all are module pages of the one build.
    [...new Set(Object.values(chunks).flat())].forEach((chunk) => {
      expect(preloadedBy(chunk).length, chunk).toBeGreaterThanOrEqual(2);
    });
    // web/shared/styles/{tokens,base}.css, linked by every page, are emitted once (step 14), and so
    // is shell.css since fidice's page links it too (M1 of docs/design/fidice-shell-adoption.md):
    // Vite splits a sheet out only where the pages that link it differ, so the three ride the one
    // common chunk, which carries the shell's rules. A page that stopped linking shell.css would
    // split it back out as a second shared sheet on the others, the same file on each (allowed, not
    // required: OWN_SHEET in test/dist/classes.ts).
    const sharedCss = shared('fidice', 'css');
    expect(sharedCss).toHaveLength(1);
    expect(readDist(root, (sharedCss[0] ?? '').replace('../../', ''))).toContain(
      'body.fixed-screen',
    );
    const [shellCss = [], ...otherShellCss] = SHELL_GAMES.map((game) =>
      shared(game, 'css').slice(1),
    );
    expect(shellCss.length).toBeLessThanOrEqual(1);
    otherShellCss.forEach((extra) => {
      expect(extra).toEqual(shellCss);
    });
    GAMES.forEach((game) => {
      expect(shared(game, 'css'), game).toEqual([
        ...sharedCss,
        ...(isShellGame(game) ? shellCss : []),
      ]);
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
    [
      '.nojekyll',
      'index.html',
      ...GAMES.map((game) => `games/${game}/index.html`),
      ...SOLO_PAGES.map((page) => `games/${page}/index.html`),
    ].forEach((file) => {
      expect(files, file).toContain(file);
    });
    // The classic ICE loader went with the last legacy page (step 13); it is bundled now.
    expect(files).not.toContain('shared/ice.js');
    // games/ holds one folder per game, one per solo page, one per alias (tools/games.ts ALIASES)
    // and one per tool page (TOOLS), nothing else; an alias folder is its stub alone, never a
    // bundle or a map (it is not a game page).
    const folders = [
      ...new Set(
        files.filter((file) => file.startsWith('games/')).map((file) => file.split('/')[1]),
      ),
    ];
    expect(folders.sort()).toEqual(
      [...GAMES, ...SOLO_PAGES, ...Object.keys(ALIASES), ...TOOL_NAMES].sort(),
    );
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
