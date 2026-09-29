// The shell's device emulator (docs/design/devices.md; the owner, 2026-09-28: "there should be a
// CLI to interact with the shell engine in order to validate this and emulate", and "Part of the
// tests should create screenshots of the app in an emulator. I should be able to peruse those
// locally and decide for myself if they all look good before shipping to customers"). Four
// commands over the one catalogue (web/shared/lib/devices.ts) and backgammon's CSS twin
// (web/games/backgammon/src/ui/board/layout.ts), so what this tool prints is what the page
// computes, never a second table. Two pages: backgammon (the board) and UI Sandbox
// (web/games/ui-sandbox, docs/design/ui-sandbox.md: the frame and the safe-area map around the
// layout examples), `--game` picking one; a sweep without it renders and checks both.
//   list                      the catalogue as a table: screen, dpr, insets, corner, cut, the bar ranges
//   explain --device <id> [--orientation portrait|landscape] [--mode browser|standalone|fullscreen] [--bar shown|hidden] [--game ..]
//                             one case: the match, the corner and which corners are the screen's,
//                             the viewport the bar leaves, then backgammon's edge paddings, landscape
//                             scheme, point width and length, chrome heights and board room, or the
//                             sandbox's safe-area map (the cut's side and span, the ears, every
//                             edge's segments, where examples (g) and (h) land) per orientation type
//   render (--device <id> | --all) [--orientation ..] [--mode ..] [--bar ..] [--game ..] (--url <site> | --serve) [--out <dir|png>]
//                             Playwright Chromium at the device's viewport, screen and pixel ratio
//                             (`isMobile`, `hasTouch`), the insets through the theme's seam;
//                             backgammon: drives pass and play to the rolled board and shoots the
//                             home, the curtain, the roll modal and the board; the sandbox: the
//                             preview screen under each orientation type (both landscapes through
//                             the page's `?type=`, since no emulator sets `screen.orientation.type`)
//                             with examples (a), (f), (g), (h) and (i), the readout's device line
//                             under the shots; `--all` sweeps every device x orientation x mode (the
//                             tab twice: bar shown and hidden) into a folder with an index.html
//                             contact sheet; a `.png` --out shoots the board (or example (h)) alone
//   check (--device <id> | --all) [..] [--game ..] (--url <site> | --serve) [--json <file>]
//                             the same drive, then per case: backgammon, the trim's computed radius
//                             equals the catalogue's, the board fills its room sideways (`boardRoom`,
//                             to half a pixel), the content clears the band by 4px, no document
//                             scroll above the floor, every tap target 44px; the sandbox, what
//                             e2e/ui-sandbox.spec.ts asserts (the four corners per the reach rule,
//                             the device matched, the map the module's, (a) fits with 11px clearance,
//                             (g) in the free segment, (h) exactly the map's ears and none over an
//                             arc or the cut, no scroll); a summary table per game, a JSON report,
//                             exit 1 on any failure
// Examples (`npm run build` first for --serve, which serves dist/ on a free port):
//   node --experimental-strip-types tools/shell-emulate.ts list
//   node --experimental-strip-types tools/shell-emulate.ts explain --device iphone-393x852 --orientation landscape --mode browser
//   node --experimental-strip-types tools/shell-emulate.ts explain --device iphone-393x852 --game ui-sandbox
//   node --experimental-strip-types tools/shell-emulate.ts render --device iphone-390x844 --orientation landscape --serve --out /tmp/board.png
//   node --experimental-strip-types tools/shell-emulate.ts render --all --serve             # = npm run shots, both games
//   node --experimental-strip-types tools/shell-emulate.ts check --all --serve --json shots/check.json
// The seam: headless Chromium reads every `env(safe-area-inset-*)` as 0 and no CDP call sets them
// (Chromium 153's `Emulation.setSafeAreaInsetsOverride` refuses every parameter shape), so an init
// script writes the case's insets on `#app` as `--inset-l/-r/-b` (the theme's own variables, its
// comment naming them the seam a measurement overrides) and the notch on the root as
// the four `--frame-inset-*` (what shell.css's `env()` would read), which the boot then reads and
// replaces with the class's radius exactly as on a phone. `display-mode` cannot be emulated either
// and no stylesheet reads it: the mode drives the viewport and the insets alone. Screenshots are at
// the device's pixel ratio. The pure parts (the arguments, the case list, the explain text, the
// verdict, the sheet) are tools/shell-emulate.test.ts's.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { chromium, type Browser, type Page } from '@playwright/test';

import {
  LANDSCAPE_GEOMETRY,
  RAIL_MIN_WIDTH,
  boardRoom,
  chromeHeight,
  chromeWidth,
  edgeOf,
  layoutFor,
  paddingOf,
  pointLength,
  pointWidth,
  type Layout,
  type Viewport,
} from '../web/games/backgammon/src/ui/board/layout.ts';
import {
  BARS,
  CORNER_KEYS,
  DEVICES,
  EVERY_CORNER,
  DISPLAY_MODES,
  ORIENTATIONS,
  deviceById,
  deviceOf,
  emulationFor,
  emulationName,
  emulationsOf,
  cornersOf,
  screenFor,
  type Bar,
  type Corners,
  type Device,
  type DisplayMode,
  type Emulation,
  type Orientation,
} from '../web/shared/lib/devices.ts';
import {
  EDGES,
  lengthOf,
  safeAreaMap,
  type OrientationType,
  type SafeAreaMap,
  type Segment,
} from '../web/shared/lib/safeArea.ts';
import { PAGES_BASE_PATH } from '../e2e/fixtures/site.ts';
import { startServer } from './serve-dist.ts';

export type Command = 'list' | 'explain' | 'render' | 'check';
/** The two pages the emulator drives. */
export type GameName = 'backgammon' | 'ui-sandbox';
export const GAME_NAMES: ReadonlyArray<GameName> = ['backgammon', 'ui-sandbox'];
export type EmulateArgs = Readonly<{
  command: Command;
  device: string | null;
  all: boolean;
  orientation: Orientation | null;
  mode: DisplayMode | null;
  bar: Bar | null;
  /** `--game`: one page; null is both under `--all`, backgammon alone for one `--device` (`gamesFor`). */
  game: GameName | null;
  url: string | null;
  serve: boolean;
  out: string | null;
  json: string | null;
}>;

const COMMANDS: ReadonlyArray<Command> = ['list', 'explain', 'render', 'check'];
const oneOf = <T extends string>(
  name: string,
  value: string | undefined,
  allowed: ReadonlyArray<T>,
): T | null => {
  if (value === undefined) return null;
  if ((allowed as ReadonlyArray<string>).includes(value)) return value as T;
  throw new Error(`--${name} must be one of ${allowed.join(', ')}, got: ${value}`);
};

/** The command line: the command first, then its options; a bad value is an error naming the choices. */
export const parseEmulateArgs = (argv: ReadonlyArray<string>): EmulateArgs => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      device: { type: 'string' },
      all: { type: 'boolean', default: false },
      orientation: { type: 'string' },
      mode: { type: 'string' },
      bar: { type: 'string' },
      game: { type: 'string' },
      url: { type: 'string' },
      serve: { type: 'boolean', default: false },
      out: { type: 'string' },
      json: { type: 'string' },
    },
  });
  const command = oneOf('command', positionals[0] ?? 'list', COMMANDS);
  if (command === null || positionals.length > 1)
    throw new Error(`one command of ${COMMANDS.join(', ')}`);
  const device = values.device ?? null;
  if (device !== null && deviceById(device) === null)
    throw new Error(`--device ${device} is not in the catalogue; \`list\` prints the ids`);
  return {
    command,
    device,
    all: values.all,
    orientation: oneOf('orientation', values.orientation, ORIENTATIONS),
    mode: oneOf('mode', values.mode, DISPLAY_MODES),
    bar: oneOf('bar', values.bar, BARS),
    game: oneOf('game', values.game, GAME_NAMES),
    url: values.url ?? null,
    serve: values.serve,
    out: values.out ?? null,
    json: values.json ?? null,
  };
};

