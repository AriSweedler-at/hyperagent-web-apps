// The card packs (docs/design/card-packs.md §2): the sound-font pattern for pictures of cards. One
// vocabulary (decks.ts), many packs, a choice per game under the game's own key (`ginRummy_cardPack`,
// `briscola_cardPack`), so two games on one origin never fight over the choice. A pack is one back
// and, per deck kind it draws, how its faces are drawn: `glyph` (the renderer prints the index and
// the suit; with a `relabel`, another deck kind's index and suit, which is how `american` shows
// gin's cards at an Italian table), `files` (one picture per card, derived at the widths a card is
// painted at by tools/card-packs.ts) or `sprite` (one sheet). Gin's four backs are the first four
// packs, with gin's four names, so `body[data-card-back]`'s values, gin's selectors and every
// golden stay what they were; `linea` is the drawn Italian deck every clone has without a network.
// A pack a game cannot draw (no faces for its deck kind) cannot be chosen for that game at all
// (`packsFor`); a pack missing one picture falls back to the glyph for that card alone
// (resolve.ts). Adding a pack (§8): a file under packs/ (the tool writes it), its name in
// `CARD_PACKS`, its row in `PACKS`.
import type { DeckKind } from './decks.ts';
import { AMERICAN_PACK } from './packs/american.ts';
import { BLUE_STRIPE_PACK } from './packs/blue-stripe.ts';
import { DEFAULT_PACK } from './packs/default.ts';
import { EMPTY_PACK } from './packs/empty.ts';
import { LINEA_PACK } from './packs/linea.ts';
import { NAPOLETANE_PACK } from './packs/napoletane.ts';
import { YU_GI_OH_PACK } from './packs/yu-gi-oh.ts';

export const CARD_PACKS = [
  'default',
  'blue-stripe',
  'yu-gi-oh',
  'empty',
  'linea',
  'napoletane',
  'american',
] as const;
export type CardPackName = (typeof CARD_PACKS)[number];

/** The width, in CSS pixels, a face file is derived at for device-pixel ratio 1 (`widths` are multiples of it). */
export const FACE_WIDTH = 120;

/** How a face-down card is painted: gin's three shapes (docs/design/gin-card-backs.md) and none. */
export type Back =
  /** One file with a fixed viewBox, painted at 100% 100%. */
  | Readonly<{ kind: 'svg'; url: string; aspect: number; colour: string }>
  /** One raster per device-pixel ratio, offered through `image-set()`. */
  | Readonly<{
      kind: 'image';
      urls: ReadonlyArray<Readonly<{ ratio: number; url: string }>>;
      aspect: number;
      colour: string;
    }>
  /** A plain field of one colour (gin's `empty`). */
  | Readonly<{ kind: 'css'; colour: string }>
  /** No back of its own: the game's default pack's back is painted instead. */
  | Readonly<{ kind: 'none' }>;

/**
 * Whether the pictures print their own corner indices (`printed`) or the card box must add them
 * (`overlay`): most Italian patterns print none, and a 26 px back-row card needs one.
 */
export type FaceIndices = 'printed' | 'overlay';

/**
 * A glyph face printed in another deck kind's vocabulary (docs/design/card-packs.md §3): `american`
 * draws briscola's forty cards as gin's glyphs, coppe as hearts, the fante as J. `suits` maps every
 * suit id of the pack's deck kind onto one of `deck`'s (an unmapped suit draws the plain glyph);
 * `ranks` maps the rank ids that differ, and a rank not in the table keeps its id (A and 2 … 7 are
 * ranks of both decks). The card's id, and so `data-card`, stays the pack's deck kind's: a pack
 * changes the picture, never the identity a table looks a click up by. The mapped ids must be
 * distinct cards of `deck`; the tool's `check` says so (resolve.ts `relabelledId`).
 */
export type Relabel = Readonly<{
  deck: DeckKind;
  suits: Readonly<Record<string, string>>;
  ranks: Readonly<Record<string, string>>;
}>;

