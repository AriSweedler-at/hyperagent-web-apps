// The layout examples (docs/design/ui-sandbox.md §5; the owner: "maybe you want something covering
// everything, maybe you want a menu bar in the game on one side, maybe you want 2 menu bars, etc.
// ... come up with a few and have those as configurable layout examples"): each a plain flex or
// grid of coloured boxes inside the shell-padded `#app`, two of them notch-aware (the rail on the
// free side between the arcs, the buttons in the cut side's ears) through the safe-area map's
// custom properties alone (theme.css positions them off `--safe-free-*` and `--safe-<edge>-*`),
// so a half turn of the phone moves them live with no game code. Pure: markup as data, and the
// report over the boxes the boot measured, with the fill rule (the owner, 2026-09-29: "it doesn't
// use all the screen real-estate ... it should fill up the screen"): the flowing boxes' outer
// edges sit where the shell's padding puts them, the frame's clearance or the safe-area inset on
// that side, whichever is more (shell.css `:where(body[data-frame]) #app`), within a pixel.
// Example (j) (docs/design/ui-sandbox.md §7) is the one with a call to action: the Dice App Clip's
// "Roll in the Island", a plain link the boot enables through web/shared/lib/appClip.ts `clipGate`.
import { safeHtml, type Rect, type SafeHtml } from '../../../shared/edge/dom.ts';
import { INITIAL_ROLL } from '../../../shared/lib/appClip.ts';
import type { Insets, ViewportSize } from '../../../shared/lib/devices.ts';
import {
  EDGES,
  insideSegments,
  type Edge,
  type SafeAreaMap,
} from '../../../shared/lib/safeArea.ts';
import { dieMarkup } from './dice.ts';
import type { ExampleId } from './settings.ts';

export type Example = Readonly<{
  id: ExampleId;
  label: string;
  /** What it stands for, and what to look at. */
  blurb: string;
  markup: SafeHtml;
}>;

const box = (name: string, cls: string): SafeHtml =>
  safeHtml`<div class="box ${cls}" data-box="${name}"><span class="box-name">${name}</span><b class="box-size" data-size></b></div>`;
const buttons = (n: number, prefix: string): SafeHtml =>
  safeHtml`${Array.from({ length: n }, (_, i) => safeHtml`<button type="button" class="sq-btn" data-target="${`${prefix}-${String(i + 1)}`}" aria-label="${`${prefix} ${String(i + 1)}`}">${String(i + 1)}</button>`)}`;

const COVER: Example = {
  id: 'cover',
  label: '(a) One box covering everything',
  blurb: 'The content area the shell leaves a game: the frame, its gap and the insets taken off.',
  markup: box('content', 'fill'),
};

