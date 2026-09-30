// The space audit's judge (docs/design/space-audit.md): pure over one measured record of one
// screen of one page on one emulated case, so the same rules read a Playwright measurement and a
// unit test's table row alike. The owner (2026-09-30): "Only backgammon gets a border. But just
// check each game ... to make sure it looks reasonable and doesn't waste space. Dispatch a subagent
// to find a deterministic way to accomplish this." Six checks, one column each in the `check`
// table (tools/shell-emulate.ts's shape): `used` (the empty screen per side beyond the room the
// shell and the insets take), `scroll` (no sideways scroll ever; no document scroll on a
// fixed-screen body or a screen the table says never scrolls), `clip` (no one-line slot wider than
// its box), `targets` (every control 44px on a touch emulation), `frame` (`data-frame` on
// backgammon alone) and `gutter` (content 4px off every edge of an unframed page, and no text under
// the notch or the home indicator). The thresholds are LIMITS below, one row per screen kind, a
// comment per number.
import type { Emulation, Insets } from '../../web/shared/lib/devices.ts';
import type { Check, Verdict } from '../shell-emulate.ts';

/** The pages the audit drives: the four games, the solo page and the tool (tools/games.ts PAGE_HOOKS). */
export type PageId = 'gin-rummy' | 'fidice' | 'briscola' | 'backgammon' | 'rps' | 'ui-sandbox';
export const PAGE_IDS: ReadonlyArray<PageId> = [
  'gin-rummy',
  'fidice',
  'briscola',
  'backgammon',
  'rps',
  'ui-sandbox',
];
/** The pages that carry the frame: backgammon alone among the games (the owner's decision, 2026-09-30), and the sandbox, which is the frame's own demo (its Settings toggle it). */
export const FRAMED: ReadonlyArray<PageId> = ['backgammon', 'ui-sandbox'];

/** What a screen is for, which picks its LIMITS row. */
export type ScreenKind = 'home' | 'table' | 'tool';
export type Screen = Readonly<{ id: string; kind: ScreenKind }>;

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: ReadonlyArray<Side> = ['top', 'right', 'bottom', 'left'];
export type Sides = Readonly<Record<Side, number>>;
export type Box = Readonly<{ x: number; y: number; w: number; h: number }>;

/** One control's box, for the 44px rule. */
export type Target = Readonly<{ sel: string; w: number; h: number }>;
/** One `white-space: nowrap` element whose content is wider than its box, by `over` px. */
export type Clipped = Readonly<{ sel: string; over: number }>;
/** One text-bearing box crossing an inset band. */
export type InsetHit = Readonly<{ sel: string; side: Side }>;

/** What the page-side script reads of one screen (tools/space-audit.ts `measureScript`). */
export type Measured = Readonly<{
  inner: Readonly<{ w: number; h: number }>;
  scrollHeight: number;
  scrollWidth: number;
  /** `body.fixed-screen`: the shell's table state (shell.css: 100dvh, overflow hidden). */
  fixedScreen: boolean;
  /** `body[data-frame]`. */
  frame: boolean;
  /** `#app`'s computed padding: the shell's clearance on a framed page, the theme's gutter elsewhere. */
  pad: Sides;
  /** `--gutter` on `#app` in px where the theme declares one; null where none does (the table's default stands). */
  gutterToken: number | null;
  /** The union of `#app`'s visible content boxes, clipped to the viewport; null where nothing paints. */
  used: Box | null;
  clipped: ReadonlyArray<Clipped>;
  targets: ReadonlyArray<Target>;
  underInset: ReadonlyArray<InsetHit>;
}>;

/** One screen kind's limits. */
export type Limits = Readonly<{
  /** The most of the viewport's height (top, bottom) or width (left, right) that may stand empty beyond the room, per side. */
  emptyMax: Sides;
  /** The document may be taller than the viewport (a home screen's column scrolls; a table never). */
  mayScroll: boolean;
}>;

/**
 * The thresholds, one row per screen kind. A fraction is of the viewport's height for the top and
 * the bottom, of its width for the sides.
 */
