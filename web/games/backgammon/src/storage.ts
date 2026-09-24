// The backgammon page's localStorage (design.md §5.2; understand.md §4 step 1 "Storage keys"):
// gin's storage.ts key for key under this game's own names, so two games on one origin never
// read each other's saves or preferences (docs/ARCHITECTURE.md "Module boundaries": only this
// module names the keys). Every read goes through a decoder built on the engine's `decodeState`
// and refuses anything else; every write produces the literal the decoder reads back, so a save
// re-encodes byte for byte (R32). It takes a `Store` from web/shared/edge/storage.ts, so tests run
// it over a Map. The save is JSON; every preference is a bare string (`backgammon_name`,
// `backgammon_homeTab`, `backgammon_playMode`, `backgammon_sound`, `backgammon_soundFont`,
// `backgammon_variant`, `backgammon_matchLength`, `backgammon_curtain`), as gin's are. The readers
// and writers both shells share (the name rule, the bare-string preferences, the save's three
// roles) are built by web/shared/edge/prefs.ts (docs/design/shared-shell.md §5 A3) over the keys,
// the engine decoder and the host save's own fields spelled here; the keys and the literals did
// not move.
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
  readTextWith,
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

// ui/state.ts names the Store through this module: the reducer may import everything below it
// but never an edge (docs/ARCHITECTURE.md "Module boundaries").
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
  integer,
  literal,
  map,
  object,
  refine,
  string,
  type Decoder,
} from '../../../shared/lib/json.ts';
import type { Result } from '../../../shared/lib/result.ts';
import {
  decodeState,
  MATCH_LENGTHS,
  SHIPPED_VARIANTS,
  type ShippedVariant,
  type State,
} from './engine/index.ts';

export const STORAGE_KEYS = {
  /** The game in progress: pass-and-play, or the host's room and game, or the guest's room. */
  save: 'backgammonMP_v1',
  /** The player's name, as typed (bare string, at most 20 characters). */
  name: 'backgammon_name',
  /** The pass-and-play second name, as typed (bare string, at most 20 characters). */
  p2Name: 'backgammon_p2Name',
  /** The home tab last shown (bare string). */
  homeTab: 'backgammon_homeTab',
  /** Online or pass-and-play (bare string). */
  playMode: 'backgammon_playMode',
  /** `on` or `off` (bare string); anything but `off` counts as on. */
  sound: 'backgammon_sound',
  /**
   * The sound font (web/shared/lib/sound/fonts.ts, bare string): this game's own key, so another
   * game on the origin keeps its own choice (docs/design/sound-fonts.md §6); set from the console for now.
   */
  soundFont: 'backgammon_soundFont',
  /** The ruleset the home screen last chose (bare string, a shipped variant only). */
  variant: 'backgammon_variant',
  /** The match length the home screen last chose (bare string naming one of MATCH_LENGTHS). */
  matchLength: 'backgammon_matchLength',
  /** The pass-and-play curtain: `always` or `never` (bare string; design.md Q4). */
  curtain: 'backgammon_curtain',
} as const;
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export const HOME_TABS = ['play', 'rules', 'about'] as const;
export type HomeTab = (typeof HOME_TABS)[number];
export const DEFAULT_HOME_TAB: HomeTab = 'play';
export const DEFAULT_PLAY_MODE: PlayMode = 'online';
export const CURTAIN_MODES = ['always', 'never'] as const;
export type CurtainMode = (typeof CURTAIN_MODES)[number];
export const DEFAULT_CURTAIN_MODE: CurtainMode = 'always';
export {
  DEFAULT_SOUND_FONT,
  SOUND_FONTS,
  type SoundFontName,
} from '../../../shared/lib/sound/fonts.ts';
export {
  DEFAULT_MATCH_LENGTH,
  DEFAULT_VARIANT,
  MATCH_LENGTHS,
  SHIPPED_VARIANTS,
  type ShippedVariant,
} from './engine/index.ts';

/** One of three shapes by role; the keys are in the order `writeSave` emits them. */
export type LocalSave = ShellLocalSave<State>;
/** The host save's own fields, between `myName` and `game` in the literal: the match's terms. */
export type HostExtra = Readonly<{ matchLength: number; variant: ShippedVariant }>;
export type HostSave = ShellHostSave<State, HostExtra>;
export type GuestSave = ShellGuestSave;
export type Save = ShellSave<State, HostExtra>;

const shippedVariant: Decoder<ShippedVariant> = literal(...SHIPPED_VARIANTS);
const hostExtra: Decoder<HostExtra> = object({ matchLength: integer(1), variant: shippedVariant });

export const decodeHomeTab: Decoder<HomeTab> = literal(...HOME_TABS);
/** Shipped literals only: a stored plakoto or fevga reads as an error until they ship (Q1). */
export const decodeVariant: Decoder<ShippedVariant> = shippedVariant;
/** A bare string naming one of MATCH_LENGTHS (`"5"`), read back as the number. */
export const decodeMatchLength: Decoder<number> = map(
  refine(
    string,
    (s) => MATCH_LENGTHS.some((n) => String(n) === s),
    `one of ${MATCH_LENGTHS.map(String).join(' | ')}`,
  ),
  Number,
);
export const decodeCurtainMode: Decoder<CurtainMode> = literal(...CURTAIN_MODES);

// ---- the game save ---------------------------------------------------------------------------

export const { decodeSave, readSave, writeSave, clearSave } = shellSave<State, HostExtra>({
  key: STORAGE_KEYS.save,
  game: 'backgammon',
  decodeGame: decodeState,
  hostExtra: {
    decode: hostExtra,
    literal: (save) => ({ matchLength: save.matchLength, variant: save.variant }),
  },
});

// ---- the bare-string preferences -----------------------------------------------------------

export const { read: readName, write: writeName } = namePref(STORAGE_KEYS.name);
/** The pass-and-play second name, under the same rule. */
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
export const { read: readSoundFont, write: writeSoundFont } = textPref(
  STORAGE_KEYS.soundFont,
  decodeSoundFont,
);
export const { read: readVariant, write: writeVariant } = textPref(
  STORAGE_KEYS.variant,
  decodeVariant,
);

/** The match length is a number in the app and its digits in the store, so it is not a `textPref`. */
export const readMatchLength = (store: Store): Result<number, StorageError> =>
  readTextWith(store, STORAGE_KEYS.matchLength, decodeMatchLength);
export const writeMatchLength = (store: Store, length: number): Result<null, StorageError> =>
  store.writeText(STORAGE_KEYS.matchLength, String(length));

export const { read: readCurtainMode, write: writeCurtainMode } = textPref(
  STORAGE_KEYS.curtain,
  decodeCurtainMode,
);

export const ALL_KEYS: ReadonlyArray<StorageKey> = Object.values(STORAGE_KEYS);