/** The ten, in the dropdown's order. */
export const EXAMPLES: ReadonlyArray<Example> = [
  COVER,
  {
    id: 'side',
    label: '(b) A side menu bar + content',
    blurb: 'A 44px bar on the left, the content beside it.',
    markup: safeHtml`${box('menu', 'bar v')}${box('content', 'fill')}`,
  },
  {
    id: 'sides',
    label: '(c) Two side bars + content',
    blurb: 'Two 44px bars, the content between them.',
    markup: safeHtml`${box('menu', 'bar v')}${box('content', 'fill')}${box('tools', 'bar v')}`,
  },
  {
    id: 'top',
    label: '(d) A top strip + content',
    blurb: 'A 22px strip above the content (a status line).',
    markup: safeHtml`${box('strip', 'bar h')}${box('content', 'fill')}`,
  },
  {
    id: 'strips',
    label: '(e) Top strip + content + bottom strip',
    blurb: 'Two 22px strips around the content.',
    markup: safeHtml`${box('top strip', 'bar h')}${box('content', 'fill')}${box('bottom strip', 'bar h')}`,
  },
  {
    id: 'board',
    label: "(f) Backgammon's shape: strip + 13-column grid + rail",
    blurb: "The table's geometry without the game: a 22px strip, a 13-column grid, a 44px rail.",
    markup: safeHtml`${box('strip', 'bar h')}<div class="board-row">${safeHtml`<div class="grid13" data-box="grid">${Array.from({ length: 13 }, (_, i) => safeHtml`<i class="col ${i === 6 ? 'mid' : ''}"></i>`)}<b class="box-size" data-size></b></div>`}${box('rail', 'bar v')}</div>`,
  },
  {
    id: 'rail',
    label: '(g) A rail on the free side, hugging the screen edge',
    blurb:
      'Three 44px buttons on the side without the cut, between the corner arcs, at the glass (`--safe-free-*`). A half turn moves it across.',
    markup: safeHtml`${box('content', 'fill')}<div class="edge-rail" data-box="rail" data-fixed>${buttons(3, 'rail')}<b class="box-size" data-size></b></div><p class="edge-note" data-note="rail"></p>`,
  },
  {
    id: 'ears',
    label: "(h) Buttons in the cut side's two ears",
    blurb:
      'One 44px button above and one below the notch or the island (`--safe-<side>-*`), shown only where an ear is at least 44px; the note says why otherwise.',
    markup: safeHtml`${box('content', 'fill')}<div class="ear ear-1" data-box="ear1" data-fixed>${buttons(1, 'ear1')}</div><div class="ear ear-2" data-box="ear2" data-fixed>${buttons(1, 'ear2')}</div><p class="edge-note" data-note="ears"></p>`,
  },
  {
    id: 'gutters',
    label: "(i) Today's symmetric gutters, for comparison",
    blurb:
      "The games' current sideways layout: one gutter as wide as the larger side inset on both sides, whichever side the cut is on.",
    markup: safeHtml`<div class="gutters" data-box="gutters">${box('content', 'fill')}<b class="box-size" data-size></b></div>`,
  },
  {
    id: 'dice',
    label: '(j) Dice in the Dynamic Island',
    blurb:
      'A web page cannot draw in the island; the Dice App Clip can. The island hatched, a mock die in each ear beside it (`--safe-<side>-*`; without ears, where they would be), and "Roll in the Island", live only on an island iPhone once the clip is published.',
    markup: safeHtml`${box('content', 'fill')}<div class="island-cut" aria-hidden="true"></div><div class="die-ear die-1" data-box="die1" data-fixed>${dieMarkup('one', INITIAL_ROLL[0])}</div><div class="die-ear die-2" data-box="die2" data-fixed>${dieMarkup('two', INITIAL_ROLL[1])}</div><div class="island-cta"><a class="btn btn-go" id="islandRollBtn" target="_blank" rel="noopener" aria-disabled="true">Roll in the Island</a><p class="island-reason" data-note="dice"></p></div>`,
  },
];

/**
 * Where example (j)'s dice sit, for the report (the owner: "without an island the dice sit where
 * the ears would be and the Report says why"): in the two ears where both fit; flanking the cut on
 * its edge where an ear is under 44px (a notch phone) or the edge is horizontal; in the top
 * corners where no cut is on the page.
 */
export const diceLine = (map: SafeAreaMap): string => {
  const vertical = map.cutEdge === 'left' || map.cutEdge === 'right';
  return map.cut === null
    ? 'dice: no cut on this page (whole glass, or the cut is under the browser bar): the seats sit in the top corners'
    : vertical && map.edges[map.cutEdge].length === 2
      ? `dice: one seat in each ear of the ${map.island ? 'island' : 'notch'} on the ${map.cutEdge}`
      : vertical
        ? `dice: the ears beside this ${map.island ? 'island' : 'notch'} are under 44px: the seats flank the cut and overlap the arcs`
        : `dice: the cut is on the ${map.cutEdge} edge: the seats flank it along that edge`;
};

export const exampleById = (id: ExampleId): Example => EXAMPLES.find((e) => e.id === id) ?? COVER;

/** A measured box: its name and its rect in the viewport. */
export type MeasuredBox = Readonly<{ name: string; rect: Rect; fixed: boolean }>;

