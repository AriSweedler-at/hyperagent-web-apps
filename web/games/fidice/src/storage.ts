// The fidice page's localStorage on the shell path (docs/design/fidice-shell-adoption.md §3
// "Storage", §4 M3; §6 risk 14): briscola's storage.ts key for key under this game's own names,
// so the games on one origin never read each other's saves or preferences (docs/ARCHITECTURE.md
// "Module boundaries": only this module names the keys). Every read goes through a decoder built
// on codec.ts's `decodeState` and refuses anything else; every write produces the literal the
// decoder reads back, so a save re-encodes byte for byte. The readers and writers every shell
// keeps (the name rule, the bare-string preferences, the save's three roles) are
// web/shared/edge/prefs.ts's over the keys, the state decoder and the host save's own fields
// spelled here, grouped as the `SHELL_STORE` the shell config carries (docs/design/shared-shell.md
// §5 C2 `shellStore`). The host save's own fields are the room's terms (`Opts`: `lives`,
// `seatCount`, `bots`, `botChoice`, `watch`, the same five the welcome frame carries after
// `hostName`), between `myName` and `game` in the literal (prefs.ts `saveLiteral`: `role, code,
// myName, <Opts>, game, oppName, seatNames?, handoff?, at?`). This page's own keys beside the
// shell's: the third to sixth pass-the-phone names (the shell remembers two; a table seats six),
// the host card's last terms one bare string each (`lives`, `seats`, `bots`, `botChoice`; `watch`
// is a mode, not remembered), and `shell`, the flag M4's boot reads to pick the shell path
// (`?shell=1` writes it, `?shell=0` removes it); M6 removes the flag with the old boot.
//
// The legacy keys (`fidice-name`, `fidice-token-<code>`) are NOT read here: M4's `hooks.home`
// copies `fidice-name` into `fidice_name` when the new key is empty (the old key kept while both
// paths live) and M6 sweeps the tokens (plan §6 risk 14, §7 D5); storage.test.ts pins that a
// legacy key alone reads as no name through this module.
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
import {
  boolean,
  integer,
  literal,
  map,
  object,
  refine,
  string,
  type Decoder,
} from '../../../shared/lib/json.ts';
import type { Result } from '../../../shared/lib/result.ts';
import { decodeState } from './codec.ts';
import type { State } from './domain/types.ts';
import { MAX_BOTS, SEAT_COUNTS, type Room, type SeatCount } from './protocol.ts';

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
export { SEAT_COUNTS, MAX_BOTS, type SeatCount };

export const STORAGE_KEYS = {
  /** The game in progress: pass the phone (Solo and Watch included), or the host's table and game, or the guest's table. */
  save: 'fidiceMP_v1',
  /** The player's name, as typed (bare string, at most 20 characters; plan §7 D1). */
  name: 'fidice_name',
  /** The pass-the-phone second name, as typed (bare string, at most 20 characters). */
  p2Name: 'fidice_p2Name',
  /** The third to sixth pass-the-phone names, under the same rule (this page alone seats them). */
  p3Name: 'fidice_p3Name',
  p4Name: 'fidice_p4Name',
  p5Name: 'fidice_p5Name',
  p6Name: 'fidice_p6Name',
  /** The home tab last shown (bare string). */
  homeTab: 'fidice_homeTab',
  /** Online or pass the phone (bare string); Solo and Watch are shown, never stored (plan §7 D9). */
  playMode: 'fidice_playMode',
  /** `on` or `off` (bare string); anything but `off` counts as on. */
  sound: 'fidice_sound',
  /** The sound font (web/shared/lib/sound/fonts.ts, bare string): this game's own key (docs/design/sound-fonts.md §6). */
  soundFont: 'fidice_soundFont',
  /** The finished games this device remembers (web/shared/lib/recentGames.ts, JSON, newest first, at most 20). */
  recentGames: 'fidice_recentGames',
  /** The kayaks each the host card last chose (bare digits; `0` keeps score). */
  lives: 'fidice_lives',
  /** The chairs the host card last opened (bare digits, `2`..`6`). */
  seats: 'fidice_seats',
  /** The computers the host card last seated (bare digits, `0`..`5`). */
  bots: 'fidice_bots',
  /** The computers' strategy choice (bare string: a bots/registry.ts id, or `random`). */
  botChoice: 'fidice_botChoice',
  /**
   * The shell-path flag (plan §4 M4): `1` while this device opted into `?shell=1`. Read by main.ts
   * from M4; M6 removes the key with the old boot.
   */
  shell: 'fidice_shell',
} as const;
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Play / Rules / Ladder / About, in the composed page's order (page.ts: the Ladder tab sits in the partial's extra-tab slot, between Rules and About). */
export const HOME_TABS = ['play', 'rules', 'ladder', 'about'] as const;
export type HomeTab = (typeof HOME_TABS)[number];
export const DEFAULT_HOME_TAB: HomeTab = 'play';
export const DEFAULT_PLAY_MODE: PlayMode = 'online';

