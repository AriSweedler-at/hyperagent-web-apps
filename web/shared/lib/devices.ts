// The device catalogue (docs/design/devices.md; docs/design/backgammon-board.md §3.6): the phones
// the shell knows by their screen, with what no CSS or JS API tells a page: the display's corner
// radius, the safe-area insets each orientation reports, and what the browser's own bars take off
// the height in a tab. The owner (2026-09-28): "the shell must [figure this out]. And there should
// be a CLI to interact with the shell engine in order to validate this and emulate." So: the rows
// are data, every function over them is pure, and three readers share them: the boot
// (web/shared/edge/screen.ts `applyScreenCorner`: `screen`, `devicePixelRatio` and the notch off
// the page, then `cornerRadius`), the layout sweep (web/games/backgammon/src/ui/board/layout.test.ts,
// every row x orientation x mode through the CSS's pure twin) and the emulator
// (tools/shell-emulate.ts `list`, `explain`, `render`, `check`: Playwright with `emulationFor`'s
// viewport, insets and screen). A row is a device class: every iPhone that shares a screen in CSS
// points shares its radius; two classes on one screen (375x812: the X and the 12 mini; 414x896:
// the XR and the XS Max) part by their notch and their pixel ratio.
//
// Sources. Screens, pixel ratios and insets: Apple's Human Interface Guidelines "Layout" device
// table (developer.apple.com/design/human-interface-guidelines/layout, the points per model) and
// the safe-area values `UIWindow.safeAreaInsets` reports per class (44/34 X-class, 47/34 12-class,
// 59/34 14 Pro-class, 62/34 16 Pro-class upright; the notch on both short edges and 21 below
// sideways), as web/games/backgammon/theme.css §3.6 measured them and as the owner's probe can
// re-read them (`?probe=1`). Corner radii: iOS's private `_displayCornerRadius` per screen, as
// published by the paulz/ScreenCorners survey (github.com/kylebshr/ScreenCorners, the same
// numbers the design tools ship): 39, 41.5, 44, 47.33, 53.33, 55, 62. Browser bars: Apple,
// "Configuring the Viewport" (Safari Web Content Guide, 2016: the bars are outside the layout
// viewport); Chrome, "URL bar resizing" (developer.chrome.com/blog/url-bar-resizing, 2016: the
// URL bar is chrome, `innerHeight` grows when it hides); Koch, "Toolbars, keyboards, and the
// viewports" (quirksmode.org, 2017: "a typical browser toolbar ... takes about 60px"). None of the
// three publishes a height per model, so every `toolbar` range below is UNVERIFIED: min is the bar
// hidden, max the bar shown, and the emulator renders both.
//
// UNVERIFIED (inferred, `verified: false`; the probe on a real phone settles each): the iPhone 17
// line and the Air (screens announced 2025-09, insets and radii assumed to be the 16 Pro's); the
// iPads (0 insets in a tab; 20 or 24 under the status bar standalone; radius 0, 18 on Pro models);
// the Pixel and Galaxy rows (insets 0 in a tab, a display cutout of 24-30 in fullscreen, radii of
// 30-40); Safari's compact landscape bar (44-50pt); Chrome Android's 56dp toolbar over a 24dp
// status bar. In a portrait Safari tab the top inset reads 0 (the status bar is the browser's), so
// no corner rounds there: the same rule `cornerRadius` applies at boot.