export const LIMITS: Readonly<Record<ScreenKind, Limits>> = {
  home: {
    emptyMax: {
      // The masthead sits at the top of the column: a tenth of the height above it is air, more is a gap.
      top: 0.1,
      // The shell's column is 480px wide and centred (shell.css `#app`): sideways on the widest
      // catalogued phone (956px) each side stands (956 - 480) / 2 = 238px empty, 24.9%; a quarter
      // passes that by design and fails anything wider.
      right: 0.25,
      // The owner's allowance: a home screen may leave up to 30% empty below its last card upright.
      bottom: 0.3,
      left: 0.25,
    },
    mayScroll: true,
  },
  table: {
    // A table screen fills its room: at most 8% of the viewport empty on any side (the owner's
    // brief), the one figure for all four, since a table is symmetric in intent.
    emptyMax: { top: 0.08, right: 0.08, bottom: 0.08, left: 0.08 },
    mayScroll: false,
  },
  tool: {
    // UI Sandbox's example (a) is one box at the room's edge (FILL_SLACK 1px): 2% is the rounding
    // of a 1px slack on a 50px side, nothing more.
    emptyMax: { top: 0.02, right: 0.02, bottom: 0.02, left: 0.02 },
    mayScroll: false,
  },
};
/** Half a pixel: the rounding between two reads of one layout. */
export const TOL = 0.5;
/** A finger's target (Apple HIG, Material): the shell's `.icon-btn` and `.btn-sm` floor. */
export const TARGET_MIN = 44;
/** The air an unframed page keeps off the glass, where its theme names no `--gutter`: shell.css's `--frame-gap`. */
export const GUTTER = 4;
/** A document one pixel taller than the viewport is rounding, not a scroll. */
export const SCROLL_SLACK = 1;

/** The audit's one record: the page, the screen, the case and what was measured. */
export type Record_ = Readonly<{
  page: PageId;
  screen: Screen;
  e: Emulation;
  m: Measured;
}>;

const pct = (n: number): string => `${String(Math.round(n * 1000) / 10)}%`;
const px = (n: number): string => String(Math.round(n * 10) / 10);

/** The distance from each viewport edge to the used union's edge (0 where nothing paints). */
export const gapsOf = (inner: Measured['inner'], used: Box | null): Sides =>
  used === null
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : {
        top: used.y,
        right: inner.w - (used.x + used.w),
        bottom: inner.h - (used.y + used.h),
        left: used.x,
      };

/** The room per side: what the shell's padding or the inset takes, whichever is more; content may end there and waste nothing. */
export const roomOf = (pad: Sides, insets: Insets): Sides => ({
  top: Math.max(pad.top, insets.top),
  right: Math.max(pad.right, insets.right),
  bottom: Math.max(pad.bottom, insets.bottom),
  left: Math.max(pad.left, insets.left),
});

/** The empty screen per side in px: the gap beyond the room, never negative. */
export const emptyOf = (gaps: Sides, room: Sides): Sides => ({
  top: Math.max(0, gaps.top - room.top),
  right: Math.max(0, gaps.right - room.right),
  bottom: Math.max(0, gaps.bottom - room.bottom),
  left: Math.max(0, gaps.left - room.left),
});

/** A side's px as a fraction of the viewport's height (top, bottom) or width (left, right). */
export const fractionOf = (inner: Measured['inner'], side: Side, n: number): number =>
  n / (side === 'top' || side === 'bottom' ? inner.h : inner.w);

/** The per-side numbers the sheet prints: `t 12 (1.4%)`. */
export const sidesText = (inner: Measured['inner'], empty: Sides): string =>
  SIDES.map(
    (s) => `${s.slice(0, 1)} ${px(empty[s])} (${pct(fractionOf(inner, s, empty[s]))})`,
  ).join('  ');

/**
 * The six checks over one record. `used`: every side's empty fraction within the screen kind's
 * limit. `scroll`: never wider than the viewport; taller only where the kind may and the body is
 * not `fixed-screen`. `clip`: no nowrap overflow. `targets`: all 44px. `frame`: the attribute on
 * backgammon alone. `gutter`: on an unframed page every gap at least the gutter (the theme's
 * `--gutter`, else 4px) on a side with no inset (a side with one is the inset's rule below); on
 * every page no text box crosses an inset band.
 */
