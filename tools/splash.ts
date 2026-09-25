// The link-preview splash art (docs/design/link-previews.md §2): one drawn SVG per shell game,
// web/games/<g>/assets/splash.svg, in the game's quiet theme, rendered here to the 1200x630 PNG the
// page's og:image names, web/public/games/<g>/splash.png. Vite copies public/ verbatim, so the PNG
// ships at games/<g>/splash.png on both origins; a `<meta content>` URL is not a Vite asset reference,
// which is why the PNG cannot sit beside its SVG. The render is Chromium's (the repo's Playwright
// browser) at device scale 1, so the committed PNG is the rendering machine's: a font family the SVG
// names that the machine lacks falls back to the generic family after it. Re-run when an SVG changes
// and commit the PNGs; test/dist/link-previews.test.ts holds each PNG's size to the head's width and height.
//   node --experimental-strip-types tools/splash.ts
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Browser, chromium } from '@playwright/test';

import { SHELL_GAMES, type ShellGame } from './games.ts';
import { REPO_ROOT, isMain } from './legacy/extract.ts';

/** The card's size: the Open Graph large-image card (1.91:1). */
export const SPLASH_WIDTH = 1200;
export const SPLASH_HEIGHT = 630;

/** The drawn source, repo-relative. */
export const splashSvg = (game: ShellGame): string => `web/games/${game}/assets/splash.svg`;

/** The rendered PNG, repo-relative (served at games/<g>/splash.png). */
export const splashPng = (game: ShellGame): string => `web/public/games/${game}/splash.png`;

const render = async (browser: Browser, game: ShellGame): Promise<string> => {
  const page = await browser.newPage({
    viewport: { width: SPLASH_WIDTH, height: SPLASH_HEIGHT },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(resolve(REPO_ROOT, splashSvg(game))).href);
  const out = resolve(REPO_ROOT, splashPng(game));
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({
    path: out,
    clip: { x: 0, y: 0, width: SPLASH_WIDTH, height: SPLASH_HEIGHT },
  });
  await page.close();
  return splashPng(game);
};

const main = async (): Promise<void> => {
  const browser = await chromium.launch();
  try {
    const written = await Promise.all(SHELL_GAMES.map((game) => render(browser, game)));
    written.forEach((path) => {
      console.log(`${path}: written`);
    });
  } finally {
    await browser.close();
  }
};

if (isMain(import.meta.url)) await main();