/**
 * The cases an invocation names: `--all` every supported device (the SE 1st gen is catalogued for
 * the record and held to no promise: its board overflows the 44px point floor sideways and its
 * last iOS cannot run the theme; `--device` reaches it), the filters narrowing orientation, mode
 * and bar; else the one device at the given or default orientation (landscape), mode (browser)
 * and bar (shown); a tab is rendered twice under `--all` unless `--bar` picks one.
 */
export const casesFor = (args: EmulateArgs): ReadonlyArray<Emulation> => {
  if (args.all) {
    return DEVICES.filter((d) => d.supported).flatMap((d) =>
      emulationsOf(d).filter((e) => narrowed(args, e)),
    );
  }
  const device = args.device === null ? null : deviceById(args.device);
  if (device === null) throw new Error('--device <id> or --all');
  return [
    emulationFor(
      device,
      args.orientation ?? 'landscape',
      args.mode ?? 'browser',
      args.bar ?? 'shown',
    ),
  ];
};

/** The `--orientation`, `--mode` and `--bar` filters over one case (the bar matters in a tab alone). */
const narrowed = (args: EmulateArgs, e: Emulation): boolean =>
  (args.orientation === null || e.orientation === args.orientation) &&
  (args.mode === null || e.mode === args.mode) &&
  (args.bar === null || e.mode !== 'browser' || e.bar === args.bar);

/** The pages an invocation drives: `--game`'s; else both under `--all`, and backgammon alone for one `--device` (a `.png` --out shoots its board, as it did). */
export const gamesFor = (args: EmulateArgs): ReadonlyArray<GameName> =>
  args.game !== null ? [args.game] : args.all ? GAME_NAMES : ['backgammon'];

// ---- UI Sandbox's cases ----------------------------------------------------------------------------

/** One sandbox case: the emulation and the `screen.orientation.type` the page is told (`?type=`), which puts the cut on the left or the right sideways. */
export type SandboxCase = Readonly<{ e: Emulation; type: OrientationType }>;

/** The orientation types a case is rendered under: both landscapes (the cut on the left, then on the right), the one portrait. */
export const typesOf = (o: Orientation): ReadonlyArray<OrientationType> =>
  o === 'landscape' ? ['landscape-primary', 'landscape-secondary'] : ['portrait-primary'];

/** UI Sandbox's phones: every supported row but the iPads (no cut, the desktop template), as e2e/ui-sandbox.spec.ts sweeps them. */
export const SANDBOX_PHONES: ReadonlyArray<Device> = DEVICES.filter(
  (d) => d.kind !== 'ipad' && d.supported,
);

/** The sandbox's cases for an invocation: `casesFor`'s emulations over the phones, each under its orientation types; e2e/ui-sandbox.spec.ts's 56 (sideways bar-up twice, sideways fullscreen, upright bar-up) are among `--all`'s. */
export const sandboxCasesFor = (args: EmulateArgs): ReadonlyArray<SandboxCase> => {
  const withTypes = (es: ReadonlyArray<Emulation>): ReadonlyArray<SandboxCase> =>
    es.flatMap((e) => typesOf(e.orientation).map((type) => ({ e, type })));
  if (args.all)
    return withTypes(
      SANDBOX_PHONES.flatMap((d) => emulationsOf(d).filter((e) => narrowed(args, e))),
    );
  return withTypes(casesFor(args));
};

/** A sandbox case's name: the emulation's, then the type. */
export const sandboxName = (c: SandboxCase): string => `${emulationName(c.e)} ${c.type}`;

/** The row the page can tell for a case: upright in a tab the notch reads 0, so two classes on one screen part by their pixel ratio alone. */
export const sandboxMatch = (e: Emulation): Device | null =>
  deviceOf({ screen: e.screen, dpr: e.dpr, notch: e.notch });

/** The safe-area map the module computes for a case: what the page must write (e2e/ui-sandbox.spec.ts asserts the same). */
export const sandboxMap = (c: SandboxCase): SafeAreaMap =>
  safeAreaMap({
    corners: c.e.corners,
    cut: sandboxMatch(c.e)?.cut ?? null,
    type: c.type,
    insets: c.e.insets,
    viewport: c.e.viewport,
    full: screenFor(c.e.device, c.e.orientation),
  });

/** The vertical edge without the cut, or null: where example (g)'s rail goes. */
export const freeSideOf = (map: SafeAreaMap): 'left' | 'right' | null =>
  map.cutEdge === 'left' ? 'right' : map.cutEdge === 'right' ? 'left' : null;

/** How many ears example (h) shows: the cut's vertical edge's segments, 0 for a cut on a horizontal edge or none. */
export const earsOf = (map: SafeAreaMap): number =>
  map.cutEdge === 'left' || map.cutEdge === 'right' ? map.edges[map.cutEdge].length : 0;

const px = (n: number): string => String(Math.round(n * 100) / 100);
const pad = (s: string, n: number): string => s.padEnd(n);
/** A row's cut as the readout spells it: `126 island`, `209 notch`, `none`. */
const cutText = (cut: Device['cut']): string =>
  cut === null ? 'none' : `${String(cut.length)} ${cut.island ? 'island' : 'notch'}`;
const segmentText = (s: Segment): string => `${px(s.from)}-${px(s.to)} (${px(lengthOf(s))})`;

/** `list`: the catalogue, one line per row. */
export const listText = (): string => {
  const head = [
    pad('id', 26),
    pad('screen', 9),
    pad('dpr', 6),
    pad('up t/b', 8),
    pad('side l/r/b', 11),
    pad('corner', 7),
    pad('cut', 11),
    pad('bar up', 8),
    pad('bar side', 9),
    pad('', 11),
    'models',
  ].join(' ');
  const rows = DEVICES.map((d) =>
    [
      pad(d.id, 26),
      pad(`${String(d.screen.width)}x${String(d.screen.height)}`, 9),
      pad(String(d.dpr), 6),
      pad(`${String(d.insets.portrait.top)}/${String(d.insets.portrait.bottom)}`, 8),
      pad(
        `${String(d.insets.landscape.left)}/${String(d.insets.landscape.right)}/${String(d.insets.landscape.bottom)}`,
        11,
      ),
      pad(String(d.corner), 7),
      pad(cutText(d.cut), 11),
      pad(`${String(d.toolbar.portrait.min)}-${String(d.toolbar.portrait.max)}`, 8),
      pad(`${String(d.toolbar.landscape.min)}-${String(d.toolbar.landscape.max)}`, 9),
      pad(d.verified ? '' : 'UNVERIFIED', 11),
      d.models,
    ].join(' '),
  );
  return [head, ...rows].join('\n');
};

