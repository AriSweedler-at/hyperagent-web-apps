// The fonts (docs/design/sound-fonts.md §4): named sets of sounds, one per cue, shared by every
// game. Each game stores which one it plays under its own key (§6: `ginRummy_soundFont`,
// `backgammon_soundFont`), so two games on one origin never fight over the choice and both choose
// from the same list. The `default` font is total; every other may be partial and falls back to
// it cue by cue (`resolveSound`). Adding a font (§8): a file under fonts/, a name in `SOUND_FONTS`,
// and the tests beside this module check it.
import type { SoundCue } from './cues.ts';
import { ARCADE_FONT } from './fonts/arcade.ts';
import { DEFAULT_FONT, DEFAULT_SOUNDS } from './fonts/default.ts';
import { FELT_FONT } from './fonts/felt.ts';
import type { Sound } from './sound.ts';

export const SOUND_FONTS = ['default', 'felt', 'arcade'] as const;
export type SoundFontName = (typeof SOUND_FONTS)[number];

export type SoundFont = Readonly<{
  name: SoundFontName;
  /** What a settings panel shows. */
  label: string;
  /** Partial: a cue a font does not compose falls back to the `default` font's sound. */
  sounds: Readonly<Partial<Record<SoundCue, Sound>>>;
}>;

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

/** The font's sound for the cue, else the default font's: the default is total, so never undefined. */
export const resolveSound = (font: SoundFont, cue: SoundCue): Sound =>
  font.sounds[cue] ?? DEFAULT_SOUNDS[cue];
