// The cue vocabulary every game speaks (docs/design/sound-fonts.md §2): what happened, in words
// no game owns. A game keeps its own event names and maps each onto one of these in a single
// table (gin: src/ui/sound.ts); a font (fonts.ts) composes one sound per cue, so a new font
// re-voices every game at once and a game never names a sound. Adding a cue is a shared change:
// the `default` font must gain a sound for it (fonts.test.ts pins that it is total). Pure: a cue
// is a name.
export const SOUND_CUES = [
  /** A touch acknowledged: a card or checker selected, a menu opened, a toggle flipped. */
  'tap',
  /** A piece or card placed on the table. */
  'move',
  /** Something taken up from the table, face up: the discard pile, a checker lifted. */
  'pickup',
  /** Something taken from a face-down source: the stock, a shuffled deck. */
  'draw',
  /** Dice thrown. */
  'roll',
  /** A piece taken or sent back: a blot hit to the bar. */
  'capture',
  /** Points banked or a piece borne off. */
  'score',
  /** A move taken back. */
  'undo',
  /** A game or a round begins: the deal, the opening roll. */
  'start',
  /** It is this player's turn now. */
  'turn',
  /** A favourable notice: a knock that scored, the cube taken. */
  'good',
  /** A triumphant notice, bigger than `good`: gin, a gammon. */
  'great',
  /** An unfavourable notice: a refused action, a bad outcome, being hit. */
  'bad',
  /** A plain notice with no valence: a void hand, a pass. */
  'neutral',
  /** A stake raised: the doubling cube offered. */
  'challenge',
  /** The game or match won. */
  'victory',
  /** The game or match lost. */
  'loss',
  /** A peer connected or reconnected. */
  'connection',
  /** The connection was lost. */
  'disconnect',
  /** The invite was shared or a code accepted. */
  'invite',
] as const;
export type SoundCue = (typeof SOUND_CUES)[number];