/** The twin's viewport for a case: coarse pointer, the case's side and bottom insets. */
export const twinViewport = (e: Emulation): Viewport => ({
  width: e.viewport.width,
  height: e.viewport.height,
  coarse: true,
  insets: { left: e.insets.left, right: e.insets.right, bottom: e.insets.bottom },
});

/**
 * theme.css §3.10's two scroll tiers: upright the 44px point floor needs 806px, so at most 805px
 * tall the document scrolls; the desktop board floors at 40px points and scrolls at most 645px tall
 * (`@media (max-height: 805px) and (max-width: 899px)`, `(max-height: 645px) and (min-width: 900px)`).
 * Sideways the tier is the landscape floor's own height (`floorHeight` below).
 */
export const PHONE_SCROLL_MAX_HEIGHT = 805;
export const DESKTOP_SCROLL_MAX_HEIGHT = 645;

/** What the twin says of a case: the layout and, sideways, every number the CSS computes. */
export type Twin = Readonly<{
  layout: Layout;
  scheme: 'rail' | 'rows' | null;
  edge: number;
  chromeW: number;
  pointW: number;
  padding: Readonly<{ top: number; bottom: number }>;
  chromeH: number;
  room: Readonly<{ top: number; bottom: number }>;
  pointLen: number;
  floor: number;
  /** Sideways, the height under which the floor holds and the document scrolls. */
  floorHeight: number;
  /** The document scrolls by design: under the landscape floor, or in the §3.10 tiers upright and on the desktop. */
  scrolls: boolean;
}>;

export const twinOf = (e: Emulation): Twin => {
  const vp = twinViewport(e);
  const layout = layoutFor(vp);
  const s = vp.width >= RAIL_MIN_WIDTH ? LANDSCAPE_GEOMETRY.rail : LANDSCAPE_GEOMETRY.rows;
  const padding = paddingOf(vp);
  const floor = s.minPointLen - (padding.top + padding.bottom - s.padTop - s.padBottom) / 2;
  const chromeH = chromeHeight(vp);
  const floorHeight = 2 * floor + LANDSCAPE_GEOMETRY.frame + chromeH;
  return {
    layout,
    scheme: layout === 'landscape' ? (vp.width >= RAIL_MIN_WIDTH ? 'rail' : 'rows') : null,
    edge: edgeOf(vp),
    chromeW: chromeWidth(vp),
    pointW: pointWidth(vp),
    padding,
    chromeH,
    room: boardRoom(vp),
    pointLen: pointLength(vp),
    floor,
    floorHeight,
    scrolls:
      layout === 'landscape'
        ? vp.height < floorHeight
        : layout === 'phone'
          ? vp.height <= PHONE_SCROLL_MAX_HEIGHT
          : vp.height <= DESKTOP_SCROLL_MAX_HEIGHT,
  };
};

/** `explain`: one case, every number, from the same modules the page runs. */
export const explainText = (e: Emulation): string => {
  const d = e.device;
  const match = deviceOf({ screen: e.screen, dpr: e.dpr, notch: e.notch });
  const t = twinOf(e);
  const reach = CORNER_KEYS.map((c) => `${c} ${px(e.corners[c])}`).join('  ');
  const lines = [
    `${emulationName(e)}${d.verified ? '' : '  (UNVERIFIED row)'}`,
    `  ${d.models}`,
    `  screen ${String(e.screen.width)}x${String(e.screen.height)} @${String(e.dpr)}x  viewport ${String(e.viewport.width)}x${String(e.viewport.height)}${
      e.mode === 'browser'
        ? `  (bar ${e.bar}: ${String(d.toolbar[e.orientation][e.bar === 'shown' ? 'max' : 'min'])}px of ${String(d.toolbar[e.orientation].min)}-${String(d.toolbar[e.orientation].max)}, UNVERIFIED)`
        : ''
    }`,
    `  insets t/r/b/l ${String(e.insets.top)}/${String(e.insets.right)}/${String(e.insets.bottom)}/${String(e.insets.left)}  notch ${String(e.notch)}`,
    `  match ${match === null ? 'unknown (heuristic)' : match.id}  radius ${e.notch > 0 ? `${px(e.corner)}px` : 'none (square)'}  frame corners: ${reach}`,
    `  layout ${t.layout}${t.scheme === null ? '' : ` (${t.scheme})`}`,
  ];
  if (t.layout === 'landscape') {
    lines.push(
      `  edge ${px(t.edge)}  chrome-w ${px(t.chromeW)}  point-w ${px(t.pointW)}`,
      `  padding ${px(t.padding.top)}/${px(t.padding.bottom)}  chrome-h ${px(t.chromeH)}  room above/below ${px(t.room.top)}/${px(t.room.bottom)}`,
      `  point-len ${px(t.pointLen)} (floor ${px(t.floor)}; the floor holds under ${px(t.floorHeight)}px)  board ${px(2 * t.pointLen + LANDSCAPE_GEOMETRY.frame)} tall${t.scrolls ? '  SCROLLS (under the floor)' : ''}`,
    );
  }
  if (e.mode === 'browser') {
    const other = emulationFor(d, e.orientation, e.mode, e.bar === 'shown' ? 'hidden' : 'shown');
    const ot = twinOf(other);
    lines.push(
      `  bar ${other.bar}: viewport ${String(other.viewport.width)}x${String(other.viewport.height)}${
        ot.layout === 'landscape'
          ? `  point-len ${px(ot.pointLen)}  board ${px(2 * ot.pointLen + LANDSCAPE_GEOMETRY.frame)} tall${ot.scrolls ? '  SCROLLS' : ''}`
          : `  layout ${ot.layout}`
      }`,
    );
  }
  return lines.join('\n');
};

/** `explain --game ui-sandbox`: one case's safe-area map, from the same module the page runs, and where examples (g) and (h) land. */
export const explainSandboxText = (c: SandboxCase): string => {
  const e = c.e;
  const d = e.device;
  const match = sandboxMatch(e);
  const map = sandboxMap(c);
  const free = freeSideOf(map);
  const ears = earsOf(map);
  const reach = CORNER_KEYS.map((k) => `${k} ${px(e.corners[k])}`).join('  ');
  return [
    `${sandboxName(c)}${d.verified ? '' : '  (UNVERIFIED row)'}`,
    `  ${d.models}`,
    `  screen ${String(e.screen.width)}x${String(e.screen.height)} @${String(e.dpr)}x  viewport ${String(e.viewport.width)}x${String(e.viewport.height)}`,
    `  insets t/r/b/l ${String(e.insets.top)}/${String(e.insets.right)}/${String(e.insets.bottom)}/${String(e.insets.left)}  match ${match === null ? 'unknown (heuristic)' : match.id}  cut ${cutText(match?.cut ?? null)}`,
    `  frame corners: ${reach}`,
    `  cut side ${map.cutEdge}${map.cut === null ? (map.cutEdge === 'none' ? '' : ' (off the page: under the bar)') : `  at ${segmentText(map.cut)}`}  ear ${px(map.ear)}  free side ${free ?? 'none'}`,
    ...EDGES.map(
      (edge) =>
        `  safe ${edge}: ${map.edges[edge].length === 0 ? 'none' : map.edges[edge].map(segmentText).join(', ')}`,
    ),
    `  (g) rail: ${free === null || map.edges[free].length === 0 ? 'hidden (no free segment)' : `${free} segment 1`}  (h) ears: ${String(ears)}${ears === 0 && map.cutEdge !== 'none' && map.cut !== null ? ' (under 44px)' : ''}`,
  ].join('\n');
};

