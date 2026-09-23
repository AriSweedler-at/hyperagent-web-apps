// The backgammon page's localStorage (design.md §5.2; understand.md §4 step 1 "Storage keys"):
// gin's storage.ts key for key under this game's own names, so two games on one origin never
// read each other's saves or preferences (docs/ARCHITECTURE.md "Module boundaries": only this
// module names the keys). Every read goes through a decoder built on the engine's `decodeState`
// and refuses anything else; every write produces the literal the decoder reads back, so a save
// re-encodes byte for byte (R32). It takes a `Store` from web/shared/edge/storage.ts, so tests run
// it over a Map. The save is JSON; every preference is a bare string (`backgammon_name`,
// `backgammon_homeTab`, `backgammon_playMode`, `backgammon_sound`, `backgammon_soundFont`,
// `backgammon_variant`, `backgammon_matchLength`, `backgammon_curtain`), as gin's are, so the
// shared-shell extraction (design.md §6 PR-E, P6) moves this file rather than rewriting it.
import type { Store, StorageError } from '../../../shared/edge/storage.ts';

// ui/state.ts names the Store through this module: the reducer may import everything below it
// but never an edge (docs/ARCHITECTURE.md "Module boundaries").
export type { Store, StorageError };
import {
  formatError,
  integer,
  literal,
  map,
  nullable,
  object,
  optional,
  refine,
  string,
  type Decoder,
} from '../../../shared/lib/json.ts';
import { err, type Result } from '../../../shared/lib/result.ts';
import { isWellFormedCode } from '../../../shared/lib/roomCode.ts';
import { SOUND_FONTS, type SoundFontName } from '../../../shared/lib/sound/fonts.ts';
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
export const PLAY_MODES = ['online', 'local'] as const;
export type PlayMode = (typeof PLAY_MODES)[number];
export const DEFAULT_PLAY_MODE: PlayMode = 'online';
export const SOUND_STATES = ['on', 'off'] as const;
export type SoundState = (typeof SOUND_STATES)[number];
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
/** `writeName` slices what it stores to this many characters (the wire cap, protocol.ts NAME_MAX). */
export const NAME_MAX = 20;

/** One of three shapes by role; the keys are in the order `writeSave` emits them. */
export type LocalSave = Readonly<{ role: 'local'; game: State }>;
export type HostSave = Readonly<{
  role: 'host';
  code: string;
  myName: string;
  matchLength: number;
  variant: ShippedVariant;
  /** null while the room waits for its first guest. */
  game: State | null;
  oppName: string | null;
  /**
   * The game came from pass-and-play (ui/state.ts `handoff`) and its remote seat has not joined:
   * a reload resumes the offer, and cancelling gives the game back to pass-and-play. Written only
   * when true, as gin writes it, so every other host save keeps the same literal.
   */
  handoff?: true;
}>;
export type GuestSave = Readonly<{ role: 'guest'; code: string; myName: string }>;
export type Save = LocalSave | HostSave | GuestSave;

const roomCode = refine(
  string,
  (code) => isWellFormedCode('backgammon', code),
  'a 4-letter room code',
);
const shippedVariant: Decoder<ShippedVariant> = literal(...SHIPPED_VARIANTS);
const saveHead = object({ role: literal('local', 'host', 'guest') });
const localSave: Decoder<LocalSave> = object({ role: literal('local'), game: decodeState });
const hostSave: Decoder<HostSave> = object({
  role: literal('host'),
  code: roomCode,
  myName: string,
  matchLength: integer(1),
  variant: shippedVariant,
  game: nullable(decodeState),
  oppName: nullable(string),
  handoff: optional(literal(true)),
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

/** An empty string is no name (gin's `if (savedName)`). */
export const decodeName: Decoder<string> = refine(string, (s) => s !== '', 'a non-empty name');
export const decodeHomeTab: Decoder<HomeTab> = literal(...HOME_TABS);
export const decodePlayMode: Decoder<PlayMode> = literal(...PLAY_MODES);
export const decodeSoundState: Decoder<SoundState> = literal(...SOUND_STATES);
export const decodeSoundFont: Decoder<SoundFontName> = literal(...SOUND_FONTS);
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

/** The literal for a save, key for key, whatever order the caller's object had. */
const saveLiteral = (save: Save): Save => {
  switch (save.role) {
    case 'local':
      return { role: 'local', game: save.game };
    case 'host':
      return {
        role: 'host',
        code: save.code,
        myName: save.myName,
        matchLength: save.matchLength,
        variant: save.variant,
        game: save.game,
        oppName: save.oppName,
        ...(save.handoff === true ? { handoff: true } : {}),
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

/** An empty name removes the key, anything else is stored cut to NAME_MAX (gin's `rememberName`). */
const writeNameUnder = (store: Store, key: StorageKey, name: string): Result<null, StorageError> =>
  name === '' ? store.remove(key) : store.writeText(key, name.slice(0, NAME_MAX));

export const writeName = (store: Store, name: string): Result<null, StorageError> =>
  writeNameUnder(store, STORAGE_KEYS.name, name);

/** The pass-and-play second name, under the same rule. */
export const readP2Name = (store: Store): Result<string, StorageError> =>
  readTextWith(store, STORAGE_KEYS.p2Name, decodeName);

export const writeP2Name = (store: Store, name: string): Result<null, StorageError> =>
  writeNameUnder(store, STORAGE_KEYS.p2Name, name);

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

/** On unless the key says off (missing or unreadable counts as on). */
export const soundEnabled = (store: Store): boolean => {
  const state = readSoundState(store);
  return !(state.ok && state.value === 'off');
};

export const writeSoundState = (store: Store, sound: SoundState): Result<null, StorageError> =>
  store.writeText(STORAGE_KEYS.sound, sound);

export const readSoundFont = (store: Store): Result<SoundFontName, StorageError> =>
  readTextWith(store, STORAGE_KEYS.soundFont, decodeSoundFont);
export const writeSoundFont = (store: Store, font: SoundFontName): Result<null, StorageError> =>
  store.writeText(STORAGE_KEYS.soundFont, font);

export const readVariant = (store: Store): Result<ShippedVariant, StorageError> =>
  readTextWith(store, STORAGE_KEYS.variant, decodeVariant);
export const writeVariant = (store: Store, variant: ShippedVariant): Result<null, StorageError> =>
  store.writeText(STORAGE_KEYS.variant, variant);

export const readMatchLength = (store: Store): Result<number, StorageError> =>
  readTextWith(store, STORAGE_KEYS.matchLength, decodeMatchLength);
export const writeMatchLength = (store: Store, length: number): Result<null, StorageError> =>
  store.writeText(STORAGE_KEYS.matchLength, String(length));

export const readCurtainMode = (store: Store): Result<CurtainMode, StorageError> =>
  readTextWith(store, STORAGE_KEYS.curtain, decodeCurtainMode);
export const writeCurtainMode = (store: Store, mode: CurtainMode): Result<null, StorageError> =>
  store.writeText(STORAGE_KEYS.curtain, mode);

export const ALL_KEYS: ReadonlyArray<StorageKey> = Object.values(STORAGE_KEYS);
