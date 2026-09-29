// The installable app's icons (docs/design/backgammon-landscape.md §5C, §6 item 4). A game that
// ships a manifest (MANIFEST_GAMES: backgammon, whose `orientation: landscape` is the one
// OS-enforced sideways hold, an Android WebAPK's; iOS ignores it) names PNGs in
// web/public/games/<g>/manifest.webmanifest: 192 and 512 for `purpose: any` and a full-bleed 512
// the launcher masks to its own shape (`purpose: maskable`, the mark inside the central 80%
// circle). Each purpose is one drawn SVG in the game's assets/, beside splash.svg and in the same
// quiet theme with no text, rendered here by Chromium (the repo's Playwright browser) at the icon's
// size: the SVG's root is sized 100% over a 512 viewBox, so the viewport is the size and one
// drawing serves both `any` sizes. The `any` tile has rounded corners, so its render omits the page
// background and the corners come out transparent; the maskable render keeps it (no transparency
// anywhere). Vite copies public/ verbatim, so the PNGs ship at games/<g>/icons/<file> on both
// origins, where the manifest's `./icons/<file>` (relative to the manifest) finds them. Re-run
// when an SVG changes and commit the PNGs; test/dist/manifest.test.ts holds each PNG's size to its
// manifest row and every icon URL to a file the build ships on both origins.
//   node --experimental-strip-types tools/icons.ts
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Browser, chromium } from '@playwright/test';

import type { ShellGame } from './games.ts';
import { REPO_ROOT, isMain } from './legacy/extract.ts';

/** The games that ship a manifest: backgammon alone plays sideways. */
export const MANIFEST_GAMES: ReadonlyArray<ShellGame> = ['backgammon'];

/** The manifest's `purpose` for an icon: shown as drawn, or cut to the launcher's shape. */
export type IconPurpose = 'any' | 'maskable';

/** One icon the manifest names: its drawn source, its rendered file and the size of both. */
export type IconSpec = Readonly<{
  game: ShellGame;
  purpose: IconPurpose;
  size: number;
}>;

/** The manifest, repo-relative (served at games/<g>/manifest.webmanifest). */
export const manifestPath = (game: ShellGame): string =>
  `web/public/games/${game}/manifest.webmanifest`;

/** The drawn source, repo-relative: one per purpose. */
export const iconSvg = (game: ShellGame, purpose: IconPurpose): string =>
  `web/games/${game}/assets/${purpose === 'any' ? 'icon' : 'icon-maskable'}.svg`;

/** The rendered file's name, as the manifest's `src` spells it under ./icons/. */
export const iconFile = ({ purpose, size }: IconSpec): string =>
  `${purpose === 'any' ? 'icon' : 'maskable'}-${String(size)}.png`;

/** The rendered PNG, repo-relative (served at games/<g>/icons/<file>). */
export const iconPng = (icon: IconSpec): string =>
  `web/public/games/${icon.game}/icons/${iconFile(icon)}`;

/** Every icon rendered: the sizes Android's WebAPK asks for, plus the maskable 512. */
export const ICONS: ReadonlyArray<IconSpec> = MANIFEST_GAMES.flatMap(
  (game): ReadonlyArray<IconSpec> => [
    { game, purpose: 'any', size: 192 },
    { game, purpose: 'any', size: 512 },
    { game, purpose: 'maskable', size: 512 },
  ],
);

/** True for a game that ships a manifest: what the dist guards branch on for a page's extra files. */
export const isManifestGame = (game: string): game is ShellGame =>
  MANIFEST_GAMES.some((candidate) => candidate === game);

/** The manifest and its icons as the build ships them under games/<g>/ (Vite copies public/ verbatim). */
export const shippedFiles = (game: ShellGame): ReadonlyArray<string> => [
  `games/${game}/manifest.webmanifest`,
  ...ICONS.filter((icon) => icon.game === game).map(
    (icon) => `games/${game}/icons/${iconFile(icon)}`,
  ),
];

const render = async (browser: Browser, icon: IconSpec): Promise<string> => {
  const page = await browser.newPage({
    viewport: { width: icon.size, height: icon.size },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(resolve(REPO_ROOT, iconSvg(icon.game, icon.purpose))).href);
  const out = resolve(REPO_ROOT, iconPng(icon));
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({
    path: out,
    omitBackground: icon.purpose === 'any',
    clip: { x: 0, y: 0, width: icon.size, height: icon.size },
  });
  await page.close();
  return iconPng(icon);
};

const main = async (): Promise<void> => {
  const browser = await chromium.launch();
  try {
    const written = await Promise.all(ICONS.map((icon) => render(browser, icon)));
    written.forEach((path) => {
      console.log(`${path}: written`);
    });
  } finally {
    await browser.close();
  }
};

if (isMain(import.meta.url)) await main();
