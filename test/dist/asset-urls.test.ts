// Guard 1 of docs/ARCHITECTURE.md "Two origins": every src/href/url() in dist HTML and CSS is
// `./`-relative (or bare relative), `../../shared/`-relative or `https://`; never `/`-rooted, so
// the same bytes resolve from /hyperagent-web-apps/ on github.io and from / on games.sweedler.com.
// Nothing may be emitted to a root /assets/ either. Runs on dist/ after the build (test:dist).
import { expect, test } from 'vitest';

import { GAMES } from '../../tools/games.ts';
import {
  allReferences,
  classify,
  describeDist,
  distFiles,
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
    const references = allReferences(root);
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
