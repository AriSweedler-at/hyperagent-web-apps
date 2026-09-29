// The buddy's manifest against the files on disk (docs/design/rps-buddy.md §5): every frame the
// table promises exists as a 24x24 PNG, every sheet is frames x 24 wide, the drawn SVG beside each
// frame is there, and buddy.json is the table's own output. The IHDR is read by hand (width and
// height, big-endian, after the 8-byte signature and the chunk header), no library. The pure half
// is checked on the poses: a resting body is left-right symmetric, a smile bows down and a frown
// up, a hop's colour walks from one mood's to the next, and every pixel stays on the grid.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  BANDS,
  MANIFEST,
  MOODS,
  PALETTE,
  PUBLIC_DIR,
  SETS,
  SIZE,
  type Pixel,
  frameStem,
  frameSvg,
  framePng,
  hopName,
  mix,
  moodFor,
  raster,
  rest,
  sheetPng,
  sheetSvg,
  svgPath,
} from './buddy-frames.ts';
import { REPO_ROOT } from './legacy/extract.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG's IHDR: width and height, big-endian, right after the signature and the chunk header. */
const pngSize = (bytes: Buffer): Readonly<{ width: number; height: number }> | null =>
  bytes.length >= 24 &&
  bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
  bytes.toString('latin1', 12, 16) === 'IHDR'
    ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    : null;

const readRepo = (path: string): Buffer => readFileSync(resolve(REPO_ROOT, path));
const inRepo = (path: string): boolean => existsSync(resolve(REPO_ROOT, path));

const setNames = SETS.map((set) => set.name);

describe('the pose table', () => {
  test('five moods in counter order, one hop per adjacent pair, nine sets', () => {
    expect(MOODS).toEqual(['very-sad', 'sad', 'neutral', 'happy', 'very-happy']);
    expect(setNames).toEqual([
      ...MOODS,
      'very-sad-to-sad',
      'sad-to-neutral',
      'neutral-to-happy',
      'happy-to-very-happy',
    ]);
    expect(new Set(setNames).size).toBe(SETS.length);
  });

  test('the bands tile −5..5 and moodFor reads them (clamped)', () => {
    const counters = Array.from({ length: 11 }, (_, i) => i - 5);
    expect(counters.map(moodFor)).toEqual([
      'very-sad',
      'sad',
      'sad',
      'sad',
      'neutral',
      'neutral',
      'neutral',
      'happy',
      'happy',
      'happy',
      'very-happy',
    ]);
    expect(moodFor(-9)).toBe('very-sad');
    expect(moodFor(9)).toBe('very-happy');
    expect(MOODS.map((m) => BANDS[m].max - BANDS[m].min + 1).reduce((a, b) => a + b)).toBe(11);
  });

  test('every set holds four to eight frames at 90..250 ms', () => {
    SETS.forEach((set) => {
      expect(set.poses.length, set.name).toBeGreaterThanOrEqual(4);
      expect(set.poses.length, set.name).toBeLessThanOrEqual(8);
      expect(set.ms, set.name).toBeGreaterThanOrEqual(90);
      expect(set.ms, set.name).toBeLessThanOrEqual(250);
    });
  });
});

