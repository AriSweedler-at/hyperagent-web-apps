// The cue vocabulary every game speaks (docs/design/sound-fonts.md §2): what happened, in words
// no game owns. A game keeps its own event names and maps each onto one of these in a single
// table (gin: src/ui/sound.ts) whose rows are `CueSpec`s and whose first four rows are the shell's
// (`SHELL_CUES`, below); a font (fonts.ts) composes one sound per cue, so a new font re-voices
// every game at once and a game never names a sound. Adding a cue is a shared change: the
// `default` font must gain a sound for it (fonts.test.ts pins that it is total). Pure: a cue is a
// name.
import { string, type Decoder } from '../json.ts';
import { err, ok } from '../result.ts';

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

// ---- qualified cues (docs/design/sound-fonts.md §2.1; briscola-sound-history.md §3.1) ----------
// A game may say more than the base: `good.trick.steal` is still a `good`, told apart from the
// plain one by the segments after the dot, which are the GAME's words (briscola says `trick`,
// `steal`; gin may say `knock`). Nothing shared interprets them: a font voices any prefix it likes
// and `resolveSound` (fonts.ts) walks the `ladder` up to the base, so a font that voices only the
// twenty base cues covers every qualified cue a game ever spells, and the vocabulary above never
// grows a game noun. Voices (`voice.*`) are the announcer namespace over the same ladder; the
// default font leaves it silent.

/** A base cue, or one qualified by the game's own dotted words: `good`, `good.trick`, `good.trick.steal`. */
export type CueId = SoundCue | `${SoundCue}.${string}`;
/** An announcer line laid over a phrase's steps; a font voices any prefix of it or none. */
export type VoiceId = 'voice' | `voice.${string}`;
/** A vibration pattern: one duration, or the on/off alternation `navigator.vibrate` takes. */
export type Buzz = number | ReadonlyArray<number>;

/**
 * What one event plays: the cue the font voices, and a vibration pattern. Since the phrases
 * (phrase.ts) a row is also the one-step phrase `spec(cue, buzz)`, so a table of rows is a table of
 * phrases with no edit; `cue` may be qualified.
 */
export type CueSpec = Readonly<{ cue: CueId; buzz: Buzz }>;

/** The base cue a qualified id is a kind of: `good.trick.steal` is a `good`. */
export const baseOf = (id: CueId): SoundCue =>
  // The base is the text before the first dot; the type says it is one of the twenty, and
  // `decodeCueId` is where an unknown string is refused before it becomes a `CueId`.
  id.replace(/\..*$/, '') as SoundCue;

/**
 * Every prefix of an id, most specific first: `good.trick.steal` -> `good.trick.steal`,
 * `good.trick`, `good`. A font is looked up along it; the last rung is the base.
 */
export const ladder = <Id extends string>(id: Id): ReadonlyArray<Id> => {
  const parts = id.split('.');
  // A prefix of a dotted `Id` is the same template type by construction; TS cannot see that
  // through `join`, hence the assertion.
  return parts.map((_, i) => parts.slice(0, parts.length - i).join('.') as Id);
};

export const isSoundCue = (value: string): value is SoundCue => SOUND_CUES.some((c) => c === value);

/** `[a-z]+(\.[a-z0-9-]+)*`: the file-name-safe spelling the asset tool (§7) reads back as an id. */
const CUE_ID_RE = /^[a-z]+(\.[a-z0-9-]+)*$/;
const CUE_ID_EXPECTED = 'a cue id: a base cue, then dotted segments of [a-z0-9-]';

export const isCueId = (value: string): value is CueId =>
  CUE_ID_RE.test(value) && isSoundCue(value.replace(/\..*$/, ''));

/** A stored or wire string as a cue id: refused unless it is well formed AND its base is a known cue. */
export const decodeCueId: Decoder<CueId> = (input) => {
  const text = string(input);
  if (!text.ok) return text;
  return isCueId(text.value) ? ok(text.value) : err({ path: [], expected: CUE_ID_EXPECTED });
};

// The four rows every game's table carries (docs/design/shared-shell.md §5 `cues`: the shell taps
// on a touch, chimes the turn, plays the win and the loss), spelt once so a table spreads them
// (`...SHELL_CUES`) and writes only its own events (docs/design/dry-round-2.md E9). They were the
// two tables' byte for byte, and each game's fx.test.ts still pins them against its frozen copy.
export const SHELL_CUES: Readonly<Record<'tap' | 'yourTurn' | 'win' | 'lose', CueSpec>> = {
  tap: { cue: 'tap', buzz: 12 },
  yourTurn: { cue: 'turn', buzz: [40, 60, 40] },
  win: { cue: 'victory', buzz: [80, 50, 80, 50, 200] },
  lose: { cue: 'loss', buzz: [200] },
};
