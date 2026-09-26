// The preferences and the game save every shell keeps (docs/design/shared-shell.md §4.1
// `edge/prefs.ts`, §5 A3): gin's storage.ts helpers moved here as they were, with the four things
// the two games' copies disagreed on injected: the key, the game whose room codes the save's `code`
// must be well formed for, the engine's `State` decoder and the host save's own fields. Each game's
// storage.ts still names its keys (docs/ARCHITECTURE.md "Module boundaries": only that module
// does) and builds its readers and writers from these, so the strings a page wrote before this
// file existed are the strings it writes after it: the decoders are the same decoders, and the
// host literal keeps `saveLiteral`'s order `role, code, myName, <extra>, game, oppName, handoff?`
// (test/parity/gin.storage.test.ts round-trips the legacy captures byte for byte; both games'
// storage.test.ts pin the literals). `shellStore` (§5 C2) groups the readers and writers the shell
// reducer needs over a game's keys, the object its `ShellConfig.prefs` carries. An edge because it
// takes a `Store` (./storage.ts); nothing here touches the browser itself, so prefs.test.ts runs it
// over a Map.
import {
  arrayOf,
  formatError,
  literal,
  nullable,
  number,
  object,
  optional,
  refine,
  string,
  taggedUnion,
  type Decoder,
} from '../lib/json.ts';
import { err, ok, type Result } from '../lib/result.ts';
import { packsFor, type CardPackFor } from '../lib/cards/packs.ts';
import type { DeckKind } from '../lib/cards/decks.ts';
import { appendCapped, decodeRecentGames, type RecentGame } from '../lib/recentGames.ts';
import { ROOM_CODE, isWellFormedCode, type Game } from '../lib/roomCode.ts';
import { LANGUAGE_PACKS, type LanguagePackName } from '../lib/lang/packs.ts';
import { SOUND_FONTS, type SoundFontName } from '../lib/sound/fonts.ts';
import type { StorageError, Store } from './storage.ts';

export const PLAY_MODES = ['online', 'local'] as const;
export type PlayMode = (typeof PLAY_MODES)[number];
export const SOUND_STATES = ['on', 'off'] as const;
export type SoundState = (typeof SOUND_STATES)[number];
/** `rememberName` sliced what it stored to this many characters (the wire cap too). */
export const NAME_MAX = 20;

/** `if (savedName)`: the legacy treated an empty string as no name. */
export const decodeName: Decoder<string> = refine(string, (s) => s !== '', 'a non-empty name');
export const decodePlayMode: Decoder<PlayMode> = literal(...PLAY_MODES);
export const decodeSoundState: Decoder<SoundState> = literal(...SOUND_STATES);
export const decodeSoundFont: Decoder<SoundFontName> = literal(...SOUND_FONTS);
/**
 * The card pack a game with this deck kind may store (docs/design/card-packs.md §2): one of
 * `packsFor(kind)`, so a stored `linea` is refused under gin's key and accepted under briscola's.
 */
export const decodeCardPackFor = <K extends DeckKind>(kind: K): Decoder<CardPackFor<K>> =>
  literal(...packsFor(kind));
/** The language pack a game names its cards in (docs/design/language-packs.md §3): one of the shared packs. */
export const decodeLanguagePack: Decoder<LanguagePackName> = literal(...LANGUAGE_PACKS);

const invalid = (key: string, error: Parameters<typeof formatError>[0]): StorageError => ({
  kind: 'invalid',
  key,
  reason: formatError(error),
});

/** A bare-string key through its decoder. */
export const readTextWith = <T>(
  store: Store,
  key: string,
  decoder: Decoder<T>,
): Result<T, StorageError> => {
  const text = store.readText(key);
  if (!text.ok) return text;
  const decoded = decoder(text.value);
  return decoded.ok ? decoded : err(invalid(key, decoded.error));
};

// ---- the bare-string preferences -----------------------------------------------------------

