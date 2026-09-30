// The layout buckets (docs/design/layout-buckets.md): one table of the screen sizes a game lays
// out for, a name per bucket and the predicate that picks it, pure over the same inputs the
// media queries read (the viewport's width and height, `(any-pointer: fine)` and `(hover: hover)`).
// The owner (2026-09-28): "The briscola game can be played vertical or horizontal. Most games can
// be. And it shouldn't be that hard to make a thin layer on top to display differently for
// different buckets of screen sizing. That should be nicely done. There's also desktop." So: the
// boot writes the bucket on `<body data-layout>` and keeps it live (web/shared/edge/screen.ts
// `applyLayout`, `watchLayout`), the same predicates are spelled as `@media` strings here for a
// theme that prefers pure CSS (`BUCKET_MEDIA`), the UI Sandbox reads the bucket out and forces one
// for its preview, and the space audit reports the bucket per case (tools/space-audit.ts). Every
// threshold is spelled once below, with the catalogued devices (web/shared/lib/devices.ts) that
// land on each side of it; `bucketOf` is the one function, tested over every catalogued phone x
// orientation x mode in layout.test.ts. The family is decided by the pointer, never the width: a
// touch laptop (a fine pointer that hovers, and a coarse one too) is a desktop, an iPad Pro is a
// tablet, a phone's 956px sideways is a phone's. Backgammon's own tiers (its theme's rail scheme,
// the SE class, the 900px desktop step) are finer than these buckets and stay its own.

/** The inputs the predicates read: the viewport, and the two pointer facts a page's `matchMedia` answers. */
export type LayoutInputs = Readonly<{
  width: number;
  height: number;
  /** `(any-pointer: fine)`: some pointer is a mouse, a trackpad or a pen; false on a phone or tablet with fingers alone. */
  fine: boolean;
  /** `(hover: hover)`: the primary pointer hovers (a mouse, a trackpad; a touch laptop's); false on a phone or tablet. */
  hover: boolean;
}>;

export type Bucket =
  | 'phone-upright'
  | 'phone-sideways'
  | 'phone-sideways-short'
  | 'tablet-upright'
  | 'tablet-sideways'
  | 'desktop'
  | 'desktop-wide';
/** The seven, in the order a readout lists them: the phones, the tablets, the desktops. */
export const BUCKETS: ReadonlyArray<Bucket> = [
  'phone-upright',
  'phone-sideways',
  'phone-sideways-short',
  'tablet-upright',
  'tablet-sideways',
  'desktop',
  'desktop-wide',
];
/** The body attribute the boot writes (web/shared/styles/CONTRACT.md; `body[data-layout="phone-sideways"]` in a theme). */
export const LAYOUT_ATTR = 'layout';

/**
 * A phone upright is under this wide. Every catalogued phone is 320-440px wide upright (the SE1
 * 320, the Galaxy 360, the X class 375, the 12 class 390, the Pixel 412, the 16 Pro Max 440); the
 * narrowest iPad is 768. The classic phone/tablet line (Android's `sw600dp`).
 */
export const PHONE_MAX_WIDTH = 600;
/**
 * A phone sideways is at most this tall: the same figure as media.ts `LANDSCAPE_PHONE`'s
 * `(max-height: 500px)`. Sideways a phone is its upright width tall less the browser's bar:
 * 320-440px standalone, 270-440 in a tab; the smallest iPad sideways is 768 tall.
 */
export const SIDEWAYS_MAX_HEIGHT = 500;
/**
 * A short phone sideways is at most this tall: the SE and the X class (375 wide, so 375 tall
 * sideways standalone), the Galaxy S23 (360), the SE1 (320), and every phone up to the XR/XS Max
 * class (414) in a tab with the bar shown (414 - 50 = 364); the 12 class (390) and up standalone,
 * the 428+ classes in a tab, land above it.
 */
export const SHORT_MAX_HEIGHT = 375;
/**
 * A desktop window is wide from here: the audit's 1440x900 and 1920x1080 windows; the 1280x800
 * golden, the 1024x768 window and the narrow 900x700 land below. The smallest common laptop's
 * width at 1x (a 13-inch MacBook Air's 1440x900 default), so a wide bucket is one with room for
 * side panels beside a centred board.
 */
