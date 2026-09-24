// The boot helpers both shell main.ts files spelled line for line (docs/design/shared-shell.md
// §4.5 `boot.ts`; §5 B3 moved them out of gin's main.ts and backgammon's): the invite link a page
// reads once its home screen is up, the share chain behind `#shareCodeBtn`, and the adapters that
// turn a session's events into the reducer's intents. Under web/shared/edge rather than the
// web/shared/ui the plan lists (§4.1 leaves the folder to this PR) because the three reach past the
// ui zone's contract (web/shared/lib, the DOM edge and the clock fake, eslint.config.js zones): the
// invite readers (invite.ts), the share sheet (share.ts), the wake lock's type (fx.ts) and the
// sessions' event types (web/shared/net). Each takes the page's objects injected (`location` and
// `history`, `navigator`), so boot.test.ts drives them over fakes and main.ts passes the real ones;
// `bootShell(cfg)` (§5 C3) lands beside them.
import type { WakeLock } from './fx.ts';
import { joinCodeFrom, withoutJoin } from './invite.ts';
import { shareText, type ShareNavigatorLike } from './share.ts';
import { inviteUrl } from '../lib/invite.ts';
import type { GuestEvents } from '../net/guest.ts';
import type { HostEvents } from '../net/host.ts';
import type { Toast } from '../ui/toast.ts';

// ---- the invite link ------------------------------------------------------------------------

/** The page's `location` and `history`, as `applyInviteLink` reads and rewrites them. */
export type InviteWindowLike = Readonly<{
  location: Readonly<{ search: string; pathname: string; hash: string }>;
  history: Readonly<{ replaceState: (data: null, unused: string, url: string) => void }>;
}>;

/**
 * An invite link (`?join=<code>`, docs/ARCHITECTURE.md "Documented test hooks"): the code goes
 * into the join form once the home screen is up and leaves the address bar, so a reload or a
 * bookmark of this page lands on the ordinary home screen (the other hooks, `?peer=` and
 * `?ice=`, stay). main.ts calls it right after `home/init`; `joinByLink` is its `join/link`.
 */
export const applyInviteLink = (
  win: InviteWindowLike,
  joinByLink: (code: string) => void,
): void => {
  const { location, history } = win;
  const join = joinCodeFrom(location.search);
  if (join !== null) {
    joinByLink(join);
    const query = withoutJoin(location.search);
    history.replaceState(
      null,
      '',
      `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`,
    );
  }
};

// ---- the share chain ------------------------------------------------------------------------

export const INVITE_COPIED_MSG = 'Invite copied to clipboard';
/** `shareText`'s last resort: the code itself, for the player to read out. */
export const roomCodeMsg = (code: string): string => `Room code: ${code}`;
/** `shareCodeBtn`'s fallback toast lasts this long. */
export const SHARE_FALLBACK_MS = 4000;

export type ShareInviteOptions = Readonly<{
  /** The share sheet's title: the game's name as its legacy page spelled it. */
  title: string;
  code: string;
  /** The page's origin and path (`${location.origin}${location.pathname}`), the invite's base. */
  pageUrl: string;
  toast: Toast;
}>;

/**
 * The legacy handler's chain: the share sheet (a phone's OS menu), else the clipboard with a
 * toast (desktop), else the code itself. The invite is the link alone (`?join=<code>` on the
 * page's origin and path, so a fragment on this page never lands in it): no text beside it.
 */
export const shareInvite = (nav: ShareNavigatorLike, o: ShareInviteOptions): Promise<void> =>
  shareText(nav, { title: o.title, url: inviteUrl(o.code, o.pageUrl) }).then((outcome) => {
    if (outcome === 'copied') o.toast(INVITE_COPIED_MSG, null);
    else if (outcome === 'failed') o.toast(roomCodeMsg(o.code), SHARE_FALLBACK_MS);
  });

// ---- the sessions' events -------------------------------------------------------------------

/**
 * The intents a session raises: the same nine members of both games' `Intent` unions
 * (ui/state.ts), over the game's guest frame `G` and host frame `H`. A game's `dispatch` takes its
 * whole union, so it fits here as it is.
 */
export type SessionIntent<G, H> =
  | Readonly<{ type: 'host/status'; text: string; stopPulse: boolean }>
  | Readonly<{ type: 'host/start'; code: string | null }>
  | Readonly<{ type: 'host/frame'; frame: G }>
  | Readonly<{ type: 'host/guestGone'; iceFailed: string | null }>
  | Readonly<{ type: 'guest/status'; text: string; stopPulse: boolean }>
  | Readonly<{ type: 'guest/connected' }>
  | Readonly<{ type: 'guest/frame'; frame: H }>
  | Readonly<{ type: 'guest/lost' }>
  | Readonly<{ type: 'persist' }>;

export type SessionEventDeps<G, H> = Readonly<{
  dispatch: (intent: SessionIntent<G, H>) => void;
  toast: Toast;
  wakeLock: Pick<WakeLock, 'hold'>;
}>;

export type SessionEvents<G, H> = Readonly<{ host: HostEvents<G>; guest: GuestEvents<H> }>;

/**
 * The adapters main.ts hands its sessions (`events` in their deps): every event is an intent
 * through `dispatch` (`status` with `stopPulse` false unless the session says so), a toast through
 * `toast` (an undefined `ms` is the default duration), and the wake lock held.
 */
export const sessionEvents = <G, H>(deps: SessionEventDeps<G, H>): SessionEvents<G, H> => {
  const { dispatch, toast, wakeLock } = deps;
  const host: HostEvents<G> = {
    status: (text, stopPulse = false) => {
      dispatch({ type: 'host/status', text, stopPulse });
    },
    toast: (message, ms) => {
      toast(message, ms ?? null);
    },
    holdWakeLock: () => {
      void wakeLock.hold();
    },
    persist: () => {
      dispatch({ type: 'persist' });
    },
    restart: (code) => {
      dispatch({ type: 'host/start', code });
    },
    frame: (frame) => {
      dispatch({ type: 'host/frame', frame });
    },
    guestGone: (iceFailed) => {
      dispatch({ type: 'host/guestGone', iceFailed });
    },
  };
  const guest: GuestEvents<H> = {
    status: (text, stopPulse = false) => {
      dispatch({ type: 'guest/status', text, stopPulse });
    },
    toast: (message, ms) => {
      toast(message, ms ?? null);
    },
    holdWakeLock: () => {
      void wakeLock.hold();
    },
    persist: () => {
      dispatch({ type: 'persist' });
    },
    connected: () => {
      dispatch({ type: 'guest/connected' });
    },
    frame: (frame) => {
      dispatch({ type: 'guest/frame', frame });
    },
    lost: () => {
      dispatch({ type: 'guest/lost' });
    },
  };
  return { host, guest };
};
