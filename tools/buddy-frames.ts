// The RPS buddy (docs/design/rps-buddy.md): the animated face the floating island shows and the
// web page's static one. Five moods off the counter (very sad −5 in blue, sad −4..−2, neutral
// −1..1 in pale yellow, happy 2..4, very happy 5 in bright yellow), a motion each (sulk, walk,
// bounce) and one hop between each adjacent pair (played backwards for the way down). Every frame
// is drawn here from a pose (a body ellipse, eyes, a mouth curve, feet, a tear, a sparkle) on a
// 24x24 pixel grid: integer rects, `shape-rendering: crispEdges`, no anti-aliasing, so the art is
// pixel art by construction and regenerable from this table. The poses become SVG frames under
// tools/buddy/<set>/<nn>.svg (committed: the editable art), Chromium (the repo's Playwright
// browser) renders each set's sheet and cuts the frames from it into web/public/games/rps/buddy/
// (<set>/<nn>.png beside <set>.png, frames x 24 wide), and buddy.json and preview.html beside them
// are written from the same table. tools/buddy-frames.test.ts holds the manifest to the files.
//   node --experimental-strip-types tools/buddy-frames.ts             # draw the SVGs, render everything
//   node --experimental-strip-types tools/buddy-frames.ts --from-svg  # render the SVGs on disk as they are
// Then `node node_modules/prettier/bin/prettier.cjs --write web/public/games/rps/buddy` (the
// manifest and the preview page are formatted files).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type Browser, chromium } from '@playwright/test';

import { REPO_ROOT, isMain } from './legacy/extract.ts';

export type Mood = 'very-sad' | 'sad' | 'neutral' | 'happy' | 'very-happy';

/** The moods in counter order, −5 up to +5. */
export const MOODS: ReadonlyArray<Mood> = ['very-sad', 'sad', 'neutral', 'happy', 'very-happy'];

/** One frame's side in pixels; the sheet is `frames * SIZE` wide and SIZE tall. */
export const SIZE = 24;

/** The served folder (Vite copies public/ verbatim: games/rps/buddy/ on both origins). */
export const PUBLIC_DIR = 'web/public/games/rps/buddy';

/** The drawn frames, one SVG each, beside this tool. */
export const SVG_DIR = 'tools/buddy';

/** The counter band a mood covers, inclusive. */
export const BANDS: Readonly<Record<Mood, Readonly<{ min: number; max: number }>>> = {
  'very-sad': { min: -5, max: -5 },
  sad: { min: -4, max: -2 },
  neutral: { min: -1, max: 1 },
  happy: { min: 2, max: 4 },
  'very-happy': { min: 5, max: 5 },
};

/** The mood for a counter value; the counter is clamped to −5..5 first. */
export const moodFor = (counter: number): Mood => {
  const c = Math.max(-5, Math.min(5, Math.round(counter)));
  return MOODS.find((mood) => c >= BANDS[mood].min && c <= BANDS[mood].max) ?? 'neutral';
};

/**
 * The body colour: the owner's blue, pale yellow and bright yellow with a step between each, the
 * clip model's `Mood.fill` (docs/design/rps-island.md §4) so the island and the page agree.
 */
export const PALETTE: Readonly<Record<Mood, string>> = {
  'very-sad': '#3b6fd6',
  sad: '#6c9bea',
  neutral: '#f2e6a8',
  happy: '#f5cd3b',
  'very-happy': '#ffd200',
};

/** The band's name on the wire (`Mood`'s raw value in the clip; rps-island.md §8). */
export const BAND_NAMES: Readonly<Record<Mood, string>> = {
  'very-sad': 'verySad',
  sad: 'sad',
  neutral: 'neutral',
  happy: 'happy',
  'very-happy': 'veryHappy',
};

export type Motion = 'sulk' | 'walk' | 'bounce' | 'hop';

export const MOTIONS: Readonly<Record<Mood, Motion>> = {
  'very-sad': 'sulk',
  sad: 'sulk',
  neutral: 'walk',
  happy: 'bounce',
  'very-happy': 'bounce',
};

export type Eyes = 'open' | 'closed';
export type Feet = 'none' | 'both' | 'left' | 'right';

