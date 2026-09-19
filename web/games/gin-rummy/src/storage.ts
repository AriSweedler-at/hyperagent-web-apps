// The gin page's localStorage (docs/MIGRATION.md step 11): the seven keys the legacy page wrote
// (legacy/gin-rummy/index.html: `persist()`, `rememberName`, `setHomeTab`, `setPlayMode`,
// `fx.toggle`, the scorer's `save()` and `startScoring`), frozen here, each behind a decoder that
// accepts every payload captured from a real legacy session (test/fixtures/legacy/gin-storage,
// test/parity/gin.storage.test.ts) and refuses anything else, and a writer that produces the same
// string the legacy wrote for the same value (the captures round-trip byte for byte). Only this
// module names the keys (docs/ARCHITECTURE.md "Module boundaries"); it takes a `Store` from
// web/shared/edge/storage.ts, so tests run it over a Map. Four keys hold bare strings, not JSON
// (`ginRummy_name`, `ginRummy_homeTab`, `ginRummy_playMode`, `ginRummy_sound`), as the legacy
// `safeSet` wrote them.
import type { Store, StorageError } from '../../../shared/edge/storage.ts';

// ui/state.ts names the Store through this module (docs/MIGRATION.md step 12): the reducer may
// import everything below it but never an edge (docs/ARCHITECTURE.md "Module boundaries").
export type { Store, StorageError };
import {
  arrayOf,
  formatError,
  integer,
  literal,
  nullable,
  object,
  record,
  refine,
  string,
  type Decoder,
} from '../../../shared/lib/json.ts';
import { err, type Result } from '../../../shared/lib/result.ts';
import { isWellFormedCode } from '../../../shared/lib/roomCode.ts';
import { decodeState } from './engine/decode.ts';
import type { State } from './engine/types.ts';
import type { ScorerState } from './scorer/scores.ts';

export const STORAGE_KEYS = {
  /** The game in progress: pass-and-play, or the host's room and game, or the guest's room. */
  save: 'ginRummyMP_v1',
  /** The player's name, as typed (bare string, at most 20 characters). */
  name: 'ginRummy_name',
  /** The home tab last shown (bare string). */
  homeTab: 'ginRummy_homeTab',
  /** Online or pass-and-play (bare string). */
  playMode: 'ginRummy_playMode',
  /** `on` or `off` (bare string); anything but `off` counts as on. */
  sound: 'ginRummy_sound',
  /** The Score Counter's session. */
  scorerState: 'ginRummyScorerState_v2',
  /** The names the Score Counter was last started with (JSON array). */
  scorerNames: 'ginRummy_scorerNames',
} as const;
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export const HOME_TABS = ['play', 'rules', 'score'] as const;
export type HomeTab = (typeof HOME_TABS)[number];
export const DEFAULT_HOME_TAB: HomeTab = 'play';
export const PLAY_MODES = ['online', 'local'] as const;
export type PlayMode = (typeof PLAY_MODES)[number];
export const DEFAULT_PLAY_MODE: PlayMode = 'online';
export const SOUND_STATES = ['on', 'off'] as const;
export type SoundState = (typeof SOUND_STATES)[number];
/** `rememberName` sliced what it stored to this many characters. */
export const NAME_MAX = 20;

/** `persist()` writes one of three shapes by role; the keys are in the legacy literals' order. */
export type LocalSave = Readonly<{ role: 'local'; game: State }>;
export type HostSave = Readonly<{
  role: 'host';
  code: string;
  myName: string;
  target: number;
  /** null while the room waits for its first guest. */
  game: State | null;
  oppName: string | null;
}>;
export type GuestSave = Readonly<{ role: 'guest'; code: string; myName: string }>;
export type Save = LocalSave | HostSave | GuestSave;

const roomCode = refine(
  string,
  (code) => isWellFormedCode('gin-rummy', code),
  'a 4-letter room code',
);
const saveHead = object({ role: literal('local', 'host', 'guest') });
const localSave: Decoder<LocalSave> = object({ role: literal('local'), game: decodeState });
const hostSave: Decoder<HostSave> = object({
  role: literal('host'),
  code: roomCode,
  myName: string,
  target: integer(1),
  game: nullable(decodeState),
  oppName: nullable(string),
});
const guestSave: Decoder<GuestSave> = object({
  role: literal('guest'),
  code: roomCode,
  myName: string,
});

export const decodeSave: Decoder<Save> = (input) => {
  const head = saveHead(input);
  if (!head.ok) return head;
  switch (head.value.role) {
    case 'local':
      return localSave(input);
    case 'host':
      return hostSave(input);
    case 'guest':
      return guestSave(input);
  }
};

/** `if (savedName)`: the legacy treated an empty string as no name. */
export const decodeName: Decoder<string> = refine(string, (s) => s !== '', 'a non-empty name');
export const decodeHomeTab: Decoder<HomeTab> = literal(...HOME_TABS);
export const decodePlayMode: Decoder<PlayMode> = literal(...PLAY_MODES);
export const decodeSoundState: Decoder<SoundState> = literal(...SOUND_STATES);