export const DESKTOP_WIDE_MIN_WIDTH = 1440;
/**
 * The audit's smallest standard desktop window (1024x768); a documented figure, not a threshold:
 * a fine pointer's window narrower than this (the audit's 900x700) is a `desktop` too, since the
 * pointer picks the family and a mouse never gets a phone's column.
 */
export const DESKTOP_MIN_WIDTH = 1024;

/** The pointer family: a desktop has a pointer that is fine or hovers; everything else is touch. */
export const isDesktop = (i: Pick<LayoutInputs, 'fine' | 'hover'>): boolean => i.fine || i.hover;

/** Sideways is wider than tall; a square is upright, as screen.ts `readFrame` reads it. */
export const isSideways = (i: Pick<LayoutInputs, 'width' | 'height'>): boolean =>
  i.width > i.height;

/** The bucket for a viewport and its pointer: the one function every reader shares. */
export const bucketOf = (i: LayoutInputs): Bucket => {
  if (isDesktop(i)) return i.width >= DESKTOP_WIDE_MIN_WIDTH ? 'desktop-wide' : 'desktop';
  if (isSideways(i)) {
    if (i.height <= SHORT_MAX_HEIGHT) return 'phone-sideways-short';
    return i.height <= SIDEWAYS_MAX_HEIGHT ? 'phone-sideways' : 'tablet-sideways';
  }
  return i.width < PHONE_MAX_WIDTH ? 'phone-upright' : 'tablet-upright';
};

/** The touch family in CSS: no pointer that is fine, none that hovers. */
const TOUCH = '(any-pointer: coarse) and (hover: none)';
/** The desktop family in CSS: two queries in a list (a media query list is an OR), each carrying the width clause. */
const desktopMedia = (width: string): string =>
  `(any-pointer: fine) and ${width}, (hover: hover) and ${width}`;

/**
 * The same predicates as `@media` query strings, for a theme that prefers pure CSS to the body
 * attribute (a phone's `any-pointer: coarse` stands for "no fine pointer": a phone answers
 * `any-pointer: fine` false, a touch laptop true, so the two spellings agree on every catalogued
 * device and on Chromium's emulation). The three phone buckets nest as the table does: the short
 * one is a phone sideways too, so a theme that reads `phone-sideways` alone catches both.
 */
export const BUCKET_MEDIA: Readonly<Record<Bucket, string>> = {
  'phone-upright': `${TOUCH} and (orientation: portrait) and (max-width: ${String(PHONE_MAX_WIDTH - 1)}px)`,
  'phone-sideways': `${TOUCH} and (orientation: landscape) and (max-height: ${String(SIDEWAYS_MAX_HEIGHT)}px)`,
  'phone-sideways-short': `${TOUCH} and (orientation: landscape) and (max-height: ${String(SHORT_MAX_HEIGHT)}px)`,
  'tablet-upright': `${TOUCH} and (orientation: portrait) and (min-width: ${String(PHONE_MAX_WIDTH)}px)`,
  'tablet-sideways': `${TOUCH} and (orientation: landscape) and (min-height: ${String(SIDEWAYS_MAX_HEIGHT + 1)}px)`,
  desktop: desktopMedia(`(max-width: ${String(DESKTOP_WIDE_MIN_WIDTH - 1)}px)`),
  'desktop-wide': desktopMedia(`(min-width: ${String(DESKTOP_WIDE_MIN_WIDTH)}px)`),
};

/**
 * One viewport that stands for each bucket (the UI Sandbox's switcher, docs/design/layout-buckets.md
 * §4): the 12 class upright and sideways, the SE sideways, the 9th iPad both ways, the 1280x800
 * golden and the 1440x900 laptop.
 */
export const REPRESENTATIVE: Readonly<Record<Bucket, LayoutInputs>> = {
  'phone-upright': { width: 390, height: 844, fine: false, hover: false },
  'phone-sideways': { width: 844, height: 390, fine: false, hover: false },
  'phone-sideways-short': { width: 667, height: 375, fine: false, hover: false },
  'tablet-upright': { width: 768, height: 1024, fine: false, hover: false },
  'tablet-sideways': { width: 1024, height: 768, fine: false, hover: false },
  desktop: { width: 1280, height: 800, fine: true, hover: true },
  'desktop-wide': { width: 1440, height: 900, fine: true, hover: true },
};

/** A bucket's name, or null for anything else (a `?layout=` query, an attribute read back). */
export const bucketNamed = (raw: string | null): Bucket | null =>
  BUCKETS.find((b) => b === raw) ?? null;
