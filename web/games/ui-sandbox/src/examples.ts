// The layout examples (docs/design/ui-sandbox.md §5; the owner: "maybe you want something covering
// everything, maybe you want a menu bar in the game on one side, maybe you want 2 menu bars, etc.
// ... come up with a few and have those as configurable layout examples"): each a plain flex or
// grid of coloured boxes inside the shell-padded `#app`, two of them notch-aware (the rail on the
// free side between the arcs, the buttons in the cut side's ears) through the safe-area map's
// custom properties alone (theme.css positions them off `--safe-free-*` and `--safe-<edge>-*`),
// so a half turn of the phone moves them live with no game code. Pure: markup as data, and the
// report over the boxes the boot measured.
import { safeHtml, type Rect, type SafeHtml } from '../../../shared/edge/dom.ts';
import type { ViewportSize } from '../../../shared/lib/devices.ts';
import {
  EDGES,
  insideSegments,
  type Edge,
  type SafeAreaMap,
} from '../../../shared/lib/safeArea.ts';
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

/** The nine, in the dropdown's order. */
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
];

export const exampleById = (id: ExampleId): Example => EXAMPLES.find((e) => e.id === id) ?? COVER;

/** A measured box: its name and its rect in the viewport. */
export type MeasuredBox = Readonly<{ name: string; rect: Rect; fixed: boolean }>;

export type ExampleReport = Readonly<{
  /** No document scroll: every box inside the viewport. */
  fits: boolean;
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

/** The report over the boxes the boot measured (`getBoundingClientRect` through dom.ts). */
export const exampleReport = (
  boxes: ReadonlyArray<MeasuredBox>,
  viewport: ViewportSize,
  map: SafeAreaMap,
  scrolls: boolean,
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
  const placements = boxes.filter((b) => b.fixed).map((b) => placementOf(map, b, viewport));
  return {
    fits,
    gaps,
    placements,
    lines: [
      fits ? 'fits without scroll' : scrolls ? 'SCROLLS' : 'a box leaves the viewport',
      `gaps to the edge: ${EDGES.map((e) => `${e} ${Number.isFinite(gaps[e]) ? px(gaps[e]) : '-'}`).join('  ')}`,
      ...(placements.length === 0 ? ['uses no map segment'] : placements),
    ],
  };
};