/** How the faces of one deck kind are drawn. */
export type Faces =
  | Readonly<{ kind: 'glyph'; relabel?: Relabel }>
  | Readonly<{
      kind: 'files';
      /** `../../shared/cards/<pack>/<deck>` from a game page: the tool wrote `<id>-<width>.<ext>` (or `<id>.<ext>` for SVG) into it. */
      dir: string;
      ext: 'jpg' | 'png' | 'svg';
      /** The derived widths in CSS px, `FACE_WIDTH × ratio`; `[0]` for an SVG face, which has no raster size. */
      widths: ReadonlyArray<number>;
      /** The ids pictured; a card outside the list draws the glyph. A shipped pack lists every card (the test says so). */
      ids: ReadonlyArray<string>;
      /** The picture's own aspect (a scan may keep the card's white border or not); the card box takes it. */
      aspect: number;
      /** The fraction of the card width the picture is inset by, to give a trimmed scan its margin back. */
      inset: number;
      indices: FaceIndices;
    }>
  | Readonly<{
      kind: 'sprite';
      sheets: ReadonlyArray<Readonly<{ ratio: number; url: string }>>;
      /** One cell in CSS px at ratio 1. */
      cell: Readonly<{ width: number; height: number }>;
      /** id -> the cell's column and row. */
      cells: Readonly<Record<string, Readonly<{ x: number; y: number }>>>;
      aspect: number;
      inset: number;
      indices: FaceIndices;
    }>;

export type Attribution = Readonly<{
  /** "Luigi Chiesa (Wikimedia Commons)". */
  author: string;
  sourceUrl: string;
  /** The short licence name as the source prints it: "Public domain", "CC0", "CC BY 4.0". */
  licence: string;
  licenceUrl: string | null;
  /** What the pictures are: "the Bergamo pattern, a Masenghini print". */
  note: string;
}>;

export type CardPack = Readonly<{
  name: CardPackName;
  /** What a settings panel shows. */
  label: string;
  back: Back;
  /** The deck kinds this pack draws; a game whose kind is absent may not choose it. */
  decks: Readonly<Partial<Record<DeckKind, Faces>>>;
  /** Null for a drawn pack; the test requires one for every `files`/`sprite` pack. */
  attribution: Attribution | null;
}>;

const PACKS = {
  default: DEFAULT_PACK,
  'blue-stripe': BLUE_STRIPE_PACK,
  'yu-gi-oh': YU_GI_OH_PACK,
  empty: EMPTY_PACK,
  linea: LINEA_PACK,
  napoletane: NAPOLETANE_PACK,
  american: AMERICAN_PACK,
} as const satisfies Readonly<Record<CardPackName, CardPack>>;

/** The names of the packs that draw a deck kind, read off the table's literal types. */
export type CardPackFor<K extends DeckKind> = {
  [N in CardPackName]: K extends keyof (typeof PACKS)[N]['decks'] ? N : never;
}[CardPackName];

export const packByName = (name: CardPackName): CardPack => PACKS[name];

export const isCardPack = (value: string): value is CardPackName =>
  CARD_PACKS.some((n) => n === value);

/** The packs a game with this deck kind may choose, in `CARD_PACKS` order. */
export const packsFor = <K extends DeckKind>(kind: K): ReadonlyArray<CardPackFor<K>> =>
  CARD_PACKS.filter((name): name is CardPackFor<K> => packByName(name).decks[kind] !== undefined);

export const isCardPackFor = <K extends DeckKind>(
  kind: K,
  value: string,
): value is CardPackFor<K> => packsFor(kind).some((n) => n === value);

/**
 * Each deck kind's default pack: gin's `default` back over glyph faces; the Neapolitan sheet the
 * owner supplied (docs/design/card-packs.md §7.1), `linea` staying the drawn fallback.
 */
export const DEFAULT_CARD_PACKS: Readonly<{ [K in DeckKind]: CardPackFor<K> }> = {
  french52: 'default',
  italian40: 'napoletane',
};

export const defaultPackFor = <K extends DeckKind>(kind: K): CardPackFor<K> =>
  DEFAULT_CARD_PACKS[kind];

/** The line a refused value logs under the game's own key: what was refused and what would do for its deck. */
export const badCardPackMsg = (key: string, kind: DeckKind, value: string): string =>
  `${key}: "${value}" is not a card pack for this deck; kept the current one. One of: ${packsFor(kind).join(', ')}.`;