// ---- the page ----------------------------------------------------------------------------------

/** The init script for a case: the four insets on the root (shell.css's `--frame-inset-*`, what the boot reads for the frame) and on `#app` (the theme's `--inset-*` seam), before the boot reads either. */
export const seamScript = (e: Emulation): string => `(() => {
  const insets = ${JSON.stringify(e.insets)};
  const apply = () => {
    const root = document.documentElement;
    if (root === null) return false;
    root.style.setProperty('--frame-inset-top', insets.top + 'px');
    root.style.setProperty('--frame-inset-right', insets.right + 'px');
    root.style.setProperty('--frame-inset-bottom', insets.bottom + 'px');
    root.style.setProperty('--frame-inset-left', insets.left + 'px');
    const app = document.getElementById('app');
    if (app === null) return false;
    app.style.setProperty('--inset-l', insets.left + 'px');
    app.style.setProperty('--inset-r', insets.right + 'px');
    app.style.setProperty('--inset-b', insets.bottom + 'px');
    app.style.setProperty('--inset-t', insets.top + 'px');
    return true;
  };
  if (!apply()) {
    const mo = new MutationObserver(() => { if (apply()) mo.disconnect(); });
    mo.observe(document, { childList: true, subtree: true });
  }
})();`;

/** The frame's boxes sideways (e2e/fixtures/backgammon-geometry.ts LANDSCAPE_FRAME) and upright. */
const FRAME_SELECTORS: ReadonlyArray<string> = [
  '#tableScreen .topbar',
  '#statusLine',
  '#controls',
  '#tableScreen .opp-strip',
  '#gameBadge',
  '#tableScreen .me-strip',
  '#tableScreen .roll-slot',
  '#menuBtn',
  '#soundBtn',
];
/** What a finger may land on at the table (the geometry oracle's list, `#diceMini` excluded). */
const TARGET_SELECTOR =
  '#tableScreen .point, #tableScreen .bar, #tableScreen .off, #dice .die, #tableScreen .btn, #tableScreen .icon-btn, #tableScreen .chip';

export type Box = Readonly<{ x: number; y: number; w: number; h: number }>;
export type Measured = Readonly<{
  inner: Readonly<{ w: number; h: number }>;
  scrollHeight: number;
  board: Box | null;
  frame: Readonly<Record<string, Box | null>>;
  targets: ReadonlyArray<Readonly<{ sel: string; w: number; h: number }>>;
  /** `body::before`'s four computed corner radii in px (the frame's). */
  corners: Corners;
  /** The root's four `--frame-corner-*` as written, `/`-joined ('' where the boot wrote none). */
  rootCorners: string;
  /** `document.fullscreenElement` is set: the page asked for fullscreen (the Android lock at the table, which Chromium's emulated phone grants), so every corner is the screen's whatever the case's mode. */
  fullscreen: boolean;
  screen: readonly [number, number];
  dpr: number;
  coarse: boolean;
}>;

const MEASURE = `(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const board = document.getElementById('board');
  const frame = Object.fromEntries(${JSON.stringify(FRAME_SELECTORS)}.map((sel) => {
    const el = document.querySelector(sel);
    return [sel, el !== null && shown(el) ? rect(el) : null];
  }));
  const targets = Array.from(document.querySelectorAll(${JSON.stringify(TARGET_SELECTOR)})).filter(shown).map((el) => {
    const r = rect(el);
    return { sel: el.id !== '' ? '#' + el.id : '.' + String(el.className).split(' ')[0], w: r.w, h: r.h };
  });
  return {
    inner: { w: innerWidth, h: innerHeight },
    scrollHeight: document.documentElement.scrollHeight,
    board: board === null ? null : rect(board),
    frame,
    targets,
    corners: (() => { const cs = getComputedStyle(document.body, '::before'); const r = (v) => parseFloat(v) || 0; return { tl: r(cs.borderTopLeftRadius), tr: r(cs.borderTopRightRadius), br: r(cs.borderBottomRightRadius), bl: r(cs.borderBottomLeftRadius) }; })(),
    rootCorners: ['tl', 'tr', 'br', 'bl'].map((k) => getComputedStyle(document.documentElement).getPropertyValue('--frame-corner-' + k).trim()).filter((v) => v !== '').join('/'),
    fullscreen: document.fullscreenElement !== null,
    screen: [screen.width, screen.height],
    dpr: devicePixelRatio,
    coarse: matchMedia('(any-pointer: coarse)').matches,
  };
})()`;

export type Check = Readonly<{ name: string; pass: boolean; detail: string }>;
export type Verdict = Readonly<{ pass: boolean; checks: ReadonlyArray<Check> }>;
/** Half a pixel: the rounding between two reads of one layout. */
export const TOL = 0.5;
/** The trim's 6px band, its 1px hairline and the 4px of air the content keeps off it. */
export const CLEARANCE = 11;

/**
 * The invariants over a measurement (pure): the frame's four corners are the catalogue's radius
 * where the reach rule says the corner is the screen's and 0 elsewhere; sideways where
 * the viewport fits, the board's edges sit exactly `boardRoom` from the viewport's; every frame
 * box and the board clear the band by 4px; no document scroll above the floor (and the floor's
 * scroll under it); every tap target 44px on a phone.
 */
export const judge = (e: Emulation, m: Measured): Verdict => {
  const t = twinOf(e);
  const checks: Check[] = [];
  // The page in fullscreen (the Android lock, granted by Chromium's emulated phone at the table
  // while the viewport stays the case's) is the screen's on every corner, whatever the case's mode.
  const want = m.fullscreen ? cornersOf(e.corner, EVERY_CORNER) : e.corners;
  const corners = CORNER_KEYS.map((k) => `${k} ${px(m.corners[k])}`).join(' ');
  const expected = CORNER_KEYS.map((k) => `${k} ${px(want[k])}`).join(' ');
  checks.push({
    name: 'corner',
    pass: CORNER_KEYS.every((k) => Math.abs(m.corners[k] - want[k]) <= 0.01),
    detail: `frame ${corners}, catalogue ${expected}${m.fullscreen ? ' (page in fullscreen)' : ''} (root ${m.rootCorners === '' ? 'none' : m.rootCorners})`,
  });
  const board = m.board;
  const below = board === null ? NaN : m.inner.h - (board.y + board.h);
  if (t.layout === 'landscape' && !t.scrolls) {
    checks.push({
      name: 'fills',
      pass:
        board !== null &&
        Math.abs(board.y - t.room.top) <= TOL &&
        Math.abs(below - t.room.bottom) <= TOL,
      detail:
        board === null
          ? 'no #board'
          : `above ${px(board.y)} (room ${px(t.room.top)}), below ${px(below)} (room ${px(t.room.bottom)})`,
    });
  } else {
    checks.push({
      name: 'fills',
      pass: board !== null && board.y >= -TOL && (t.scrolls || below >= -TOL),
      detail:
        board === null
          ? 'no #board'
          : `${t.layout}${t.scrolls ? ', under the floor' : ''}: above ${px(board.y)}, below ${px(below)}`,
    });
  }
  const boxes = [...Object.values(m.frame), board].filter((b): b is Box => b !== null);
  const tight = boxes.filter(
    (b) =>
      b.x < CLEARANCE - TOL ||
      b.y < CLEARANCE - TOL ||
      b.x + b.w > m.inner.w - CLEARANCE + TOL ||
      (!t.scrolls && b.y + b.h > m.inner.h - CLEARANCE + TOL),
  );
  checks.push({
    name: 'clear',
    pass: tight.length === 0,
    detail:
      tight.length === 0
        ? `${String(boxes.length)} boxes ${String(CLEARANCE)}px off the edge`
        : `${String(tight.length)} within ${String(CLEARANCE)}px of the edge`,
  });
  const scrolls = m.scrollHeight > m.inner.h + 1;
  checks.push({
    name: 'scroll',
    pass: scrolls === t.scrolls,
    detail: `${scrolls ? 'scrolls' : 'no scroll'} (${String(m.scrollHeight)} in ${String(m.inner.h)}); the twin says ${t.scrolls ? 'under the floor' : 'fits'}`,
  });
  const small =
    t.layout === 'desktop' ? [] : m.targets.filter((x) => Math.min(x.w, x.h) < 44 - TOL);
  checks.push({
    name: 'targets',
    pass: small.length === 0,
    detail:
      small.length === 0
        ? `${String(m.targets.length)} targets, all 44px`
        : small.map((x) => `${x.sel} ${px(x.w)}x${px(x.h)}`).join(', '),
  });
  return { pass: checks.every((c) => c.pass), checks };
};

