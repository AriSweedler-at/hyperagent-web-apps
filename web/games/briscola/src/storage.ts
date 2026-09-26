// The briscola page's localStorage (docs/design/briscola.md §5.8 "Storage keys", D19): gin's and
// backgammon's storage.ts key for key under this game's own names, so the games on one origin
// never read each other's saves or preferences (docs/ARCHITECTURE.md "Module boundaries": only this
// module names the keys). Every read goes through a decoder built on the engine's `decodeState` and
// refuses anything else; every write produces the literal the decoder reads back, so a save
// re-encodes byte for byte (E20). The readers and writers every shell keeps (the name rule, the
// bare-string preferences, the save's three roles) are web/shared/edge/prefs.ts's over the keys,
// the engine decoder and the host save's own fields spelled here, grouped as the `SHELL_STORE` the
// shell config carries (docs/design/shared-shell.md §5 C2 `shellStore`). The host save's own fields
// are the room's six options (`GameOptions`, the same six the welcome frame carries after
// `hostName`), between `myName` and `game` in the literal. This page's own keys beside the shell's:
// the third and fourth pass-and-play names (the shell remembers two), the card pack (validated for
// the Italian deck, docs/design/card-packs.md §2, so a pack that lands later is accepted the day it
// does), and the seat count the home screen last chose (one bare string). The rest of the room's
// terms are fixed (`TABLE_TERMS`): one game per sitting and the engine's defaults for the house
// rules, since the owner took the match and house-rule controls off the home screen (2026-09-25);
// the keys those controls wrote (`briscola_match`, `briscola_removedTwo`, `briscola_exchange`,
// `briscola_scoperta`, `briscola_partnerPeek`) are retired: never read, never written.
import type { Store, StorageError } from '../../../shared/edge/storage.ts';
import {
  NAME_MAX,
  PLAY_MODES,
  SOUND_STATES,
  cardPackPref,
  decodeCardPackFor,
  decodeName,
  decodePlayMode,
  decodeSoundFont,
  decodeSoundState,
  langPref,
  namePref,
  readTextWith,
  shellStore,
  textPref,
  type GuestSave as ShellGuestSave,
  type HostSave as ShellHostSave,
  type LocalSave as ShellLocalSave,
  type PlayMode,
  type Save as ShellSave,
  type SoundState,
  type TextPref,
} from '../../../shared/edge/prefs.ts';
import { defaultPackFor, type CardPackFor } from '../../../shared/lib/cards/packs.ts';
import type { LanguagePackName } from '../../../shared/lib/lang/packs.ts';
import { literal, map, refine, string, type Decoder } from '../../../shared/lib/json.ts';
import type { Result } from '../../../shared/lib/result.ts';
import {
  DEFAULT_SPEED,
  SPEEDS,
  decodeSpeed,
  isSpeed,
  type Speed,
} from '../../../shared/lib/speed.ts';
import {
  SEAT_COUNTS,
  decodeOptions,
  decodeState,
  normaliseOptions,
  type CreateGameOptions,
  type GameOptions,
  type GamesToWin,
  type SeatCount,
  type State,
} from './engine/index.ts';

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
export {
  DEFAULT_SOUND_FONT,
  SOUND_FONTS,
  type SoundFontName,
} from '../../../shared/lib/sound/fonts.ts';
export { LANGUAGE_PACKS, type LanguagePackName } from '../../../shared/lib/lang/packs.ts';

