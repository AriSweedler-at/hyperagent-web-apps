// The phones the shell knows by their screen (docs/design/backgammon-board.md §3.6): no CSS or JS
// API exposes a display's corner radius, and the safe-area insets only track it within a few
// points, so the trim's `--screen-corner` comes from this table when the screen matches a row and
// from the insets when it does not. A row is a device class: every iPhone that shares a screen in
// CSS points shares its radius (iOS `_displayCornerRadius`, in points; the 12 mini and 13 mini
// share the X's 375x812 and differ by their notch, 50pt against 44). Pure: the edge
// (web/shared/edge/screen.ts) reads `screen`, `devicePixelRatio`, the insets and the display mode
// off the page and asks here; a follow-up grows the table into a device catalogue.

/** A screen in CSS points; either orientation (the match normalises to portrait). */
export type ScreenSize = Readonly<{ width: number; height: number }>;

/** What the page knows of the device: the screen, its pixel ratio and the notch's depth (the largest of the top and side safe-area insets; null where the page cannot say). */
export type DeviceInputs = Readonly<{ screen: ScreenSize; dpr: number; notch: number | null }>;

/** One device class: the phones that share a screen, and the display's corner radius in points. */
export type DeviceClass = Readonly<{
  /** The models, for a readout. */
  models: string;
  /** The portrait screen in CSS points. */
  screen: ScreenSize;
  /** `devicePixelRatio`. */
  dpr: number;
  /** The notch or island's depth: the top inset upright, the side insets sideways. 0 on a home-button phone. */
  notch: number;
  /** The display's corner radius in points; 0 on a squared screen. */
  corner: number;
}>;

const row = (
  models: string,
  width: number,
  height: number,
  dpr: number,
  notch: number,
  corner: number,
): DeviceClass => ({ models, screen: { width, height }, dpr, notch, corner });

/** The iPhones by screen, the two 375x812 classes first (the notch tells them apart). */
export const DEVICES: ReadonlyArray<DeviceClass> = [
  row('iPhone X, XS, 11 Pro', 375, 812, 3, 44, 39),
  row('iPhone 12 mini, 13 mini', 375, 812, 3, 50, 44),
  row('iPhone XR, 11, XS Max, 11 Pro Max', 414, 896, 2, 48, 41.5),
  row('iPhone 12, 12 Pro, 13, 13 Pro, 14', 390, 844, 3, 47, 47.33),
  row('iPhone 12 Pro Max, 13 Pro Max, 14 Plus', 428, 926, 3, 47, 53.33),
  row('iPhone 14 Pro, 15, 15 Pro, 16', 393, 852, 3, 59, 55),
  row('iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus', 430, 932, 3, 59, 55),
  row('iPhone 16 Pro', 402, 874, 3, 62, 62),
  row('iPhone 16 Pro Max', 440, 956, 3, 62, 62),
  row('iPhone SE (2nd, 3rd), 6, 7, 8', 375, 667, 2, 0, 0),
  row('iPhone SE (1st), 5s', 320, 568, 2, 0, 0),
];

/** A screen as a portrait size: the shorter side first, so a phone held sideways matches its row. */
export const portraitOf = (screen: ScreenSize): ScreenSize => ({
  width: Math.min(screen.width, screen.height),
  height: Math.max(screen.width, screen.height),
});

/**
 * The device class a screen belongs to: the rows that share its portrait size, then the one whose
 * notch the insets name (a 375x812 screen with a 50pt notch is a mini, with 44 an X; with no notch
 * to read, the first row); null for a screen no row names (a desktop, an Android, a Display Zoom
 * setting, headless).
 */
export const deviceOf = (inputs: DeviceInputs): DeviceClass | null => {
  const screen = portraitOf(inputs.screen);
  const rows = DEVICES.filter(
    (d) => d.screen.width === screen.width && d.screen.height === screen.height,
  );
  const first = rows[0];
  if (first === undefined) return null;
  return rows.find((d) => d.notch === inputs.notch && d.dpr === inputs.dpr) ?? first;
};

/**
 * `--screen-corner` in px: the device's radius when its class is known, else the notch's depth
 * (the CSS fallback's own heuristic, `max(env(safe-area-inset-top), -left, -right)`), and null
 * where neither says (no notch read, or a notch of 0: the glass's corners are under the browser's
 * chrome, or square, and the theme's `env()` fallback stands at 0). A known class whose notch the
 * page reads as 0 is null too: in a portrait browser tab the page never reaches the corners.
 */
export const cornerRadius = (inputs: DeviceInputs): number | null => {
  if (inputs.notch === null || inputs.notch <= 0) return null;
  const device = deviceOf(inputs);
  return device === null ? inputs.notch : device.corner;
};
