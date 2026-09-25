// The fonts (docs/design/sound-fonts.md §4): named sets of sounds, one per cue, shared by every
// game. Each game stores which one it plays under its own key (§6: `ginRummy_soundFont`,
// `backgammon_soundFont`), so two games on one origin never fight over the choice and both choose
// from the same list. The `default` font is total over the base cues; every other may be partial
// and falls back cue by cue (`resolveCue`): along the id's ladder in the font, then in its `base`
// font, then in `default`, whose base cue always answers. Adding a font (§8): a file under
// fonts/, a name in `SOUND_FONTS`, and the tests beside this module check it.
import { baseOf, ladder, type CueId, type VoiceId } from './cues.ts';
import { ARCADE_FONT } from './fonts/arcade.ts';
import { DEFAULT_FONT, DEFAULT_SOUNDS } from './fonts/default.ts';
import { FELT_FONT } from './fonts/felt.ts';
import { SILENCE, soundMs, type Sound } from './sound.ts';

export const SOUND_FONTS = ['default', 'felt', 'arcade'] as const;
export type SoundFontName = (typeof SOUND_FONTS)[number];

export type SoundFont = Readonly<{
  name: SoundFontName;
  /** What a settings panel shows. */
  label: string;
  /**
   * Partial, and the keys may be qualified (`good.trick.steal`): a cue the font does not compose
   * is looked up along its ladder, then in `base`, then in the `default` font (`resolveCue`).
   */
  sounds: Readonly<Partial<Record<CueId, Sound>>>;
  /** Announcer lines over a phrase's steps (`voice.*`, the same ladder); absent means silence. */
  voices?: Readonly<Partial<Record<VoiceId, Sound>>>;
  /**
   * A sample's length, measured by the asset tool (sound-fonts.md §4, §8): the scheduler needs it
   * before the bytes are decoded. A synth's is summed from its notes; an undeclared sample is
   * assumed `SAMPLE_MS_FALLBACK` long and the manifest test flags it.
   */
  durationsMs?: Readonly<Partial<Record<CueId | VoiceId, number>>>;
  /** "Voices: … (licence)": what a settings panel prints under a recorded font. */
  credits?: string;
  /** One more rung before `default`: a font that re-voices a few cues of another says which. */
  base?: SoundFontName;
}>;

/** What an undeclared sample is scheduled as (sound-history.md §3.3): a short sting's length. */
export const SAMPLE_MS_FALLBACK = 400;

export const DEFAULT_SOUND_FONT: SoundFontName = 'default';

export const isSoundFont = (value: string): value is SoundFontName =>
  SOUND_FONTS.some((f) => f === value);

/** The line a refused value logs, under the game's own key: what was refused and what would do. */
export const badSoundFontMsg = (key: string, value: string): string =>
  `${key}: "${value}" is not a sound font; kept the current one. One of: ${SOUND_FONTS.join(', ')}.`;

const FONTS: Readonly<Record<SoundFontName, SoundFont>> = {
  default: DEFAULT_FONT,
  felt: FELT_FONT,
  arcade: ARCADE_FONT,
};

export const fontByName = (name: SoundFontName): SoundFont => FONTS[name];

/** A resolved cue or voice: the sound, and how long the scheduler books for it. */
export type Resolved = Readonly<{ sound: Sound; ms: number }>;

/**
 * The fonts a lookup walks, nearest first: the font, its `base` if it names one, then `default`;
 * a font listed twice (the default itself, or a base of `default`) is walked once.
 */
const rungs = (font: SoundFont): ReadonlyArray<SoundFont> => {
  const base = font.base === undefined ? [] : [fontByName(font.base)];
  return [font, ...base, DEFAULT_FONT].filter(
    (f, i, all: ReadonlyArray<SoundFont>) => all.indexOf(f) === i,
  );
};

/** The declared length beside the key the sound was found under, else the sound's own, else the fallback. */
const resolvedAt = (rung: SoundFont, key: CueId | VoiceId, sound: Sound): Resolved => ({
  sound,
  ms: rung.durationsMs?.[key] ?? soundMs(sound) ?? SAMPLE_MS_FALLBACK,
});

/** The first hit along `keys` in one rung's table, or none. */
const hitIn = <K extends CueId | VoiceId>(
  rung: SoundFont,
  table: Readonly<Partial<Record<K, Sound>>> | undefined,
  keys: ReadonlyArray<K>,
): Resolved | undefined =>
  keys
    .map((key) => {
      const sound = table?.[key];
      return sound === undefined ? undefined : resolvedAt(rung, key, sound);
    })
    .find((hit) => hit !== undefined);

/**
 * The font's sound for the cue: the first hit along the cue's ladder in the font, then in its
 * base, then in `default`. Total: the default font voices every base cue (fonts.test.ts pins it),
 * so the walk ends there at the latest; the last rung is spelled as a direct read of that table.
 */
export const resolveCue = (font: SoundFont, id: CueId): Resolved => {
  const keys = ladder(id);
  const fromFonts = rungs(font)
    .filter((rung) => rung !== DEFAULT_FONT)
    .map((rung) => hitIn(rung, rung.sounds, keys))
    .find((hit) => hit !== undefined);
  // `default` has base cues only (its `sounds` is `DEFAULT_SOUNDS`, typed total over them), so
  // its rung is the base key read directly, no walk.
  const base = baseOf(id);
  return fromFonts ?? resolvedAt(DEFAULT_FONT, base, DEFAULT_SOUNDS[base]);
};

/** The font's sound for the cue (the walk of `resolveCue`); every caller before the phrases reads this. */
export const resolveSound = (font: SoundFont, id: CueId): Sound => resolveCue(font, id).sound;

/** An announcer line along its ladder through the same rungs; silence when no font voices it. */
export const resolveVoice = (font: SoundFont, id: VoiceId): Resolved =>
  rungs(font)
    .map((rung) => hitIn(rung, rung.voices, ladder(id)))
    .find((hit) => hit !== undefined) ?? { sound: SILENCE, ms: 0 };
