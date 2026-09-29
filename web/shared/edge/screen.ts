// The screen as the page reads it (docs/design/screen-frame.md; docs/design/backgammon-board.md
// §3.6): the runtime inputs the device catalogue (web/shared/lib/devices.ts) needs, read off the
// window and the root's computed style through dom.ts; the four custom properties the boot writes
// back (`--frame-corner-{tl,tr,br,bl}`, the screen frame's corner radii, on `documentElement` so
// they beat shell.css's `:root` fallback); the watcher that re-reads them as the browser's bar
// shows and hides; and the `?probe=1` readout (docs/ARCHITECTURE.md "Documented test hooks"): a
// small fixed panel of the same numbers, the matched catalogue id (or `unknown (heuristic)` where
// the insets stand in), the four corners and the reach rule's inputs, for a look at a real phone.
// The insets are read off shell.css's own declarations (`--frame-inset-*: env(safe-area-inset-*)`):
// `env()` is substituted in the computed value, so each reads `47px` or `0px`, and a measurement
// (tools/shell-emulate.ts `seamScript`) sets the same four inline where `env()` cannot be faked.
import {
  CORNER_KEYS,
  cornerRadius,
  cornersOf,
  deviceLabel,
  portraitOf,
  reachOf,
  turnFor,
  type Corners,
  type DeviceInputs,
  type DisplayMode,
  type Insets,
  type Orientation,
  type Reach,
  type ScreenSize,
  type ViewportSize,
} from '../lib/devices.ts';
import {
  appendHtml,
  byId,
  hasAttr,
  listen,
  nextFrame,
  queryIn,
  readRootStyle,
  rectOf,
  removeElement,
  safeHtml,
  setRootStyle,
  setText,
  stopPropagation,
  trustedHtml,
  type DocumentLike,
  type Element,
  type Listenable,
  type RootDocumentLike,
  type StyleReaderLike,
} from './dom.ts';

/** The four inset properties shell.css declares on `:root` (`--frame-inset-top: env(safe-area-inset-top, 0px)` and the rest). */
export const FRAME_INSETS: Readonly<Record<keyof Insets, string>> = {
  top: '--frame-inset-top',
  right: '--frame-inset-right',
  bottom: '--frame-inset-bottom',
  left: '--frame-inset-left',
};
/** The corner property the frame reads for one corner (shell.css `body[data-frame]::before { border-radius }`). */
export const frameCornerProp = (corner: keyof Corners): string => `--frame-corner-${corner}`;

/** The window as the screen is read: `screen`, `devicePixelRatio`, the viewport, `matchMedia` for the display mode, the two the watcher listens on; all optional (the boot test's window has none). */
export type ScreenWindowLike = StyleReaderLike &
  Readonly<{
    screen?: Readonly<{ width?: number; height?: number }>;
    devicePixelRatio?: number;
    innerWidth?: number;
    innerHeight?: number;
    matchMedia?: (query: string) => Readonly<{ matches: boolean }>;
    /** `resize` and `orientationchange` (a turn of the phone, a desktop window dragged). */
    addEventListener?: Listenable['addEventListener'];
    /** Its `resize` fires as Safari's bar shows and hides, before the layout viewport's does. */
    visualViewport?: Listenable | null;
  }>;

/** The document as the screen is read and the probe is drawn: the root, the body, and `fullscreenElement` (the Android lock's fullscreen, orientation.ts). */
export type ScreenDocumentLike = RootDocumentLike &
  DocumentLike &
  Listenable &
  Readonly<{ body: Element; fullscreenElement?: unknown }>;

/** The page opted into the screen frame (web/shared/markup/shell.ts `ShellPage.frame`: `<body data-frame>`); a page without it gets no corners written and no watcher. */
export const framed = (doc: ScreenDocumentLike): boolean => hasAttr(doc.body, 'data-frame');

/** The largest `<n>px` in a computed value (`47px`, `max(47px, 0px, 0px)`), or null where there is none. */
export const notchOf = (value: string | null): number | null => {
  if (value === null) return null;
  const lengths = [...value.matchAll(/(-?\d*\.?\d+)px/g)].map((m: ReadonlyArray<string>) =>
    Number(m[1]),
  );
  return lengths.length === 0 ? null : Math.max(...lengths);
};

