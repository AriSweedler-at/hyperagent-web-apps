// The half of gin's shell config the game spells from its engine, protocol and storage alone
// (docs/design/shared-shell.md §4.3; C2): the id the room codes are made for, the default host
// name, the tabs, the modes (the sandbox shown while the first player is named `sandbox`, never
// stored), the copy the shared flows paint (the two leave confirms, the room named with its
// target, and the sessions' three status strings the shell paints before a session speaks), the
// option codec (`{ target }`: the host save's own field, the welcome frame's, the resume offer's),
// the engine adapters, the frame builders, the cue memory's start and the shell's store. The
// table hooks (`rendered`, `refuse`, the per-site `reset`, pass-and-play's `viewer`/`revealer`)
// and the rest of `home` are the reducer's (ui/state.ts `GIN`), which completes this record: they
// use its own helpers, and a value import both ways would be a cycle. Every literal here was
// ui/state.ts's before the move; the constants and helpers the tests import are re-exported there.
import type { ShellGameData } from '../../../shared/ui/shell.ts';
import { applyAction, createGame, viewFor } from './engine/index.ts';
import { connectingMsg } from './net/guest.ts';
import { OPENING_MSG, handoffMsg } from './net/host.ts';
import { action, lobby, state, toast } from './protocol.ts';
import { unlocksSandbox } from './sandbox.ts';
import {
  DEFAULT_CARD_BACK,
  DEFAULT_HOME_TAB,
  DEFAULT_PLAY_MODE,
  DEFAULT_SORT,
  HOME_TABS,
  SHELL_STORE,
  readCardBack,
  readScorerState,
  readSort,
  type PlayMode as StoredPlayMode,
} from './storage.ts';
import { INITIAL_CUES } from './ui/cues.ts';
import type { Gin } from './ui/state.ts';

export const DEFAULT_NAME = 'Ari';
export const DEFAULT_TARGET = 100;
export const LEAVE_LOCAL_MSG = 'End this game? Scores will be cleared.';
export const LEAVE_ONLINE_MSG = 'Leave this game? The room will close.';
export const hostRoomMsg = (hostName: string, target: number): string =>
  `Connected to ${hostName}'s room (playing to ${String(target)}). Waiting for the host to start…`;

/** `parseInt(v, 10)`, falling back to 100 unless a positive integer. */
export const parseTarget = (raw: string): number => {
  const t = parseInt(raw, 10);
  return !Number.isNaN(t) && t > 0 ? t : DEFAULT_TARGET;
};

export const GIN_SHELL: ShellGameData<Gin> = {
  id: 'gin-rummy',
  names: { default: DEFAULT_NAME },
  tabs: { list: HOME_TABS, default: DEFAULT_HOME_TAB },
  modes: {
    default: DEFAULT_PLAY_MODE,
    parse: (raw, shell) => {
      // The sandbox is shown, never stored: a reload lands on the stored mode.
      if (raw === 'sandbox')
        return unlocksSandbox(shell.p1Name) ? { shown: 'sandbox', stored: null } : null;
      const mode: StoredPlayMode = raw === 'local' ? 'local' : 'online';
      return { shown: mode, stored: mode };
    },
  },
  copy: {
    leaveLocal: LEAVE_LOCAL_MSG,
    leaveOnline: LEAVE_ONLINE_MSG,
    opening: OPENING_MSG,
    connecting: connectingMsg,
    handoff: handoffMsg,
    hostRoom: (hostName, opts) => hostRoomMsg(hostName, opts.target),
  },
  opts: {
    initial: { target: DEFAULT_TARGET },
    // A bad target is 100, never the shell's (the legacy `parseTarget`).
    parse: (raw) => ({ target: parseTarget(raw.target) }),
    ofGame: (game) => ({ target: game.target }),
    pick: (from) => ({ target: from.target }),
  },
  engine: {
    create: (players, { target }, rng, now) => createGame({ players, target }, rng, now),
    apply: applyAction,
    viewFor,
    over: (view) => view.phase === 'gameOver',
    finished: (game) => game.phase === 'gameOver',
    names: (game) => [game.players[0].name, game.players[1].name],
    /** `app.game.players[1].name = name` on a rejoin. */
    renameGuest: (game, name) => ({
      ...game,
      players: [game.players[0], { ...game.players[1], name }],
    }),
  },
  frames: { lobby, state, toast, action },
  cues: { initial: INITIAL_CUES },
  home: {
    // This page's own keys (defaults when unreadable; main.ts logs a bad card back), and the Score Counter's session.
    read: (store) => {
      const sort = readSort(store);
      const back = readCardBack(store);
      const scorer = readScorerState(store);
      return {
        sort: sort.ok ? sort.value : DEFAULT_SORT,
        cardBack: back.ok ? back.value : DEFAULT_CARD_BACK,
        scorer: scorer.ok ? scorer.value : null,
      };
    },
  },
  prefs: SHELL_STORE,
};