const scorerPlayer = object({ id: string, name: string });
const scorerRound = object({
  deadwood: record(integer(0)),
  knockerId: string,
  knockType: literal('knock', 'gin'),
  scores: record(integer()),
  ts: integer(0),
});
/** The legacy `loadSaved` kept a session only with `players.length >= 2`. */
export const decodeScorerState: Decoder<ScorerState> = object({
  players: refine(arrayOf(scorerPlayer), (ps) => ps.length >= 2, 'at least two players'),
  target: integer(1),
  rounds: arrayOf(scorerRound),
  startedAt: integer(0),
});
/** `populateDefaultPlayers` used the stored names only when there were at least two. */
export const decodeScorerNames: Decoder<ReadonlyArray<string>> = refine(
  arrayOf(string),
  (names) => names.length >= 2,
  'at least two names',
);

const invalid = (key: string, error: Parameters<typeof formatError>[0]): StorageError => ({
  kind: 'invalid',
  key,
  reason: formatError(error),
});

/** A bare-string key through its decoder. */
const readTextWith = <T>(
  store: Store,
  key: string,
  decoder: Decoder<T>,
): Result<T, StorageError> => {
  const text = store.readText(key);
  if (!text.ok) return text;
  const decoded = decoder(text.value);
  return decoded.ok ? decoded : err(invalid(key, decoded.error));
};

// ---- the game save ---------------------------------------------------------------------------

export const readSave = (store: Store): Result<Save, StorageError> =>
  store.readJson(STORAGE_KEYS.save, decodeSave);

/** The `persist()` literal for a save, key for key, whatever order the caller's object had. */
const saveLiteral = (save: Save): Save => {
  switch (save.role) {
    case 'local':
      return { role: 'local', game: save.game };
    case 'host':
      return {
        role: 'host',
        code: save.code,
        myName: save.myName,
        target: save.target,
        game: save.game,
        oppName: save.oppName,
      };
    case 'guest':
      return { role: 'guest', code: save.code, myName: save.myName };
  }
};

export const writeSave = (store: Store, save: Save): Result<null, StorageError> =>
  store.writeJson(STORAGE_KEYS.save, saveLiteral(save));

export const clearSave = (store: Store): Result<null, StorageError> =>
  store.remove(STORAGE_KEYS.save);

// ---- the bare-string preferences -----------------------------------------------------------

export const readName = (store: Store): Result<string, StorageError> =>
  readTextWith(store, STORAGE_KEYS.name, decodeName);

/** `rememberName`: an empty name removes the key, anything else is stored cut to NAME_MAX. */
export const writeName = (store: Store, name: string): Result<null, StorageError> =>
  name === ''
    ? store.remove(STORAGE_KEYS.name)
    : store.writeText(STORAGE_KEYS.name, name.slice(0, NAME_MAX));

export const readHomeTab = (store: Store): Result<HomeTab, StorageError> =>
  readTextWith(store, STORAGE_KEYS.homeTab, decodeHomeTab);

export const writeHomeTab = (store: Store, tab: HomeTab): Result<null, StorageError> =>
  store.writeText(STORAGE_KEYS.homeTab, tab);

export const readPlayMode = (store: Store): Result<PlayMode, StorageError> =>
  readTextWith(store, STORAGE_KEYS.playMode, decodePlayMode);

export const writePlayMode = (store: Store, mode: PlayMode): Result<null, StorageError> =>
  store.writeText(STORAGE_KEYS.playMode, mode);

export const readSoundState = (store: Store): Result<SoundState, StorageError> =>
  readTextWith(store, STORAGE_KEYS.sound, decodeSoundState);

/** `safeGet(FX_KEY) !== 'off'`: on unless the key says off (missing or unreadable counts as on). */
export const soundEnabled = (store: Store): boolean => {
  const state = readSoundState(store);
  return !(state.ok && state.value === 'off');
};

export const writeSoundState = (store: Store, sound: SoundState): Result<null, StorageError> =>
  store.writeText(STORAGE_KEYS.sound, sound);

// ---- the Score Counter -----------------------------------------------------------------------

export const readScorerState = (store: Store): Result<ScorerState, StorageError> =>
  store.readJson(STORAGE_KEYS.scorerState, decodeScorerState);

/** The scorer's `save()`: `JSON.stringify(state)`, or the key removed when there is no session. */
export const writeScorerState = (
  store: Store,
  state: ScorerState | null,
): Result<null, StorageError> =>
  state === null
    ? store.remove(STORAGE_KEYS.scorerState)
    : store.writeJson(STORAGE_KEYS.scorerState, {
        players: state.players.map((p) => ({ id: p.id, name: p.name })),
        target: state.target,
        rounds: state.rounds.map((r) => ({
          deadwood: r.deadwood,
          knockerId: r.knockerId,
          knockType: r.knockType,
          scores: r.scores,
          ts: r.ts,
        })),
        startedAt: state.startedAt,
      });

export const readScorerNames = (store: Store): Result<ReadonlyArray<string>, StorageError> =>
  store.readJson(STORAGE_KEYS.scorerNames, decodeScorerNames);

export const writeScorerNames = (
  store: Store,
  names: ReadonlyArray<string>,
): Result<null, StorageError> => store.writeJson(STORAGE_KEYS.scorerNames, names);

export const ALL_KEYS: ReadonlyArray<StorageKey> = Object.values(STORAGE_KEYS);
