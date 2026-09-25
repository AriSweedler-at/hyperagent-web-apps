// The half of briscola's shell config the game spells from its engine, protocol and storage alone
// (docs/design/briscola.md §5.8; docs/design/shared-shell.md §4.3): the id the table codes are made
// for, the default host name, the tabs, the two stored modes, the copy the shared flows paint (the
// two leave confirms, the guest's status once the host has answered, and the sessions' three
// status strings the shell paints before a session speaks), the option codec (`GameOptions`, the
// room's six terms: the host save's own fields, the welcome frame's, the resume offer's; the home
// screen sets the seat count alone, the rest are the fixed `TABLE_TERMS`, and the whole is
// normalised as the engine normalises a room), the engine adapters, the frame builders, the cue
// memory's start and the shell's store. The first game booted through the shared shell (D18): the table hooks
// (`rendered` with the settle beat and the event-driven cues, `refuse`, the per-site `reset`,
// pass-and-play's `viewer`/`revealer` over two, three or four seats) and the rest of `home` are the
// reducer's (ui/state.ts `BRISCOLA`), which completes this record; a value import both ways would
// be a cycle. Online is two-seat in this PR (D16): the shell's `host/deal` seats the host and its
// one guest through `create` over a pair, and the N-seat lobby is PR-5's.
import type { ShellGameData } from '../../../shared/ui/shell.ts';
import { connectingMsg } from '../../../shared/net/guest.ts';
import { OPENING_MSG, handoffMsg } from '../../../shared/net/host.ts';
import {
  SEAT_COUNTS,
  applyAction,
  createGame,
  decodeState,
  nameOf,
  normaliseOptions,
  viewFor,
  type GameOptions,
  type SeatCount,
} from './engine/index.ts';
import { action, lobby, state, toast } from './protocol.ts';
import {
  DEFAULT_CARD_PACK,
  DEFAULT_HOME_TAB,
  DEFAULT_OPTS,
  DEFAULT_PLAY_MODE,
  HOME_TABS,
  LANG_PREF,
  ONE_GAME,
  SHELL_STORE,
  TABLE_TERMS,
  readCardPack,
  readOpts,
  readP3Name,
  readP4Name,
  type PlayMode,
} from './storage.ts';
import { INITIAL_CUES } from './ui/sound.ts';
import type { Briscola, Raw } from './ui/state.ts';

export type Opts = GameOptions;
export { DEFAULT_OPTS, ONE_GAME, TABLE_TERMS };

export const DEFAULT_NAME = 'Ari';
/**
 * The four pass-and-play seats when nothing is remembered or typed (the owner, 2026-09-25:
 * "briscola is Ari and Lavi (with p3 Sandro and p4 Grant)"); the first is `#nameInput`'s markup
 * value (DEFAULT_NAME) too, since the shell's `fillName` reaches that input. The first two are
 * tools/games.ts SHELL's `localNames` for the e2e; ui/home.ts paints the third and fourth.
 */
export const LOCAL_NAMES: ReadonlyArray<string> = ['Ari', 'Lavi', 'Sandro', 'Grant'];
export const LEAVE_LOCAL_MSG = 'End this game? The score will be cleared.';
export const LEAVE_ONLINE_MSG = 'Leave this game? The table will close.';
/** `#guestWaitStatus` once the host's lobby frame names the room (tools/games.ts SHELL `hostAnswered` pins the shape). */
export const hostRoomMsg = (hostName: string): string =>
  `Connected — waiting for ${hostName} to deal`;

/** A seat count from a select's raw value (`"3"`), else `fallback`. */
export const parseSeatCount = (raw: string | undefined, fallback: SeatCount): SeatCount =>
  SEAT_COUNTS.find((n) => String(n) === raw) ?? fallback;

/**
 * The room's terms off the raw inputs (`Raw`): the seat count from the Online select or its
 * pass-and-play twin, whichever the click carried, falling back to the shell's current count; the
 * rest are the fixed `TABLE_TERMS` (one game, the house rules at their defaults), whatever the
 * current room carried (a resumed save may still hold a match), normalised as the engine
 * normalises a room (E15, E16).
 */
export const parseOpts = (raw: Raw, current: GameOptions): GameOptions =>
  normaliseOptions(parseSeatCount(raw.players ?? raw.localPlayers, current.seatCount), TABLE_TERMS);

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
  localNames: LOCAL_NAMES,
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
    // One game per sitting (the owner, 2026-09-25): a game is over when its last trick is played,
    // decided or drawn; the engine's match runs on underneath (a save from before may hold one).
    over: (view) => view.phase === 'over',
    finished: (game) => game.phase === 'over',
    names: (game) => [nameOf(game.players, 0), nameOf(game.players, 1)],
    /** `game.players[1].name = name` on a rejoin. */
    renameGuest: (game, name) => ({
      ...game,
      players: game.players.map((p, i) => (i === 1 ? { ...p, name } : p)),
    }),
  },
  // The finished game's record (the owner, 2026-09-25): a game is its deal's clock (Play again
  // deals under a new one), every seat's name, its score the points per side ("71–49", "60–60"),
  // its victor the side the result names (null for a draw): side 0 is seat 0's (and seat 2's) in
  // every seat count, so the outcome for the device's user reads off it as off a seat.
  result: {
    keyOf: (view) => String(view.startedAt),
    playersOf: (view) => view.players.map((p) => p.name),
    scoreOf: (view) => (view.result?.totals ?? view.sides).map(String).join('–'),
    winnerOf: (view) => view.result?.winner ?? null,
  },
  frames: { lobby, state, toast, action },
  cues: { initial: INITIAL_CUES },
  home: {
    // This page's own keys: the seat count (the default when unreadable) on the fixed terms, the card pack, the language pack, the third and fourth names.
    read: (store) => {
      const pack = readCardPack(store);
      const p3 = readP3Name(store);
      const p4 = readP4Name(store);
      return {
        opts: readOpts(store),
        cardPack: pack.ok ? pack.value : DEFAULT_CARD_PACK,
        lang: LANG_PREF.orDefault(store),
        p3Name: p3.ok ? p3.value : null,
        p4Name: p4.ok ? p4.value : null,
      };
    },
  },
  prefs: SHELL_STORE,
};