// ---- UI Sandbox: the measurement and the verdict ---------------------------------------------------

/** The layout examples shot and measured per sandbox case (src/examples.ts ids): (a), (f), (g), (h), (i). */
export const SANDBOX_EXAMPLES = ['cover', 'board', 'rail', 'ears', 'gutters'] as const;
export type SandboxExample = (typeof SANDBOX_EXAMPLES)[number];
export const EXAMPLE_LABELS: Readonly<Record<SandboxExample, string>> = {
  cover: '(a) one box',
  board: "(f) backgammon's shape",
  rail: '(g) rail on the free side',
  ears: '(h) buttons in the ears',
  gutters: '(i) symmetric gutters',
};

/** One example as the page reports it (`__uiSandbox.report()`), plus what is visible and the document's height. */
export type ExampleMeasure = Readonly<{
  fits: boolean;
  gaps: Readonly<Record<string, number>>;
  placements: ReadonlyArray<string>;
  /** Visible `.edge-rail .sq-btn` (example (g)). */
  railButtons: number;
  /** Visible `.ear` (example (h)). */
  ears: number;
  scrollHeight: number;
}>;
export type SandboxMeasured = Readonly<{
  inner: Readonly<{ w: number; h: number }>;
  /** `body::before`'s four computed corner radii in px (the frame's). */
  corners: Corners;
  /** `__uiSandbox.device()`: the row the page matched. */
  device: string | null;
  /** `__uiSandbox.map()`: the map the page wrote. */
  map: SafeAreaMap;
  /** The readout's first line (the device line), for the sheet. */
  deviceLine: string;
  examples: Readonly<Record<SandboxExample, ExampleMeasure>>;
}>;

const SANDBOX_PAGE = `(() => {
  const h = window.__uiSandbox;
  const cs = getComputedStyle(document.body, '::before');
  const r = (v) => parseFloat(v) || 0;
  return {
    inner: { w: innerWidth, h: innerHeight },
    corners: { tl: r(cs.borderTopLeftRadius), tr: r(cs.borderTopRightRadius), br: r(cs.borderBottomRightRadius), bl: r(cs.borderBottomLeftRadius) },
    device: h.device(),
    map: h.map(),
    deviceLine: h.readout().split('\\n')[0],
  };
})()`;
const SANDBOX_EXAMPLE = `(() => {
  const rep = window.__uiSandbox.report();
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const count = (sel) => Array.from(document.querySelectorAll(sel)).filter(shown).length;
  return {
    fits: rep !== null && rep.fits,
    gaps: rep === null ? {} : rep.gaps,
    placements: rep === null ? [] : rep.placements,
    railButtons: count('.edge-rail .sq-btn'),
    ears: count('.ear'),
    scrollHeight: document.documentElement.scrollHeight,
  };
})()`;

/**
 * The sandbox's invariants over a measurement (pure), the same e2e/ui-sandbox.spec.ts asserts, so
 * the CLI and the spec agree case for case: the frame's four corners are the catalogue's radius
 * where the reach rule says the corner is the screen's and 0 elsewhere; the page matched the
 * emulated row; the map the page wrote equals the module's; example (a) fits without scroll and
 * keeps 11px inside every edge; (g)'s three buttons sit in the free side's first segment (or the
 * rail is hidden where the map names none); (h) shows exactly the map's ears, none over an arc or
 * the cut; no example scrolls the document.
 */
export const judgeSandbox = (c: SandboxCase, m: SandboxMeasured): Verdict => {
  const e = c.e;
  const expected = sandboxMap(c);
  const matched = sandboxMatch(e)?.id ?? null;
  const checks: Check[] = [];
  const corners = CORNER_KEYS.map((k) => `${k} ${px(m.corners[k])}`).join(' ');
  const want = CORNER_KEYS.map((k) => `${k} ${px(e.corners[k])}`).join(' ');
  checks.push({
    name: 'corner',
    pass: CORNER_KEYS.every((k) => Math.abs(m.corners[k] - e.corners[k]) <= 0.01),
    detail: `frame ${corners}, catalogue ${want}`,
  });
  checks.push({
    name: 'device',
    pass: m.device === matched,
    detail: `page ${m.device ?? 'unknown'}, catalogue ${matched ?? 'unknown'}`,
  });
  const same = JSON.stringify(m.map) === JSON.stringify(expected);
  checks.push({
    name: 'map',
    pass: same,
    detail: same
      ? `cut ${m.map.cutEdge}, ear ${px(m.map.ear)}, segments ${EDGES.map((edge) => `${edge} ${String(m.map.edges[edge].length)}`).join(' ')}`
      : `page ${JSON.stringify(m.map)} vs module ${JSON.stringify(expected)}`,
  });
  const cover = m.examples.cover;
  const gaps = Object.entries(cover.gaps);
  const tight = gaps.filter(([, g]) => g < CLEARANCE - TOL);
  checks.push({
    name: 'fits',
    pass: cover.fits && tight.length === 0,
    detail: `(a) ${cover.fits ? 'fits' : 'DOES NOT FIT'}; gaps ${gaps.map(([k, g]) => `${k} ${px(g)}`).join(' ')}`,
  });
  const free = freeSideOf(expected);
  const freeSegment = free !== null && expected.edges[free].length > 0;
  const rail = m.examples.rail;
  checks.push({
    name: 'rail',
    pass: freeSegment
      ? rail.railButtons === 3 && rail.placements.join('; ') === `rail: ${free} segment 1`
      : rail.railButtons === 0,
    detail: freeSegment
      ? `(g) ${String(rail.railButtons)} buttons, ${rail.placements.join('; ') || 'no placement'}`
      : `(g) no free segment: ${String(rail.railButtons)} buttons shown`,
  });
  const wanted = earsOf(expected);
  const ears = m.examples.ears;
  const over = ears.placements.slice(0, wanted).filter((p) => p.includes('OVER'));
  checks.push({
    name: 'ears',
    pass: ears.ears === wanted && over.length === 0,
    detail: `(h) ${String(ears.ears)} shown, the map holds ${String(wanted)}${over.length === 0 ? '' : `; ${over.join('; ')}`}`,
  });
  const scrolling = SANDBOX_EXAMPLES.filter((x) => m.examples[x].scrollHeight > m.inner.h + 1);
  checks.push({
    name: 'scroll',
    pass: scrolling.length === 0,
    detail:
      scrolling.length === 0
        ? `no scroll in ${String(m.inner.h)}`
        : `scrolls: ${scrolling.join(', ')}`,
  });
  return { pass: checks.every((k) => k.pass), checks };
};

