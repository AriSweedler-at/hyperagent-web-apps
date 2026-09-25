// Resolution (docs/design/card-packs.md §2.3): what to draw for one card of one pack, with the
// three silent fallbacks, card by card. A pack without the deck kind is never chosen (packs.ts
// `packsFor`), so it never reaches here; a `files`/`sprite` pack missing an id draws the glyph for
// that id alone (a pack with 38 of 40 faces is a legal pack that shows two glyph cards); a pack
// with no back of its own takes the default pack's. No console line for any of them: nothing is
// wrong, the picture is simply the drawn one. A relabelled glyph (§3: `american` draws briscola's
// cards as gin's) resolves here too, to a glyph of the other deck kind carrying this card's id, so
// the renderer's French branch prints it unchanged. The strings the renderer needs (URLs, the alt
// text, the sprite's position) are computed here so web/shared/ui/cardFace.ts only templates them.
import {
  DECKS,
  splitId,
  type DeckKind,
  type RankSpec,
  type SplitId,
  type SuitSpec,
} from './decks.ts';
import {
  FACE_WIDTH,
  type Attribution,
  type Back,
  type CardPack,
  type FaceIndices,
  type Faces,
  type Relabel,
} from './packs.ts';

/** One picture per device-pixel ratio, `srcset`-style. */
export type RatioUrl = Readonly<{ ratio: number; url: string }>;

export type FaceSpec =
  /** The renderer prints the rank's index in two corners and the suit's symbol. */
  | Readonly<{ kind: 'glyph'; deck: DeckKind; id: string; rank: RankSpec; suit: SuitSpec }>
  /** One picture, at one or more ratios; the card box takes the picture's aspect and inset. */
  | Readonly<{
      kind: 'image';
      id: string;
      /** The rank's printed index for `indices: 'overlay'` corners (decks.ts keeps it apart from the id). */
      index: string;
      /** The card's name in the deck's language, for assistive technology. */
      alt: string;
      urls: ReadonlyArray<RatioUrl>;
      aspect: number;
      inset: number;
      indices: FaceIndices;
    }>
  /** One cell of a sheet: the sheet at one or more ratios, its size in cells and this cell's place. */
  | Readonly<{
      kind: 'sprite';
      id: string;
      index: string;
      alt: string;
      sheets: ReadonlyArray<RatioUrl>;
      columns: number;
      rows: number;
      cell: Readonly<{ x: number; y: number }>;
      aspect: number;
      inset: number;
      indices: FaceIndices;
    }>;

/** A back that can be painted: `none` resolved away. */
export type PaintedBack = Exclude<Back, Readonly<{ kind: 'none' }>>;

/** What a pack with no back falls back to when the default pack has none either: never shipped, never null. */
const BARE_BACK: PaintedBack = { kind: 'css', colour: '#1e3a8a' };

const faceUrls = (
  faces: Extract<Faces, Readonly<{ kind: 'files' }>>,
  id: string,
): ReadonlyArray<RatioUrl> =>
  faces.widths.map((width) =>
    width === 0
      ? { ratio: 1, url: `${faces.dir}/${id}.${faces.ext}` }
      : { ratio: width / FACE_WIDTH, url: `${faces.dir}/${id}-${String(width)}.${faces.ext}` },
  );

type Grid = Readonly<{ columns: number; rows: number }>;

const gridOf = (cells: Readonly<Record<string, Readonly<{ x: number; y: number }>>>): Grid =>
  Object.values(cells).reduce<Grid>(
    (grid, cell) => ({
      columns: Math.max(grid.columns, cell.x + 1),
      rows: Math.max(grid.rows, cell.y + 1),
    }),
    { columns: 0, rows: 0 },
  );

/**
 * The id of `relabel.deck` this card is drawn as (`FC` → `JH`): the suit through the table, the rank
 * through it or unchanged. Null when the table has no suit for the card; the tool's `check` reports
 * that, and a mapped id that is no card of the target, and two cards on one target id.
 */
export const relabelledId = (relabel: Relabel, split: SplitId): string | null => {
  const suit = relabel.suits[split.suit.id];
  return suit === undefined ? null : (relabel.ranks[split.rank.id] ?? split.rank.id) + suit;
};

/**
 * The other deck kind's glyph for this card, keeping this card's id (docs/design/card-packs.md §3:
 * `data-card` is what a table looks a click up by, so a pack never changes it); null when the table
 * maps the card onto nothing, and resolution then draws this deck's own glyph for that card alone.
 */
const relabelledFace = (relabel: Relabel, id: string, split: SplitId): FaceSpec | null => {
  const to = relabelledId(relabel, split);
  const target = to === null ? null : splitId(relabel.deck, to);
  return target === null
    ? null
    : { kind: 'glyph', deck: relabel.deck, id, rank: target.rank, suit: target.suit };
};

/**
 * The face for one card: the pack's picture when it has one for this deck kind and id, else the
 * glyph; null when the id names no card of the deck (the wire's decoders keep that out, so a
 * painter may treat null as a bug, not a fallback).
 */
export const resolveFace = (pack: CardPack, kind: DeckKind, id: string): FaceSpec | null => {
  const split = splitId(kind, id);
  if (split === null) return null;
  const faces = pack.decks[kind];
  const glyph: FaceSpec = { kind: 'glyph', deck: kind, id, rank: split.rank, suit: split.suit };
  if (faces === undefined) return glyph;
  if (faces.kind === 'glyph')
    return faces.relabel === undefined
      ? glyph
      : (relabelledFace(faces.relabel, id, split) ?? glyph);
  const alt = DECKS[kind].name(split.rank, split.suit);
  if (faces.kind === 'files') {
    return faces.ids.includes(id)
      ? {
          kind: 'image',
          id,
          index: split.rank.index,
          alt,
          urls: faceUrls(faces, id),
          aspect: faces.aspect,
          inset: faces.inset,
          indices: faces.indices,
        }
      : glyph;
  }
  const cell = faces.cells[id];
  return cell === undefined
    ? glyph
    : {
        kind: 'sprite',
        id,
        index: split.rank.index,
        alt,
        sheets: faces.sheets,
        ...gridOf(faces.cells),
        cell,
        aspect: faces.aspect,
        inset: faces.inset,
        indices: faces.indices,
      };
};

/** The pack's back, or the fallback pack's when it has none (`kind: 'none'`). */
export const resolveBack = (pack: CardPack, fallback: CardPack): PaintedBack =>
  pack.back.kind !== 'none' ? pack.back : fallback.back.kind !== 'none' ? fallback.back : BARE_BACK;

/**
 * The card box aspect a page should use: the pictures' own when the pack draws this kind with
 * pictures; the printed deck's nominal for a relabelled glyph (`american` is gin's 100 × 144 card,
 * not the long thin Italian one); else the deck kind's nominal.
 */
export const resolveAspect = (pack: CardPack, kind: DeckKind): number => {
  const faces = pack.decks[kind];
  if (faces === undefined) return DECKS[kind].aspect;
  return faces.kind === 'glyph' ? DECKS[faces.relabel?.deck ?? kind].aspect : faces.aspect;
};

/** The About panel's line for a sourced pack ("Cards: Bergamasche — Luigi Chiesa (Wikimedia Commons), Public domain"); null for a drawn one. */
export const attributionLine = (pack: CardPack): string | null =>
  pack.attribution === null ? null : attributionText(pack.label, pack.attribution);

const attributionText = (label: string, a: Attribution): string =>
  `Cards: ${label} — ${a.author}, ${a.licence}`;
