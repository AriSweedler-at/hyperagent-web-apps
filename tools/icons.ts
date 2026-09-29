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
// origins, where the manifest's `./icons/<file>` (relative to the manifest) finds them. One more
// PNG is not the manifest's: iOS reads `<link rel="apple-touch-icon">` in the page's head for a
// Home Screen bookmark (and never the manifest's icons; without the link it shows a screenshot of
// the page), so TOUCH_ICONS renders the maskable drawing at 180x180 with its background kept (iOS
// rounds the corners itself and paints black behind a transparent pixel) to icons/apple-touch-icon.png,
// and the head links it. Re-run when an SVG changes and commit the PNGs; test/dist/manifest.test.ts
// holds each PNG's size to its manifest row (the touch icon to 180, opaque) and every icon URL to
// a file the build ships on both origins.
//   node --experimental-strip-types tools/icons.ts
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Browser, chromium } from '@playwright/test';

import type { ShellGame } from './games.ts';
import { REPO_ROOT, isMain } from './legacy/extract.ts';

/** The games that ship a manifest: backgammon alone plays sideways. */
export const MANIFEST_GAMES: ReadonlyArray<ShellGame> = ['backgammon'];

/**
 * The manifest's `purpose` for an icon: shown as drawn, or cut to the launcher's shape; `touch` is
 * iOS's Home Screen icon, linked from the head and not the manifest's (the maskable drawing, opaque).
 */
export type IconPurpose = 'any' | 'maskable' | 'touch';

/** One icon the manifest names: its drawn source, its rendered file and the size of both. */
export type IconSpec = Readonly<{
  game: ShellGame;
  purpose: IconPurpose;
  size: number;
}>;

/** The manifest, repo-relative (served at games/<g>/manifest.webmanifest). */
export const manifestPath = (game: ShellGame): string =>
  `web/public/games/${game}/manifest.webmanifest`;

/** The drawn source, repo-relative: the `any` tile, or the full-bleed drawing (maskable and touch). */
export const iconSvg = (game: ShellGame, purpose: IconPurpose): string =>
  `web/games/${game}/assets/${purpose === 'any' ? 'icon' : 'icon-maskable'}.svg`;

/** The rendered file's name under ./icons/: as the manifest's `src` spells it, or the name iOS's link carries. */
export const iconFile = ({ purpose, size }: IconSpec): string =>
  purpose === 'touch'
    ? 'apple-touch-icon.png'
    : `${purpose === 'any' ? 'icon' : 'maskable'}-${String(size)}.png`;

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

/** iOS's Home Screen icon per installable game: 180x180 (the size every iPhone since the 6 Plus asks for), the head links it. */
export const TOUCH_ICONS: ReadonlyArray<IconSpec> = MANIFEST_GAMES.map((game): IconSpec => ({
  game,
  purpose: 'touch',
  size: 180,
}));

/** True for a game that ships a manifest: what the dist guards branch on for a page's extra files. */
export const isManifestGame = (game: string): game is ShellGame =>
  MANIFEST_GAMES.some((candidate) => candidate === game);

/** The manifest, its icons and the touch icon as the build ships them under games/<g>/ (Vite copies public/ verbatim). */
export const shippedFiles = (game: ShellGame): ReadonlyArray<string> => [
  `games/${game}/manifest.webmanifest`,
  ...[...ICONS, ...TOUCH_ICONS]
    .filter((icon) => icon.game === game)
    .map((icon) => `games/${game}/icons/${iconFile(icon)}`),
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
    const written = await Promise.all(
      [...ICONS, ...TOUCH_ICONS].map((icon) => render(browser, icon)),
    );
    written.forEach((path) => {
      console.log(`${path}: written`);
    });
  } finally {
    await browser.close();
  }
};

if (isMain(import.meta.url)) await main();