/** A preference under one key: `read` runs its decoder, `write` stores the value as is. */
export type TextPref<T> = Readonly<{
  read: (store: Store) => Result<T, StorageError>;
  write: (store: Store, value: T) => Result<null, StorageError>;
}>;

export const textPref = <T extends string>(key: string, decoder: Decoder<T>): TextPref<T> => ({
  read: (store) => readTextWith(store, key, decoder),
  write: (store, value) => store.writeText(key, value),
});

/** `rememberName`: an empty name removes the key, anything else is stored cut to NAME_MAX. */
export const namePref = (key: string): TextPref<string> => ({
  read: (store) => readTextWith(store, key, decodeName),
  write: (store, name) =>
    name === '' ? store.remove(key) : store.writeText(key, name.slice(0, NAME_MAX)),
});

/** A game's card-pack preference under its own key, validated for its deck kind like the sound font. */
export const cardPackPref = <K extends DeckKind>(key: string, kind: K): TextPref<CardPackFor<K>> =>
  textPref(key, decodeCardPackFor(kind));

export type LangPref = TextPref<LanguagePackName> &
  Readonly<{
    /** The stored pack, or the game's default when the key is missing or unreadable (the read never logs). */
    orDefault: (store: Store) => LanguagePackName;
  }>;

/** A game's language-pack preference under its own key, with the game's default beside the reader (docs/design/language-packs.md §3). */
export const langPref = (key: string, defaultName: LanguagePackName): LangPref => {
  const pref = textPref(key, decodeLanguagePack);
  return {
    ...pref,
    orDefault: (store) => {
      const stored = pref.read(store);
      return stored.ok ? stored.value : defaultName;
    },
  };
};

export type SoundPref = TextPref<SoundState> &
  Readonly<{
    /**
     * `safeGet(FX_KEY) !== 'off'`: on unless the key says off (missing or unreadable counts as
     * on). `fallback` is what a missing or unreadable key counts as instead: the boot passes
     * `false` on a touch device (docs/design/sound-fonts.md §12), where sound starts muted and the
     * tap on the speaker is the gesture that unlocks it; a remembered `on` or `off` always wins.
     */
    enabled: (store: Store, fallback?: boolean) => boolean;
  }>;

export const soundPref = (key: string): SoundPref => {
  const pref = textPref(key, decodeSoundState);
  return {
    ...pref,
    enabled: (store, fallback = true) => {
      const state = pref.read(store);
      return state.ok ? state.value === 'on' : fallback;
    },
  };
};

// ---- the finished games ----------------------------------------------------------------------

/**
 * The finished games a device remembers (web/shared/lib/recentGames.ts, the owner's "save up to 20
 * games of history in browser storage"), as JSON under one key: `read` is the stored list or []
 * (a missing, unreadable or foreign value reads as none: a record is a convenience, never a
 * save), `write` stores a list as is, `append` puts one finished game first and keeps the newest
 * `RECENT_GAMES_CAP`, re-reading the store so a second tab's records are kept too.
 */
export type RecentGamesPref = Readonly<{
  read: (store: Store) => ReadonlyArray<RecentGame>;
  write: (store: Store, games: ReadonlyArray<RecentGame>) => Result<null, StorageError>;
  append: (store: Store, game: RecentGame) => Result<null, StorageError>;
}>;

export const recentGamesPref = (key: string): RecentGamesPref => {
  const read = (store: Store): ReadonlyArray<RecentGame> => {
    const stored = store.readJson(key, decodeRecentGames);
    return stored.ok ? stored.value : [];
  };
  const write = (store: Store, games: ReadonlyArray<RecentGame>): Result<null, StorageError> =>
    store.writeJson(key, games);
  return {
    read,
    write,
    append: (store, game) => write(store, appendCapped(read(store), game)),
  };
};

// ---- the game save ---------------------------------------------------------------------------

