// The legacy `fx` object (legacy/gin-rummy/index.html: sound + haptics; docs/MIGRATION.md step 12)
// is the shared cue player (web/shared/edge/cuePlayer.ts, scratchpad/bg/shared-shell.md §5 A4)
// over gin's table (ui/sound.ts) and its `ginRummy_sound` preference (storage.ts). main.ts
// constructs the real deps; fx.test.ts pins the table and this wiring.
import {
  createCuePlayer,
  type CuePlayer,
  type CuePlayerDeps,
} from '../../../shared/edge/cuePlayer.ts';
import { writeSoundState, type Store } from './storage.ts';
import type { Cue } from './ui/cues.ts';
import { CUES } from './ui/sound.ts';

export type FxDeps = Omit<CuePlayerDeps<Cue>, 'cues' | 'persist'> & Readonly<{ store: Store }>;
export type Fx = CuePlayer<Cue>;

export const createFx = ({ store, ...deps }: FxDeps): Fx =>
  createCuePlayer({ ...deps, cues: CUES, persist: (state) => writeSoundState(store, state) });