/** A screen in CSS points; either orientation (the match normalises to portrait). */
export type ScreenSize = Readonly<{ width: number; height: number }>;
/** A viewport in CSS px: what `innerWidth x innerHeight` reads. */
export type ViewportSize = ScreenSize;
export type Orientation = 'portrait' | 'landscape';
export const ORIENTATIONS: ReadonlyArray<Orientation> = ['portrait', 'landscape'];
/** How the page is shown: a browser tab (the bars take height), an installed app (standalone), or the fullscreen the Android lock asks for. */
export type DisplayMode = 'browser' | 'standalone' | 'fullscreen';
export const DISPLAY_MODES: ReadonlyArray<DisplayMode> = ['browser', 'standalone', 'fullscreen'];
/** In a tab, whether the browser's bar is up (the page shorter) or hidden after a scroll. */
export type Bar = 'shown' | 'hidden';
export const BARS: ReadonlyArray<Bar> = ['shown', 'hidden'];
export type DeviceKind = 'iphone' | 'ipad' | 'android';
/** A range in CSS px, min to max inclusive. */
export type Range = Readonly<{ min: number; max: number }>;
/** The four safe-area insets in px, as `env(safe-area-inset-*)` reports them. */
export type Insets = Readonly<{ top: number; right: number; bottom: number; left: number }>;
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** One device class: the phones that share a screen, and what the page cannot read of them. */
export type Device = Readonly<{
  /** `<kind>-<w>x<h>[-<tag>]`: the CLI's `--device`, the probe's readout. */
  id: string;
  /** The models, for a readout. */
  models: string;
  kind: DeviceKind;
  /** The portrait screen in CSS points. */
  screen: ScreenSize;
  /** `devicePixelRatio`. */
  dpr: number;
  /** The safe-area insets standalone: upright the notch and the home indicator; sideways the notch on both short edges and the indicator below. */
  insets: Readonly<{
    portrait: Readonly<{ top: number; bottom: number }>;
    landscape: Readonly<{ left: number; right: number; bottom: number }>;
  }>;
  /** An Android display cutout: the inset fullscreen takes at the top upright and the left sideways (0 in a tab). */
  cutout: number;
  /** The display's corner radius in points; 0 on a squared screen. */
  corner: number;
  /** What the browser's bars take off the height in a tab, per orientation: min hidden, max shown. */
  toolbar: Readonly<{ portrait: Range; landscape: Range }>;
  /** True where every number is a published one; false where any is inferred (UNVERIFIED). */
  verified: boolean;
  /** False for a phone whose last iOS predates the theme's container queries (Safari 16): catalogued for the record, held to no promise. */
  supported: boolean;
}>;
/** The sibling's name for a row, kept for its callers. */
export type DeviceClass = Device;

/** What the page knows of the device: the screen, its pixel ratio and the notch's depth (the largest of the top and side safe-area insets; null where the page cannot say). */
export type DeviceInputs = Readonly<{ screen: ScreenSize; dpr: number; notch: number | null }>;

/** Safari on an iPhone: a compact bar sideways (UNVERIFIED 44-50), the status bar and the tab bar upright (94 collapsed to 180 expanded on a notched phone; 40 to 114 on a home-button one). */
const SAFARI_NOTCHED = { portrait: { min: 94, max: 180 }, landscape: { min: 0, max: 50 } } as const;
const SAFARI_HOME_BUTTON = {
  portrait: { min: 40, max: 114 },
  landscape: { min: 0, max: 50 },
} as const;
/** Safari on an iPad: one toolbar that never collapses (UNVERIFIED 50-70). */
const SAFARI_IPAD = { portrait: { min: 50, max: 70 }, landscape: { min: 50, max: 70 } } as const;
/** Chrome on Android: the 56dp toolbar over a 24dp status bar upright; the toolbar alone sideways (UNVERIFIED). */
const CHROME_ANDROID = { portrait: { min: 24, max: 80 }, landscape: { min: 0, max: 56 } } as const;

