// The shell's device emulator (docs/design/devices.md; the owner, 2026-09-28: "there should be a
// CLI to interact with the shell engine in order to validate this and emulate", and "Part of the
// tests should create screenshots of the app in an emulator. I should be able to peruse those
// locally and decide for myself if they all look good before shipping to customers"). Four
// commands over the one catalogue (web/shared/lib/devices.ts) and backgammon's CSS twin
// (web/games/backgammon/src/ui/board/layout.ts), so what this tool prints is what the page
// computes, never a second table:
//   list                      the catalogue as a table: screen, dpr, insets, corner, the bar ranges
//   explain --device <id> [--orientation portrait|landscape] [--mode browser|standalone|fullscreen] [--bar shown|hidden]
//                             one case: the match, the corner and which corners are the screen's,
//                             the viewport the bar leaves, the edge paddings, the landscape scheme,
//                             point width and length, the chrome heights, the board's room
//   render (--device <id> | --all) [--orientation ..] [--mode ..] [--bar ..] (--url <page> | --serve) [--out <dir|png>]
//                             Playwright Chromium at the device's viewport, screen and pixel ratio
//                             (`isMobile`, `hasTouch`), the insets through the theme's seam, drives
//                             pass and play to the rolled board and shoots the home, the curtain,
//                             the roll modal and the board; `--all` sweeps every device x
//                             orientation x mode (the tab twice: bar shown and hidden) into a folder
//                             with an index.html contact sheet; a `.png` --out shoots the board alone
//   check (--device <id> | --all) [..] (--url <page> | --serve) [--json <file>]
//                             the same drive, then per case: the trim's computed radius equals the
//                             catalogue's, the board fills its room sideways (`boardRoom`, to half a
//                             pixel), the content clears the band by 4px, no document scroll above
//                             the floor, every tap target 44px; a summary table, a JSON report,
//                             exit 1 on any failure
// Examples (`npm run build` first for --serve, which serves dist/ on a free port):
//   node --experimental-strip-types tools/shell-emulate.ts list
//   node --experimental-strip-types tools/shell-emulate.ts explain --device iphone-393x852 --orientation landscape --mode browser
//   node --experimental-strip-types tools/shell-emulate.ts render --device iphone-390x844 --orientation landscape --serve --out /tmp/board.png
//   node --experimental-strip-types tools/shell-emulate.ts render --all --serve             # = npm run shots
//   node --experimental-strip-types tools/shell-emulate.ts check --all --serve --json shots/check.json
// The seam: headless Chromium reads every `env(safe-area-inset-*)` as 0 and no CDP call sets them
// (Chromium 153's `Emulation.setSafeAreaInsetsOverride` refuses every parameter shape), so an init
// script writes the case's insets on `#app` as `--inset-l/-r/-b` (the theme's own variables, its
// comment naming them the seam a measurement overrides) and the notch on the root as
// `--screen-corner` (what the theme's fallback would compute), which the boot then reads and
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
  DEVICES,
  DISPLAY_MODES,
  ORIENTATIONS,
  deviceById,
  deviceOf,
  emulationFor,
  emulationName,
  emulationsOf,
  type Bar,
  type DisplayMode,
  type Emulation,
  type Orientation,
} from '../web/shared/lib/devices.ts';
import { PAGES_BASE_PATH } from '../e2e/fixtures/site.ts';
import { startServer } from './serve-dist.ts';

