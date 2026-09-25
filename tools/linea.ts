// The `linea` pack (docs/design/card-packs.md §5): the drawn Italian deck every clone has with no
// network, in the stories and the fake page, and the glyph's pips under a partial sourced pack.
// Node only, no browser: string templates over the four suit symbols (web/shared/lib/cards/suits.ts)
// and a rank -> layout table write forty SVG faces, one back and the pack's manifest. Deterministic:
// tools/linea.test.ts regenerates the forty-two strings and compares them to the committed files,
// so a changed path or table is caught until this is re-run:
//   node --experimental-strip-types tools/linea.ts
// Its name is its promise (lines): plain on purpose. The owner has said hand drawings are often not
// good enough, so it is the fallback the table always has, not the deck the owner is expected to keep.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DECKS, cardIds, splitId, type RankSpec } from '../web/shared/lib/cards/decks.ts';
import {
  ITALIAN_SUIT_SYMBOLS,
  fmt,
  placedSymbol,
  suitSymbol,
  type SuitSymbol,
} from '../web/shared/lib/cards/suits.ts';

/** The one `<defs>` entry a face carries: its suit symbol, which every pip and index `<use>`s. */
const SYMBOL_ID = 's';
const defineSymbol = (s: SuitSymbol): string => `<defs><g id="${SYMBOL_ID}">${s.markup}</g></defs>`;
/** The face's symbol placed like suits.ts `placedSymbol`, but by reference to the one definition. */
const useSymbol = (s: SuitSymbol, cx: number, cy: number, height: number): string => {
  const scale = height / s.height;
  const x = cx - (s.width * scale) / 2;
  const y = cy - height / 2;
  return `<use href="#${SYMBOL_ID}" transform="translate(${fmt(x)} ${fmt(y)}) scale(${fmt(scale)})"/>`;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_NAME = 'linea';
export const SERVED_DIR = `../../shared/cards/${PACK_NAME}`;
export const PUBLIC_DIR = `web/public/shared/cards/${PACK_NAME}`;
export const MANIFEST_PATH = `web/shared/lib/cards/packs/${PACK_NAME}.ts`;

/** The card box: 100 wide, 193 tall, the Bergamo cut (aspect 0.518) the briscola design lays out for. */
const W = 100;
const H = 193;
const CX = W / 2;
const CY = H / 2;
const INK = '#2b2118';
const FIELD = '#fdfdf7';
const FRAME = '#c9b98a';
const ACCENT = '#b8582f';
const GROUND = '#f4eddc';
const FONT = "Georgia, 'Times New Roman', serif";

const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(W)} ${String(H)}">`;
const field = `<rect x="0.5" y="0.5" width="${String(W - 1)}" height="${String(H - 1)}" rx="8" fill="${FIELD}" stroke="#d8ccb0"/>`;
const frame = `<rect x="5" y="5" width="${String(W - 10)}" height="${String(H - 10)}" rx="5" fill="none" stroke="${FRAME}"/>`;

const isLong = (s: SuitSymbol): boolean => s.height > s.width;

/** The rank index top-left with a small suit under it, and the same pair turned upside down bottom-right. */
const indices = (rank: RankSpec, s: SuitSymbol): string => {
  const corner =
    `<text x="8" y="20" font-family="${FONT}" font-size="14" font-weight="700" fill="${s.colour}">${rank.index}</text>` +
    (isLong(s) ? useSymbol(s, 14, 36, 20) : useSymbol(s, 14, 31, 11));
  return `${corner}<g transform="rotate(180 ${fmt(CX)} ${fmt(CY)})">${corner}</g>`;
};

type Point = readonly [number, number];
const row = (y: number, xs: ReadonlyArray<number>): ReadonlyArray<Point> => xs.map((x) => [x, y]);

/** Coins and cups: the classic pip grid on two columns, the odd pip on the axis. */
const ROUND_LAYOUT: Readonly<Record<string, ReadonlyArray<Point>>> = {
  '2': [
    [CX, 62],
    [CX, 132],
  ],
  '3': [
    [CX, 52],
    [CX, CY],
    [CX, 142],
  ],
  '4': [...row(62, [31, 69]), ...row(132, [31, 69])],
  '5': [...row(62, [31, 69]), [CX, CY], ...row(132, [31, 69])],
  '6': [...row(55, [31, 69]), ...row(CY, [31, 69]), ...row(139, [31, 69])],
  '7': [...row(55, [31, 69]), [CX, 76], ...row(CY, [31, 69]), ...row(139, [31, 69])],
};
const ROUND_PIP = 20;