/** `persist()` writes one of three shapes by role; the keys are in the legacy literals' order. */
export type LocalSave<S> = Readonly<{ role: 'local'; game: S }>;
export type HostSave<S, X extends object> = Readonly<{
  role: 'host';
  code: string;
  myName: string;
}> &
  Readonly<X> &
  Readonly<{
    /** null while the room waits for its first guest. */
    game: S | null;
    oppName: string | null;
    /**
     * Every guest seat's name in seat order, for a room of more than two seats
     * (docs/design/n-seat-sessions.md §7: a resume reseats each guest by name). Written only when
     * the shell has more than one seat, so every two-seat save keeps the legacy literal byte for byte.
     */
    seatNames?: ReadonlyArray<string | null>;
    /**
     * The game came from pass-and-play (the shell's `handoff`) and its remote seat has not
     * joined: a reload resumes the offer, and cancelling gives the game back to pass-and-play.
     * Written only when true, so every other host save keeps the legacy literal byte for byte.
     */
    handoff?: true;
    /**
     * When this device opened (or reopened) the room, ms since the epoch: written only while the
     * room waits for its first guest (`game` null; docs/design/lobby-resume.md D1), so a reload
     * within WAITING_RESUME_MS resumes the lobby by itself and an older one is offered. A save
     * with a game never carries it, so every mid-game literal is the legacy one byte for byte.
     */
    at?: number;
  }>;
export type GuestSave = Readonly<{ role: 'guest'; code: string; myName: string }>;
export type Save<S, X extends object> = LocalSave<S> | HostSave<S, X> | GuestSave;

export type ShellSave<S, X extends object> = Readonly<{
  decodeSave: Decoder<Save<S, X>>;
  readSave: (store: Store) => Result<Save<S, X>, StorageError>;
  writeSave: (store: Store, save: Save<S, X>) => Result<null, StorageError>;
  clearSave: (store: Store) => Result<null, StorageError>;
}>;

/**
 * The save's decoders, reader, writer and remover over a game's engine. `hostExtra` is the host
 * save's own fields between `myName` and `game` (gin's `target`, backgammon's `matchLength` and
 * `variant`): `decode` reads them off the stored object, `literal` picks them off a save in the
 * order they are written, so the game spells its fields once in each direction and the shared
 * literal around them never changes.
 */
export const shellSave = <S, X extends object>(
  cfg: Readonly<{
    /** The key the save lives under (the game's `STORAGE_KEYS.save`). */
    key: string;
    /** Whose room codes `code` must be well formed for (web/shared/lib/roomCode.ts). */
    game: Game;
    /** The engine's `State` decoder, in its literal key order. */
    decodeGame: Decoder<S>;
    hostExtra: Readonly<{ decode: Decoder<X>; literal: (save: HostSave<S, X>) => X }>;
  }>,
): ShellSave<S, X> => {
  // The legacy message spelled the length ("a 4-letter room code"); both games' codes are 4 letters.
  const roomCode = refine(
    string,
    (code) => isWellFormedCode(cfg.game, code),
    `a ${String(ROOM_CODE[cfg.game].length)}-letter room code`,
  );
  // `object`'s Shape cannot be resolved over a type parameter (whether `undefined extends S` is
  // deferred), so the two decoders holding the game state are asserted to the shapes they spell.
  const localSave = object({
    role: literal('local'),
    game: cfg.decodeGame,
  }) as Decoder<LocalSave<S>>;
  // The host object in three parts in the literal's order, so the first failing field is the one
  // a single `object` over all of them would have reported.
  const hostHead = object({ role: literal('host'), code: roomCode, myName: string });
  const hostTail = object({
    game: nullable(cfg.decodeGame),
    oppName: nullable(string),
    seatNames: optional(arrayOf(nullable(string))),
    handoff: optional(literal(true)),
    at: optional(number),
  }) as Decoder<
    Readonly<{
      game: S | null;
      oppName: string | null;
      seatNames?: ReadonlyArray<string | null>;
      handoff?: true;
      at?: number;
    }>
  >;
  const hostSave: Decoder<HostSave<S, X>> = (input) => {
    const head = hostHead(input);
    if (!head.ok) return head;
    const extra = cfg.hostExtra.decode(input);
    if (!extra.ok) return extra;
    const tail = hostTail(input);
    if (!tail.ok) return tail;
    return ok({ ...head.value, ...extra.value, ...tail.value });
  };
  const guestSave: Decoder<GuestSave> = object({
    role: literal('guest'),
    code: roomCode,
    myName: string,
  });

  // The three shapes by role in the legacy literals' order, so a refused role names them as before.
  const decodeSave: Decoder<Save<S, X>> = taggedUnion('role', {
    local: localSave,
    host: hostSave,
    guest: guestSave,
  });

  /** The `persist()` literal for a save, key for key, whatever order the caller's object had. */
  const saveLiteral = (save: Save<S, X>): Save<S, X> => {
    switch (save.role) {
      case 'local':
        return { role: 'local', game: save.game };
      case 'host':
        return {
          role: 'host',
          code: save.code,
          myName: save.myName,
          ...cfg.hostExtra.literal(save),
          game: save.game,
          oppName: save.oppName,
          ...(save.seatNames === undefined ? {} : { seatNames: save.seatNames }),
          ...(save.handoff === true ? { handoff: true } : {}),
          ...(save.at === undefined ? {} : { at: save.at }),
        };
      case 'guest':
        return { role: 'guest', code: save.code, myName: save.myName };
    }
  };

  return {
    decodeSave,
    readSave: (store) => store.readJson(cfg.key, decodeSave),
    writeSave: (store, save) => store.writeJson(cfg.key, saveLiteral(save)),
    clearSave: (store) => store.remove(cfg.key),
  };
};

