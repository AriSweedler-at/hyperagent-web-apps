// The language packs (docs/design/language-packs.md): the sound-font and card-pack pattern applied
// to what a card is called. One vocabulary of cards (../cards/decks.ts), many packs, a choice per
// game under the game's own key (`briscola_lang`), so two games on one origin never fight over it.
// A pack carries, per deck kind it speaks, a word per suit id, a word per rank id and the word that
// joins them: `it` says "re di denari" and "asso di picche", `en` says "king of coins" and "ace of
// spades", `en-plates` is `en` with the owner's word for denari. A pack that lacks a deck kind, or
// a word, falls back card by card to the deck's own language (`DECKS[kind].name`, what the `alt`
// text has always said), silently, as a card pack missing one picture draws the glyph
// (../cards/resolve.ts). Adding a pack (§4): a file under packs/, its name in `LANGUAGE_PACKS`,
// its row in `PACKS`; the tests beside this module check it names every card of every deck kind.
import { DECKS, splitId, type DeckKind } from '../cards/decks.ts';
import { EN_PACK } from './packs/en.ts';
import { EN_PLATES_PACK } from './packs/en-plates.ts';
import { IT_PACK } from './packs/it.ts';

export const LANGUAGE_PACKS = ['it', 'en', 'en-plates'] as const;
export type LanguagePackName = (typeof LANGUAGE_PACKS)[number];

/** How one deck kind's cards are named: a word per suit id, a word per rank id, and the word between them. */
export type DeckWords = Readonly<{
  suits: Readonly<Record<string, string>>;
  ranks: Readonly<Record<string, string>>;
  /** "di", "of": `${rank} ${join} ${suit}`. */
  join: string;
}>;

export type LanguagePack = Readonly<{
  name: LanguagePackName;
  /** What a settings panel shows. */
  label: string;
  /** The deck kinds this pack speaks; a kind absent falls back to the deck's own language. */
  decks: Readonly<Partial<Record<DeckKind, DeckWords>>>;
  /** A word about the pack's choices ("coins, not plates"), for a settings panel or a reader. */
  notes?: string;
}>;

const PACKS: Readonly<Record<LanguagePackName, LanguagePack>> = {
  it: IT_PACK,
  en: EN_PACK,
  'en-plates': EN_PLATES_PACK,
};

export const langByName = (name: LanguagePackName): LanguagePack => PACKS[name];

export const isLanguagePack = (value: string): value is LanguagePackName =>
  LANGUAGE_PACKS.some((n) => n === value);

/** The pack `value` names, else the fallback's: a stored or typed name resolved without a console line. */
export const resolveLang = (
  value: string | null | undefined,
  fallback: LanguagePackName,
): LanguagePack =>
  langByName(value !== undefined && value !== null && isLanguagePack(value) ? value : fallback);

/** The line a refused value logs under the game's own key: what was refused and what would do. */
export const badLanguageMsg = (key: string, value: string): string =>
  `${key}: "${value}" is not a language pack; kept the current one. One of: ${LANGUAGE_PACKS.join(', ')}.`;

/**
 * The card's name in the pack's language ("re di denari", "king of coins", "ace of spades"), the
 * deck's own where the pack has no word for the kind, the rank or the suit; null for an id that
 * names no card of the deck.
 */
export const cardName = (pack: LanguagePack, kind: DeckKind, id: string): string | null => {
  const split = splitId(kind, id);
  if (split === null) return null;
  const words = pack.decks[kind];
  const rank = words?.ranks[split.rank.id];
  const suit = words?.suits[split.suit.id];
  return words === undefined || rank === undefined || suit === undefined
    ? DECKS[kind].name(split.rank, split.suit)
    : `${rank} ${words.join} ${suit}`;
};