/** The four safe-area insets off the root's computed `--frame-inset-*`, or null where the page cannot say (no `getComputedStyle`, or a sheet without the declarations). */
export const readInsets = (doc: RootDocumentLike, win: StyleReaderLike): Insets | null => {
  const top = notchOf(readRootStyle(doc, win, FRAME_INSETS.top));
  const right = notchOf(readRootStyle(doc, win, FRAME_INSETS.right));
  const bottom = notchOf(readRootStyle(doc, win, FRAME_INSETS.bottom));
  const left = notchOf(readRootStyle(doc, win, FRAME_INSETS.left));
  if (top === null || right === null || bottom === null || left === null) return null;
  return { top, right, bottom, left };
};

/** The device inputs off the page: the screen, its pixel ratio and the notch (the largest of the top and side insets); null without a `screen` to read. */
export const readDevice = (doc: RootDocumentLike, win: ScreenWindowLike): DeviceInputs | null => {
  const width = win.screen?.width;
  const height = win.screen?.height;
  if (width === undefined || height === undefined) return null;
  const screen: ScreenSize = { width, height };
  const insets = readInsets(doc, win);
  return {
    screen,
    dpr: win.devicePixelRatio ?? 1,
    notch: insets === null ? null : Math.max(insets.top, insets.left, insets.right),
  };
};

/** The page's viewport, `innerWidth x innerHeight`; null where the window has neither (a fake). */
export const readViewport = (win: ScreenWindowLike): ViewportSize | null =>
  win.innerWidth === undefined || win.innerHeight === undefined
    ? null
    : { width: win.innerWidth, height: win.innerHeight };

/**
 * How the page is shown: `fullscreen` with an element in fullscreen (the Android lock) or under
 * `(display-mode: fullscreen)` (the manifest's), `standalone` under `(display-mode: standalone)`
 * (an installed page; iOS's Home Screen web apps report it), else `browser` (a tab, `minimal-ui`
 * included: a bar is on one edge).
 */
export const readMode = (doc: ScreenDocumentLike, win: ScreenWindowLike): DisplayMode => {
  const matches = (mode: string): boolean =>
    win.matchMedia?.(`(display-mode: ${mode})`).matches === true;
  if ((doc.fullscreenElement ?? null) !== null || matches('fullscreen')) return 'fullscreen';
  return matches('standalone') ? 'standalone' : 'browser';
};

/** Everything the frame's corners are computed from, and the four radii: one read of the page. */
export type FrameReading = Readonly<{
  inputs: DeviceInputs | null;
  insets: Insets;
  mode: DisplayMode;
  orientation: Orientation;
  viewport: ViewportSize | null;
  /** The whole screen turned for the orientation; null without a `screen`. */
  full: ViewportSize | null;
  /** The display's radius: the catalogue's, or the notch's depth, or 0. */
  radius: number;
  reach: Reach;
  corners: Corners;
}>;

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Read the page once (docs/design/screen-frame.md §4): the orientation off the viewport (the
 * screen where there is none), the mode, the insets, the whole screen for the orientation, then the
 * radius (`cornerRadius`) and the edge-reach rule (`reachOf`) into the four corners (`cornersOf`).
 */
export const readFrame = (doc: ScreenDocumentLike, win: ScreenWindowLike): FrameReading => {
  const inputs = readDevice(doc, win);
  const insets = readInsets(doc, win) ?? NO_INSETS;
  const viewport = readViewport(win);
  const wide = viewport ?? inputs?.screen ?? null;
  const orientation: Orientation =
    wide !== null && wide.width > wide.height ? 'landscape' : 'portrait';
  const full = inputs === null ? null : turnFor(portraitOf(inputs.screen), orientation);
  const mode = readMode(doc, win);
  const radius = inputs === null ? 0 : (cornerRadius(inputs) ?? 0);
  const reach = reachOf({ mode, insets, viewport, full });
  return {
    inputs,
    insets,
    mode,
    orientation,
    viewport,
    full,
    radius,
    reach,
    corners: cornersOf(radius, reach),
  };
};

/**
 * Write the four `--frame-corner-*` on the root where the page has a screen to read (the
 * catalogue's radius at each corner the page reaches, 0 at each a bar owns); shell.css's `env()`
 * fallback stands otherwise (a window without `screen`: a fake). The reading, for the probe.
 */
export const applyFrame = (doc: ScreenDocumentLike, win: ScreenWindowLike): FrameReading => {
  const reading = readFrame(doc, win);
  if (reading.inputs !== null) {
    CORNER_KEYS.forEach((k) => {
      setRootStyle(doc, frameCornerProp(k), `${String(reading.corners[k])}px`);
    });
  }
  return reading;
};

