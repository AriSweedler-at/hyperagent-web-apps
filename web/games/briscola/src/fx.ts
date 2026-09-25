// The game's sound and haptics (docs/design/briscola.md §5.8 "Cues"; docs/design/sound-fonts.md §5,
// §9) are the shared cue player (web/shared/edge/cuePlayer.ts, docs/design/shared-shell.md §5 A4)
// over this game's table (ui/sound.ts) and its `briscola_sound` preference (storage.ts). main.ts
// constructs the real deps through bootShell; fx.test.ts pins the table and this wiring.
import {
  createCuePlayer,
  type CuePlayer,
  type CuePlayerDeps,
} from '../../../shared/edge/cuePlayer.ts';
import { writeSoundState, type Store } from './storage.ts';
import { CUES, type Cue } from './ui/sound.ts';

export type FxDeps = Omit<CuePlayerDeps<Cue>, 'cues' | 'persist'> & Readonly<{ store: Store }>;
export type Fx = CuePlayer<Cue>;

export const createFx = ({ store, ...deps }: FxDeps): Fx =>
  createCuePlayer({ ...deps, cues: CUES, persist: (state) => writeSoundState(store, state) });
