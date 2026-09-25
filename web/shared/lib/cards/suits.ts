// The four Italian suit symbols (docs/design/card-packs.md §4): a chalice, a coin, a sword and a
// knotted baton, each a few filled shapes with a thin dark outline in the print colours the
// traditional decks use (coppe red, denari gold, spade blue, bastoni green). Drawn once here as
// data so three things agree pixel for pixel: the `italian40` glyph face's one symbol (the shared
// sprite web/shared/ui/cardFace.ts inlines), the `linea` pack's pips (tools/linea.ts writes them
// into its forty faces) and a table's trump badge. The swords and batons are parallel verticals in
// a tall box, an honest simplification of the interlaced arcs of a real Neapolitan deck.
export type SuitSymbol = Readonly<{
  /** The suit id of `DECKS.italian40`. */
  id: 'C' | 'D' | 'S' | 'B';
  /** The print colour: what an index or a badge in this suit is coloured. */
  colour: string;
  /** The symbol's own coordinate box; the round symbols are square, the long ones 1:5. */
  width: number;
  height: number;
  /** The SVG shapes, in that box, with their fills and outlines spelled out. */
  markup: string;
}>;

const INK = '#2b2118';

const COPPE: SuitSymbol = {
  id: 'C',
  colour: '#c81e1e',
  width: 100,
  height: 100,
  // A bowl, a stem and a foot as one silhouette, a gold band across the bowl.
  markup:
    `<path d="M18 16H82C82 42 70 60 55 60V78C68 79 74 84 74 92H26C26 84 32 79 45 78V60C30 60 18 42 18 16Z" fill="#c81e1e" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M22 28H78" stroke="#f3d27a" stroke-width="4"/>`,
};

const DENARI: SuitSymbol = {
  id: 'D',
  colour: '#d3a12a',
  width: 100,
  height: 100,
  // A gold disc, an inner ring and an eight-point star in red.
  markup:
    `<circle cx="50" cy="50" r="45" fill="#d3a12a" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="50" cy="50" r="33" fill="none" stroke="${INK}" stroke-width="2.5"/>` +
    `<path d="M72 50L59.2 53.8 65.6 65.6 53.8 59.2 50 72 46.2 59.2 34.4 65.6 40.8 53.8 28 50 40.8 46.2 34.4 34.4 46.2 40.8 50 28 53.8 40.8 65.6 34.4 59.2 46.2Z" fill="#c8302e" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`,
};

const SPADE: SuitSymbol = {
  id: 'S',
  colour: '#1d4ed8',
  width: 20,
  height: 100,
  // A straight blade with a ridge, a gold cross-guard, a brown grip and a round pommel.
  markup:
    `<path d="M10 2L15 14V66H5V14Z" fill="#1d4ed8" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M10 16V62" stroke="#9fb7ff" stroke-width="1.2"/>` +
    `<path d="M2 66H18V72H2Z" fill="#d3a12a" stroke="${INK}" stroke-width="1.4"/>` +
    `<path d="M7 72H13V90H7Z" fill="#6b3a1e" stroke="${INK}" stroke-width="1.4"/>` +
    `<circle cx="10" cy="94" r="4.5" fill="#d3a12a" stroke="${INK}" stroke-width="1.4"/>`,
};

const BASTONI: SuitSymbol = {
  id: 'B',
  colour: '#2f7d32',
  width: 20,
  height: 100,
  // A shaft that widens toward the foot, three knots on alternate sides, a pale grain line.
  markup:
    `<path d="M7 10C7 6 13 6 13 10L14.5 90C14.5 95 5.5 95 5.5 90Z" fill="#2f7d32" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<ellipse cx="6.5" cy="30" rx="3.2" ry="4.2" fill="#2f7d32" stroke="${INK}" stroke-width="1.4"/>` +
    `<ellipse cx="14" cy="52" rx="3.2" ry="4.2" fill="#2f7d32" stroke="${INK}" stroke-width="1.4"/>` +
    `<ellipse cx="6.5" cy="74" rx="3.2" ry="4.2" fill="#2f7d32" stroke="${INK}" stroke-width="1.4"/>` +
    `<path d="M10 12V88" stroke="#7fbf7a" stroke-width="1.2"/>`,
};

/** In the deck's display order (coppe, denari, spade, bastoni). */
export const ITALIAN_SUIT_SYMBOLS: ReadonlyArray<SuitSymbol> = [COPPE, DENARI, SPADE, BASTONI];

export const suitSymbol = (id: string): SuitSymbol | null =>
  ITALIAN_SUIT_SYMBOLS.find((s) => s.id === id) ?? null;

/** The sprite id the glyph face's `<use>` points at: `suit-C`, `suit-D`, `suit-S`, `suit-B`. */
export const suitSymbolId = (id: string): string => `suit-${id}`;

/**
 * The symbol placed in someone else's drawing: translated so its box is centred on (cx, cy) and
 * scaled so its height is `height` (the width follows the box's aspect).
 */
export const placedSymbol = (
  symbol: SuitSymbol,
  cx: number,
  cy: number,
  height: number,
): string => {
  const scale = height / symbol.height;
  const x = cx - (symbol.width * scale) / 2;
  const y = cy - height / 2;
  return `<g transform="translate(${fmt(x)} ${fmt(y)}) scale(${fmt(scale)})">${symbol.markup}</g>`;
};

/** Numbers in the SVG text: at most three decimals, no trailing zeros, so the files stay small and stable. */
export const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);