export const STORAGE_KEYS = {
  /** The game in progress: pass-and-play, or the host's table and game, or the guest's table. */
  save: 'briscolaMP_v1',
  /** The player's name, as typed (bare string, at most 20 characters). */
  name: 'briscola_name',
  /** The pass-and-play second name, as typed (bare string, at most 20 characters). */
  p2Name: 'briscola_p2Name',
  /** The third and fourth pass-and-play names, under the same rule (this page alone seats them). */
  p3Name: 'briscola_p3Name',
  p4Name: 'briscola_p4Name',
  /** The home tab last shown (bare string). */
  homeTab: 'briscola_homeTab',
  /** Online or pass-and-play (bare string). */
  playMode: 'briscola_playMode',
  /** `on` or `off` (bare string); anything but `off` counts as on. */
  sound: 'briscola_sound',
  /** The sound font (web/shared/lib/sound/fonts.ts, bare string): this game's own key (docs/design/sound-fonts.md §6). */
  soundFont: 'briscola_soundFont',
  /**
   * The finished matches this device remembers (web/shared/lib/recentGames.ts, JSON, newest
   * first, at most 20; the owner's game history of 2026-09-25). This game's own key, like the font.
   */
  recentGames: 'briscola_recentGames',
  /** The card pack (web/shared/lib/cards/packs.ts, bare string): one of the packs that draw the Italian deck (docs/design/card-packs.md §2). */
  cardPack: 'briscola_cardPack',
  /** The language pack the cards are named in (web/shared/lib/lang/packs.ts, bare string): the tooltip, the captions, the aria labels (docs/design/language-packs.md §3). */
  lang: 'briscola_lang',
  /** The seat count the home screen last chose (D3), a bare string: `2`|`3`|`4`. */
  players: 'briscola_players',
  /** The battle beat's speed (docs/design/briscola-battle.md §3.7, D8; bare string): `normal` | `quick` | `off`. */
  speed: 'briscola_speed',
} as const;
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export const HOME_TABS = ['play', 'rules', 'about'] as const;
export type HomeTab = (typeof HOME_TABS)[number];
export const DEFAULT_HOME_TAB: HomeTab = 'play';
export const DEFAULT_PLAY_MODE: PlayMode = 'online';

/** The deck this page deals (D10): the packs it may store are the ones that draw it. */
export const DECK_KIND = 'italian40';
export type CardPack = CardPackFor<typeof DECK_KIND>;
export const DEFAULT_CARD_PACK: CardPack = defaultPackFor(DECK_KIND);
/** The cards are named in Italian unless the console (or a settings panel later) says otherwise. */
export const DEFAULT_LANG: LanguagePackName = 'it';

/** One game per sitting (the owner, 2026-09-25: "It is always single game. Just 1 draw. With a replay button at the end"). */
export const ONE_GAME: GamesToWin = 1;
/** The room's fixed terms beside the seat count: one game, and the engine's defaults for the house rules (the 2 di coppe out at three, the exchange, scoperta and the partner peek off). */
export const TABLE_TERMS: CreateGameOptions = { gamesToWin: ONE_GAME };
/** The room's terms as the home screen starts (D3): two players on the fixed terms. */
export const DEFAULT_OPTS: GameOptions = normaliseOptions(2, TABLE_TERMS);

/** One of three shapes by role; the keys are in the order `writeSave` emits them. */
export type LocalSave = ShellLocalSave<State>;
/** The host save's own fields, between `myName` and `game` in the literal: the room's six options. */
export type HostExtra = GameOptions;
export type HostSave = ShellHostSave<State, HostExtra>;
export type GuestSave = ShellGuestSave;
export type Save = ShellSave<State, HostExtra>;

export const decodeHomeTab: Decoder<HomeTab> = literal(...HOME_TABS);

// ---- the shell's store: the game save and the bare-string preferences every shell keeps -----