/** Swords and batons: parallel verticals; up to three stand full height, four and more take two rows. */
const LONG_LAYOUT: Readonly<
  Record<string, Readonly<{ height: number; at: ReadonlyArray<Point> }>>
> = {
  '2': { height: 110, at: row(CY, [37, 63]) },
  '3': { height: 110, at: row(CY, [30, 50, 70]) },
  '4': { height: 62, at: [...row(62, [36, 64]), ...row(132, [36, 64])] },
  '5': { height: 62, at: [...row(62, [30, 50, 70]), ...row(132, [40, 60])] },
  '6': { height: 62, at: [...row(62, [30, 50, 70]), ...row(132, [30, 50, 70])] },
  '7': { height: 62, at: [...row(62, [26, 42, 58, 74]), ...row(132, [34, 50, 66])] },
};

const pips = (rank: RankSpec, s: SuitSymbol): string => {
  if (rank.id === 'A') {
    // The one flourish: the ace of coins wears a green laurel ring, as the traditional aces do.
    const ring =
      s.id === 'D'
        ? `<circle cx="${fmt(CX)}" cy="${fmt(CY)}" r="32" fill="none" stroke="#2f7d32" stroke-width="2" stroke-dasharray="3 2.5"/>`
        : '';
    return ring + useSymbol(s, CX, CY, isLong(s) ? 130 : 46);
  }
  if (isLong(s)) {
    const layout = LONG_LAYOUT[rank.id];
    return layout === undefined
      ? ''
      : layout.at.map(([x, y]) => useSymbol(s, x, y, layout.height)).join('');
  }
  return (ROUND_LAYOUT[rank.id] ?? []).map(([x, y]) => useSymbol(s, x, y, ROUND_PIP)).join('');
};

const shape = (d: string, fill: string): string =>
  `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`;
const disc = (cx: number, cy: number, r: number, fill: string): string =>
  `<circle cx="${String(cx)}" cy="${String(cy)}" r="${String(r)}" fill="${fill}" stroke="${INK}" stroke-width="1.5"/>`;

/** The courts: silhouettes in the suit colour on a pale ground, each holding its suit symbol. */
const court = (rank: RankSpec, s: SuitSymbol): string => {
  const ground = `<rect x="12" y="30" width="76" height="140" rx="3" fill="${GROUND}" stroke="#e2d7bd"/>`;
  const letter = `<text x="${fmt(CX)}" y="128" text-anchor="middle" font-family="${FONT}" font-size="88" font-weight="700" fill="${s.colour}" opacity="0.14">${rank.index}</text>`;
  const c = s.colour;
  const figure =
    rank.id === 'F'
      ? // A standing figure, the right arm raised to hold the symbol.
        disc(50, 58, 9, c) +
        shape('M38 70H62L67 114H33Z', c) +
        shape('M38 114H47V158H38Z', c) +
        shape('M53 114H62V158H53Z', c) +
        shape('M34 158H49V163H34Z', c) +
        shape('M51 158H66V163H51Z', c) +
        shape('M62 74L74 96L70 99L58 80Z', c) +
        (isLong(s) ? useSymbol(s, 77, 92, 44) : useSymbol(s, 77, 100, 16))
      : rank.id === 'C'
        ? // A horse and rider, the symbol carried on the near side.
          shape('M26 132H32V160H26Z', c) +
          shape('M36 133H42V160H36Z', c) +
          shape('M56 133H62V160H56Z', c) +
          shape('M66 132H72V160H66Z', c) +
          `<ellipse cx="48" cy="120" rx="30" ry="15" fill="${c}" stroke="${INK}" stroke-width="1.5"/>` +
          shape('M70 112L78 94L84 98L78 108L76 122Z', c) +
          disc(80, 93, 6, c) +
          shape('M42 84H56L58 110H40Z', c) +
          disc(49, 74, 7, c) +
          (isLong(s) ? useSymbol(s, 28, 96, 40) : useSymbol(s, 28, 92, 16))
        : // A crowned, seated king, the symbol held at his side.
          shape('M32 100H68L78 165H22Z', c) +
          shape('M28 104H72V110H28Z', c) +
          disc(50, 80, 10, c) +
          shape('M38 68L42 56L47 65L50 53L53 65L58 56L62 68Z', '#d3a12a') +
          (isLong(s) ? useSymbol(s, 76, 118, 46) : useSymbol(s, 74, 118, 18));
  return ground + letter + figure;
};

