// The page's sound and haptics: the shared cue player (web/shared/edge/cuePlayer.ts) over this
// page's table (ui/sound.ts) and its `rps_sound` preference (storage.ts), as every game wires it.
// main.ts constructs the real deps; fx.test.ts pins the table and this wiring.
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
  createCuePlayer({
    ...deps,
    cues: CUES,
    persist: (state) => {
      writeSoundState(store, state);
    },
  });
