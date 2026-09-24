// The gin page's localStorage (docs/MIGRATION.md step 11): six of the seven keys the legacy page wrote
// (`ginRummy_scorerNames` is retired: the Score Counter scores the two pass-and-play names)
// (legacy/gin-rummy/index.html: `persist()`, `rememberName`, `setHomeTab`, `setPlayMode`,
// `fx.toggle`, the scorer's `save()` and `startScoring`), frozen here, each behind a decoder that
// accepts every payload captured from a real legacy session (test/fixtures/legacy/gin-storage,
// test/parity/gin.storage.test.ts) and refuses anything else, and a writer that produces the same
// string the legacy wrote for the same value (the captures round-trip byte for byte). Only this
// module names the keys (docs/ARCHITECTURE.md "Module boundaries"); it takes a `Store` from
// web/shared/edge/storage.ts, so tests run it over a Map. Four keys hold bare strings, not JSON
// (`ginRummy_name`, `ginRummy_homeTab`, `ginRummy_playMode`, `ginRummy_sound`), as the legacy
// `safeSet` wrote them. One key is this page's own: `ginRummy_p2Name`, the pass-and-play second
// name, remembered under `rememberName`'s rule; the legacy read `#p2NameInput` only at the Start
// button and never stored it, so no capture exists for it. The readers and writers every shell
// shares (the name rule, the bare-string preferences, the save's three roles) are built by
// web/shared/edge/prefs.ts (docs/design/shared-shell.md §5 A3) over the keys, the engine decoder
// and the host save's own field spelled here; the keys and the literals did not move.
import { CARD_BACKS, type CardBack } from './cardBack.ts';
import { SORT_MODES, type SortMode } from './sort.ts';
import type { Store, StorageError } from '../../../shared/edge/storage.ts';
import {
  NAME_MAX,
  PLAY_MODES,
  SOUND_STATES,
  decodeName,
  decodePlayMode,
  decodeSoundFont,
  decodeSoundState,
  namePref,
  shellSave,
  soundPref,
  textPref,
  type GuestSave as ShellGuestSave,
  type HostSave as ShellHostSave,
  type LocalSave as ShellLocalSave,
  type PlayMode,
  type Save as ShellSave,
  type SoundState,
} from '../../../shared/edge/prefs.ts';

// ui/state.ts names the Store through this module (docs/MIGRATION.md step 12): the reducer may
// import everything below it but never an edge (docs/ARCHITECTURE.md "Module boundaries").
export type { Store, StorageError };
// The shell's shared literals, named through this module too, so the page has one storage import.
export {
  NAME_MAX,
  PLAY_MODES,
  SOUND_STATES,
  decodeName,
  decodePlayMode,
  decodeSoundFont,
  decodeSoundState,
  type PlayMode,
  type SoundState,
};
import {
  arrayOf,
  integer,
  literal,
  object,
  record,
  refine,
  string,
  type Decoder,
} from '../../../shared/lib/json.ts';
import type { Result } from '../../../shared/lib/result.ts';
import { decodeState } from './engine/decode.ts';
import type { State } from './engine/types.ts';
import type { ScorerState } from './scorer/scores.ts';

