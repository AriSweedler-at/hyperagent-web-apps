// A card's markup from a pack (docs/design/card-packs.md §3): strings in, strings out, no DOM, so
// both card games' ui/ may import it. The glyph renderer is gin's ui/cards.ts today, moved behind
// the pack: for a `french52` glyph it prints byte for byte what `cardHtml(card)` prints (the rank
// label, gin's suit symbol, the rank again bottom-right, `red`/`black` by suit; gin's
// ui/cards.test.ts pins the 52), so gin can adopt it without a golden moving. A relabelled glyph
// (the `american` pack: briscola's `FC` as gin's `J♥`) arrives from resolve.ts as a `french52` glyph
// spec carrying the Italian id, so the same branch prints it and only `data-card` differs from
// gin's (test/card-packs.test.ts pins the 40 against `cardHtml`). An `italian40` glyph
// prints the rank index in two corners and one suit symbol from the shared sprite (`SUIT_SPRITE_SVG`,
// inlined once at the top of a page that shows Italian cards). A `files` or `sprite` face paints the
// pack's picture as the box's background from its document-relative URL, one `url()` per
// device-pixel ratio through `image-set()` with a plain `url()` first for browsers without it. A back
// is gin's `backHtml` markup and the picture comes from the pack through `backImageCss`.
// Class names are spelled through the constants below, never as a literal class attribute, so the
// class-contract extraction (test/dist/classes.ts) does not read them into every game's list; the
// names a stylesheet must know are rows of web/shared/styles/CONTRACT.md.
import type { FaceSpec, PaintedBack, RatioUrl } from '../lib/cards/resolve.ts';
import { ITALIAN_SUIT_SYMBOLS, suitSymbolId } from '../lib/cards/suits.ts';

const CARD = 'card';
const FACE = 'face';
const GLYPH = 'glyph';
const BACK = 'back';
const RANK = 'rank';
const RANK_BR = 'rank br';
const SUIT = 'suit';

export type FaceOptions = Readonly<{
  /** Classes appended after the shape's own, space-separated (a table's `selected`, `dim`). */
  extra?: string;
  /**
   * The card's name from a language pack (docs/design/language-packs.md §3), written as the box's
   * `aria-label` (`role="img"` on a glyph; a picture's alt is replaced). Absent, the markup is byte
   * for byte what it was, which gin's 52 pins (ui/cards.test.ts) hold.
   */
  name?: string;
  /** With `name`, a `title` too (the browser's own tooltip), for a game with no tooltip of its own. */
  title?: boolean;
}>;

/** ` role="img" aria-label="…"[ title="…"]` for a named glyph; nothing without a name. */
const nameAttrs = (opts: FaceOptions): string =>
  opts.name === undefined
    ? ''
    : ` role="img" aria-label="${opts.name}"${opts.title === true ? ` title="${opts.name}"` : ''}`;

const classAttr = (own: ReadonlyArray<string>, extra: string | undefined): string =>
  [...own, extra ?? ''].filter((c) => c !== '').join(' ');

/** The `url(a) 1x, url(b) 2x` list, in the pack's ratio order. */
const imageSet = (urls: ReadonlyArray<RatioUrl>): string =>
  urls.map(({ ratio, url }) => `url(${url}) ${String(ratio)}x`).join(', ');

/** The plain picture for a browser without `image-set()`: the 2x file when there is one, else the first. */
const plainUrl = (urls: ReadonlyArray<RatioUrl>): string =>
  (urls.find((u) => u.ratio === 2) ?? urls[0])?.url ?? '';

/** Two `background-image` declarations: the plain one first, so a browser that knows `image-set()` keeps the second. */
const pictureCss = (urls: ReadonlyArray<RatioUrl>): string =>
  urls.length <= 1
    ? `background-image:url(${plainUrl(urls)})`
    : `background-image:url(${plainUrl(urls)});background-image:image-set(${imageSet(urls)})`;

/** The corner indices a picture without printed ones gets (`indices: 'overlay'`); nothing otherwise. */
const overlay = (spec: Extract<FaceSpec, Readonly<{ kind: 'image' | 'sprite' }>>): string =>
  spec.indices === 'overlay'
    ? `<span class="${RANK}">${spec.index}</span><span class="${RANK_BR}">${spec.index}</span>`
    : '';