export type Command = 'list' | 'explain' | 'render' | 'check';
export type EmulateArgs = Readonly<{
  command: Command;
  device: string | null;
  all: boolean;
  orientation: Orientation | null;
  mode: DisplayMode | null;
  bar: Bar | null;
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
      emulationsOf(d).filter(
        (e) =>
          (args.orientation === null || e.orientation === args.orientation) &&
          (args.mode === null || e.mode === args.mode) &&
          (args.bar === null || e.mode !== 'browser' || e.bar === args.bar),
      ),
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

const px = (n: number): string => String(Math.round(n * 100) / 100);
const pad = (s: string, n: number): string => s.padEnd(n);

/** `list`: the catalogue, one line per row. */
export const listText = (): string => {
  const head = [
    pad('id', 26),
    pad('screen', 9),
    pad('dpr', 6),
    pad('up t/b', 8),
    pad('side l/r/b', 11),
    pad('corner', 7),
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
  const reach = (['tl', 'tr', 'br', 'bl'] as const)
    .map((c) => `${c} ${e.reach[c] ? px(d.corner) : '0'}`)
    .join('  ');
  const lines = [
    `${emulationName(e)}${d.verified ? '' : '  (UNVERIFIED row)'}`,
    `  ${d.models}`,
    `  screen ${String(e.screen.width)}x${String(e.screen.height)} @${String(e.dpr)}x  viewport ${String(e.viewport.width)}x${String(e.viewport.height)}${
      e.mode === 'browser'
        ? `  (bar ${e.bar}: ${String(d.toolbar[e.orientation][e.bar === 'shown' ? 'max' : 'min'])}px of ${String(d.toolbar[e.orientation].min)}-${String(d.toolbar[e.orientation].max)}, UNVERIFIED)`
        : ''
    }`,
    `  insets t/r/b/l ${String(e.insets.top)}/${String(e.insets.right)}/${String(e.insets.bottom)}/${String(e.insets.left)}  notch ${String(e.notch)}`,
    `  match ${match === null ? 'unknown (heuristic)' : match.id}  --screen-corner ${e.notch > 0 ? `${px(e.corner)}px` : 'env() fallback (0)'}  screen corners: ${reach}`,
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

// ---- the page ----------------------------------------------------------------------------------

/** The init script for a case: the insets on `#app`, the notch on the root, before the boot reads either. */
export const seamScript = (e: Emulation): string => `(() => {
  const insets = ${JSON.stringify(e.insets)};
  const notch = ${String(e.notch)};
  const apply = () => {
    const root = document.documentElement;
    if (root === null) return false;
    if (notch > 0) root.style.setProperty('--screen-corner', notch + 'px');
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
  /** `body::before`'s computed `border-top-left-radius` in px. */
  corner: number;
  rootCorner: string;
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
    corner: parseFloat(getComputedStyle(document.body, '::before').borderTopLeftRadius) || 0,
    rootCorner: getComputedStyle(document.documentElement).getPropertyValue('--screen-corner').trim(),
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
 * The invariants over a measurement (pure): the trim's radius is the catalogue's; sideways where
 * the viewport fits, the board's edges sit exactly `boardRoom` from the viewport's; every frame
 * box and the board clear the band by 4px; no document scroll above the floor (and the floor's
 * scroll under it); every tap target 44px on a phone.
 */
export const judge = (e: Emulation, m: Measured): Verdict => {
  const t = twinOf(e);
  const checks: Check[] = [];
  checks.push({
    name: 'corner',
    pass: Math.abs(m.corner - e.corner) <= 0.01,
    detail: `trim ${px(m.corner)}px, catalogue ${px(e.corner)}px (root ${m.rootCorner === '' ? 'none' : m.rootCorner})`,
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

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** `index.html`: one card per case, the tab's two bar states side by side, every number and the verdict under the pictures. */
export const sheetHtml = (cards: ReadonlyArray<Card>, stamp: string): string => {
  const passed = cards.filter((c) => c.verdict.pass).length;
  const card = (c: Card): string => {
    const b = c.measured.board;
    const below = b === null ? NaN : c.measured.inner.h - (b.y + b.h);
    const pics = STATES.map(
      (s) =>
        `<figure><img src="${esc(c.pictures[s] ?? '')}" alt="${esc(`${c.name} ${s}`)}" loading="lazy"><figcaption>${esc(s)}</figcaption></figure>`,
    ).join('');
    const checks = c.verdict.checks
      .map(
        (k) => `<li class="${k.pass ? 'ok' : 'bad'}"><b>${esc(k.name)}</b> ${esc(k.detail)}</li>`,
      )
      .join('');
    return `<section class="card ${c.verdict.pass ? 'pass' : 'fail'}" id="${esc(c.name.replace(/[^a-z0-9]+/gi, '-'))}">
<h2>${esc(c.e.device.models)} <small>${esc(c.name)}${c.e.device.verified ? '' : ' · UNVERIFIED row'}</small> <span class="badge">${c.verdict.pass ? 'pass' : 'FAIL'}</span></h2>
<div class="pics">${pics}</div>
<dl>
<dt>viewport</dt><dd>${String(c.e.viewport.width)}x${String(c.e.viewport.height)} @${String(c.e.dpr)}x (screen ${String(c.e.screen.width)}x${String(c.e.screen.height)})</dd>
<dt>insets t/r/b/l</dt><dd>${String(c.e.insets.top)}/${String(c.e.insets.right)}/${String(c.e.insets.bottom)}/${String(c.e.insets.left)}</dd>
<dt>board</dt><dd>${b === null ? 'none' : `${px(b.x)},${px(b.y)} ${px(b.w)}x${px(b.h)}`}</dd>
<dt>gap above / below</dt><dd>${b === null ? '-' : `${px(b.y)} / ${px(below)}`}${c.twin.layout === 'landscape' ? ` (room ${px(c.twin.room.top)} / ${px(c.twin.room.bottom)})` : ''}</dd>
<dt>corner</dt><dd>${px(c.measured.corner)}px (catalogue ${px(c.e.corner)})</dd>
<dt>layout</dt><dd>${esc(c.twin.layout)}${c.twin.scheme === null ? '' : ` ${c.twin.scheme}`}, point ${px(c.twin.pointW)} x ${px(c.twin.pointLen)}</dd>
</dl>
<ul class="checks">${checks}</ul>
</section>`;
  };
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
</style></head><body>
<h1>Shell screenshot sheet · ${esc(stamp)} · ${String(passed)} of ${String(cards.length)} cases pass</h1>
<p>Every phone the shell knows (web/shared/lib/devices.ts), each orientation and display mode, a browser tab twice (bar shown, then hidden): the home, the first curtain, the roll modal and the rolled board, at the device's pixel ratio. Look, then decide.</p>
${cards.map(card).join('\n')}
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

const stampNow = (): string => {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
};

const fileNameOf = (e: Emulation, state: string): string =>
  `${emulationName(e).replace(/\s+/g, '_')}--${state}.png`;

type Served = Readonly<{ url: string; close: () => Promise<void> }>;
/** `--url` as given, or `--serve`: dist/ through tools/serve-dist.ts on a free port. */
const pageUrl = async (args: EmulateArgs): Promise<Served> => {
  if (args.url !== null) return { url: args.url, close: () => Promise.resolve() };
  if (!args.serve)
    throw new Error('--url <page> or --serve (serves dist/; run `npm run build` first)');
  const running = await startServer({
    root: resolve('dist'),
    base: PAGES_BASE_PATH,
    host: '127.0.0.1',
    port: 0,
    aliases: {},
  });
  return { url: `${running.url}${PAGES_BASE_PATH}games/backgammon/`, close: running.close };
};

/** One after another (one Chromium context at a time), the results in order. */
const inTurn = <T, R>(
  items: ReadonlyArray<T>,
  fn: (item: T) => Promise<R>,
): Promise<ReadonlyArray<R>> =>
  items.reduce<Promise<ReadonlyArray<R>>>(
    async (prev, item) => [...(await prev), await fn(item)],
    Promise.resolve([]),
  );

const render = async (
  browser: Browser,
  url: string,
  cases: ReadonlyArray<Emulation>,
  out: string | null,
): Promise<void> => {
  const single = out?.endsWith('.png') === true;
  const stamp = stampNow();
  const dir = single ? dirname(resolve(out)) : resolve(out ?? `shots/${stamp}`);
  mkdirSync(dir, { recursive: true });
  const cards = await inTurn(cases, async (e): Promise<Card> => {
    const pictures = single
      ? { board: resolve(out) }
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
  if (single) return;
  writeFileSync(resolve(dir, 'index.html'), sheetHtml(cards, stamp));
  console.log(`${String(cards.length)} cards -> ${resolve(dir, 'index.html')}`);
};

const check = async (
  browser: Browser,
  url: string,
  cases: ReadonlyArray<Emulation>,
  json: string | null,
): Promise<number> => {
  const report = await inTurn(cases, async (e) => {
    const measured = await driveCase(browser, url, e, null);
    return {
      case: emulationName(e),
      emulation: e,
      twin: twinOf(e),
      measured,
      verdict: judge(e, measured),
    };
  });
  console.log(summaryTable(report.map((r) => [r.case, r.verdict] as const)));
  if (json !== null) {
    mkdirSync(dirname(resolve(json)), { recursive: true });
    writeFileSync(resolve(json), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report -> ${resolve(json)}`);
  }
  return report.every((r) => r.verdict.pass) ? 0 : 1;
};

const run = async (args: EmulateArgs): Promise<number> => {
  if (args.command === 'list') {
    console.log(listText());
    return 0;
  }
  const cases = casesFor(args);
  if (args.command === 'explain') {
    console.log(cases.map(explainText).join('\n\n'));
    return 0;
  }
  const served = await pageUrl(args);
  const browser = await chromium.launch();
  try {
    if (args.command === 'render') {
      await render(browser, served.url, cases, args.out);
      return 0;
    }
    return await check(browser, served.url, cases, args.json);
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
