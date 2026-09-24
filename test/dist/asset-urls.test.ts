// Guard 1 of docs/ARCHITECTURE.md "Two origins": every src/href/url() in dist HTML and CSS is
// `./`-relative (or bare relative), `../../shared/`-relative or `https://`; never `/`-rooted, so
// the same bytes resolve from /hyperagent-web-apps/ on github.io and from / on games.sweedler.com.
// Nothing may be emitted to a root /assets/ either. Runs on dist/ after the build (npm run test:site).
import { expect, test } from 'vitest';

import { PAGES_BASE_PATH } from '../../e2e/fixtures/site.ts';
import { GAMES } from '../../tools/games.ts';
import {
  ALIAS_PAGES,
  allReferences,
  classify,
  describeDist,
  distFiles,
  isAliasPage,
  readDist,
  referencedFiles,
  referencesIn,
} from './dist.ts';

describeDist('dist asset URLs', (root) => {
  test('the landing page and every HTML/CSS file in the tree are checked', () => {
    const files = referencedFiles(root);
    expect(files).toContain('index.html');
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  test('every reference is relative, shared-relative or https', () => {
    // An alias stub's one link is `../<game>/`, a parent path only a sibling of games/<game>/ may
    // use; the alias test below checks it, and every other file's references are checked here.
    const references = allReferences(root).filter(({ file }) => !isAliasPage(file));
    expect(references.length).toBeGreaterThan(0);
    const offenders = references
      .map((reference) => ({ ...reference, placement: classify(reference.value) }))
      .filter(
        ({ placement }) =>
          placement === 'rooted' || placement === 'parent-escape' || placement === 'other-scheme',
      );
    expect(offenders, 'references that break one of the two origins').toEqual([]);
  });

  test('no page loads shared/ice.js or the PeerJS CDN bundle as a classic script', () => {
    // Only the legacy pages did (fidice stopped in docs/MIGRATION.md step 9, gin in step 13); the
    // ICE loader and PeerJS arrive with the module graph.
    const references = allReferences(root);
    expect(references.filter(({ value }) => value.endsWith('/ice.js'))).toEqual([]);
    expect(references.filter(({ value }) => value.includes('peerjs'))).toEqual([]);
  });

  test('nothing is emitted under a root assets/ directory', () => {
    expect(distFiles(root).filter((file) => file.startsWith('assets/'))).toEqual([]);
  });

  ALIAS_PAGES.forEach(({ alias, game, page }) => {
    test(`the ${alias} stub forwards to ../${game}/, links it once and requests nothing else`, () => {
      const html = readDist(root, page);
      // The one reference: the no-script link. Its inline script is code, not markup, so the
      // forward itself is checked as text; both spell the same document-relative target, which the
      // Pages origin resolves to games/<game>/ (on the proxy the Worker serves the alias in place
      // and this file is never fetched).
      expect(referencesIn(page, html)).toEqual([
        { file: page, kind: 'href', value: `../${game}/` },
      ]);
      expect(html).toContain(`location.replace('../${game}/' + location.search + location.hash)`);
      expect(html).not.toContain('<script type="module"');
      expect(html).not.toContain(' src=');
      // No `/`-rooted URL anywhere in the file, the script included: a quote, paren or `=`
      // followed by `/`; and never the Pages mount point.
      expect(html).not.toMatch(/["'(=]\//);
      expect(html).not.toContain(PAGES_BASE_PATH);
      expect(html).toContain('<meta name="robots" content="noindex" />');
      expect(html).toMatch(/<title>[^<]+<\/title>/);
    });
  });

  GAMES.forEach((game) => {
    test(`the ${game} page loads its bundle beside itself and its CSS under ../../shared/assets/`, () => {
      const page = `games/${game}/index.html`;
      const references = referencesIn(page, readDist(root, page));
      // Its only script is the bundle: PeerJS and the ICE loader come with the module graph (steps
      // 9 and 12), through a preloaded shared chunk under ../../shared/assets/ (no classic script).
      expect(references.filter(({ kind }) => kind === 'src').map(({ value }) => value)).toEqual([
        expect.stringMatching(/^\.\/app-[\w-]+\.js$/) as string,
      ]);
      references
        .filter(({ kind, value }) => kind === 'href' && value.endsWith('.js'))
        .forEach(({ value }) => {
          expect(value).toMatch(/^\.\.\/\.\.\/shared\/assets\/[\w-]+\.js$/);
        });
      // Two stylesheets, both under ../../shared/assets/: the web/shared/styles sheets both pages
      // link ride the shared chunk (docs/MIGRATION.md step 14), then the game's own CSS.
      expect(
        references.filter(({ value }) => value.endsWith('.css')).map(({ value }) => value),
      ).toEqual([
        expect.stringMatching(/^\.\.\/\.\.\/shared\/assets\/[\w-]+\.css$/) as string,
        expect.stringMatching(
          new RegExp(`^\\.\\./\\.\\./shared/assets/${game}-[\\w-]+\\.css$`),
        ) as string,
      ]);
    });
  });
});
