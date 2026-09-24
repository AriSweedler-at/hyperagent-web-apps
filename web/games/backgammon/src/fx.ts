// The game's sound and haptics (docs/design/backgammon-board.md §5.1 "Sound"; docs/design/sound-fonts.md §5, §9) over the
// shared audio, sound and vibration edges (web/shared/edge/{fx,sound}.ts), with the event table
// from ui/sound.ts and the `backgammon_sound` preference through storage.ts: gin's fx.ts under
// this game's table, so a shared shell (backgammon-board.md §5.3) can lift both at once.
// An event names a cue, not notes: `play` resolves the cue in the font the caller passes (the
// App's `soundFont`, so the reducer stays the source of truth) and hands the sound to the edge
// player. `enabled` lives in the audio cues; a buzz is skipped when disabled. `toggle` flips and
// persists the preference, warms the context and taps when turning on, then tells the page to
// repaint `#soundBtn`. main.ts constructs the real deps; fx.test.ts records fakes.
import type { AudioCues } from '../../../shared/edge/fx.ts';
import { playSound, type SoundDeps } from '../../../shared/edge/sound.ts';
import { fontByName, resolveSound } from '../../../shared/lib/sound/fonts.ts';
import { writeSoundState, type SoundFontName, type Store } from './storage.ts';
import { CUES, type Cue } from './ui/sound.ts';

export type FxDeps = Readonly<{
  audio: AudioCues;
  /** The sample seam of the shared player (nothing in the shipped fonts uses it yet). */
  sound: SoundDeps;
  vibrate: (pattern: number | ReadonlyArray<number>) => void;
  store: Store;
  /** `paintSound()`: the sound button reflects the new state. */
  onToggle: (enabled: boolean) => void;
}>;

export type Fx = Readonly<{
  /** An event of the table in the given font, with its buzz. */
  play: (event: Cue | 'tap', font: SoundFontName) => void;
  /** Flip the preference; turning on taps in the given font. */
  toggle: (font: SoundFontName) => void;
  enabled: () => boolean;
  /** `audio.warm()` on the first gesture: browsers only start audio after one. */
  warm: () => void;
}>;

export const createFx = (deps: FxDeps): Fx => {
  const buzz = (pattern: number | ReadonlyArray<number>): void => {
    if (deps.audio.enabled()) deps.vibrate(pattern);
  };
  const play = (event: Cue | 'tap', font: SoundFontName): void => {
    const spec = CUES[event];
    playSound(deps.audio, resolveSound(fontByName(font), spec.cue), deps.sound);
    buzz(spec.buzz);
  };
  const toggle = (font: SoundFontName): void => {
    const enabled = !deps.audio.enabled();
    deps.audio.setEnabled(enabled);
    writeSoundState(deps.store, enabled ? 'on' : 'off');
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
