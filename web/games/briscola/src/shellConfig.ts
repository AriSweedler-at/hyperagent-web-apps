// The half of briscola's shell config the game spells from its engine, protocol and storage alone
// (docs/design/briscola.md §5.8; docs/design/shared-shell.md §4.3): the id the table codes are made
// for, the default host name, the tabs, the two stored modes, the copy the shared flows paint (the
// two leave confirms, the guest's status once the host has answered, and the sessions' three
// status strings the shell paints before a session speaks), the option codec (`GameOptions`, the
// room's six terms: the host save's own fields, the welcome frame's, the resume offer's, each raw
// select or switch falling back to the shell's current value and the whole normalised as the
// engine normalises a room), the engine adapters, the frame builders, the cue memory's start and
// the shell's store. The first game booted through the shared shell (D18): the table hooks
// (`rendered` with the settle beat and the event-driven cues, `refuse`, the per-site `reset`,
// pass-and-play's `viewer`/`revealer` over two, three or four seats) and the rest of `home` are the
// reducer's (ui/state.ts `BRISCOLA`), which completes this record; a value import both ways would
// be a cycle. Online is two-seat in this PR (D16): the shell's `host/deal` seats the host and its
// one guest through `create` over a pair, and the N-seat lobby is PR-5's.
import type { ShellGameData } from '../../../shared/ui/shell.ts';
import { connectingMsg } from '../../../shared/net/guest.ts';
import { OPENING_MSG, handoffMsg } from '../../../shared/net/host.ts';
import {
  GAMES_TO_WIN,
  SEAT_COUNTS,
  SUITS,
  applyAction,
  createGame,
  decodeState,
  matchOver,
  nameOf,
  normaliseOptions,
  viewFor,
  type GameOptions,
  type GamesToWin,
  type SeatCount,
  type Suit,
} from './engine/index.ts';
import { action, lobby, state, toast } from './protocol.ts';
import {
  DEFAULT_CARD_PACK,
  DEFAULT_HOME_TAB,
  DEFAULT_OPTS,
  DEFAULT_PLAY_MODE,
  HOME_TABS,
  SHELL_STORE,
  readCardPack,
  readOpts,
  readP3Name,
  readP4Name,
  type PlayMode,
} from './storage.ts';
import { INITIAL_CUES } from './ui/sound.ts';
import type { Briscola, Raw } from './ui/state.ts';

export type Opts = GameOptions;
export { DEFAULT_OPTS };

export const DEFAULT_NAME = 'Ari';
export const LEAVE_LOCAL_MSG = 'End this game? The score will be cleared.';
export const LEAVE_ONLINE_MSG = 'Leave this match? The table will close.';
/** `#guestWaitStatus` once the host's lobby frame names the room (tools/games.ts SHELL `hostAnswered` pins the shape). */
export const hostRoomMsg = (hostName: string): string =>
  `Connected — waiting for ${hostName} to deal`;

/** The match badge's words for a target (D7): one game, or the best of 2n − 1. */
export const matchLabel = (gamesToWin: GamesToWin): string =>
  gamesToWin === 1 ? 'one game' : `best of ${String(gamesToWin * 2 - 1)}`;

/** A seat count from a select's raw value (`"3"`), else `fallback`. */
export const parseSeatCount = (raw: string | undefined, fallback: SeatCount): SeatCount =>
  SEAT_COUNTS.find((n) => String(n) === raw) ?? fallback;
/** The games to win from a select's raw value (`"2"` is best of three), else `fallback`. */
export const parseGamesToWin = (raw: string | undefined, fallback: GamesToWin): GamesToWin =>
  GAMES_TO_WIN.find((n) => String(n) === raw) ?? fallback;
/** A suit letter from a select's raw value, else `fallback`. */
export const parseSuit = (raw: string | undefined, fallback: Suit): Suit =>
  SUITS.find((s) => s === raw) ?? fallback;