/** One frame, before it is drawn. Distances in pixels; `lift` raises the body off the floor. */
export type Pose = Readonly<{
  body: string;
  rx: number;
  ry: number;
  lift: number;
  eyeDy: number;
  eyes: Eyes;
  /** The mouth's bend: positive bows down in the middle (a smile), negative up (a frown), 0 flat. */
  mouth: number;
  mouthW: number;
  open: boolean;
  feet: Feet;
  /** 0 for none, else how far the tear has slid down the cheek. */
  tear: number;
  /** 0 for none, 1 or 2 for which corner sparkles. */
  sparkle: number;
}>;

/** A mood's resting face: everything but its motion. */
export const rest = (mood: Mood): Pose => ({
  body: PALETTE[mood],
  rx: 8,
  ry: 7,
  lift: 0,
  eyeDy: mood === 'very-sad' ? 1 : 0,
  eyes: 'open',
  mouth: { 'very-sad': -2, sad: -1, neutral: 0, happy: 2, 'very-happy': 2 }[mood],
  mouthW: { 'very-sad': 3, sad: 3, neutral: 2, happy: 3, 'very-happy': 4 }[mood],
  open: mood === 'very-happy',
  feet: 'none',
  tear: 0,
  sparkle: 0,
});

/** The sulk's droop cycle: down over three frames and back, so the loop never snaps. */
const DROOP: ReadonlyArray<number> = [0, 1, 2, 3, 2, 1];

const sulk = (mood: Mood, deep: boolean): ReadonlyArray<Pose> =>
  DROOP.map((d) => ({
    ...rest(mood),
    ry: d >= (deep ? 2 : 3) ? 6 : 7,
    rx: deep && d >= 2 ? 9 : 8,
    eyeDy: rest(mood).eyeDy + (d >= (deep ? 1 : 2) ? 1 : 0),
    tear: deep ? d : 0,
  }));

const WALK_FEET: ReadonlyArray<Feet> = ['left', 'both', 'right', 'both'];

const walk = (mood: Mood): ReadonlyArray<Pose> =>
  WALK_FEET.map((feet, i) => ({ ...rest(mood), feet, lift: i % 2 }));

type Squash = Readonly<{ rx: number; ry: number; lift: number }>;

/** Squash on the floor, stretch on the way up, round at the top, stretch down, squash on landing. */
const BOUNCE: ReadonlyArray<Squash> = [
  { rx: 8, ry: 7, lift: 0 },
  { rx: 9, ry: 6, lift: 0 },
  { rx: 7, ry: 8, lift: 2 },
  { rx: 8, ry: 7, lift: 5 },
  { rx: 7, ry: 8, lift: 2 },
  { rx: 9, ry: 6, lift: 0 },
];

const BIG_BOUNCE: ReadonlyArray<Squash> = [
  { rx: 8, ry: 7, lift: 0 },
  { rx: 10, ry: 5, lift: 0 },
  { rx: 7, ry: 8, lift: 3 },
  { rx: 8, ry: 7, lift: 7 },
  { rx: 7, ry: 8, lift: 3 },
  { rx: 10, ry: 5, lift: 0 },
];

const bounce = (mood: Mood, arc: ReadonlyArray<Squash>, sparkles: boolean): ReadonlyArray<Pose> =>
  arc.map((squash, i) => ({ ...rest(mood), ...squash, sparkle: sparkles ? i % 3 : 0 }));

/** One hop between two moods: squash, blink up, land as the new face. */
const HOP: ReadonlyArray<Squash & Readonly<{ eyes: Eyes }>> = [
  { rx: 9, ry: 6, lift: 0, eyes: 'open' },
  { rx: 7, ry: 8, lift: 3, eyes: 'closed' },
  { rx: 8, ry: 7, lift: 3, eyes: 'closed' },
  { rx: 8, ry: 7, lift: 0, eyes: 'open' },
];

const channel = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16);

const hex2 = (n: number): string =>
  Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0');

/** The colour `t` of the way from `a` to `b` (both `#rrggbb`). */
export const mix = (a: string, b: string, t: number): string =>
  `#${[1, 3, 5].map((at) => hex2(channel(a, at) + (channel(b, at) - channel(a, at)) * t)).join('')}`;

const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

const hop = (from: Mood, to: Mood): ReadonlyArray<Pose> =>
  HOP.map((step, i) => {
    const t = i / (HOP.length - 1);
    const a = rest(from);
    const b = rest(to);
    return {
      ...(t < 0.5 ? a : b),
      ...step,
      body: mix(a.body, b.body, t),
      mouth: lerp(a.mouth, b.mouth, t),
      mouthW: lerp(a.mouthW, b.mouthW, t),
      eyeDy: lerp(a.eyeDy, b.eyeDy, t),
    };
  });