const glyphHtml = (
  spec: Extract<FaceSpec, Readonly<{ kind: 'glyph' }>>,
  opts: FaceOptions,
): string => {
  const extra = opts.extra;
  if (spec.suit.symbol !== null) {
    // Gin's cardHtml, character for character: `card red|black [extra]`, the label, the symbol, the label.
    const classes = classAttr([CARD, spec.suit.colour], extra);
    return `<div class="${classes}" data-card="${spec.id}"${nameAttrs(opts)}><span class="${RANK}">${spec.rank.index}</span><span class="${SUIT}">${spec.suit.symbol}</span><span class="${RANK_BR}">${spec.rank.index}</span></div>`;
  }
  const classes = classAttr([CARD, FACE, GLYPH, suitSymbolId(spec.suit.id)], extra);
  return `<div class="${classes}" data-card="${spec.id}"${nameAttrs(opts)}><span class="${RANK}">${spec.rank.index}</span><svg class="${SUIT}" aria-hidden="true"><use href="#${suitSymbolId(spec.suit.id)}"/></svg><span class="${RANK_BR}">${spec.rank.index}</span></div>`;
};

const pictureHtml = (
  spec: Extract<FaceSpec, Readonly<{ kind: 'image' | 'sprite' }>>,
  style: string,
  opts: FaceOptions,
): string => {
  const classes = classAttr([CARD, FACE], opts.extra);
  const label = opts.name ?? spec.alt;
  const title = opts.title === true && opts.name !== undefined ? ` title="${label}"` : '';
  return `<div class="${classes}" data-card="${spec.id}" role="img" aria-label="${label}"${title} style="--face-inset:${String(spec.inset)};${style}">${overlay(spec)}</div>`;
};

/** `background-position` for one cell of a `columns × rows` sheet, as percentages. */
const cellPosition = (
  cell: Readonly<{ x: number; y: number }>,
  columns: number,
  rows: number,
): string => {
  const pct = (i: number, n: number): string => (n <= 1 ? '0' : String((i / (n - 1)) * 100));
  return `${pct(cell.x, columns)}% ${pct(cell.y, rows)}%`;
};

/** A face-up card: the pack's picture, or gin's glyph markup. */
export const faceHtml = (spec: FaceSpec, opts: FaceOptions = {}): string => {
  switch (spec.kind) {
    case 'glyph':
      return glyphHtml(spec, opts);
    case 'image':
      return pictureHtml(spec, pictureCss(spec.urls), opts);
    case 'sprite':
      return pictureHtml(
        spec,
        `${pictureCss(spec.sheets)};background-size:${String(spec.columns * 100)}% ${String(spec.rows * 100)}%;background-position:${cellPosition(spec.cell, spec.columns, spec.rows)}`,
        opts,
      );
  }
};

/** A face-down card, gin's `backHtml`: `cls` is `tiny` (the opponent's strip), `big` (the stock) or nothing. */
export const backHtml = (cls = ''): string => {
  const classes = `${CARD} ${BACK} ${cls}`;
  return `<div class="${classes}"></div>`;
};

/** The `background-image` value that paints a back: the picture at every ratio, or `none` for a plain field. */
export const backImageCss = (back: PaintedBack): string => {
  switch (back.kind) {
    case 'svg':
      return `url(${back.url})`;
    case 'image':
      return `image-set(${imageSet(back.urls)})`;
    case 'css':
      return 'none';
  }
};

/** The plain `background-image` for a browser without `image-set()`: the 2x file of a raster back. */
export const backFallbackImageCss = (back: PaintedBack): string =>
  back.kind === 'image' ? `url(${plainUrl(back.urls)})` : backImageCss(back);

/**
 * The four Italian suit symbols as `<symbol>`s (`#suit-C #suit-D #suit-S #suit-B`) in one hidden
 * `<svg>`: a page that shows Italian glyph cards inlines it once, and every glyph face's `<use>`
 * points into it. Zero-sized rather than `display: none`, which some browsers refuse to `<use>` from.
 */
export const SUIT_SPRITE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">${ITALIAN_SUIT_SYMBOLS.map(
  (s) =>
    `<symbol id="${suitSymbolId(s.id)}" viewBox="0 0 ${String(s.width)} ${String(s.height)}">${s.markup}</symbol>`,
).join('')}</svg>`;