export const SHELL_STORE = shellStore<State, HostExtra, HomeTab>(STORAGE_KEYS, {
  game: 'briscola',
  decodeGame: decodeState,
  hostExtra: {
    // The engine's own decoder reads the six fields off the save (extra keys are ignored) and holds E15/E16.
    decode: decodeOptions,
    literal: (save) => ({
      seatCount: save.seatCount,
      gamesToWin: save.gamesToWin,
      removedTwo: save.removedTwo,
      exchange: save.exchange,
      scoperta: save.scoperta,
      partnerPeek: save.partnerPeek,
    }),
  },
  decodeHomeTab,
});
export const { decodeSave, readSave, writeSave, clearSave } = SHELL_STORE.save;
export const { read: readName, write: writeName } = SHELL_STORE.name;
/** The pass-and-play second name, under the same rule. */
export const { read: readP2Name, write: writeP2Name } = SHELL_STORE.p2Name;
export const { read: readHomeTab, write: writeHomeTab } = SHELL_STORE.homeTab;
export const { read: readPlayMode, write: writePlayMode } = SHELL_STORE.playMode;
export const {
  read: readSoundState,
  write: writeSoundState,
  enabled: soundEnabled,
} = SHELL_STORE.sound;
export const { read: readSoundFont, write: writeSoundFont } = SHELL_STORE.soundFont;
/** The finished matches: the stored list or [], and one match put first under the cap. */
export const {
  read: readRecentGames,
  write: writeRecentGames,
  append: appendRecentGame,
} = SHELL_STORE.recentGames;

// ---- this page's own preferences -----------------------------------------------------------

/** The third and fourth pass-and-play names, by seat (2 and 3), under `rememberName`'s rule. */
export const EXTRA_NAME_PREFS: Readonly<Record<2 | 3, TextPref<string>>> = {
  2: namePref(STORAGE_KEYS.p3Name),
  3: namePref(STORAGE_KEYS.p4Name),
};
export const { read: readP3Name, write: writeP3Name } = EXTRA_NAME_PREFS[2];
export const { read: readP4Name, write: writeP4Name } = EXTRA_NAME_PREFS[3];

/** The card pack, one of the packs that draw the Italian deck (a French-only pack is refused under this key). */
export const decodeCardPack: Decoder<CardPack> = decodeCardPackFor(DECK_KIND);
export const { read: readCardPack, write: writeCardPack } = cardPackPref(
  STORAGE_KEYS.cardPack,
  DECK_KIND,
);

/** The battle beat's speed (docs/design/briscola-battle.md §3.7; web/shared/lib/speed.ts owns the literals): one key, one bare string. */
export { DEFAULT_SPEED, SPEEDS, decodeSpeed, isSpeed, type Speed };
export const { read: readSpeed, write: writeSpeed } = textPref(STORAGE_KEYS.speed, decodeSpeed);

/** The language pack, one of the shared packs; `orDefault` is Italian when the key is missing or unreadable. */
export const LANG_PREF = langPref(STORAGE_KEYS.lang, DEFAULT_LANG);
export const { read: readLang, write: writeLang } = LANG_PREF;

/** A number stored as its digits (`"3"`), read back as one of `values` (the refine admits those alone, so the cast holds): the seat count. */
const digitsOf = <T extends number>(values: ReadonlyArray<T>): Decoder<T> =>
  map(
    refine(
      string,
      (s) => values.some((v) => String(v) === s),
      `one of ${values.map(String).join(' | ')}`,
    ),
    (s) => Number(s) as T,
  );

export const decodeSeatCount: Decoder<SeatCount> = digitsOf(SEAT_COUNTS);

/** A number is its digits in the store, so it is not a `textPref` (backgammon's match length has the same shape). */
const digitsPref = <T extends number>(key: string, decoder: Decoder<T>): TextPref<T> => ({
  read: (store) => readTextWith(store, key, decoder),
  write: (store, value) => store.writeText(key, String(value)),
});
const seatCountPref = digitsPref(STORAGE_KEYS.players, decodeSeatCount);

const orDefault = <T>(r: Result<T, StorageError>, fallback: T): T => (r.ok ? r.value : fallback);

/**
 * The room the home screen last chose: the seat count under its key (the default when missing or
 * unreadable) on the fixed terms, normalised as the engine normalises a room.
 */
export const readOpts = (store: Store): GameOptions =>
  normaliseOptions(orDefault(seatCountPref.read(store), DEFAULT_OPTS.seatCount), TABLE_TERMS);

/** The one key written from a room's options: the seat count's digits. */
export const writeOpts = (store: Store, opts: GameOptions): void => {
  seatCountPref.write(store, opts.seatCount);
};

export const ALL_KEYS: ReadonlyArray<StorageKey> = Object.values(STORAGE_KEYS);