/** The room the shell leaves an example: the frame's clearance (band + hairline + gap; 0 with the frame off) and the four insets. */
export type Room = Readonly<{ clearance: number; insets: Insets }>;
/** No frame, no insets: the boxes reach the viewport's edge. */
export const NO_ROOM: Room = { clearance: 0, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
/** Where each edge of the flowing boxes must sit: the clearance or that side's inset, whichever is more. */
export const roomEdges = (room: Room): Readonly<Record<Edge, number>> => ({
  top: Math.max(room.clearance, room.insets.top),
  right: Math.max(room.clearance, room.insets.right),
  bottom: Math.max(room.clearance, room.insets.bottom),
  left: Math.max(room.clearance, room.insets.left),
});
/** One pixel: the slack a box edge may leave beyond the room's (a sub-pixel flex rounding). */
export const FILL_SLACK = 1;

export type ExampleReport = Readonly<{
  /** No document scroll: every box inside the viewport. */
  fits: boolean;
  /** Every edge of the flowing boxes within `FILL_SLACK` of the room's edge (and no scroll). */
  fills: boolean;
  /** The room's edge per side: the clearance or the inset. */
  room: Readonly<Record<Edge, number>>;
  /** The least gap from the flowing boxes to each viewport edge. */
  gaps: Readonly<Record<Edge, number>>;
  /** The map segments the fixed boxes sit in (`left 1`, `right 2`), or `over an arc or the cut`. */
  placements: ReadonlyArray<string>;
  lines: ReadonlyArray<string>;
}>;

const px = (n: number): string => String(Math.round(n * 100) / 100);

/** Which of an edge's segments holds a fixed box along that edge, if any. */
const placementOf = (map: SafeAreaMap, b: MeasuredBox, viewport: ViewportSize): string => {
  const vertical = b.rect.left < viewport.width / 2 ? ('left' as const) : ('right' as const);
  const span = { from: b.rect.top, to: b.rect.top + b.rect.height };
  const inside = insideSegments(map.edges[vertical], span);
  const index = map.edges[vertical].findIndex(
    (s) => span.from >= s.from - 0.5 && span.to <= s.to + 0.5,
  );
  return `${b.name}: ${vertical} ${inside ? `segment ${String(index + 1)}` : 'OVER AN ARC OR THE CUT'}`;
};

/** The report over the boxes the boot measured (`getBoundingClientRect` through dom.ts) against the room the shell left them. */
export const exampleReport = (
  boxes: ReadonlyArray<MeasuredBox>,
  viewport: ViewportSize,
  map: SafeAreaMap,
  scrolls: boolean,
  room: Room = NO_ROOM,
): ExampleReport => {
  const flowing = boxes.filter((b) => !b.fixed);
  const gaps: Record<Edge, number> = {
    top: Math.min(...flowing.map((b) => b.rect.top), Infinity),
    left: Math.min(...flowing.map((b) => b.rect.left), Infinity),
    right: Math.min(...flowing.map((b) => viewport.width - (b.rect.left + b.rect.width)), Infinity),
    bottom: Math.min(
      ...flowing.map((b) => viewport.height - (b.rect.top + b.rect.height)),
      Infinity,
    ),
  };
  const inside = boxes.every(
    (b) =>
      b.rect.top >= -0.5 &&
      b.rect.left >= -0.5 &&
      b.rect.top + b.rect.height <= viewport.height + 0.5 &&
      b.rect.left + b.rect.width <= viewport.width + 0.5,
  );
  const fits = inside && !scrolls;
  const want = roomEdges(room);
  const off = EDGES.filter((e) => !(Math.abs(gaps[e] - want[e]) <= FILL_SLACK));
  const fills = flowing.length > 0 && !scrolls && off.length === 0;
  const held = EDGES.filter((e) => room.insets[e] > room.clearance);
  const placements = boxes.filter((b) => b.fixed).map((b) => placementOf(map, b, viewport));
  return {
    fits,
    fills,
    room: want,
    gaps,
    placements,
    lines: [
      fits ? 'fits without scroll' : scrolls ? 'SCROLLS' : 'a box leaves the viewport',
      `gaps to the edge: ${EDGES.map((e) => `${e} ${Number.isFinite(gaps[e]) ? px(gaps[e]) : '-'}`).join('  ')}`,
      fills
        ? 'fills the room the frame leaves'
        : flowing.length === 0
          ? 'no flowing box to fill the room'
          : `SHORT OF THE FRAME: ${off.map((e) => `${e} ${Number.isFinite(gaps[e]) ? px(gaps[e] - want[e]) : '-'}px (room ${px(want[e])})`).join('  ')}`,
      ...held.map(
        (e) =>
          `${e} held off by the ${px(room.insets[e])}px inset (the notch, the status bar or the home indicator), not the frame`,
      ),
      ...(placements.length === 0 ? ['uses no map segment'] : placements),
    ],
  };
};
