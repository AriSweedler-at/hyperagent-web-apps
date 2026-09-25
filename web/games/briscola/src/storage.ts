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
// does), and the six options the home screen last chose, one bare string each.
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
import { literal, map, refine, string, type Decoder } from '../../../shared/lib/json.ts';
import type { Result } from '../../../shared/lib/result.ts';
import {
  GAMES_TO_WIN,
  SEAT_COUNTS,
  SUITS,
  decodeOptions,
  decodeState,
  normaliseOptions,
  type GameOptions,
  type GamesToWin,
  type SeatCount,
  type State,
  type Suit,
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
  /** The card pack (web/shared/lib/cards/packs.ts, bare string): one of the packs that draw the Italian deck (docs/design/card-packs.md §2). */
  cardPack: 'briscola_cardPack',
  /** The room options the home screen last chose (D3), one bare string each: `2`|`3`|`4`, `1`|`2`|`3`, a suit letter, `on`|`off` ×3. */
  players: 'briscola_players',
  match: 'briscola_match',
  removedTwo: 'briscola_removedTwo',
  exchange: 'briscola_exchange',
  scoperta: 'briscola_scoperta',
  partnerPeek: 'briscola_partnerPeek',
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

/** The room's terms as the home screen starts (D3): two players, best of three, the 2 di coppe out at three, every house rule off. */
export const DEFAULT_OPTS: GameOptions = normaliseOptions(2, {});

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

/** A number stored as its digits (`"3"`), read back as one of `values` (the refine admits those alone, so the cast holds): the seat count and the games to win. */
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
export const decodeGamesToWin: Decoder<GamesToWin> = digitsOf(GAMES_TO_WIN);
export const decodeSuit: Decoder<Suit> = literal(...SUITS);
/** A house rule: `on` or `off`, as the sound preference spells a switch. */
export const decodeFlag: Decoder<SoundState> = decodeSoundState;

/** A number is its digits in the store, so it is not a `textPref` (backgammon's match length has the same shape). */
const digitsPref = <T extends number>(key: string, decoder: Decoder<T>): TextPref<T> => ({
  read: (store) => readTextWith(store, key, decoder),
  write: (store, value) => store.writeText(key, String(value)),
});
const seatCountPref = digitsPref(STORAGE_KEYS.players, decodeSeatCount);
const gamesToWinPref = digitsPref(STORAGE_KEYS.match, decodeGamesToWin);
const removedTwoPref = textPref(STORAGE_KEYS.removedTwo, decodeSuit);
const flagPrefs: Readonly<Record<'exchange' | 'scoperta' | 'partnerPeek', TextPref<SoundState>>> = {
  exchange: textPref(STORAGE_KEYS.exchange, decodeFlag),
  scoperta: textPref(STORAGE_KEYS.scoperta, decodeFlag),
  partnerPeek: textPref(STORAGE_KEYS.partnerPeek, decodeFlag),
};

const orDefault = <T>(r: Result<T, StorageError>, fallback: T): T => (r.ok ? r.value : fallback);
const readFlag = (store: Store, name: keyof typeof flagPrefs, fallback: boolean): boolean => {
  const r = flagPrefs[name].read(store);
  return r.ok ? r.value === 'on' : fallback;
};

/**
 * The six options the home screen last chose, each falling back to `DEFAULT_OPTS` when its key is
 * missing or unreadable, then normalised as the engine normalises them (scoperta at two players
 * only, the partner peek at four only), so a stored pair that disagrees reads as a legal room.
 */
export const readOpts = (store: Store): GameOptions => {
  const d = DEFAULT_OPTS;
  return normaliseOptions(orDefault(seatCountPref.read(store), d.seatCount), {
    gamesToWin: orDefault(gamesToWinPref.read(store), d.gamesToWin),
    removedTwo: orDefault(removedTwoPref.read(store), d.removedTwo),
    exchange: readFlag(store, 'exchange', d.exchange),
    scoperta: readFlag(store, 'scoperta', d.scoperta),
    partnerPeek: readFlag(store, 'partnerPeek', d.partnerPeek),
  });
};

/** The six keys written from a room's options: the digits, the suit letter and `on`/`off`. */
export const writeOpts = (store: Store, opts: GameOptions): void => {
  seatCountPref.write(store, opts.seatCount);
  gamesToWinPref.write(store, opts.gamesToWin);
  removedTwoPref.write(store, opts.removedTwo);
  flagPrefs.exchange.write(store, opts.exchange ? 'on' : 'off');
  flagPrefs.scoperta.write(store, opts.scoperta ? 'on' : 'off');
  flagPrefs.partnerPeek.write(store, opts.partnerPeek ? 'on' : 'off');
};

export const ALL_KEYS: ReadonlyArray<StorageKey> = Object.values(STORAGE_KEYS);