/** The room's terms: the host save's own fields, the welcome frame's room and the resume offer's (protocol.ts `Room`). */
export type Opts = Room;
/** The strategy the host card's Medium difficulty means (the legacy name form's default, src/view/ui.ts). */
export const DEFAULT_BOT_CHOICE = 'profiler';
/** The host card as the page ships it: keep score, six chairs, no computers, Medium, the host plays (page.ts `hostFields`). */
export const DEFAULT_OPTS: Opts = {
  lives: 0,
  seatCount: 6,
  bots: 0,
  botChoice: DEFAULT_BOT_CHOICE,
  watch: false,
};

/** One of three shapes by role; the keys are in the order `writeSave` emits them. */
export type LocalSave = ShellLocalSave<State>;
/** The host save's own fields, between `myName` and `game` in the literal: the room's five terms. */
export type HostExtra = Opts;
export type HostSave = ShellHostSave<State, HostExtra>;
export type GuestSave = ShellGuestSave;
export type Save = ShellSave<State, HostExtra>;

export const decodeHomeTab: Decoder<HomeTab> = literal(...HOME_TABS);

/** The five terms off a record that carries them (extra keys are ignored), in the literal's order. */
export const decodeOpts: Decoder<Opts> = object({
  lives: integer(0),
  seatCount: literal(...SEAT_COUNTS),
  bots: integer(0, MAX_BOTS),
  botChoice: string,
  watch: boolean,
});

// ---- the shell's store: the game save and the bare-string preferences every shell keeps -----

export const SHELL_STORE = shellStore<State, HostExtra, HomeTab>(STORAGE_KEYS, {
  game: 'fidice',
  decodeGame: decodeState,
  hostExtra: {
    decode: decodeOpts,
    literal: (save) => ({
      lives: save.lives,
      seatCount: save.seatCount,
      bots: save.bots,
      botChoice: save.botChoice,
      watch: save.watch,
    }),
  },
  decodeHomeTab,
});
export const { decodeSave, readSave, writeSave, clearSave } = SHELL_STORE.save;
export const { read: readName, write: writeName } = SHELL_STORE.name;
/** The pass-the-phone second name, under the same rule. */
export const { read: readP2Name, write: writeP2Name } = SHELL_STORE.p2Name;
export const { read: readHomeTab, write: writeHomeTab } = SHELL_STORE.homeTab;
export const { read: readPlayMode, write: writePlayMode } = SHELL_STORE.playMode;
export const {
  read: readSoundState,
  write: writeSoundState,
  enabled: soundEnabled,
} = SHELL_STORE.sound;
export const { read: readSoundFont, write: writeSoundFont } = SHELL_STORE.soundFont;
/** The finished games: the stored list or [], and one game put first under the cap. */
export const {
  read: readRecentGames,
  write: writeRecentGames,
  append: appendRecentGame,
} = SHELL_STORE.recentGames;

// ---- this page's own preferences -----------------------------------------------------------

