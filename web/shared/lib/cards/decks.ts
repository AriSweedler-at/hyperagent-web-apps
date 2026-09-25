// The deck kinds (docs/design/card-packs.md §1): the vocabulary of cards a pack draws pictures
// for, one per family of games. `french52` is gin's deck, spelled from gin's engine literals
// (engine/cards.ts `SUITS`, `RANK_LABEL`) and pinned equal to `makeDeck().map((c) => c.id)` in
// gin's order by test/card-packs.test.ts, so the shared vocabulary and gin's engine never drift;
// gin's engine keeps its own `Card` type and never imports this module. `italian40` is briscola's
// (and later scopa's and tressette's), with the ids the briscola design fixes (D10: `id = LABEL[r] +
// s`, ranks A 2 … 7 F C R, suits C D S B) so a pack's picture, the engine's card and the wire agree
// on which file is the ace of coins. Points and strength are never here: they are each game's.
export const DECK_KINDS = ['french52', 'italian40'] as const;
export type DeckKind = (typeof DECK_KINDS)[number];

export type SuitSpec = Readonly<{
  /** The one letter every id ends with. */
  id: string;
  /** How the pack's language names it: "coppe", "spades"; the `alt` text and the About line use it. */
  label: string;
  /** The English name, for a settings panel or a rule: "cups", "spades". */
  english: string;
  /** The glyph renderer's class for the two-colour French deck; `none` for the four-colour Italian one. */
  colour: 'red' | 'black' | 'none';
  /** A text symbol the glyph renderer prints (gin's `SUIT_SYMBOL`), or null when the suit is drawn from the shared sprite. */
  symbol: string | null;
}>;

export type RankSpec = Readonly<{
  /** What the id starts with: `A`, `10`, `K`, `F`. */
  id: string;
  /** What the corners print (the glyph, and a picture's overlay): the same letters today, kept apart so a pack may print `8` for the fante. */
  index: string;
  /** The rank's name in the deck's language: "asso", "ace". */
  label: string;
  english: string;
}>;

export type DeckSpec = Readonly<{
  kind: DeckKind;
  /** Display order, and the suit-major order of `cardIds`. */
  suits: ReadonlyArray<SuitSpec>;
  /** Low to high by index, never by a game's strength. */
  ranks: ReadonlyArray<RankSpec>;
  /** The nominal card aspect (width / height) a glyph-only pack draws at. */
  aspect: number;
  /** A face-down card's border as a fraction of its width (gin's theme: 0.062). */
  border: number;
  /** The corner radius as a fraction of the width: Italian cards have tighter corners. */
  radius: number;
  /** How a card is named in the deck's language: "sette di spade", "seven of spades". */
  name: (rank: RankSpec, suit: SuitSpec) => string;
}>;

const french = (id: string, index: string, label: string): RankSpec => ({
  id,
  index,
  label,
  english: label,
});
const italian = (id: string, label: string, english: string): RankSpec => ({
  id,
  index: id,
  label,
  english,
});

const FRENCH52: DeckSpec = {
  kind: 'french52',
  // Gin's SUITS order and its SUIT_SYMBOL glyphs.
  suits: [
    { id: 'S', label: 'spades', english: 'spades', colour: 'black', symbol: '♠' },
    { id: 'H', label: 'hearts', english: 'hearts', colour: 'red', symbol: '♥' },
    { id: 'D', label: 'diamonds', english: 'diamonds', colour: 'red', symbol: '♦' },
    { id: 'C', label: 'clubs', english: 'clubs', colour: 'black', symbol: '♣' },
  ],
  ranks: [
    french('A', 'A', 'ace'),
    french('2', '2', 'two'),
    french('3', '3', 'three'),
    french('4', '4', 'four'),
    french('5', '5', 'five'),
    french('6', '6', 'six'),
    french('7', '7', 'seven'),
    french('8', '8', 'eight'),
    french('9', '9', 'nine'),
    french('10', '10', 'ten'),
    french('J', 'J', 'jack'),
    french('Q', 'Q', 'queen'),
    french('K', 'K', 'king'),
  ],
  // Gin's backs are 100 × 144 (docs/design/gin-card-backs.md §1) and its theme sets the border.
  aspect: 100 / 144,
  border: 0.062,
  radius: 0.16,
  name: (rank, suit) => `${rank.label} of ${suit.label}`,
};

const ITALIAN40: DeckSpec = {
  kind: 'italian40',
  // The briscola design's suit order (D10): coppe, denari, spade, bastoni.
  suits: [
    { id: 'C', label: 'coppe', english: 'cups', colour: 'none', symbol: null },
    { id: 'D', label: 'denari', english: 'coins', colour: 'none', symbol: null },
    { id: 'S', label: 'spade', english: 'swords', colour: 'none', symbol: null },
    { id: 'B', label: 'bastoni', english: 'batons', colour: 'none', symbol: null },
  ],
  ranks: [
    italian('A', 'asso', 'ace'),
    italian('2', 'due', 'two'),
    italian('3', 'tre', 'three'),
    italian('4', 'quattro', 'four'),
    italian('5', 'cinque', 'five'),
    italian('6', 'sei', 'six'),
    italian('7', 'sette', 'seven'),
    italian('F', 'fante', 'knave'),
    italian('C', 'cavallo', 'knight'),
    italian('R', 're', 'king'),
  ],
  // The long thin card the owner asked for: the Bergamo cut (0.518), which `linea` draws at.
  aspect: 0.518,
  border: 0.05,
  radius: 0.08,
  name: (rank, suit) => `${rank.label} di ${suit.label}`,
};

export const DECKS: Readonly<Record<DeckKind, DeckSpec>> = {
  french52: FRENCH52,
  italian40: ITALIAN40,
};

export const isDeckKind = (value: string): value is DeckKind => DECK_KINDS.some((k) => k === value);

/** Every id of the deck, suit-major in display order: the order gin's `makeDeck` builds its 52. */
export const cardIds = (kind: DeckKind): ReadonlyArray<string> =>
  DECKS[kind].suits.flatMap((suit) => DECKS[kind].ranks.map((rank) => rank.id + suit.id));

export type SplitId = Readonly<{ rank: RankSpec; suit: SuitSpec }>;

/** The rank and suit of an id, or null when it names no card of the deck (`10H` splits at the last letter). */
export const splitId = (kind: DeckKind, id: string): SplitId | null => {
  const suit = DECKS[kind].suits.find((s) => s.id === id.slice(-1));
  const rank = DECKS[kind].ranks.find((r) => r.id === id.slice(0, -1));
  return suit === undefined || rank === undefined ? null : { rank, suit };
};

export const isCardId = (kind: DeckKind, id: string): boolean => splitId(kind, id) !== null;

/** The card's name in the deck's language ("sette di spade"), or null for a stranger: the `alt` text. */
export const cardName = (kind: DeckKind, id: string): string | null => {
  const split = splitId(kind, id);
  return split === null ? null : DECKS[kind].name(split.rank, split.suit);
};