type Notched = readonly [top: number, bottom: number, side: number, sideBottom: number];
const iphone = (
  tag: string,
  models: string,
  width: number,
  height: number,
  dpr: number,
  [top, bottom, side, sideBottom]: Notched,
  corner: number,
  extra: Partial<Pick<Device, 'verified' | 'supported'>> = {},
): Device => ({
  id: `iphone-${String(width)}x${String(height)}${tag === '' ? '' : `-${tag}`}`,
  models,
  kind: 'iphone',
  screen: { width, height },
  dpr,
  insets: { portrait: { top, bottom }, landscape: { left: side, right: side, bottom: sideBottom } },
  cutout: 0,
  corner,
  toolbar: top === 0 ? SAFARI_HOME_BUTTON : SAFARI_NOTCHED,
  verified: true,
  supported: true,
  ...extra,
});
const ipad = (models: string, width: number, height: number, corner: number): Device => ({
  id: `ipad-${String(width)}x${String(height)}`,
  models,
  kind: 'ipad',
  screen: { width, height },
  dpr: 2,
  insets: { portrait: { top: 0, bottom: 0 }, landscape: { left: 0, right: 0, bottom: 0 } },
  cutout: 0,
  corner,
  toolbar: SAFARI_IPAD,
  verified: false,
  supported: true,
});
const android = (
  tag: string,
  models: string,
  width: number,
  height: number,
  dpr: number,
  cutout: number,
  corner: number,
): Device => ({
  id: `android-${String(width)}x${String(height)}-${tag}`,
  models,
  kind: 'android',
  screen: { width, height },
  dpr,
  insets: { portrait: { top: 0, bottom: 0 }, landscape: { left: 0, right: 0, bottom: 0 } },
  cutout,
  corner,
  toolbar: CHROME_ANDROID,
  verified: false,
  supported: true,
});

const NOTCH_44: Notched = [44, 34, 44, 21];
const NOTCH_47: Notched = [47, 34, 47, 21];
const NOTCH_48: Notched = [48, 34, 48, 21];
const NOTCH_50: Notched = [50, 34, 50, 21];
const NOTCH_59: Notched = [59, 34, 59, 21];
const NOTCH_62: Notched = [62, 34, 62, 21];
const NO_NOTCH: Notched = [0, 0, 0, 0];

/**
 * The catalogue: the iPhones by screen (the shared screens' classes adjacent, the notch and the
 * pixel ratio telling them apart), then the iPads and the two Android classes. A new phone is one
 * row: the sweep, the emulator and the sheet pick it up.
 */
export const DEVICES: ReadonlyArray<Device> = [
  iphone('x', 'iPhone X, XS, 11 Pro', 375, 812, 3, NOTCH_44, 39),
  iphone('mini', 'iPhone 12 mini, 13 mini', 375, 812, 3, NOTCH_50, 44),
  iphone('xr', 'iPhone XR, 11', 414, 896, 2, NOTCH_48, 41.5),
  iphone('max', 'iPhone XS Max, 11 Pro Max', 414, 896, 3, NOTCH_44, 39),
  iphone('', 'iPhone 12, 12 Pro, 13, 13 Pro, 14, 16e', 390, 844, 3, NOTCH_47, 47.33),
  iphone('', 'iPhone 12 Pro Max, 13 Pro Max, 14 Plus', 428, 926, 3, NOTCH_47, 53.33),
  iphone('', 'iPhone 14 Pro, 15, 15 Pro, 16', 393, 852, 3, NOTCH_59, 55),
  iphone('', 'iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus', 430, 932, 3, NOTCH_59, 55),
  iphone('', 'iPhone 16 Pro; 17, 17 Pro (UNVERIFIED)', 402, 874, 3, NOTCH_62, 62, {
    verified: false,
  }),
  iphone('', 'iPhone 16 Pro Max; 17 Pro Max (UNVERIFIED)', 440, 956, 3, NOTCH_62, 62, {
    verified: false,
  }),
  iphone('air', 'iPhone Air (UNVERIFIED)', 420, 912, 3, NOTCH_62, 62, { verified: false }),
  iphone('se', 'iPhone SE (2nd, 3rd), 6, 7, 8', 375, 667, 2, NO_NOTCH, 0),
  // iOS 15 was its last; the theme's container queries need Safari 16.
  iphone('se1', 'iPhone SE (1st), 5s', 320, 568, 2, NO_NOTCH, 0, { supported: false }),
  ipad('iPad (9th), mini', 768, 1024, 0),
  ipad('iPad (10th), Air', 820, 1180, 18),
  ipad('iPad Pro 12.9', 1024, 1366, 18),
  android('pixel', 'Pixel 7, 8', 412, 915, 2.625, 28, 32),
  android('galaxy', 'Galaxy S23', 360, 780, 3, 30, 30),
];