export const STORAGE_KEYS = {
  /** The game in progress: pass-and-play, or the host's room and game, or the guest's room. */
  save: 'ginRummyMP_v1',
  /** The player's name, as typed (bare string, at most 20 characters). */
  name: 'ginRummy_name',
  /**
   * The pass-and-play second name, as typed (bare string, at most 20 characters). Not a legacy
   * key: the legacy page read `#p2NameInput` only at the Start button and never stored it.
   */
  p2Name: 'ginRummy_p2Name',
  /** The home tab last shown (bare string). */
  homeTab: 'ginRummy_homeTab',
  /** Online or pass-and-play (bare string). */
  playMode: 'ginRummy_playMode',
  /** `on` or `off` (bare string); anything but `off` counts as on. */
  sound: 'ginRummy_sound',
  /** How the hand is arranged: `suit`, `rank` or `manual` (bare string). This page's own key. */
  sort: 'ginRummy_sort',
  /** The card back (src/cardBack.ts, bare string). This page's own key; set from the console for now. */
  cardBack: 'ginRummy_cardBack',
  /**
   * The sound font (web/shared/lib/sound/fonts.ts, bare string). This page's own key, so another
   * game on the origin keeps its own choice (docs/design/sound-fonts.md §6); set from the console for now.
   */
  soundFont: 'ginRummy_soundFont',
  /**
   * The Score Counter's session. Its players' names are `name` and `p2Name` above (the legacy
   * `ginRummy_scorerNames` list is retired: the Score Counter scores the two pass-and-play players).
   */
  scorerState: 'ginRummyScorerState_v2',
} as const;
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export const HOME_TABS = ['play', 'rules', 'score'] as const;
export type HomeTab = (typeof HOME_TABS)[number];
export const DEFAULT_HOME_TAB: HomeTab = 'play';
export const DEFAULT_PLAY_MODE: PlayMode = 'online';
export { DEFAULT_SORT, SORT_MODES, type SortMode } from './sort.ts';
export { CARD_BACKS, DEFAULT_CARD_BACK, type CardBack } from './cardBack.ts';
export {
  DEFAULT_SOUND_FONT,
  SOUND_FONTS,
  type SoundFontName,
} from '../../../shared/lib/sound/fonts.ts';

/** `persist()` writes one of three shapes by role; the keys are in the legacy literals' order. */
export type LocalSave = ShellLocalSave<State>;
/** The host save's own field, between `myName` and `game` in the legacy literal: the target score. */
export type HostExtra = Readonly<{ target: number }>;
export type HostSave = ShellHostSave<State, HostExtra>;
export type GuestSave = ShellGuestSave;
export type Save = ShellSave<State, HostExtra>;

const hostExtra: Decoder<HostExtra> = object({ target: integer(1) });

export const decodeHomeTab: Decoder<HomeTab> = literal(...HOME_TABS);
export const decodeSort: Decoder<SortMode> = literal(...SORT_MODES);
export const decodeCardBack: Decoder<CardBack> = literal(...CARD_BACKS);

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

// ---- the game save ---------------------------------------------------------------------------

export const { decodeSave, readSave, writeSave, clearSave } = shellSave<State, HostExtra>({
  key: STORAGE_KEYS.save,
  game: 'gin-rummy',
  decodeGame: decodeState,
  hostExtra: { decode: hostExtra, literal: (save) => ({ target: save.target }) },
});

// ---- the bare-string preferences -----------------------------------------------------------

export const { read: readName, write: writeName } = namePref(STORAGE_KEYS.name);
/** The pass-and-play second name, under `rememberName`'s rule; the legacy never stored it. */
export const { read: readP2Name, write: writeP2Name } = namePref(STORAGE_KEYS.p2Name);
export const { read: readHomeTab, write: writeHomeTab } = textPref(
  STORAGE_KEYS.homeTab,
  decodeHomeTab,
);
export const { read: readPlayMode, write: writePlayMode } = textPref(
  STORAGE_KEYS.playMode,
  decodePlayMode,
);
export const {
  read: readSoundState,
  write: writeSoundState,
  enabled: soundEnabled,
} = soundPref(STORAGE_KEYS.sound);
export const { read: readSort, write: writeSort } = textPref(STORAGE_KEYS.sort, decodeSort);
export const { read: readCardBack, write: writeCardBack } = textPref(
  STORAGE_KEYS.cardBack,
  decodeCardBack,
);
export const { read: readSoundFont, write: writeSoundFont } = textPref(
  STORAGE_KEYS.soundFont,
  decodeSoundFont,
);

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

export const ALL_KEYS: ReadonlyArray<StorageKey> = Object.values(STORAGE_KEYS);
