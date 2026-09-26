// The game's sound and haptics on the shell path (docs/design/fidice-shell-adoption.md §3
// "Sound", §7 D11; docs/design/sound-fonts.md §5, §9): the shared cue player
// (web/shared/edge/cuePlayer.ts, docs/design/shared-shell.md §5 A4) over this game's table
// (ui/sound.ts: the shell's four rows alone until M9) and its `fidice_sound` preference
// (storage.ts). main.ts constructs the real deps through bootShell at M4; fx.test.ts pins the
// table and this wiring.
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
