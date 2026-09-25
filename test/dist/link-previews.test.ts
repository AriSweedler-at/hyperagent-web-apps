// Link previews (docs/design/link-previews.md §2): every shell page's head names the Open Graph card
// an iMessage'd link shows. The og:image must be an ABSOLUTE URL on the proxy origin (the one the
// owner texts) that the Worker's mapPath resolves to a PNG the build ships, and that PNG must be the
// 1200x630 the head declares (its IHDR is read, so a re-rendered image of another size fails here);
// twitter:image is the same file; og:url is the page's own short URL; the card is the large-image
// kind and carries a description. Runs after the build (npm run test:site). The Worker's `?join=`
// rewrite of these same heads is pinned in infra/games-proxy/worker.test.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

import { mapPath, metaContent } from '../../infra/games-proxy/worker.ts';
import { SHELL_GAMES } from '../../tools/games.ts';
import { SPLASH_HEIGHT, SPLASH_WIDTH } from '../../tools/splash.ts';
import { describeDist, distHasFile, readDist } from './dist.ts';

const PROXY_ORIGIN = 'https://games.sweedler.com';

/** A PNG's IHDR: width and height, big-endian, right after the 8-byte signature and the chunk header. */
const pngSize = (bytes: Buffer): Readonly<{ width: number; height: number }> => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20),
});

/** The dist-relative file the Worker fetches for a proxy-origin pathname: mapPath's upstream path minus the site prefix. */
const distPathFor = (pathname: string): string => {
  const mapped = mapPath(pathname);
  expect(mapped.kind).toBe('fetch');
  return mapped.path.split('/').slice(2).join('/');
};

describeDist('link previews: the Open Graph head of every shell page', (root) => {
  SHELL_GAMES.forEach((game) => {
    test(`${game}: og:image is an absolute proxy-origin URL naming a ${String(SPLASH_WIDTH)}x${String(SPLASH_HEIGHT)} PNG the build ships`, () => {
      const page = readDist(root, `games/${game}/index.html`);
      const image = metaContent(page, 'og:image') ?? '';
      expect(image.startsWith(`${PROXY_ORIGIN}/`)).toBe(true);
      const file = distPathFor(new URL(image).pathname);
      expect(distHasFile(root, file), file).toBe(true);
      expect(pngSize(readFileSync(resolve(root.dir, file)))).toEqual({
        width: SPLASH_WIDTH,
        height: SPLASH_HEIGHT,
      });
      expect(metaContent(page, 'og:image:width')).toBe(String(SPLASH_WIDTH));
      expect(metaContent(page, 'og:image:height')).toBe(String(SPLASH_HEIGHT));
      expect(metaContent(page, 'og:image:alt')).not.toBe('');
      expect(metaContent(page, 'twitter:image')).toBe(image);
    });

    test(`${game}: the card's text: a title, a description, the page's own URL, the large-image kind`, () => {
      const page = readDist(root, `games/${game}/index.html`);
      const title = metaContent(page, 'og:title') ?? '';
      const description = metaContent(page, 'og:description') ?? '';
      expect(title).not.toBe('');
      expect(description).not.toBe('');
      expect(metaContent(page, 'og:type')).toBe('website');
      expect(metaContent(page, 'og:url')).toBe(`${PROXY_ORIGIN}/${game}/`);
      expect(metaContent(page, 'twitter:card')).toBe('summary_large_image');
      expect(metaContent(page, 'twitter:title')).toBe(title);
      expect(metaContent(page, 'twitter:description')).toBe(description);
    });
  });
});
