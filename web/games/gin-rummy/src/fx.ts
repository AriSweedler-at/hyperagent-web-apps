// The legacy `fx` object (legacy/gin-rummy/index.html: sound + haptics) over the shared audio
// and vibration edges (web/shared/edge/fx.ts), with the cue tables from ui/sound.ts and the
// `ginRummy_sound` preference through storage.ts (docs/MIGRATION.md step 12). `enabled` lives in
// the audio cues; a buzz is skipped when disabled, as the legacy `buzz` checked `this.enabled`.
// `toggle` flips and persists the preference, warms the context and taps when turning on, then
// tells the page to repaint `#soundBtn` (`renderToggle`, a paint in phase 2). main.ts constructs
// the real deps; fx.test.ts records fakes.
import type { AudioCues } from '../../../shared/edge/fx.ts';
import { writeSoundState, type Store } from './storage.ts';
import type { Cue } from './ui/cues.ts';
import { CUES, TAP, type CueSpec } from './ui/sound.ts';

export type FxDeps = Readonly<{
  audio: AudioCues;
  vibrate: (pattern: number | ReadonlyArray<number>) => void;
  store: Store;
  /** `renderToggle()`: the sound button reflects the new state. */
  onToggle: (enabled: boolean) => void;
}>;

export type Fx = Readonly<{
  /** The seven named cues plus the tap, each a method as the legacy had them. */
  play: (cue: Cue | 'tap') => void;
  tap: () => void;
  yourTurn: () => void;
  knockGood: () => void;
  gin: () => void;
  bad: () => void;
  neutral: () => void;
  win: () => void;
  lose: () => void;
  toggle: () => void;
  enabled: () => boolean;
  /** `fx.ensure()` on the first gesture: browsers only start audio after one. */
  warm: () => void;
}>;

export const createFx = (deps: FxDeps): Fx => {
  const buzz = (pattern: number | ReadonlyArray<number>): void => {
    if (deps.audio.enabled()) deps.vibrate(pattern);
  };
  const sound = (spec: CueSpec): void => {
    deps.audio.seq(spec.notes, spec.type, spec.gain);
    buzz(spec.buzz);
  };
  const play = (cue: Cue | 'tap'): void => {
    sound(cue === 'tap' ? TAP : CUES[cue]);
  };
  const toggle = (): void => {
    const enabled = !deps.audio.enabled();
    deps.audio.setEnabled(enabled);
    writeSoundState(deps.store, enabled ? 'on' : 'off');
    if (enabled) {
      deps.audio.warm();
      play('tap');
    }
    deps.onToggle(enabled);
  };
  return {
    play,
    tap: () => {
      play('tap');
    },
    yourTurn: () => {
      play('yourTurn');
    },
    knockGood: () => {
      play('knockGood');
    },
    gin: () => {
      play('gin');
    },
    bad: () => {
      play('bad');
    },
    neutral: () => {
      play('neutral');
    },
    win: () => {
      play('win');
    },
    lose: () => {
      play('lose');
    },
    toggle,
    enabled: () => deps.audio.enabled(),
    warm: () => {
      if (deps.audio.enabled()) deps.audio.warm();
    },
  };
};
