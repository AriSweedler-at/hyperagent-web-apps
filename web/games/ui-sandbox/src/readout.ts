// The information panel's text (docs/design/ui-sandbox.md §2): what the page read of the device
// and the viewport, the frame's reading (web/shared/edge/screen.ts `readFrame`), the browser bar's
// state as the reach rule implies it, the safe-area map and every media query the shell uses with
// its match, as one block of text a user can paste into a bug report beside a screenshot. Pure:
// the boot gathers the numbers, this file spells them.
import { LANDSCAPE_PHONE, PORTRAIT_PHONE } from '../../../shared/edge/media.ts';
import type { FrameReading } from '../../../shared/edge/screen.ts';
import {
  CORNER_KEYS,
  deviceOf,
  type Device,
  type DisplayMode,
  type Reach,
} from '../../../shared/lib/devices.ts';
import {
  EDGES,
  lengthOf,
  type OrientationType,
  type SafeAreaMap,
} from '../../../shared/lib/safeArea.ts';

/** The media queries the panel reports, the shell's two first. */
export const MEDIA_QUERIES: ReadonlyArray<readonly [name: string, query: string]> = [
  ['LANDSCAPE_PHONE', LANDSCAPE_PHONE],
  ['PORTRAIT_PHONE', PORTRAIT_PHONE],
  ['any-pointer coarse', '(any-pointer: coarse)'],
  ['pointer coarse', '(pointer: coarse)'],
  ['hover none', '(hover: none)'],
  ['orientation landscape', '(orientation: landscape)'],
  ['orientation portrait', '(orientation: portrait)'],
  ['display-mode browser', '(display-mode: browser)'],
  ['display-mode standalone', '(display-mode: standalone)'],
  ['display-mode fullscreen', '(display-mode: fullscreen)'],
  ['display-mode minimal-ui', '(display-mode: minimal-ui)'],
  ['prefers-color-scheme dark', '(prefers-color-scheme: dark)'],
  ['prefers-reduced-motion reduce', '(prefers-reduced-motion: reduce)'],
  ['max-width 899', '(max-width: 899px)'],
  ['min-width 900', '(min-width: 900px)'],
  ['max-height 500', '(max-height: 500px)'],
];

/** Where the browser's bar is, as the reach rule's corners imply (docs/design/screen-frame.md §4). */
export type BarState = 'none' | 'hidden' | 'top' | 'bottom' | 'unknown';
export const barOf = (mode: DisplayMode, reach: Reach): BarState => {
  if (mode !== 'browser') return 'none';
  if (reach.tl && reach.tr && reach.br && reach.bl) return 'hidden';
  if (!reach.tl && !reach.tr && reach.br && reach.bl) return 'top';
  if (reach.tl && reach.tr && !reach.br && !reach.bl) return 'bottom';
  return 'unknown';
};
export const BAR_COPY: Readonly<Record<BarState, string>> = {
  none: 'no browser bar (installed or fullscreen)',
  hidden: 'browser bar hidden (the page is the whole screen)',
  top: 'browser bar at the top (the top corners are its)',
  bottom: 'browser bar at the bottom (the bottom corners are its)',
  unknown: 'browser bar: unknown (no side inset proves an edge)',
};

export type Readout = Readonly<{
  reading: FrameReading;
  /** `screen.orientation.type`, or null where the browser has none. */
  type: OrientationType | null;
  /** `?type=` overrode it. */
  typeForced: boolean;
  visual: Readonly<{ width: number; height: number; scale: number }> | null;
  /** 100svh, 100dvh, 100lvh and 100vw in px. */
  units: Readonly<{ svh: number; dvh: number; lvh: number; vw: number }>;
  media: ReadonlyArray<readonly [name: string, matches: boolean]>;
  map: SafeAreaMap;
  flipped: boolean;
  frameOn: boolean;
}>;

const px = (n: number): string => String(Math.round(n * 100) / 100);
const size = (s: Readonly<{ width: number; height: number }> | null): string =>
  s === null ? '?' : `${px(s.width)}x${px(s.height)}`;

/** The matched row for a reading, or null (unknown: the heuristic stands). */
export const matchedDevice = (reading: FrameReading): Device | null =>
  reading.inputs === null ? null : deviceOf(reading.inputs);

const segmentText = (s: Readonly<{ from: number; to: number }>): string =>
  `${px(s.from)}-${px(s.to)} (${px(lengthOf(s))})`;

/** The whole readout, one fact per line. */
export const readoutLines = (r: Readout): ReadonlyArray<string> => {
  const { reading: f } = r;
  const device = matchedDevice(f);
  const i = f.insets;
  const bar = barOf(f.mode, f.reach);
  return [
    `device ${device === null ? 'unknown: heuristic (the notch depth stands for the radius)' : `${device.id}  ${device.models}${device.verified ? '' : '  (UNVERIFIED row)'}`}`,
    `corner radius ${px(f.radius)}px${device === null ? '' : `  cut ${device.cut === null ? 'none' : `${String(device.cut.length)}pt ${device.cut.island ? 'island' : 'notch'}`}`}`,
    `screen ${f.inputs === null ? '?' : size(f.inputs.screen)}  dpr ${f.inputs === null ? '?' : String(f.inputs.dpr)}  full ${size(f.full)}`,
    `inner ${size(f.viewport)}  visualViewport ${r.visual === null ? '?' : `${size(r.visual)} @${px(r.visual.scale)}`}`,
    `100svh ${px(r.units.svh)}  100dvh ${px(r.units.dvh)}  100lvh ${px(r.units.lvh)}  100vw ${px(r.units.vw)}`,
    `insets top ${px(i.top)}  right ${px(i.right)}  bottom ${px(i.bottom)}  left ${px(i.left)}`,
    `display-mode ${f.mode}  orientation ${f.orientation}  type ${r.type ?? 'unavailable'}${r.typeForced ? ' (forced by ?type=)' : ''}`,
    BAR_COPY[bar],
    `reaches ${CORNER_KEYS.map((k) => `${k} ${f.reach[k] ? px(f.corners[k]) : 'square'}`).join('  ')}`,
    `frame ${r.frameOn ? 'on' : 'off'}  flip ${r.flipped ? 'on' : 'off'}`,
    `cut side ${r.map.cutEdge}${r.map.cut === null ? (r.map.cutEdge === 'none' ? '' : ' (off the page)') : `  at ${segmentText(r.map.cut)}`}  ear ${px(r.map.ear)}`,
    ...EDGES.map(
      (edge) =>
        `safe ${edge}: ${r.map.edges[edge].length === 0 ? 'none' : r.map.edges[edge].map(segmentText).join(', ')}`,
    ),
    ...r.media.map(([name, matches]) => `${matches ? 'match ' : '      '} ${name}`),
  ];
};

export const readoutText = (r: Readout): string => readoutLines(r).join('\n');