/** Page-side: no animation is running on the dice (the tumble is a keyframe animation that scales the faces, so a read mid-tumble sees 30px dice). */
export const DICE_STILL = `() => document.getAnimations().every((a) => a.playState !== 'running' || !(a.effect instanceof KeyframeEffect && a.effect.target !== null && a.effect.target.closest('#dice') !== null))`;

/** The four states shot per case, in the order the drive reaches them. */
export const STATES: ReadonlyArray<string> = ['home', 'curtain', 'roll', 'board'];

export type Card = Readonly<{
  name: string;
  e: Emulation;
  twin: Twin;
  measured: Measured;
  verdict: Verdict;
  /** State -> the PNG's path, relative to the sheet. */
  pictures: Readonly<Record<string, string>>;
}>;

/** A sandbox card: the case, the measurement, the verdict and one picture per example. */
export type SandboxCard = Readonly<{
  name: string;
  c: SandboxCase;
  measured: SandboxMeasured;
  verdict: Verdict;
  /** Example -> the PNG's path, relative to the sheet. */
  pictures: Readonly<Record<string, string>>;
}>;
export type SheetCard = Card | SandboxCard;
const isSandbox = (c: SheetCard): c is SandboxCard => 'c' in c;

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

const checksHtml = (v: Verdict): string =>
  v.checks
    .map((k) => `<li class="${k.pass ? 'ok' : 'bad'}"><b>${esc(k.name)}</b> ${esc(k.detail)}</li>`)
    .join('');