// ---- the shell's store -----------------------------------------------------------------------

/** The keys every shell keeps, as a game's `STORAGE_KEYS` names them (its own keys sit beside these). */
export type ShellKeys = Readonly<{
  save: string;
  name: string;
  p2Name: string;
  homeTab: string;
  playMode: string;
  sound: string;
  soundFont: string;
  /** The finished games (`<game>_recentGames`, JSON; web/shared/lib/recentGames.ts). */
  recentGames: string;
}>;

/** The shell's readers and writers over one game's keys: what `web/shared/ui/shell.ts` reads `initHome` from and `shellEffects.ts` writes the effects through. */
export type ShellStore<S, X extends object, Tab extends string> = Readonly<{
  name: TextPref<string>;
  /** The pass-and-play second name, under `rememberName`'s rule; the legacy never stored it. */
  p2Name: TextPref<string>;
  homeTab: TextPref<Tab>;
  playMode: TextPref<PlayMode>;
  sound: SoundPref;
  soundFont: TextPref<SoundFontName>;
  /** The finished games, newest first, at most RECENT_GAMES_CAP (the `recordGame` effect appends). */
  recentGames: RecentGamesPref;
  save: ShellSave<S, X>;
}>;

/**
 * The shell's store for a game: the seven preferences, the finished games and the save, each over
 * the game's own key, so a game's storage.ts spells its keys once and destructures its
 * `readName`/`writeName`/… from here (docs/design/shared-shell.md §5 C2 "shellStore/shellKeys onto
 * prefs.ts").
 */
export const shellStore = <S, X extends object, Tab extends string>(
  keys: ShellKeys,
  cfg: Readonly<{
    game: Game;
    decodeGame: Decoder<S>;
    hostExtra: Readonly<{ decode: Decoder<X>; literal: (save: HostSave<S, X>) => X }>;
    decodeHomeTab: Decoder<Tab>;
  }>,
): ShellStore<S, X, Tab> => ({
  name: namePref(keys.name),
  p2Name: namePref(keys.p2Name),
  homeTab: textPref(keys.homeTab, cfg.decodeHomeTab),
  playMode: textPref(keys.playMode, decodePlayMode),
  sound: soundPref(keys.sound),
  soundFont: textPref(keys.soundFont, decodeSoundFont),
  recentGames: recentGamesPref(keys.recentGames),
  save: shellSave({
    key: keys.save,
    game: cfg.game,
    decodeGame: cfg.decodeGame,
    hostExtra: cfg.hostExtra,
  }),
});