export const judge = (r: Record_): Verdict => {
  const { m, e, page, screen } = r;
  const limits = LIMITS[screen.kind];
  const gaps = gapsOf(m.inner, m.used);
  const room = roomOf(m.pad, e.insets);
  const empty = emptyOf(gaps, room);
  const over = SIDES.filter((s) => fractionOf(m.inner, s, empty[s]) > limits.emptyMax[s] + 1e-9);
  const used: Check = {
    name: 'used',
    pass: m.used !== null && over.length === 0,
    detail:
      m.used === null
        ? 'nothing painted under #app'
        : `empty ${sidesText(m.inner, empty)}${over.length === 0 ? '' : `; over the ${screen.kind} limit: ${over.join(', ')}`} (room t/r/b/l ${SIDES.map((s) => px(room[s])).join('/')})`,
  };
  const wide = m.scrollWidth > m.inner.w + SCROLL_SLACK;
  const tall = m.scrollHeight > m.inner.h + SCROLL_SLACK;
  const mayScroll = limits.mayScroll && !m.fixedScreen;
  const scroll: Check = {
    name: 'scroll',
    pass: !wide && (!tall || mayScroll),
    detail: `${String(m.scrollWidth)}x${String(m.scrollHeight)} in ${String(m.inner.w)}x${String(m.inner.h)}${
      wide ? '; scrolls sideways' : ''
    }${tall ? (mayScroll ? '; scrolls down (allowed here)' : `; scrolls down on a ${m.fixedScreen ? 'fixed-screen' : screen.kind} screen`) : ''}`,
  };
  const clip: Check = {
    name: 'clip',
    pass: m.clipped.length === 0,
    detail:
      m.clipped.length === 0
        ? 'no one-line slot clips'
        : m.clipped.map((c) => `${c.sel} by ${px(c.over)}px`).join(', '),
  };
  const small = m.targets.filter((t) => Math.min(t.w, t.h) < TARGET_MIN - TOL);
  const targets: Check = {
    name: 'targets',
    pass: small.length === 0,
    detail:
      small.length === 0
        ? `${String(m.targets.length)} targets, all ${String(TARGET_MIN)}px`
        : small.map((t) => `${t.sel} ${px(t.w)}x${px(t.h)}`).join(', '),
  };
  const wantFrame = FRAMED.includes(page);
  const frame: Check = {
    name: 'frame',
    pass: m.frame === wantFrame,
    detail: `data-frame ${m.frame ? 'present' : 'absent'}, ${wantFrame ? 'wanted' : 'not wanted'} on ${page}`,
  };
  const gutter = m.gutterToken ?? GUTTER;
  // While the document scrolls, content at the bottom edge or crossing the bottom band is below
  // the fold, not against the glass or under the home indicator (the `scroll` column owns an
  // unintended scroll): the bottom counts only where the screen ends at the viewport.
  const edges = tall ? SIDES.filter((s) => s !== 'bottom') : SIDES;
  const tight = wantFrame
    ? []
    : edges.filter((s) => e.insets[s] <= 0 && m.used !== null && gaps[s] < gutter - TOL);
  const hits = tall ? m.underInset.filter((h) => h.side !== 'bottom') : m.underInset;
  const gutterCheck: Check = {
    name: 'gutter',
    pass: tight.length === 0 && hits.length === 0,
    detail: [
      wantFrame
        ? "framed: the emulator's `clear` holds the band's clearance"
        : tight.length === 0
          ? `content ${String(gutter)}px off every edge${m.gutterToken === null ? '' : ' (the theme’s --gutter)'}`
          : `within ${String(gutter)}px of the ${tight.join(', ')} edge`,
      hits.length === 0
        ? `nothing under an inset${tall ? ' (the bottom band skipped: the document scrolls)' : ''}`
        : `under the inset: ${hits.map((h) => `${h.sel} (${h.side})`).join(', ')}`,
    ].join('; '),
  };
  const checks: ReadonlyArray<Check> = [used, scroll, clip, targets, frame, gutterCheck];
  return { pass: checks.every((c) => c.pass), checks };
};
