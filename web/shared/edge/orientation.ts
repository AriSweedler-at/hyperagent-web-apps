// The Android lock (docs/design/backgammon-landscape.md §5C; the owner, 2026-09-25: "it should lock
// the user into place to make it sideways. Only on mobile!"): fullscreen on the document, then
// `screen.orientation.lock('landscape')`, the one way a web page holds a phone sideways, and only
// Android's Chromium family has it (no iPhone browser has `lock` or element fullscreen; desktop
// Chromium has both and `lock` rejects). Both calls need a tap (`requestFullscreen` needs
// transient activation, `lock` needs fullscreen), so the shell steps the `orientationLock` effect
// only inside one (web/shared/ui/shell.ts `lockSideways`) and this adapter runs it there. The
// whole document, never `#app`: the curtain, the sheets and the toast are `#app`'s body siblings,
// and a fullscreen `#app` would hide the curtain itself. Every browser API is injected as a
// structural type so tests run on fakes, and every failure is silent here (as the wake lock's,
// fx.ts) and reported to the caller as `false`, so the boot can tell the reducer the lock did not
// take (`fullscreen/lost`). The boot's `fullscreenchange` listener, not this file, reports the
// loss a back gesture causes: on that exit the spec unlocks the orientation too, and nothing can
// re-enter until the next tap.

/** The document as the lock reads it; every member optional, since an iPhone browser has none. */
export type FullscreenDocumentLike = Readonly<{
  documentElement?: Readonly<{ requestFullscreen?: () => Promise<void> }>;
  exitFullscreen?: () => Promise<void>;
  /** The element in fullscreen, or null; undefined on a browser without the API. */
  fullscreenElement?: unknown;
}>;

/**
 * The screen as the lock reads it. `lock` is `unknown`, not a function type: the DOM lib spells
 * none (Safari has none, so it is not baseline), so the real `window.screen` fits only this way;
 * `isLock` narrows it at the call. `unlock` is spelled everywhere.
 */
export type ScreenLike = Readonly<{
  orientation?: Readonly<{ lock?: unknown; unlock?: () => void }>;
}>;

export type OrientationLock = Readonly<{
  /**
   * Fullscreen (unless already in it), then the landscape lock; resolves true when both took,
   * false when either did not or the browser has neither. Never throws.
   */
  hold: () => Promise<boolean>;
  /** Unlock the orientation and leave fullscreen where the page is in it; silent everywhere else. */
  drop: () => void;
}>;

/** What the lock holds: sideways (the games), or upright (UI Sandbox's portrait mode, the mirror). */
export type LockOrientation = 'landscape' | 'portrait';
type LockFn = (orientation: LockOrientation) => Promise<unknown>;
const isLock = (value: unknown): value is LockFn => typeof value === 'function';

/** The lock over the page's `document` and `screen` (main.ts passes the real ones through the boot, tests fakes); `which` is what it holds, sideways unless said. */
export const createOrientationLock = (
  doc: FullscreenDocumentLike,
  screen: ScreenLike,
  which: LockOrientation = 'landscape',
): OrientationLock => {
  const hold = async (): Promise<boolean> => {
    try {
      const orientation = screen.orientation;
      const lock = orientation?.lock;
      if (orientation === undefined || !isLock(lock)) return false;
      const request = doc.documentElement?.requestFullscreen;
      if (request === undefined) return false;
      // A method call on its object: `requestFullscreen` and `lock` throw "Illegal invocation" unbound.
      if ((doc.fullscreenElement ?? null) === null) await request.call(doc.documentElement);
      await lock.call(orientation, which);
      return true;
    } catch {
      /* denied, refused (a tablet, desktop Chromium), or no activation: the page stays as it is */
      return false;
    }
  };
  const drop = (): void => {
    try {
      screen.orientation?.unlock?.();
    } catch {
      /* ignore */
    }
    try {
      if ((doc.fullscreenElement ?? null) !== null)
        void doc.exitFullscreen?.().catch(() => undefined);
    } catch {
      /* ignore */
    }
  };
  return { hold, drop };
};