/** `index.html`: backgammon's cards, then the sandbox's; per case every picture, every number and the verdict under them. */
export const sheetHtml = (cards: ReadonlyArray<SheetCard>, stamp: string): string => {
  const passed = cards.filter((c) => c.verdict.pass).length;
  const sandboxCard = (c: SandboxCard): string => {
    const pics = SANDBOX_EXAMPLES.map(
      (x) =>
        `<figure><img src="${esc(c.pictures[x] ?? '')}" alt="${esc(`${c.name} ${x}`)}" loading="lazy"><figcaption>${esc(EXAMPLE_LABELS[x])}</figcaption></figure>`,
    ).join('');
    const map = c.measured.map;
    return `<section class="card ${c.verdict.pass ? 'pass' : 'fail'}" id="${esc(`ui-sandbox-${c.name.replace(/[^a-z0-9]+/gi, '-')}`)}">
<h2>${esc(c.c.e.device.models)} <small>${esc(c.name)}${c.c.e.device.verified ? '' : ' · UNVERIFIED row'}</small> <span class="badge">${c.verdict.pass ? 'pass' : 'FAIL'}</span></h2>
<div class="pics">${pics}</div>
<p class="device">${esc(c.measured.deviceLine)}</p>
<dl>
<dt>viewport</dt><dd>${String(c.c.e.viewport.width)}x${String(c.c.e.viewport.height)} @${String(c.c.e.dpr)}x (screen ${String(c.c.e.screen.width)}x${String(c.c.e.screen.height)})</dd>
<dt>insets t/r/b/l</dt><dd>${String(c.c.e.insets.top)}/${String(c.c.e.insets.right)}/${String(c.c.e.insets.bottom)}/${String(c.c.e.insets.left)}</dd>
<dt>corners tl/tr/br/bl</dt><dd>${CORNER_KEYS.map((k) => px(c.measured.corners[k])).join('/')} (catalogue ${CORNER_KEYS.map((k) => px(c.c.e.corners[k])).join('/')})</dd>
<dt>cut</dt><dd>${esc(map.cutEdge)}${map.cut === null ? '' : ` at ${esc(segmentText(map.cut))}`}, ear ${px(map.ear)}, free side ${esc(freeSideOf(map) ?? 'none')}</dd>
${EDGES.map((edge) => `<dt>safe ${edge}</dt><dd>${map.edges[edge].length === 0 ? 'none' : esc(map.edges[edge].map(segmentText).join(', '))}</dd>`).join('\n')}
</dl>
<ul class="checks">${checksHtml(c.verdict)}</ul>
</section>`;
  };
  const card = (c: Card): string => {
    const b = c.measured.board;
    const below = b === null ? NaN : c.measured.inner.h - (b.y + b.h);
    const pics = STATES.map(
      (s) =>
        `<figure><img src="${esc(c.pictures[s] ?? '')}" alt="${esc(`${c.name} ${s}`)}" loading="lazy"><figcaption>${esc(s)}</figcaption></figure>`,
    ).join('');
    const checks = checksHtml(c.verdict);
    return `<section class="card ${c.verdict.pass ? 'pass' : 'fail'}" id="${esc(c.name.replace(/[^a-z0-9]+/gi, '-'))}">
<h2>${esc(c.e.device.models)} <small>${esc(c.name)}${c.e.device.verified ? '' : ' · UNVERIFIED row'}</small> <span class="badge">${c.verdict.pass ? 'pass' : 'FAIL'}</span></h2>
<div class="pics">${pics}</div>
<dl>
<dt>viewport</dt><dd>${String(c.e.viewport.width)}x${String(c.e.viewport.height)} @${String(c.e.dpr)}x (screen ${String(c.e.screen.width)}x${String(c.e.screen.height)})</dd>
<dt>insets t/r/b/l</dt><dd>${String(c.e.insets.top)}/${String(c.e.insets.right)}/${String(c.e.insets.bottom)}/${String(c.e.insets.left)}</dd>
<dt>board</dt><dd>${b === null ? 'none' : `${px(b.x)},${px(b.y)} ${px(b.w)}x${px(b.h)}`}</dd>
<dt>gap above / below</dt><dd>${b === null ? '-' : `${px(b.y)} / ${px(below)}`}${c.twin.layout === 'landscape' ? ` (room ${px(c.twin.room.top)} / ${px(c.twin.room.bottom)})` : ''}</dd>
<dt>corners tl/tr/br/bl</dt><dd>${CORNER_KEYS.map((k) => px(c.measured.corners[k])).join('/')} (catalogue ${CORNER_KEYS.map((k) => px(c.e.corners[k])).join('/')})</dd>
<dt>layout</dt><dd>${esc(c.twin.layout)}${c.twin.scheme === null ? '' : ` ${c.twin.scheme}`}, point ${px(c.twin.pointW)} x ${px(c.twin.pointLen)}</dd>
</dl>
<ul class="checks">${checks}</ul>
</section>`;
  };
  const boards = cards.filter((c): c is Card => !isSandbox(c));
  const sandboxes = cards.filter(isSandbox);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Shell screenshot sheet ${esc(stamp)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;padding:16px;font:14px/1.4 system-ui,sans-serif;background:#f4f1ea;color:#222}
h1{font-size:18px;margin:0 0 12px}
.card{background:#fff;border:1px solid #d9d4c7;border-left:6px solid #7a8a3c;border-radius:8px;padding:12px 16px;margin:0 0 16px}
.card.fail{border-left-color:#b3261e}
.card h2{font-size:15px;margin:0 0 8px}.card h2 small{font-weight:normal;color:#666}
.badge{float:right;font-size:12px;padding:2px 8px;border-radius:10px;background:#7a8a3c;color:#fff}.fail .badge{background:#b3261e}
.pics{display:flex;gap:12px;overflow-x:auto;padding-bottom:6px}
figure{margin:0;flex:0 0 auto}figure img{display:block;max-height:320px;max-width:60vw;height:auto;border:1px solid #ccc;background:#000}
figcaption{font-size:12px;color:#666;text-align:center}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:8px 0;font-size:13px}dt{color:#666}dd{margin:0}
.checks{list-style:none;padding:0;margin:0;font-size:13px}.checks li{padding:1px 0}.checks li::before{content:"✓ ";color:#7a8a3c}.checks li.bad::before{content:"✗ ";color:#b3261e}
h2.game{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #d9d4c7}
.device{margin:6px 0 0;font:12px/1.4 ui-monospace,Menlo,monospace;color:#444}
</style></head><body>
<h1>Shell screenshot sheet · ${esc(stamp)} · ${String(passed)} of ${String(cards.length)} cases pass</h1>
<p>Every phone the shell knows (web/shared/lib/devices.ts), each orientation and display mode, a browser tab twice (bar shown, then hidden), at the device's pixel ratio. Backgammon: the home, the first curtain, the roll modal and the rolled board. UI Sandbox: the preview screen under each orientation type (both landscapes: the cut on the left, then on the right) around examples (a), (f), (g), (h) and (i), the readout's device line under the shots. Look, then decide.</p>
${boards.length === 0 ? '' : `<h2 class="game">Backgammon · ${String(boards.filter((c) => c.verdict.pass).length)} of ${String(boards.length)} pass</h2>\n${boards.map(card).join('\n')}`}
${sandboxes.length === 0 ? '' : `<h2 class="game">UI Sandbox · ${String(sandboxes.filter((c) => c.verdict.pass).length)} of ${String(sandboxes.length)} pass</h2>\n${sandboxes.map(sandboxCard).join('\n')}`}
</body></html>
`;
};

/** The `check` summary: one line per case, one column per check. */
export const summaryTable = (rows: ReadonlyArray<readonly [string, Verdict]>): string => {
  const names = rows[0]?.[1].checks.map((c) => c.name) ?? [];
  const width = Math.max(4, ...rows.map(([name]) => name.length));
  const head = [pad('case', width), ...names.map((n) => pad(n, 8)), 'result'].join(' ');
  const lines = rows.map(([name, v]) =>
    [
      pad(name, width),
      ...v.checks.map((c) => pad(c.pass ? 'ok' : 'FAIL', 8)),
      v.pass ? 'pass' : 'FAIL',
    ].join(' '),
  );
  const passed = rows.filter(([, v]) => v.pass).length;
  return [head, ...lines, `${String(passed)} of ${String(rows.length)} cases pass`].join('\n');
};

// ---- the drive ----------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
/** One seed for every case (e2e/browser/seed-random.js over `Math.random`), so every card and every check sees the same opening roll: a comparison across phones, not across dice. */
export const SEED_SCRIPT = `window.__e2eSeed = 20260928;\n${readFileSync(resolve(here, '..', 'e2e', 'browser', 'seed-random.js'), 'utf8')}`;

const shot = async (page: Page, path: string | null): Promise<void> => {
  if (path !== null) await page.screenshot({ path });
};

/**
 * One case: a context at the device (viewport, screen, pixel ratio, touch, mobile), the seam and
 * the seed installed, the page driven from the home through pass and play to the rolled board
 * (the turn gate, shown upright, dismissed with "Play upright"), a shot at each state where
 * `pictures` names a path, then the measurement.
 */
export const driveCase = async (
  browser: Browser,
  url: string,
  e: Emulation,
  pictures: Readonly<Record<string, string>> | null,
): Promise<Measured> => {
  const context = await browser.newContext({
    viewport: { width: e.viewport.width, height: e.viewport.height },
    screen: { width: e.screen.width, height: e.screen.height },
    deviceScaleFactor: e.dpr,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript({ content: SEED_SCRIPT });
  await context.addInitScript({ content: seamScript(e) });
  const page = await context.newPage();
  const pic = (state: string): string | null => pictures?.[state] ?? null;
  try {
    await page.goto(url);
    await page.locator('#homeScreen').waitFor({ state: 'visible' });
    await shot(page, pic('home'));
    await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
    await page.locator('#p1NameInput').fill('Ari');
    await page.locator('#p2NameInput').fill('Ethan');
    await page.locator('#localBtn').click();
    await page.locator('#tableScreen').waitFor({ state: 'visible' });
    const gate = page.locator('#turnGate');
    if (await gate.isVisible()) await page.locator('#turnGateKeepBtn').click();
    await page.locator('#curtainOverlay').waitFor({ state: 'visible' });
    await shot(page, pic('curtain'));
    await page.locator('#curtainBtn').click();
    await page.locator('#rollOverlay').waitFor({ state: 'visible' });
    await shot(page, pic('roll'));
    await page.locator('#rollModalBtn').click();
    await page.locator('#board[data-rolled="1"]').waitFor();
    await page.locator('#rollOverlay').waitFor({ state: 'hidden' });
    // The dice tumble and the coins' transitions settle before the read, as a finger would wait.
    await page.waitForFunction(DICE_STILL);
    await page.evaluate(
      `Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => undefined)))`,
    );
    await page.waitForTimeout(150);
    await shot(page, pic('board'));
    return await page.evaluate<Measured>(MEASURE);
  } finally {
    await context.close();
  }
};

/**
 * One sandbox case: a context at the device as `driveCase` stands it (the seam installed, no seed:
 * nothing random), the preview screen loaded under the case's orientation type and example (a),
 * the page-level reading (the corners, the match, the map, the readout's device line), then each
 * example in turn: set through the hook, a frame to paint, a shot where `pictures` names a path,
 * the report and what is visible.
 */
export const driveSandbox = async (
  browser: Browser,
  url: string,
  c: SandboxCase,
  pictures: Readonly<Record<string, string>> | null,
): Promise<SandboxMeasured> => {
  const e = c.e;
  const context = await browser.newContext({
    viewport: { width: e.viewport.width, height: e.viewport.height },
    screen: { width: e.screen.width, height: e.screen.height },
    deviceScaleFactor: e.dpr,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript({ content: seamScript(e) });
  const page = await context.newPage();
  try {
    await page.goto(`${url}?screen=preview&example=cover&type=${c.type}`);
    await page.waitForFunction("typeof window.__uiSandbox === 'object'");
    await page.waitForTimeout(50);
    const head = await page.evaluate<Omit<SandboxMeasured, 'examples'>>(SANDBOX_PAGE);
    const example = async (x: SandboxExample): Promise<ExampleMeasure> => {
      await page.evaluate(`window.__uiSandbox.set('example', '${x}')`);
      await page.waitForTimeout(50);
      await shot(page, pictures?.[x] ?? null);
      return page.evaluate<ExampleMeasure>(SANDBOX_EXAMPLE);
    };
    const cover = await example('cover');
    const board = await example('board');
    const rail = await example('rail');
    const ears = await example('ears');
    const gutters = await example('gutters');
    return { ...head, examples: { cover, board, rail, ears, gutters } };
  } finally {
    await context.close();
  }
};

const stampNow = (): string => {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
};

const fileNameOf = (e: Emulation, state: string): string =>
  `${emulationName(e).replace(/\s+/g, '_')}--${state}.png`;
const sandboxFileNameOf = (c: SandboxCase, example: string): string =>
  `ui-sandbox_${sandboxName(c).replace(/\s+/g, '_')}--${example}.png`;

type Served = Readonly<{ url: string; close: () => Promise<void> }>;
/** `--url <site>` as given (the site's root, `games/<name>/` under it, a trailing slash added), or `--serve`: dist/ through tools/serve-dist.ts on a free port. */
const siteUrl = async (args: EmulateArgs): Promise<Served> => {
  if (args.url !== null)
    return {
      url: args.url.endsWith('/') ? args.url : `${args.url}/`,
      close: () => Promise.resolve(),
    };
  if (!args.serve)
    throw new Error('--url <site> or --serve (serves dist/; run `npm run build` first)');
  const running = await startServer({
    root: resolve('dist'),
    base: PAGES_BASE_PATH,
    host: '127.0.0.1',
    port: 0,
    aliases: {},
  });
  return { url: `${running.url}${PAGES_BASE_PATH}`, close: running.close };
};
/** A page's URL under the site's root. */
const pageOf = (site: string, game: GameName): string => `${site}games/${game}/`;

/** One after another (one Chromium context at a time), the results in order. */
const inTurn = <T, R>(
  items: ReadonlyArray<T>,
  fn: (item: T) => Promise<R>,
): Promise<ReadonlyArray<R>> =>
  items.reduce<Promise<ReadonlyArray<R>>>(
    async (prev, item) => [...(await prev), await fn(item)],
    Promise.resolve([]),
  );

/** Every backgammon case driven and judged, a picture per state where `dir` is given (a `.png` `single` shoots the board alone). */
const renderBoards = async (
  browser: Browser,
  url: string,
  args: EmulateArgs,
  dir: string | null,
  single: string | null,
): Promise<ReadonlyArray<Card>> =>
  inTurn(casesFor(args), async (e): Promise<Card> => {
    const pictures =
      single !== null
        ? { board: single }
        : dir === null
          ? null
          : Object.fromEntries(STATES.map((s) => [s, resolve(dir, fileNameOf(e, s))]));
    const measured = await driveCase(browser, url, e, pictures);
    const verdict = judge(e, measured);
    console.log(`${verdict.pass ? 'pass' : 'FAIL'}  ${emulationName(e)}`);
    return {
      name: emulationName(e),
      e,
      twin: twinOf(e),
      measured,
      verdict,
      pictures: Object.fromEntries(STATES.map((s) => [s, fileNameOf(e, s)])),
    };
  });

/** Every sandbox case driven and judged, a picture per example where `dir` is given (a `.png` `single` shoots example (h) alone). */
const renderSandbox = async (
  browser: Browser,
  url: string,
  args: EmulateArgs,
  dir: string | null,
  single: string | null,
): Promise<ReadonlyArray<SandboxCard>> =>
  inTurn(sandboxCasesFor(args), async (c): Promise<SandboxCard> => {
    const pictures =
      single !== null
        ? { ears: single }
        : dir === null
          ? null
          : Object.fromEntries(
              SANDBOX_EXAMPLES.map((x) => [x, resolve(dir, sandboxFileNameOf(c, x))]),
            );
    const measured = await driveSandbox(browser, url, c, pictures);
    const verdict = judgeSandbox(c, measured);
    console.log(`${verdict.pass ? 'pass' : 'FAIL'}  ui-sandbox ${sandboxName(c)}`);
    return {
      name: sandboxName(c),
      c,
      measured,
      verdict,
      pictures: Object.fromEntries(SANDBOX_EXAMPLES.map((x) => [x, sandboxFileNameOf(c, x)])),
    };
  });

/** `render`: both games' cards (or `--game`'s) into one folder with the sheet; a `.png` --out shoots one picture and writes no sheet. */
const render = async (browser: Browser, site: string, args: EmulateArgs): Promise<void> => {
  const games = gamesFor(args);
  const single = args.out?.endsWith('.png') === true ? resolve(args.out) : null;
  const stamp = stampNow();
  const dir = single !== null ? dirname(single) : resolve(args.out ?? `shots/${stamp}`);
  mkdirSync(dir, { recursive: true });
  const boards = games.includes('backgammon')
    ? await renderBoards(browser, pageOf(site, 'backgammon'), args, dir, single)
    : [];
  const sandboxes = games.includes('ui-sandbox')
    ? await renderSandbox(browser, pageOf(site, 'ui-sandbox'), args, dir, single)
    : [];
  if (single !== null) return;
  const cards: ReadonlyArray<SheetCard> = [...boards, ...sandboxes];
  writeFileSync(resolve(dir, 'index.html'), sheetHtml(cards, stamp));
  console.log(`${String(cards.length)} cards -> ${resolve(dir, 'index.html')}`);
};

/** `check`: both games' verdicts (or `--game`'s), one summary table per game, the JSON report, exit 1 on any failure. */
const check = async (browser: Browser, site: string, args: EmulateArgs): Promise<number> => {
  const games = gamesFor(args);
  const boards = games.includes('backgammon')
    ? await renderBoards(browser, pageOf(site, 'backgammon'), args, null, null)
    : [];
  const sandboxes = games.includes('ui-sandbox')
    ? await renderSandbox(browser, pageOf(site, 'ui-sandbox'), args, null, null)
    : [];
  if (boards.length > 0) {
    console.log('\nbackgammon');
    console.log(summaryTable(boards.map((r) => [r.name, r.verdict] as const)));
  }
  if (sandboxes.length > 0) {
    console.log('\nui-sandbox');
    console.log(summaryTable(sandboxes.map((r) => [r.name, r.verdict] as const)));
  }
  const report = [
    ...boards.map((r) => ({
      game: 'backgammon',
      case: r.name,
      emulation: r.e,
      twin: r.twin,
      measured: r.measured,
      verdict: r.verdict,
    })),
    ...sandboxes.map((r) => ({
      game: 'ui-sandbox',
      case: r.name,
      emulation: r.c.e,
      type: r.c.type,
      map: sandboxMap(r.c),
      measured: r.measured,
      verdict: r.verdict,
    })),
  ];
  if (args.json !== null) {
    mkdirSync(dirname(resolve(args.json)), { recursive: true });
    writeFileSync(resolve(args.json), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report -> ${resolve(args.json)}`);
  }
  return report.every((r) => r.verdict.pass) ? 0 : 1;
};

const run = async (args: EmulateArgs): Promise<number> => {
  if (args.command === 'list') {
    console.log(listText());
    return 0;
  }
  if (args.command === 'explain') {
    const games = gamesFor(args);
    const texts = [
      ...(games.includes('backgammon') ? casesFor(args).map(explainText) : []),
      ...(games.includes('ui-sandbox') ? sandboxCasesFor(args).map(explainSandboxText) : []),
    ];
    console.log(texts.join('\n\n'));
    return 0;
  }
  const served = await siteUrl(args);
  const browser = await chromium.launch();
  try {
    if (args.command === 'render') {
      await render(browser, served.url, args);
      return 0;
    }
    return await check(browser, served.url, args);
  } finally {
    await browser.close();
    await served.close();
  }
};

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  run(parseEmulateArgs(process.argv.slice(2))).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error('shell-emulate:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