/**
 * Re-read on what moves a corner: the window's `resize` and `orientationchange` (a turn of the
 * phone), the visual viewport's `resize` (Safari's bar showing or hiding, which the layout
 * viewport reports late or not at all) and `fullscreenchange` (the Android lock), each a frame
 * later so the insets have settled.
 */
export const watchFrame = (
  doc: ScreenDocumentLike,
  win: ScreenWindowLike,
  onChange: () => void,
): void => {
  const later = (): void => {
    nextFrame(onChange);
  };
  win.addEventListener?.('resize', later);
  win.addEventListener?.('orientationchange', later);
  win.visualViewport?.addEventListener('resize', later);
  doc.addEventListener('fullscreenchange', later);
};

/** `?probe=1` in the page's query: the readout is asked for. */
export const probeAsked = (search: string): boolean => /(?:^\?|&)probe=1(?:&|$)/.test(search);

const PROBE_ID = 'screenProbe';
/** The three viewport units, each measured off a hidden element's height. */
const RULERS: ReadonlyArray<readonly [string, string]> = [
  ['svh', '100svh'],
  ['dvh', '100dvh'],
  ['lvh', '100lvh'],
];

const px = (n: number): string => String(Math.round(n * 100) / 100);
const size = (s: ViewportSize | null): string =>
  s === null ? '?' : `${String(s.width)}x${String(s.height)}`;

/** The readout's lines: what the catalogue read, the reach rule's inputs, the four corners, the units, the board's box. */
const probeLines = (doc: ScreenDocumentLike, win: ScreenWindowLike, probe: Element): string => {
  const r = readFrame(doc, win);
  const rulers = RULERS.map(([name]) => {
    const el = queryIn(probe, `[data-ruler="${name}"]`);
    return `${name} ${el === null ? '?' : px(rectOf(el).height)}`;
  });
  const board = byId(doc, 'board');
  const b = board === null ? null : rectOf(board);
  const i = r.insets;
  return [
    `inner ${size(r.viewport)}  screen ${r.inputs === null ? '?' : size(r.inputs.screen)}  full ${size(r.full)}  dpr ${String(win.devicePixelRatio ?? '?')}`,
    rulers.join('  '),
    `insets t ${px(i.top)} r ${px(i.right)} b ${px(i.bottom)} l ${px(i.left)}`,
    `mode ${r.mode}  ${r.orientation}  notch ${r.inputs?.notch === null || r.inputs === null ? '?' : px(r.inputs.notch)}`,
    `device ${deviceLabel(r.inputs)}  radius ${px(r.radius)}px`,
    `corners ${CORNER_KEYS.map((k) => `${k} ${r.reach[k] ? px(r.corners[k]) : 'square'}`).join('  ')}`,
    `board ${b === null ? 'none' : `${px(b.left)},${px(b.top)} ${px(b.width)}x${px(b.height)}`}`,
    '(tap to dismiss)',
  ].join('\n');
};

/**
 * The `?probe=1` readout: a fixed monospace panel at the top-left, re-read a frame after every tap
 * on the page (so it shows the table once one is sat at, and the strip's numbers after a turn of
 * the phone and a tap) and on every change the frame watcher sees, gone at a tap on itself. A test
 * hook, not the fix: the shell reads the same inputs by itself (`applyFrame`).
 */
export const renderProbe = (doc: ScreenDocumentLike, win: ScreenWindowLike): void => {
  const rulers = RULERS.map(
    ([name, height]) =>
      `<i data-ruler="${name}" style="position:fixed;left:0;top:0;width:0;visibility:hidden;height:${height}"></i>`,
  ).join('');
  appendHtml(
    doc.body,
    safeHtml`<pre id="${PROBE_ID}" style="position:fixed;left:8px;top:8px;z-index:200;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#fff;background:rgba(0,0,0,.72);border-radius:6px;white-space:pre;pointer-events:auto"><span data-text></span>${trustedHtml(rulers)}</pre>`,
  );
  const probe = byId(doc, PROBE_ID);
  if (probe === null) return;
  const text = queryIn(probe, '[data-text]');
  const refresh = (): void => {
    if (text !== null) setText(text, probeLines(doc, win, probe));
  };
  refresh();
  listen(probe, 'click', (e) => {
    stopPropagation(e);
    removeElement(probe);
  });
  doc.addEventListener('click', () => {
    nextFrame(refresh);
  });
  watchFrame(doc, win, refresh);
};