/** The seats beyond the shell's two: the third to sixth players (plan §3 `Seat: 2 | 3 | 4 | 5`). */
export type ExtraSeat = 2 | 3 | 4 | 5;
/** The third to sixth pass-the-phone names, by seat (2..5), under `rememberName`'s rule. */
export const EXTRA_NAME_PREFS: Readonly<Record<ExtraSeat, TextPref<string>>> = {
  2: namePref(STORAGE_KEYS.p3Name),
  3: namePref(STORAGE_KEYS.p4Name),
  4: namePref(STORAGE_KEYS.p5Name),
  5: namePref(STORAGE_KEYS.p6Name),
};
export const { read: readP3Name, write: writeP3Name } = EXTRA_NAME_PREFS[2];
export const { read: readP4Name, write: writeP4Name } = EXTRA_NAME_PREFS[3];
export const { read: readP5Name, write: writeP5Name } = EXTRA_NAME_PREFS[4];
export const { read: readP6Name, write: writeP6Name } = EXTRA_NAME_PREFS[5];

/** A number stored as its digits (`"3"`), read back as one of `values` (the refine admits those alone, so the cast holds). */
const digitsOf = <T extends number>(values: ReadonlyArray<T>): Decoder<T> =>
  map(
    refine(
      string,
      (s) => values.some((v) => String(v) === s),
      `one of ${values.map(String).join(' | ')}`,
    ),
    (s) => Number(s) as T,
  );
/** Any non-negative integer stored as its digits. */
const digits: Decoder<number> = map(
  refine(string, (s) => /^\d{1,6}$/.test(s), 'digits'),
  (s) => Number(s),
);

export const decodeSeatCount: Decoder<SeatCount> = digitsOf(SEAT_COUNTS);
/** `0`..`5` computers. */
export const decodeBots: Decoder<number> = digitsOf(
  Array.from({ length: MAX_BOTS + 1 }, (_, i) => i),
);

/** A number is its digits in the store, so it is not a `textPref` (briscola's seat count has the same shape). */
const digitsPref = <T extends number>(key: string, decoder: Decoder<T>): TextPref<T> => ({
  read: (store) => readTextWith(store, key, decoder),
  write: (store, value) => store.writeText(key, String(value)),
});
const livesPref = digitsPref(STORAGE_KEYS.lives, digits);
const seatCountPref = digitsPref(STORAGE_KEYS.seats, decodeSeatCount);
const botsPref = digitsPref(STORAGE_KEYS.bots, decodeBots);
const botChoicePref = textPref(STORAGE_KEYS.botChoice, decodeName);

const orDefault = <T>(r: Result<T, StorageError>, fallback: T): T => (r.ok ? r.value : fallback);

/**
 * The room the host card last chose: each term under its key (the default when missing or
 * unreadable); `watch` is never stored, so a card always opens with the host playing.
 */
export const readOpts = (store: Store): Opts => ({
  lives: orDefault(livesPref.read(store), DEFAULT_OPTS.lives),
  seatCount: orDefault(seatCountPref.read(store), DEFAULT_OPTS.seatCount),
  bots: orDefault(botsPref.read(store), DEFAULT_OPTS.bots),
  botChoice: orDefault(botChoicePref.read(store), DEFAULT_OPTS.botChoice),
  watch: false,
});

/** The four keys written from a room's terms: each as its digits (the choice as is); `watch` is not written. */
export const writeOpts = (store: Store, opts: Opts): void => {
  livesPref.write(store, opts.lives);
  seatCountPref.write(store, opts.seatCount);
  botsPref.write(store, opts.bots);
  botChoicePref.write(store, opts.botChoice);
};

/** The shell-path flag (plan §4 M4): `1` means this device opted into `?shell=1`. */
const SHELL_ON = '1';
export const shellFlag = textPref(STORAGE_KEYS.shell, literal(SHELL_ON));
export const readShellFlag = (store: Store): boolean => shellFlag.read(store).ok;
export const writeShellFlag = (store: Store, on: boolean): void => {
  if (on) shellFlag.write(store, SHELL_ON);
  else store.remove(STORAGE_KEYS.shell);
};

export const ALL_KEYS: ReadonlyArray<StorageKey> = Object.values(STORAGE_KEYS);