export type FrameSet = Readonly<{
  /** The folder and sheet name: the mood, or `<from>-to-<to>`. */
  name: string;
  motion: Motion;
  /** Milliseconds a frame holds. */
  ms: number;
  poses: ReadonlyArray<Pose>;
  mood?: Mood;
  from?: Mood;
  to?: Mood;
}>;

const MOOD_MS: Readonly<Record<Mood, number>> = {
  'very-sad': 220,
  sad: 240,
  neutral: 160,
  happy: 110,
  'very-happy': 90,
};

const posesFor = (mood: Mood): ReadonlyArray<Pose> => {
  switch (mood) {
    case 'very-sad':
      return sulk(mood, true);
    case 'sad':
      return sulk(mood, false);
    case 'neutral':
      return walk(mood);
    case 'happy':
      return bounce(mood, BOUNCE, false);
    case 'very-happy':
      return bounce(mood, BIG_BOUNCE, true);
  }
};

/** The transition's set name. */
export const hopName = (from: Mood, to: Mood): string => `${from}-to-${to}`;

/** Every set drawn: the five moods, then the four hops up the ladder. */
export const SETS: ReadonlyArray<FrameSet> = [
  ...MOODS.map((mood): FrameSet => ({
    name: mood,
    mood,
    motion: MOTIONS[mood],
    ms: MOOD_MS[mood],
    poses: posesFor(mood),
  })),
  ...MOODS.flatMap((from, i): ReadonlyArray<FrameSet> => {
    const to = MOODS[i + 1];
    return to === undefined
      ? []
      : [{ name: hopName(from, to), from, to, motion: 'hop', ms: 120, poses: hop(from, to) }];
  }),
];

// --- The raster ------------------------------------------------------------------------------

export type Pixel = Readonly<{ x: number; y: number; fill: string }>;

/** The row the body sits on with no lift; the two rows under it are the feet's. */
const FLOOR = SIZE - 3;
const INK = '#2a2622';
const TEAR = '#dff4ff';
const SPARK = '#fff6c4';

const grid: ReadonlyArray<Readonly<{ x: number; y: number }>> = Array.from(
  { length: SIZE * SIZE },
  (_, i) => ({ x: i % SIZE, y: Math.floor(i / SIZE) }),
);

const key = (x: number, y: number): string => `${String(x)},${String(y)}`;

