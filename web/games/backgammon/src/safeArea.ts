// The safe-area map on this page's root (docs/design/ui-sandbox.md §3; the owner, 2026-09-28: the
// rail's buttons "should happily squish up to the edge of the screen ... when I rotate it 180
// degrees, instead of leaving that 'notch aware' area on one side, it should expand to fill that
// space"). UI Sandbox's main.ts writes the map for its examples; the shared boot writes the frame's
// corners (web/shared/edge/screen.ts `applyFrame`) and not the map, so this page writes it for the
// board's rail (theme.css's landscape rail block reads `data-free-side` and the `--safe-*`
// segments; docs/design/backgammon-board.md §3.1). Beside fx.ts, not under ui/: it composes the
// shared edge (screen.ts's readers), which ui/ may not import. One read of the frame (the corners, the insets,
// the viewport, the whole screen, the catalogue's row for its cut), the orientation type off
// `screen.orientation` (`landscape-primary` puts the cut on the left; a browser without the type
// is read as the primary), the map in screen space: the far seat's half turn is theme.css's to
// mirror (`body[data-flip]` swaps the sides). Re-read on what `watchFrame` watches and on
// `screen.orientation`'s own `change` (the half turn between the two landscapes fires no resize).
import { setAttr, setRootStyle, type Element } from '../../../shared/edge/dom.ts';
import {
  readFrame,
  watchFrame,
  type FrameReading,
  type ScreenDocumentLike,
  type ScreenWindowLike,
} from '../../../shared/edge/screen.ts';
import { deviceOf } from '../../../shared/lib/devices.ts';
import {
  isOrientationType,
  safeAreaMap,
  safeAreaVars,
  type OrientationType,
  type SafeAreaInputs,
  type SafeAreaMap,
} from '../../../shared/lib/safeArea.ts';

/** `screen.orientation` as a browser without it (Safari before 16.4) reads: optional, its members too. */
export type OrientationLike = Readonly<{
  type?: string;
  addEventListener?: (type: 'change', fn: () => void) => void;
}>;
/** The window as the map is read: the screen's `orientation` beside what the frame reads. */
export type SafeAreaWindowLike = ScreenWindowLike &
  Readonly<{ screen?: Readonly<{ orientation?: OrientationLike }> }>;

/** The orientation type the screen reports, or null without one (or an unknown value). */
export const orientationTypeOf = (win: SafeAreaWindowLike): OrientationType | null => {
  const t = win.screen?.orientation?.type;
  return t !== undefined && isOrientationType(t) ? t : null;
};

/**
 * The map's inputs off one frame reading and the type: the corners as drawn, the matched row's
 * cut (null for an unknown screen: no cut, no free side, the rail keeps inside the inset), the
 * insets, the viewport (0x0 on a window without one) and the whole screen; the type the screen's,
 * else the frame's orientation as the primary.
 */
export const mapInputsOf = (
  reading: FrameReading,
  type: OrientationType | null,
): SafeAreaInputs => ({
  corners: reading.corners,
  cut: reading.inputs === null ? null : (deviceOf(reading.inputs)?.cut ?? null),
  type: type ?? (reading.orientation === 'landscape' ? 'landscape-primary' : 'portrait-primary'),
  insets: reading.insets,
  viewport: reading.viewport ?? { width: 0, height: 0 },
  full: reading.full,
});

/**
 * Read the page, compute the map and write it on the root: `safeAreaVars`'s custom properties and
 * the three attributes theme.css branches on (`data-notch-side`, `data-free-side`, `data-ears`).
 */
export const applySafeArea = (doc: ScreenDocumentLike, win: SafeAreaWindowLike): SafeAreaMap => {
  const map = safeAreaMap(mapInputsOf(readFrame(doc, win), orientationTypeOf(win)));
  const vars = safeAreaVars(map);
  Object.keys(vars).forEach((name) => {
    setRootStyle(doc, name, vars[name] ?? '');
  });
  const root = doc.documentElement as Element | undefined;
  if (root !== undefined) {
    setAttr(root, 'data-notch-side', map.cutEdge);
    setAttr(root, 'data-free-side', vars['--safe-free-side'] ?? 'none');
    setAttr(root, 'data-ears', String(map.cutEdge === 'none' ? 0 : map.edges[map.cutEdge].length));
  }
  return map;
};

/** Write the map now and again on every change of the frame or of the orientation type. */
export const watchSafeArea = (doc: ScreenDocumentLike, win: SafeAreaWindowLike): void => {
  const again = (): void => {
    applySafeArea(doc, win);
  };
  again();
  watchFrame(doc, win, again);
  win.screen?.orientation?.addEventListener?.('change', again);
};
