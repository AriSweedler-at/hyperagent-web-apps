// The raster card backs (docs/design/gin-card-backs.md §1b). A raster back is committed once, as the
// owner supplied it (web/games/gin-rummy/assets/<name>-back.jpg, RASTER_BACKS); this tool draws it at
// the widths a face-down card is painted at (the widest card is 112px, theme.css `--pile-w` on a
// desktop, at 1x, 2x and 3x device pixels) and writes web/games/gin-rummy/backs/<name>-<width>.jpg,
// which theme.css offers through image-set(). The derived files are committed too: the dist that
// deploys is the one CI's check job builds, and that job has neither a browser nor an image library
// (this tool draws with Playwright's Chromium, which the check job would have to restore from cache
// on every run), so a build cannot make them; test/card-backs.test.ts guards that each exists at its
// recorded size. Run after changing a source:
//   node --experimental-strip-types tools/card-backs.ts
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GIN = 'web/games/gin-rummy';

/** The raster backs: the preset name (src/cardBack.ts) → the committed source, relative to the repo root. */
export const RASTER_BACKS: Readonly<Record<string, string>> = {
  'yu-gi-oh': `${GIN}/assets/yu-gi-oh-back.jpg`,
};
/** The widest face-down card, in CSS pixels; one derived file per device-pixel ratio. */
export const CARD_WIDTH = 112;
export const RATIOS: ReadonlyArray<number> = [1, 2, 3];
/** The card's aspect: the SVG backs' viewBox is 100 × 144. */
export const CARD_ASPECT = 144 / 100;
const JPEG_QUALITY = 0.86;

export type Size = Readonly<{ width: number; height: number }>;
export const derivedSize = (ratio: number): Size => ({
  width: CARD_WIDTH * ratio,
  height: Math.round(CARD_WIDTH * ratio * CARD_ASPECT),
});
/** `web/games/gin-rummy/backs/<name>-<width>.jpg`, relative to the repo root. */
export const derivedPath = (name: string, ratio: number): string =>
  `${GIN}/backs/${name}-${String(derivedSize(ratio).width)}.jpg`;

/**
 * The source drawn onto a canvas of `size` (high-quality smoothing) and encoded as a JPEG data URL.
 * The page script is a string: tools/ compiles without the DOM lib (tsconfig.node.json).
 */
const draw = (page: Page, sourceDataUrl: string, size: Size): Promise<string> =>
  page.evaluate<string>(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(sourceDataUrl)};
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = ${String(size.width)};
    canvas.height = ${String(size.height)};
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', ${String(JPEG_QUALITY)});
  })()`);

const bytesOf = (dataUrl: string): Buffer =>
  Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

const main = async (): Promise<void> => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const jobs = Object.entries(RASTER_BACKS).flatMap(([name, source]) =>
      RATIOS.map((ratio) => ({ name, source, ratio })),
    );
    await jobs.reduce(async (prev, job) => {
      await prev;
      const source = await readFile(resolve(ROOT, job.source));
      const dataUrl = `data:image/jpeg;base64,${source.toString('base64')}`;
      const size = derivedSize(job.ratio);
      const out = derivedPath(job.name, job.ratio);
      const bytes = bytesOf(await draw(page, dataUrl, size));
      await writeFile(resolve(ROOT, out), bytes);
      console.log(
        `wrote ${out}: ${String(size.width)}×${String(size.height)}, ${String(bytes.byteLength)} bytes`,
      );
    }, Promise.resolve());
  } finally {
    await browser.close();
  }
};

const runDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) await main();