describe('the raster', () => {
  const onGrid = (pixels: ReadonlyArray<Pixel>): boolean =>
    pixels.every(({ x, y }) => x >= 0 && x < SIZE && y >= 0 && y < SIZE);

  test('every frame of every set stays on the 24-grid', () => {
    SETS.forEach((set) => {
      set.poses.forEach((pose, i) => {
        expect(onGrid(raster(pose)), `${set.name}/${frameStem(i)}`).toBe(true);
      });
    });
  });

  test('a resting body is left-right symmetric (eyes and mouth included, the highlight aside)', () => {
    MOODS.forEach((mood) => {
      const pixels = raster({ ...rest(mood), tear: 0, sparkle: 0 });
      const shine = mix(PALETTE[mood], '#ffffff', 0.45);
      const cells = new Set(
        pixels.filter(({ fill }) => fill !== shine).map(({ x, y }) => `${String(x)},${String(y)}`),
      );
      cells.forEach((cell) => {
        const [x = 0, y = 0] = cell.split(',').map(Number);
        expect(cells.has(`${String(SIZE - 1 - x)},${String(y)}`), `${mood} ${cell}`).toBe(true);
      });
    });
  });

  test('a smile bows down in the middle, a frown up, neutral is flat', () => {
    const ink = '#2a2622';
    const mouthRows = (mood: (typeof MOODS)[number]): ReadonlyArray<number> => {
      const pose = rest(mood);
      const pixels = raster(pose).filter(({ fill }) => fill === ink);
      // The eyes sit above the mouth: the mouth's pixels are the ink below the eye rows.
      const eyeBottom = Math.max(...pixels.filter(({ y }) => y < SIZE / 2 + 1).map(({ y }) => y));
      const mouth = pixels.filter(({ y }) => y > eyeBottom);
      const middle = mouth.filter(({ x }) => x === SIZE / 2 || x === SIZE / 2 - 1);
      const ends = mouth.filter(({ x }) => x === SIZE / 2 - pose.mouthW);
      return [Math.max(...middle.map(({ y }) => y)), Math.max(...ends.map(({ y }) => y))];
    };
    const [happyMid, happyEnd] = mouthRows('happy');
    const [sadMid, sadEnd] = mouthRows('very-sad');
    const [flatMid, flatEnd] = mouthRows('neutral');
    expect(happyMid).toBeGreaterThan(happyEnd ?? 0);
    expect(sadMid).toBeLessThan(sadEnd ?? 0);
    expect(flatMid).toBe(flatEnd);
  });

  test('a hop starts in the first mood’s colour and lands in the second’s', () => {
    MOODS.slice(1).forEach((to, i) => {
      const from = MOODS[i] ?? 'neutral';
      const set = SETS.find((s) => s.name === hopName(from, to));
      expect(set?.poses[0]?.body).toBe(PALETTE[from]);
      expect(set?.poses.at(-1)?.body).toBe(PALETTE[to]);
    });
  });

  test('mix walks the channels', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#4f86e0', '#4f86e0', 0.3)).toBe('#4f86e0');
  });

  test('a frame is crisp integer rects on a 24 viewBox; a sheet is frames x 24 wide', () => {
    const svg = frameSvg(rest('neutral'));
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain(`viewBox="0 0 ${String(SIZE)} ${String(SIZE)}"`);
    expect(svg).not.toMatch(/x="\d+\.\d/);
    const sheet = sheetSvg([svg, svg, svg]);
    expect(sheet).toContain(`width="${String(3 * SIZE)}"`);
    expect(sheet.match(/<svg x="/g)).toHaveLength(3);
  });
});

describe('the files on disk', () => {
  const manifestOnDisk: unknown = JSON.parse(readRepo(`${PUBLIC_DIR}/buddy.json`).toString('utf8'));

  test('buddy.json is the table’s output', () => {
    expect(manifestOnDisk).toEqual(MANIFEST);
  });

  test('the manifest names every set once, moods with their band and colour', () => {
    expect(Object.keys(MANIFEST.moods)).toEqual(MOODS);
    expect(Object.keys(MANIFEST.transitions)).toEqual(setNames.slice(MOODS.length));
    MOODS.forEach((mood) => {
      expect(MANIFEST.moods[mood].colour).toBe(PALETTE[mood]);
      expect(MANIFEST.moods[mood].min).toBe(BANDS[mood].min);
      expect(MANIFEST.moods[mood].sheet).toBe(`${mood}.png`);
    });
    Object.entries(MANIFEST.transitions).forEach(([name, t]) => {
      expect(name).toBe(hopName(t.from, t.to));
      expect(MOODS.indexOf(t.to)).toBe(MOODS.indexOf(t.from) + 1);
    });
  });

  SETS.forEach((set) => {
    describe(set.name, () => {
      test(`the sheet is ${String(set.poses.length)} x ${String(SIZE)} wide and ${String(SIZE)} tall`, () => {
        const size = pngSize(readRepo(sheetPng(set.name)));
        expect(size).toEqual({ width: set.poses.length * SIZE, height: SIZE });
      });

      test('every frame is a 24x24 PNG with its SVG beside the tool', () => {
        set.poses.forEach((_, i) => {
          expect(pngSize(readRepo(framePng(set.name, i))), framePng(set.name, i)).toEqual({
            width: SIZE,
            height: SIZE,
          });
          expect(inRepo(svgPath(set.name, i)), svgPath(set.name, i)).toBe(true);
        });
        expect(inRepo(framePng(set.name, set.poses.length))).toBe(false);
      });

      test('the manifest row agrees with the poses', () => {
        const row =
          set.mood === undefined ? MANIFEST.transitions[set.name] : MANIFEST.moods[set.mood];
        expect(row).toMatchObject({
          frames: set.poses.length,
          ms: set.ms,
          w: SIZE,
          h: SIZE,
          motion: set.motion,
        });
      });
    });
  });

  test('the preview page and the licence note ship beside the sheets', () => {
    expect(inRepo(`${PUBLIC_DIR}/preview.html`)).toBe(true);
    expect(inRepo(`${PUBLIC_DIR}/LICENSES.md`)).toBe(true);
    const html = readRepo(`${PUBLIC_DIR}/preview.html`).toString('utf8');
    SETS.forEach((set) => {
      expect(html).toContain(`url(${set.name}.png)`);
    });
  });
});
