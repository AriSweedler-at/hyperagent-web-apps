// The cue player every game's fx.ts wraps (docs/design/shared-shell.md §5 A4): gin's legacy `fx`
// object (legacy/gin-rummy/index.html: sound + haptics, docs/MIGRATION.md step 12) moved here
// verbatim from web/games/gin-rummy/src/fx.ts, with the two things a game owns injected: its cue
// table (ui/sound.ts, event -> generic cue + buzz) and the persist of its sound preference
// (storage.ts `writeSoundState` under the game's own key). Since docs/design/sound-fonts.md §5 an
// event names a cue, not notes: `play` resolves the cue in the font the caller passes (the App's
// `soundFont`, so the reducer stays the source of truth) and hands the sound to the edge player.
// `enabled` lives in the audio cues; a buzz is skipped when disabled, as the legacy `buzz` checked
// `this.enabled`. `toggle` flips and persists the preference, warms the context and taps when
// turning on, then tells the page to repaint `#soundBtn` (`onToggle`, a paint). A game's main.ts
// constructs the real deps through its fx.ts; cuePlayer.test.ts records fakes over a table of its
// own, and each game's fx.test.ts pins its table and the wiring.
import type { SoundCue } from '../lib/sound/cues.ts';
import { fontByName, resolveSound, type SoundFontName } from '../lib/sound/fonts.ts';
import type { AudioCues } from './fx.ts';
import { playSound, type SoundDeps } from './sound.ts';

/** What one event plays: the cue the font voices, and a vibration pattern (a game's `CueSpec`). */
export type CueSpec = Readonly<{ cue: SoundCue; buzz: number | ReadonlyArray<number> }>;

/** The sound preference as every game's storage.ts spells it (`SOUND_STATES`). */
export type SoundState = 'on' | 'off';

export type CuePlayerDeps<E extends string> = Readonly<{
  audio: AudioCues;
  /** The sample seam of the shared player (nothing in the shipped fonts uses it yet). */
  sound: SoundDeps;
  vibrate: (pattern: number | ReadonlyArray<number>) => void;
  /** The game's table: every event it raises, and the tap, onto a generic cue and a buzz. */
  cues: Readonly<Record<E | 'tap', CueSpec>>;
  /** `writeSoundState(store, state)`: the preference under the game's key. */
  persist: (state: SoundState) => void;
  /** `paintSound(document, enabled)`: the sound button reflects the new state. */
  onToggle: (enabled: boolean) => void;
}>;

export type CuePlayer<E extends string> = Readonly<{
  /** An event of the table in the given font, with its buzz. */
  play: (event: E | 'tap', font: SoundFontName) => void;
  /** Flip the preference; turning on taps in the given font. */
  toggle: (font: SoundFontName) => void;
  enabled: () => boolean;
  /** `audio.warm()` on the first gesture: browsers only start audio after one. */
  warm: () => void;
}>;

export const createCuePlayer = <E extends string>(deps: CuePlayerDeps<E>): CuePlayer<E> => {
  const buzz = (pattern: number | ReadonlyArray<number>): void => {
    if (deps.audio.enabled()) deps.vibrate(pattern);
  };
  const play = (event: E | 'tap', font: SoundFontName): void => {
    const spec = deps.cues[event];
    playSound(deps.audio, resolveSound(fontByName(font), spec.cue), deps.sound);
    buzz(spec.buzz);
  };
  const toggle = (font: SoundFontName): void => {
    const enabled = !deps.audio.enabled();
    deps.audio.setEnabled(enabled);
    deps.persist(enabled ? 'on' : 'off');
    if (enabled) {
      deps.audio.warm();
      play('tap', font);
    }
    deps.onToggle(enabled);
  };
  return {
    play,
    toggle,
    enabled: () => deps.audio.enabled(),
    warm: () => {
      if (deps.audio.enabled()) deps.audio.warm();
    },
  };
};