const isCourt = (rank: RankSpec): boolean => ['F', 'C', 'R'].includes(rank.id);

/** One face: the field and frame, the corner indices, then the pips or the court. */
export const faceSvg = (id: string): string => {
  const split = splitId('italian40', id);
  const symbol = split === null ? null : suitSymbol(split.suit.id);
  if (split === null || symbol === null) return '';
  const art = isCourt(split.rank) ? court(split.rank, symbol) : pips(split.rank, symbol);
  return `${svgOpen}${defineSymbol(symbol)}${field}${frame}${indices(split.rank, symbol)}${art}</svg>\n`;
};

/** The back: a fine 45° lattice in briscola's terracotta with a medallion of the four suits. */
export const backSvg = (): string => {
  const [coppe, denari, spade, bastoni] = ITALIAN_SUIT_SYMBOLS;
  const medallion =
    coppe === undefined || denari === undefined || spade === undefined || bastoni === undefined
      ? ''
      : placedSymbol(coppe, 39, 85, 16) +
        placedSymbol(denari, 61, 85, 16) +
        placedSymbol(spade, 39, 109, 22) +
        placedSymbol(bastoni, 61, 109, 22);
  return (
    `${svgOpen}<defs><pattern id="l" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<path d="M0 4H8M4 0V8" stroke="${ACCENT}" stroke-width="0.8"/></pattern></defs>` +
    `<rect x="0.5" y="0.5" width="${String(W - 1)}" height="${String(H - 1)}" rx="8" fill="#faf5e8" stroke="${ACCENT}"/>` +
    `<rect x="6" y="6" width="${String(W - 12)}" height="${String(H - 12)}" rx="5" fill="url(#l)" stroke="${ACCENT}" stroke-width="1.5"/>` +
    `<circle cx="${fmt(CX)}" cy="${fmt(CY)}" r="26" fill="#faf5e8" stroke="${ACCENT}" stroke-width="1.5"/>` +
    `${medallion}</svg>\n`
  );
};

export const FACE_IDS: ReadonlyArray<string> = cardIds('italian40');

/** The pack's data file, spelled the way packs.ts reads its siblings; not run through Prettier (.prettierignore). */
export const manifestSource = (): string => {
  const ids = FACE_IDS.map((id) => `'${id}'`).join(', ');
  return [
    '// Generated by tools/linea.ts; do not edit: change the tool and re-run it (tools/linea.test.ts',
    '// compares the committed files to what the tool would write). The drawn Italian deck',
    '// (docs/design/card-packs.md §5): forty SVG faces and a back under web/public/shared/cards/linea/.',
    "import type { CardPack } from '../packs.ts';",
    '',
    'export const LINEA_PACK = {',
    `  name: '${PACK_NAME}',`,
    "  label: 'Linea',",
    `  back: { kind: 'svg', url: '${SERVED_DIR}/back.svg', aspect: ${String(W)} / ${String(H)}, colour: '#faf5e8' },`,
    '  decks: {',
    '    italian40: {',
    "      kind: 'files',",
    `      dir: '${SERVED_DIR}/italian40',`,
    "      ext: 'svg',",
    '      widths: [0],',
    `      ids: [${ids}],`,
    `      aspect: ${String(W)} / ${String(H)},`,
    '      inset: 0,',
    "      indices: 'printed',",
    '    },',
    '  },',
    '  attribution: null,',
    '} as const satisfies CardPack;',
    '',
  ].join('\n');
};

export type Written = Readonly<{ path: string; text: string }>;

/** Every file the tool writes, repo-relative, in a fixed order. */
export const outputs = (): ReadonlyArray<Written> => [
  ...FACE_IDS.map((id) => ({ path: `${PUBLIC_DIR}/italian40/${id}.svg`, text: faceSvg(id) })),
  { path: `${PUBLIC_DIR}/back.svg`, text: backSvg() },
  { path: MANIFEST_PATH, text: manifestSource() },
];

const main = (): void => {
  const files = outputs();
  files.forEach(({ path, text }) => {
    const full = resolve(ROOT, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  });
  const bytes = files.reduce((n, f) => n + Buffer.byteLength(f.text), 0);
  console.log(
    `wrote ${String(files.length)} files (${String(bytes)} bytes) for ${PACK_NAME}: ${String(FACE_IDS.length)} faces of ${DECKS.italian40.kind}, the back and ${MANIFEST_PATH}`,
  );
};

const runDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) main();