/** The frame's pixels, back to front: body with its outline and highlight, then the face and feet. */
export const raster = (pose: Pose): ReadonlyArray<Pixel> => {
  const cx = SIZE / 2;
  const bottom = FLOOR - pose.lift + 1;
  const cy = bottom - pose.ry;
  const inside = (x: number, y: number): boolean =>
    ((x + 0.5 - cx) / pose.rx) ** 2 + ((y + 0.5 - cy) / pose.ry) ** 2 <= 1;
  const bodyCells = grid.filter(({ x, y }) => inside(x, y));
  const bodySet = new Set(bodyCells.map(({ x, y }) => key(x, y)));
  const edge = ({ x, y }: Readonly<{ x: number; y: number }>): boolean =>
    !bodySet.has(key(x - 1, y)) ||
    !bodySet.has(key(x + 1, y)) ||
    !bodySet.has(key(x, y - 1)) ||
    !bodySet.has(key(x, y + 1));
  const outline = mix(pose.body, '#000000', 0.35);
  const body: ReadonlyArray<Pixel> = bodyCells.map(({ x, y }) => ({
    x,
    y,
    fill: edge({ x, y }) ? outline : pose.body,
  }));
  const cyRow = Math.floor(cy);
  const shine: ReadonlyArray<Pixel> = [0, 1].map((i) => ({
    x: Math.round(cx - pose.rx * 0.55) + i,
    y: Math.round(cy - pose.ry * 0.6),
    fill: mix(pose.body, '#ffffff', 0.45),
  }));
  const eyeRow = cyRow - 3 + pose.eyeDy;
  const eyeCols: ReadonlyArray<number> = [cx - 4, cx - 3, cx + 2, cx + 3];
  const eyeRows: ReadonlyArray<number> = pose.eyes === 'open' ? [eyeRow, eyeRow + 1] : [eyeRow + 1];
  const eyes: ReadonlyArray<Pixel> = eyeCols.flatMap((x) =>
    eyeRows.map((y) => ({ x, y, fill: INK })),
  );
  const mouthRow = cyRow + 1 + pose.eyeDy;
  const mouthCols = Array.from({ length: pose.mouthW * 2 }, (_, i) => cx - pose.mouthW + i);
  const mouthY = (x: number): number => {
    const t = (x + 0.5 - cx) / pose.mouthW;
    return mouthRow + Math.round(pose.mouth * (1 - t * t));
  };
  const mouth: ReadonlyArray<Pixel> = mouthCols.flatMap((x) => {
    const y = mouthY(x);
    const rows = pose.open
      ? Array.from({ length: Math.abs(y - mouthRow) + 1 }, (_, i) => Math.min(y, mouthRow) + i)
      : [y];
    return rows.map((row) => ({ x, y: row, fill: INK }));
  });
  const footShift: Readonly<Record<Feet, readonly [number, number]>> = {
    none: [0, 0],
    both: [0, 0],
    left: [-1, 1],
    right: [1, -1],
  };
  const [leftShift, rightShift] = footShift[pose.feet];
  const feet: ReadonlyArray<Pixel> =
    pose.feet === 'none'
      ? []
      : [cx - 4 + leftShift, cx - 3 + leftShift, cx + 2 + rightShift, cx + 3 + rightShift].flatMap(
          (x) => [FLOOR + 1, FLOOR + 2].map((y) => ({ x, y, fill: outline })),
        );
  const tear: ReadonlyArray<Pixel> =
    pose.tear === 0
      ? []
      : [0, 1].map((i) => ({ x: cx - 5, y: eyeRow + 2 + pose.tear + i, fill: TEAR }));
  const sparkAt: Readonly<Record<number, readonly [number, number]>> = { 1: [3, 5], 2: [20, 4] };
  const spark = sparkAt[pose.sparkle];
  const sparkle: ReadonlyArray<Pixel> =
    spark === undefined
      ? []
      : [
          [0, 0],
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ].map(([dx = 0, dy = 0]) => ({ x: spark[0] + dx, y: spark[1] + dy, fill: SPARK }));
  return [...body, ...shine, ...eyes, ...mouth, ...feet, ...tear, ...sparkle].filter(
    ({ x, y }) => x >= 0 && x < SIZE && y >= 0 && y < SIZE,
  );
};

/** The frame as SVG: one 1x1 rect per pixel on a crisp 24-grid (later pixels paint over earlier). */
export const frameSvg = (pose: Pose): string => {
  const rects = raster(pose)
    .map(
      ({ x, y, fill }) =>
        `<rect x="${String(x)}" y="${String(y)}" width="1" height="1" fill="${fill}"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(SIZE)} ${String(SIZE)}" width="${String(SIZE)}" height="${String(SIZE)}" shape-rendering="crispEdges">${rects}</svg>\n`;
};

const inner = (svg: string): string => /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1] ?? '';

