// The screen as the page reads it (docs/design/backgammon-board.md §3.6): the runtime inputs the
// device table (web/shared/lib/devices.ts) needs, read off the window and the root's computed
// style through dom.ts, the one custom property the boot writes back (`--screen-corner`, the
// trim's corner radius, on `documentElement` so it beats the theme's `:root` fallback), and the
// `?probe=1` readout (docs/ARCHITECTURE.md "Documented test hooks"): a small fixed panel of the
// same numbers, the matched catalogue id (or `unknown (heuristic)` where the insets stand in) and
// the board's box, for a look at a real phone. The notch is read off the theme's
// own fallback (`--screen-corner: max(env(safe-area-inset-top), -left, -right)`): a theme that
// declares the property opts in, one that does not reads as an empty string and nothing is
// written. `env()` is substituted in the computed value, so the string is `47px` or, unsimplified,
// `max(47px, 0px, 0px)`; the largest length in it is the notch either way.
import { cornerRadius, deviceLabel, type DeviceInputs, type ScreenSize } from '../lib/devices.ts';
import {
  appendHtml,
  byId,
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

/** The custom property the trim reads (theme.css `body::before { border-radius }`). */
export const SCREEN_CORNER = '--screen-corner';

/** The window as the screen is read: `screen`, `devicePixelRatio`, the viewport, `matchMedia` for the display mode; all optional (the boot test's window has none). */
export type ScreenWindowLike = StyleReaderLike &
  Readonly<{
    screen?: Readonly<{ width?: number; height?: number }>;
    devicePixelRatio?: number;
    innerWidth?: number;
    innerHeight?: number;
    matchMedia?: (query: string) => Readonly<{ matches: boolean }>;
  }>;

/** The document as the screen is read and the probe is drawn: the root and, for the probe, the body. */
export type ScreenDocumentLike = RootDocumentLike &
  DocumentLike &
  Listenable &
  Readonly<{ body: Element }>;

/** The largest `<n>px` in a computed value (`47px`, `max(47px, 0px, 0px)`), or null where there is none. */
export const notchOf = (value: string | null): number | null => {
  if (value === null) return null;
  const lengths = [...value.matchAll(/(-?\d*\.?\d+)px/g)].map((m: ReadonlyArray<string>) =>
    Number(m[1]),
  );
  return lengths.length === 0 ? null : Math.max(...lengths);
};

/** The device inputs off the page: null without a `screen` to read. */
export const readDevice = (doc: RootDocumentLike, win: ScreenWindowLike): DeviceInputs | null => {
  const width = win.screen?.width;
  const height = win.screen?.height;
  if (width === undefined || height === undefined) return null;
  const screen: ScreenSize = { width, height };
  return {
    screen,
    dpr: win.devicePixelRatio ?? 1,
    notch: notchOf(readRootStyle(doc, win, SCREEN_CORNER)),
  };
};

/**
 * Write `--screen-corner` on the root where the device table (or the notch) names a radius; the
 * theme's `env()` fallback stands otherwise. The radius written, or null.
 */
export const applyScreenCorner = (doc: RootDocumentLike, win: ScreenWindowLike): number | null => {
  const inputs = readDevice(doc, win);
  const corner = inputs === null ? null : cornerRadius(inputs);
  if (corner !== null) setRootStyle(doc, SCREEN_CORNER, `${String(corner)}px`);
  return corner;
};

/** `?probe=1` in the page's query: the readout is asked for. */
export const probeAsked = (search: string): boolean => /(?:^\?|&)probe=1(?:&|$)/.test(search);

const PROBE_ID = 'screenProbe';
/** The three viewport units and the four insets, each measured off a hidden element's height. */
const RULERS: ReadonlyArray<readonly [string, string]> = [
  ['svh', '100svh'],
  ['dvh', '100dvh'],
  ['lvh', '100lvh'],
  ['inset-t', 'env(safe-area-inset-top, 0px)'],
  ['inset-r', 'env(safe-area-inset-right, 0px)'],
  ['inset-b', 'env(safe-area-inset-bottom, 0px)'],
  ['inset-l', 'env(safe-area-inset-left, 0px)'],
];
const MODES: ReadonlyArray<string> = ['fullscreen', 'standalone', 'minimal-ui', 'browser'];

const px = (n: number): string => String(Math.round(n * 100) / 100);

/** The readout's lines: what the device table read, what the units and the insets measure, the board's box. */
const probeLines = (
  doc: ScreenDocumentLike,
  win: ScreenWindowLike,
  probe: Element,
  corner: number | null,
): string => {
  const inputs = readDevice(doc, win);
  const rulers = RULERS.map(([name]) => {
    const el = queryIn(probe, `[data-ruler="${name}"]`);
    return `${name} ${el === null ? '?' : px(rectOf(el).height)}`;
  });
  const mode = MODES.find((m) => win.matchMedia?.(`(display-mode: ${m})`).matches === true) ?? '?';
  const board = byId(doc, 'board');
  const b = board === null ? null : rectOf(board);
  return [
    `inner ${String(win.innerWidth ?? '?')}x${String(win.innerHeight ?? '?')}  screen ${inputs === null ? '?' : `${String(inputs.screen.width)}x${String(inputs.screen.height)}`}  dpr ${String(win.devicePixelRatio ?? '?')}`,
    rulers.slice(0, 3).join('  '),
    rulers.slice(3).join('  '),
    `notch ${inputs?.notch === null || inputs === null ? '?' : px(inputs.notch)}  mode ${mode}`,
    `device ${deviceLabel(inputs)}  corner ${corner === null ? 'env()' : `${px(corner)}px`}`,
    `board ${b === null ? 'none' : `${px(b.left)},${px(b.top)} ${px(b.width)}x${px(b.height)}`}`,
    '(tap to dismiss)',
  ].join('\n');
};

/**
 * The `?probe=1` readout: a fixed monospace panel at the top-left, re-read a frame after every tap
 * on the page (so it shows the table once one is sat at, and the strip's numbers after a turn of
 * the phone and a tap), gone at a tap on itself. A test hook, not the fix: the shell reads the same
 * inputs by itself (`applyScreenCorner`).
 */
export const renderProbe = (
  doc: ScreenDocumentLike,
  win: ScreenWindowLike,
  corner: number | null,
): void => {
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
    if (text !== null) setText(text, probeLines(doc, win, probe, corner));
  };
  refresh();
  listen(probe, 'click', (e) => {
    stopPropagation(e);
    removeElement(probe);
  });
  doc.addEventListener('click', () => {
    nextFrame(refresh);
  });
};