/** The row with this id, or null. */
export const deviceById = (id: string): Device | null => DEVICES.find((d) => d.id === id) ?? null;

/** The notch or island's depth: the largest of the top and side insets. 0 on a home-button phone and every iPad and Android in a tab. */
export const notchOf = (d: Device): number =>
  Math.max(d.insets.portrait.top, d.insets.landscape.left, d.insets.landscape.right);

/** A screen as a portrait size: the shorter side first, so a phone held sideways matches its row. */
export const portraitOf = (screen: ScreenSize): ScreenSize => ({
  width: Math.min(screen.width, screen.height),
  height: Math.max(screen.width, screen.height),
});

/**
 * The device class a screen belongs to: the rows that share its portrait size, then the one whose
 * notch and pixel ratio the page read (a 375x812 screen with a 50pt notch is a mini, with 44 an
 * X; a 414x896 at 2x is an XR, at 3x an XS Max), else the one with its pixel ratio (a hardware
 * constant, so it outranks the notch, a measurement), else the one with its notch, else the first;
 * null for a screen no row names (a desktop, a Display Zoom setting, headless).
 */
export const deviceOf = (inputs: DeviceInputs): Device | null => {
  const screen = portraitOf(inputs.screen);
  const rows = DEVICES.filter(
    (d) => d.screen.width === screen.width && d.screen.height === screen.height,
  );
  const first = rows[0];
  if (first === undefined) return null;
  return (
    rows.find((d) => notchOf(d) === inputs.notch && d.dpr === inputs.dpr) ??
    rows.find((d) => d.dpr === inputs.dpr) ??
    rows.find((d) => notchOf(d) === inputs.notch) ??
    first
  );
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

/** The class's own name for a readout: the id, or `unknown (heuristic)` where the insets stand in. */
export const deviceLabel = (inputs: DeviceInputs | null): string => {
  const device = inputs === null ? null : deviceOf(inputs);
  return device === null ? 'unknown (heuristic)' : device.id;
};

/**
 * The safe-area insets a device reports in an orientation and a mode: standalone and fullscreen
 * the notch and the home indicator (an Android's cutout fullscreen alone, 0 in a tab); in a tab
 * the same sideways, and upright a top of 0 (Safari's status bar and Chrome's toolbar own the
 * page's top edge: UNVERIFIED for Safari, see the header).
 */
export const insetsFor = (d: Device, o: Orientation, mode: DisplayMode): Insets => {
  const cutout = d.kind === 'android' ? (mode === 'fullscreen' ? d.cutout : 0) : 0;
  if (o === 'portrait') {
    const top = mode === 'browser' ? 0 : Math.max(d.insets.portrait.top, cutout);
    return { top, right: 0, bottom: d.insets.portrait.bottom, left: 0 };
  }
  const side = d.insets.landscape;
  return {
    top: 0,
    right: side.right,
    bottom: side.bottom,
    left: Math.max(side.left, cutout),
  };
};

/** The screen as `innerWidth x innerHeight` would read it standalone: the points, turned for the orientation. */
export const screenFor = (d: Device, o: Orientation): ViewportSize =>
  o === 'portrait' ? d.screen : { width: d.screen.height, height: d.screen.width };

/** What the browser's bar takes off the height: the toolbar range's max with the bar shown, its min hidden; 0 outside a tab. */
export const toolbarFor = (d: Device, o: Orientation, mode: DisplayMode, bar: Bar): number =>
  mode === 'browser' ? d.toolbar[o][bar === 'shown' ? 'max' : 'min'] : 0;

/** The layout viewport in an orientation, a mode and a bar state: the screen less the bar. */
export const viewportFor = (
  d: Device,
  o: Orientation,
  mode: DisplayMode,
  bar: Bar,
): ViewportSize => {
  const screen = screenFor(d, o);
  return { width: screen.width, height: screen.height - toolbarFor(d, o, mode, bar) };
};

/** The four corners of the viewport; true where the page's corner is the screen's own. */
export type Reach = Readonly<{ tl: boolean; tr: boolean; br: boolean; bl: boolean }>;

/**
 * The edge-reach rule (the screen-frame design): every corner is the screen's standalone and
 * fullscreen; in a tab a corner is the screen's only where both its edges provably reach the glass
 * (a non-zero inset on that side), and sideways the top edge counts as reached when the bottom
 * inset is non-zero (iOS puts the toolbar at the bottom then: UNVERIFIED). Everything else is
 * square (the corner is the browser's).
 */
export const reachOf = (o: Orientation, mode: DisplayMode, insets: Insets): Reach => {
  if (mode !== 'browser') return { tl: true, tr: true, br: true, bl: true };
  const top = insets.top > 0 || (o === 'landscape' && insets.bottom > 0);
  const bottom = insets.bottom > 0;
  const left = insets.left > 0;
  const right = insets.right > 0;
  return { tl: top && left, tr: top && right, br: bottom && right, bl: bottom && left };
};

/** One emulated case: everything Playwright and the twin need to stand a page on this device. */
export type Emulation = Readonly<{
  device: Device;
  orientation: Orientation;
  mode: DisplayMode;
  bar: Bar;
  /** `innerWidth x innerHeight`. */
  viewport: ViewportSize;
  /** `screen.width x screen.height`: iOS reports the portrait size in either orientation. */
  screen: ScreenSize;
  dpr: number;
  insets: Insets;
  /** What the theme's `--screen-corner` fallback computes to (the largest of the top and side insets): the boot's notch. */
  notch: number;
  /** The radius the boot writes (`cornerRadius`), or 0 where it writes nothing and the `env()` fallback stands. */
  corner: number;
  reach: Reach;
}>;

/** The case for a device, an orientation, a mode and a bar state (the bar matters in a tab alone: `hidden` elsewhere). */
export const emulationFor = (
  device: Device,
  orientation: Orientation,
  mode: DisplayMode,
  bar: Bar = 'hidden',
): Emulation => {
  const insets = insetsFor(device, orientation, mode);
  const notch = Math.max(insets.top, insets.left, insets.right);
  const shownBar: Bar = mode === 'browser' ? bar : 'hidden';
  return {
    device,
    orientation,
    mode,
    bar: shownBar,
    viewport: viewportFor(device, orientation, mode, shownBar),
    screen: device.screen,
    dpr: device.dpr,
    insets,
    notch,
    corner: cornerRadius({ screen: device.screen, dpr: device.dpr, notch }) ?? 0,
    reach: reachOf(orientation, mode, insets),
  };
};

/** Every case of a device: both orientations x the three modes, the tab twice (bar shown, bar hidden). */
export const emulationsOf = (device: Device): ReadonlyArray<Emulation> =>
  ORIENTATIONS.flatMap((o) =>
    DISPLAY_MODES.flatMap((mode) =>
      (mode === 'browser' ? BARS : (['hidden'] as const)).map((bar) =>
        emulationFor(device, o, mode, bar),
      ),
    ),
  );

/** A case's short name: `iphone-390x844 landscape browser bar-shown`. */
export const emulationName = (e: Emulation): string =>
  `${e.device.id} ${e.orientation} ${e.mode}${e.mode === 'browser' ? ` bar-${e.bar}` : ''}`;