/** A set's sheet: its frames side by side, left to right, each in its own 24x24 cell. */
export const sheetSvg = (frames: ReadonlyArray<string>): string => {
  const width = frames.length * SIZE;
  const cells = frames
    .map(
      (svg, i) =>
        `<svg x="${String(i * SIZE)}" y="0" width="${String(SIZE)}" height="${String(SIZE)}" viewBox="0 0 ${String(SIZE)} ${String(SIZE)}">${inner(svg)}</svg>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(SIZE)}" width="${String(width)}" height="${String(SIZE)}" shape-rendering="crispEdges">${cells}</svg>`;
};

// --- The files ---------------------------------------------------------------------------------

/** `00`, `01`, ...: the frame's file stem. */
export const frameStem = (i: number): string => String(i).padStart(2, '0');

export const svgPath = (set: string, i: number): string => `${SVG_DIR}/${set}/${frameStem(i)}.svg`;
export const framePng = (set: string, i: number): string =>
  `${PUBLIC_DIR}/${set}/${frameStem(i)}.png`;
export const sheetPng = (set: string): string => `${PUBLIC_DIR}/${set}.png`;

export type SetEntry = Readonly<{
  frames: number;
  ms: number;
  sheet: string;
  w: number;
  h: number;
  motion: Motion;
}>;

export type Manifest = Readonly<{
  size: number;
  moods: Readonly<
    Record<Mood, SetEntry & Readonly<{ band: string; colour: string; min: number; max: number }>>
  >;
  transitions: Readonly<Record<string, SetEntry & Readonly<{ from: Mood; to: Mood }>>>;
  license: Readonly<{
    name: string;
    author: string;
    source: string;
    note: string;
  }>;
}>;

const entry = (set: FrameSet): SetEntry => ({
  frames: set.poses.length,
  ms: set.ms,
  sheet: `${set.name}.png`,
  w: SIZE,
  h: SIZE,
  motion: set.motion,
});

/** buddy.json's content, from the sets: what the web page and the clip read. */
export const manifest = (sets: ReadonlyArray<FrameSet>): Manifest => ({
  size: SIZE,
  moods: Object.fromEntries(
    sets
      .filter((set) => set.mood !== undefined)
      .map((set) => {
        const mood = set.mood ?? 'neutral';
        return [
          mood,
          { ...entry(set), band: BAND_NAMES[mood], colour: PALETTE[mood], ...BANDS[mood] },
        ];
      }),
  ) as Manifest['moods'],
  transitions: Object.fromEntries(
    sets
      .filter((set) => set.from !== undefined && set.to !== undefined)
      .map((set) => [
        set.name,
        { ...entry(set), from: set.from ?? 'neutral', to: set.to ?? 'neutral' },
      ]),
  ),
  license: {
    name: 'original',
    author: 'drawn in this repository by tools/buddy-frames.ts',
    source: 'https://github.com/AriSweedler/games/blob/main/tools/buddy-frames.ts',
    note: 'Original pixel art, no third-party assets; see LICENSES.md beside this file.',
  },
});

export const MANIFEST: Manifest = manifest(SETS);

/** The preview page: every set looping through CSS steps() over its sheet, at `scale` pixels per pixel. */
export const previewHtml = (sets: ReadonlyArray<FrameSet>, scale = 6): string => {
  const px = (n: number): string => `${String(n * scale)}px`;
  const rows = sets
    .map(
      (set) => `      <figure>
        <div class="buddy" style="--frames: ${String(set.poses.length)}; --ms: ${String(set.ms)}; background-image: url(${set.name}.png)"></div>
        <figcaption><code>${set.name}</code> · ${set.motion} · ${String(set.poses.length)} × ${String(set.ms)} ms</figcaption>
      </figure>`,
    )
    .join('\n');
  const table = sets
    .map(
      (set) =>
        `        <tr><td><code>${set.name}</code></td><td>${set.motion}</td><td>${String(set.poses.length)}</td><td>${String(set.ms)}</td><td>${String(set.poses.length * set.ms)}</td><td><code>${set.name}.png</code></td></tr>`,
    )
    .join('\n');
  const ladder = JSON.stringify(
    sets.map(({ name, poses, ms }) => ({ name, frames: poses.length, ms })),
  );
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RPS buddy frames</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        margin: 0;
        padding: 24px 16px;
        background: #111;
        color: #eee;
        font: 14px/1.4 system-ui, sans-serif;
      }
      h1 {
        font-size: 18px;
        margin: 0 0 16px;
      }
      .sets {
        display: flex;
        flex-wrap: wrap;
        gap: 24px 32px;
        margin: 0 0 32px;
      }
      figure {
        margin: 0;
        text-align: center;
      }
      figcaption {
        margin-top: 8px;
        color: #aaa;
      }
      .buddy {
        display: block;
        width: ${px(SIZE)};
        height: ${px(SIZE)};
        margin: 0 auto;
        background-repeat: no-repeat;
        background-size: calc(var(--frames) * ${px(SIZE)}) ${px(SIZE)};
        image-rendering: pixelated;
        animation: play calc(var(--frames) * var(--ms) * 1ms) steps(var(--frames)) infinite;
      }
      .buddy.once {
        animation-iteration-count: 1;
        animation-fill-mode: forwards;
      }
      .buddy.back {
        animation-direction: reverse;
      }
      @keyframes play {
        to {
          background-position: calc(var(--frames) * -${px(SIZE)}) 0;
        }
      }
      .island {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        padding: 6px 18px;
        border-radius: 999px;
        background: #000;
        border: 1px solid #333;
      }
      .island .buddy {
        width: ${String(SIZE * 2)}px;
        height: ${String(SIZE * 2)}px;
        background-size: calc(var(--frames) * ${String(SIZE * 2)}px) ${String(SIZE * 2)}px;
      }
      .island .buddy.play {
        animation-name: play-small;
      }
      @keyframes play-small {
        to {
          background-position: calc(var(--frames) * -${String(SIZE * 2)}px) 0;
        }
      }
      table {
        border-collapse: collapse;
        margin-top: 16px;
      }
      td,
      th {
        padding: 4px 12px;
        border-bottom: 1px solid #333;
        text-align: left;
      }
    </style>
  </head>
  <body>
    <h1>RPS buddy: every set, ${String(SIZE)} × ${String(SIZE)} px at ${String(scale)}×</h1>
    <div class="sets">
${rows}
    </div>
    <h1>The ladder: −5 up to +5 and back, a hop between each step (2×, ${String(SIZE * 2)} px: about the island's height)</h1>
    <div class="island"><span id="counter">−5</span><span id="ladder" class="buddy play"></span><span id="label">very-sad</span></div>
    <h1>Frame table</h1>
    <table>
      <thead>
        <tr><th>set</th><th>motion</th><th>frames</th><th>ms/frame</th><th>loop ms</th><th>sheet</th></tr>
      </thead>
      <tbody>
${table}
      </tbody>
    </table>
    <script>
      const sets = ${ladder};
      const moods = sets.slice(0, 5);
      const hops = sets.slice(5);
      const el = document.getElementById('ladder');
      const label = document.getElementById('label');
      const counter = document.getElementById('counter');
      const show = (set, cls) => {
        el.className = 'buddy play ' + cls;
        el.style.setProperty('--frames', String(set.frames));
        el.style.setProperty('--ms', String(set.ms));
        el.style.backgroundImage = 'url(' + set.name + '.png)';
        label.textContent = set.name;
      };
      const steps = [...moods.keys(), ...moods.keys()].map((i, k) => (k < 5 ? i : 4 - (k - 5)));
      let k = 0;
      const tick = () => {
        const i = steps[k % steps.length];
        const next = steps[(k + 1) % steps.length];
        counter.textContent = ['−5', '−3', '0', '3', '5'][i];
        show(moods[i], '');
        setTimeout(() => {
          const up = next > i;
          const hop = hops[Math.min(i, next)];
          show(hop, up ? 'once' : 'once back');
          k += 1;
          setTimeout(tick, hop.frames * hop.ms);
        }, 1800);
      };
      tick();
    </script>
  </body>
</html>
`;
};

// --- The render ---------------------------------------------------------------------------------

const writeRepoFile = (path: string, content: string): void => {
  const out = resolve(REPO_ROOT, path);
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(out, content);
};

const page = (svg: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`;

const renderSet = async (
  browser: Browser,
  set: FrameSet,
  frames: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> => {
  const width = frames.length * SIZE;
  const tab = await browser.newPage({ viewport: { width, height: SIZE }, deviceScaleFactor: 1 });
  await tab.setContent(page(sheetSvg(frames)));
  const sheet = sheetPng(set.name);
  mkdirSync(resolve(REPO_ROOT, PUBLIC_DIR, set.name), { recursive: true });
  await tab.screenshot({ path: resolve(REPO_ROOT, sheet), omitBackground: true });
  const written = await Promise.all(
    frames.map(async (_, i) => {
      const path = framePng(set.name, i);
      await tab.screenshot({
        path: resolve(REPO_ROOT, path),
        omitBackground: true,
        clip: { x: i * SIZE, y: 0, width: SIZE, height: SIZE },
      });
      return path;
    }),
  );
  await tab.close();
  return [sheet, ...written];
};

const main = async (argv: ReadonlyArray<string>): Promise<void> => {
  const fromSvg = argv.includes('--from-svg');
  const drawn: ReadonlyArray<ReadonlyArray<string>> = SETS.map((set) =>
    set.poses.map((pose, i) => {
      if (fromSvg) return readFileSync(resolve(REPO_ROOT, svgPath(set.name, i)), 'utf8');
      const svg = frameSvg(pose);
      writeRepoFile(svgPath(set.name, i), svg);
      return svg;
    }),
  );
  const browser = await chromium.launch();
  try {
    const written = await Promise.all(
      SETS.map((set, i) => renderSet(browser, set, drawn[i] ?? [])),
    );
    written.flat().forEach((path) => {
      console.log(`${path}: written`);
    });
  } finally {
    await browser.close();
  }
  writeRepoFile(`${PUBLIC_DIR}/buddy.json`, `${JSON.stringify(MANIFEST, null, 2)}\n`);
  writeRepoFile(`${PUBLIC_DIR}/preview.html`, previewHtml(SETS));
  console.log(`${PUBLIC_DIR}/buddy.json, ${PUBLIC_DIR}/preview.html: written`);
};

if (isMain(import.meta.url)) await main(process.argv.slice(2));
