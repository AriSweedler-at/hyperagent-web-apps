// The page's localStorage keys (docs/ARCHITECTURE.md "Module boundaries": only this module names
// them) and its readers and writers over a Store: the saved `Progress` (docs/design/rps-island.md
// D4, §2 "Persists") under `rps_progress` through the versioned codec, and the sound preference and
// font under the page's own prefix, as every game keeps them (web/shared/edge/prefs.ts). An
// unreadable or refused save reads as a fresh start: the page never plays a state the engine could
// not have reached.
import { soundPref, type SoundState } from '../../../shared/edge/prefs.ts';
import type { Store } from '../../../shared/edge/storage.ts';
import { decodeProgress, encodeProgress } from './engine/codec.ts';
import { INITIAL_PROGRESS, type Progress } from './engine/engine.ts';

export type { Store };

export const STORAGE_KEYS = {
  progress: 'rps_progress',
  sound: 'rps_sound',
  soundFont: 'rps_soundFont',
} as const;

/** The saved progress, or the start when nothing readable is there. */
export const readProgress = (store: Store): Progress => {
  const stored = store.readJson(STORAGE_KEYS.progress, decodeProgress);
  return stored.ok ? stored.value : INITIAL_PROGRESS;
};

/** Save after every round, Tech up and Reset (§2); a failing store is not the player's problem. */
export const writeProgress = (store: Store, progress: Progress): void => {
  store.writeJson(STORAGE_KEYS.progress, encodeProgress(progress));
};

const sound = soundPref(STORAGE_KEYS.sound);

/** The sound preference: `on`/`off` as stored, else `fallback` (the boot's: on with a mouse, off on a phone). */
export const soundEnabled = (store: Store, fallback: boolean): boolean =>
  sound.enabled(store, fallback);

export const writeSoundState = (store: Store, state: SoundState): void => {
  sound.write(store, state);
};
