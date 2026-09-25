// The half of backgammon's shell config the game spells from its engine, protocol and storage
// alone (docs/design/shared-shell.md §4.3; C2): the id the room codes are made for, the default
// host name, the tabs, the two stored modes, the copy the shared flows paint (the two leave
// confirms, the room named by its host, and the sessions' three status strings the shell paints
// before a session speaks), the option codec (`{ matchLength, variant }`: the host save's own
// fields, the welcome frame's, the resume offer's, each select falling back to the shell's
// current value), the engine adapters, the frame builders, the cue memory's start and the
// shell's store. The table hooks (`rendered`, `refuse`, the per-site `reset`, pass-and-play's
// `viewer`/`revealer`) and the rest of `home` are the reducer's (ui/state.ts `BACKGAMMON`), which
// completes this record: they use its own helpers, and a value import both ways would be a cycle.
// Every literal here was ui/state.ts's before the move; the constants and helpers the tests
// import are re-exported there.
import type { ShellGameData } from '../../../shared/ui/shell.ts';
import {
  applyAction,
  createGame,
  DEFAULT_MATCH_LENGTH,
  DEFAULT_VARIANT,
  MATCH_LENGTHS,
  decodeState,
  isShippedVariant,
  matchOver,
  viewFor,
  type ShippedVariant,
} from './engine/index.ts';
import { connectingMsg } from './net/guest.ts';
import { OPENING_MSG, handoffMsg } from './net/host.ts';
import { action, lobby, state, toast } from './protocol.ts';
import {
  DEFAULT_CURTAIN_MODE,
  DEFAULT_HOME_TAB,
  DEFAULT_PLAY_MODE,
  HOME_TABS,
  SHELL_STORE,
  readCurtainMode,
  readMatchLength,
  readVariant,
  type PlayMode,
} from './storage.ts';
import { INITIAL_CUES } from './ui/sound.ts';
import type { Backgammon } from './ui/state.ts';

export const DEFAULT_NAME = 'Ari';
/**
 * The pass-and-play seats when nothing is remembered or typed (the owner, 2026-09-25:
 * "backgammon is Ari and Ethan"); the first is `#nameInput`'s markup value (DEFAULT_NAME) too,
 * since the shell's `fillName` reaches that input. tools/games.ts SHELL pins the pair for the e2e.
 */
export const LOCAL_NAMES: readonly [string, string] = ['Ari', 'Ethan'];
export const LEAVE_LOCAL_MSG = 'End this match? The score will be cleared.';
export const LEAVE_ONLINE_MSG = 'Leave this match? The room will close.';
export const hostRoomMsg = (hostName: string): string =>
  `Connected — waiting for ${hostName} to start`;

/** A match length from a select's raw value: one of MATCH_LENGTHS, else `fallback`. */
export const parseMatchLength = (raw: string | number | undefined, fallback: number): number => {
  const n = typeof raw === 'number' ? raw : parseInt(raw ?? '', 10);
  return MATCH_LENGTHS.includes(n) ? n : fallback;
};

/** A variant from a select's raw value: a shipped one, else `fallback` (plakoto and fevga are typed, not playable). */
export const parseVariant = (raw: string | undefined, fallback: ShippedVariant): ShippedVariant =>
  raw !== undefined && isShippedVariant(raw) ? raw : fallback;

export const BACKGAMMON_SHELL: ShellGameData<Backgammon> = {
  id: 'backgammon',
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
    initial: { matchLength: DEFAULT_MATCH_LENGTH, variant: DEFAULT_VARIANT },
    // The match length and variant are the shell's (set by the selects' `variant/set`/`matchLength/set`), unless the binder passes the raw select values along.
    parse: (raw, current) => ({
      matchLength: parseMatchLength(raw.matchLength, current.matchLength),
      variant: parseVariant(raw.variant, current.variant),
    }),
    ofGame: (game) => ({ matchLength: game.options.matchLength, variant: game.variant }),
    pick: (from) => ({ matchLength: from.matchLength, variant: from.variant }),
  },
  engine: {
    create: (players, { matchLength, variant }, rng, now) =>
      createGame(players, { matchLength, rotation: [variant] }, rng, now),
    apply: applyAction,
    viewFor,
    over: (view) => view.matchOver,
    finished: (game) => matchOver(game.match),
    names: (game) => [game.players[0].name, game.players[1].name],
    /** `game.players[1].name = name` on a rejoin. */
    renameGuest: (game, name) => ({
      ...game,
      players: [game.players[0], { ...game.players[1], name }],
    }),
    // `position/load` (`__backgammon.setup(state)`): the save's decoder checks the hand-made state.
    decodeState,
  },
  frames: { lobby, state, toast, action },
  cues: { initial: INITIAL_CUES },
  home: {
    // This page's own keys: the options and the curtain mode (defaults when unreadable).
    read: (store) => {
      const variant = readVariant(store);
      const length = readMatchLength(store);
      const curtain = readCurtainMode(store);
      return {
        variant: variant.ok ? variant.value : DEFAULT_VARIANT,
        matchLength: length.ok ? length.value : DEFAULT_MATCH_LENGTH,
        curtainMode: curtain.ok ? curtain.value : DEFAULT_CURTAIN_MODE,
      };
    },
  },
  prefs: SHELL_STORE,
};