/** A house rule from a switch's raw value: `on` (or `true`) is on, any other string off, absent keeps `fallback`. */
export const parseFlag = (raw: string | undefined, fallback: boolean): boolean =>
  raw === undefined ? fallback : raw === 'on' || raw === 'true';

/**
 * The room's terms off the raw inputs (`Raw`): the Online selects or their pass-and-play twins,
 * whichever the click carried, each falling back to the shell's current value; normalised so the
 * two-player-only and four-player-only rules never store true elsewhere (E15, E16).
 */
export const parseOpts = (raw: Raw, current: GameOptions): GameOptions =>
  normaliseOptions(parseSeatCount(raw.players ?? raw.localPlayers, current.seatCount), {
    gamesToWin: parseGamesToWin(raw.match ?? raw.localMatch, current.gamesToWin),
    removedTwo: parseSuit(raw.removedTwo ?? raw.localRemovedTwo, current.removedTwo),
    exchange: parseFlag(raw.exchange ?? raw.localExchange, current.exchange),
    scoperta: parseFlag(raw.scoperta ?? raw.localScoperta, current.scoperta),
    partnerPeek: parseFlag(raw.partnerPeek ?? raw.localPartnerPeek, current.partnerPeek),
  });

/** The six option fields alone off a record that carries them (a welcome frame, a save, an offer), normalised. */
export const pickOpts = (from: GameOptions): GameOptions =>
  normaliseOptions(from.seatCount, {
    gamesToWin: from.gamesToWin,
    removedTwo: from.removedTwo,
    exchange: from.exchange,
    scoperta: from.scoperta,
    partnerPeek: from.partnerPeek,
  });

export const BRISCOLA_SHELL: ShellGameData<Briscola> = {
  id: 'briscola',
  names: { default: DEFAULT_NAME },
  tabs: { list: HOME_TABS, default: DEFAULT_HOME_TAB },
  modes: {
    default: DEFAULT_PLAY_MODE,
    parse: (raw) => {
      const mode: PlayMode = raw === 'local' ? 'local' : 'online';
      return { shown: mode, stored: mode };
    },
  },
  copy: {
    leaveLocal: LEAVE_LOCAL_MSG,
    leaveOnline: LEAVE_ONLINE_MSG,
    opening: OPENING_MSG,
    connecting: connectingMsg,
    handoff: handoffMsg,
    hostRoom: (hostName) => hostRoomMsg(hostName),
  },
  opts: {
    initial: DEFAULT_OPTS,
    parse: parseOpts,
    ofGame: (game) => game.options,
    pick: pickOpts,
  },
  engine: {
    // A pair is one of the engine's `Players` tuples (D1): the two-seat shell deals as gin's does.
    create: (players, opts, rng, now) => createGame(players, opts, rng, now),
    apply: applyAction,
    viewFor,
    /** `position/load` (`window.__briscola.setup`): the save's decoder, E20's invariants refined. */
    decodeState,
    over: (view) => view.matchOver,
    finished: (game) => matchOver(game.match),
    names: (game) => [nameOf(game.players, 0), nameOf(game.players, 1)],
    /** `game.players[1].name = name` on a rejoin. */
    renameGuest: (game, name) => ({
      ...game,
      players: game.players.map((p, i) => (i === 1 ? { ...p, name } : p)),
    }),
  },
  frames: { lobby, state, toast, action },
  cues: { initial: INITIAL_CUES },
  home: {
    // This page's own keys: the six options (defaults when unreadable), the card pack, the third and fourth names.
    read: (store) => {
      const pack = readCardPack(store);
      const p3 = readP3Name(store);
      const p4 = readP4Name(store);
      return {
        opts: readOpts(store),
        cardPack: pack.ok ? pack.value : DEFAULT_CARD_PACK,
        p3Name: p3.ok ? p3.value : null,
        p4Name: p4.ok ? p4.value : null,
      };
    },
  },
  prefs: SHELL_STORE,
};
