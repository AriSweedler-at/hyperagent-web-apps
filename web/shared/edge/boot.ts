// The boot both shell main.ts files spelled line for line (docs/design/shared-shell.md §4.5
// `boot.ts`; §5 B3 moved the invite link, the share chain and the session-event adapters out of
// gin's main.ts and backgammon's, C3 the ~290 lines around them into `bootShell`). Under
// web/shared/edge rather than the web/shared/ui the plan lists (§4.1 leaves the folder to this
// file) because it reaches past the ui zone's contract (web/shared/lib, the DOM edge and the clock
// fake, eslint.config.js zones): the invite readers (invite.ts), the share sheet (share.ts), the
// wake lock and Web Audio (fx.ts), the sessions' event types (web/shared/net), the browser net deps
// and localStorage. Each helper takes the page's objects injected (`location` and `history`,
// `navigator`), and `bootShell` takes them all in `cfg.page` (the document, the window, the
// navigator, the store and the clock), so boot.test.ts drives the whole boot over the page fake and
// main.ts passes the real ones. `Math.random` is read here (RNG_ALLOWED covers this folder), as the
// two main.ts files read it: the harness's `window.__rng` when installed, else the real one.
import type { Clock } from '../lib/clock.ts';
import { inviteUrl } from '../lib/invite.ts';
import type { RecentGame } from '../lib/recentGames.ts';
import type { Rng } from '../lib/rng.ts';
import { badSoundFontMsg, isSoundFont, type SoundFontName } from '../lib/sound/fonts.ts';
import type { GuestEvents } from '../net/guest.ts';
import type { HostEvents } from '../net/host.ts';
import { ruleFromHash } from '../ui/glossary.ts';
import type {
  Ctx,
  Cue,
  Effect,
  GuestContextOf,
  GuestFrameOf,
  HomeSnapshot,
  HostContextOf,
  HostFrameOf,
  Intent,
  ScreenId,
  ShellApp,
  ShellTypes,
  TimerId,
} from '../ui/shell.ts';
import type { ShellEffectDeps } from '../ui/shellEffects.ts';
import type { ToastMarks } from '../ui/shellPaint.ts';
import { createTimers, createToaster, type Toast } from '../ui/toast.ts';
import type { CuePlayer, CuePlayerDeps } from './cuePlayer.ts';
import type { DocumentLike, PageLike } from './dom.ts';
import {
  createAudioCues,
  createWakeLock,
  vibrate,
  type AudioContextLike,
  type NavigatorLike,
  type WakeLock,
} from './fx.ts';
import { bindJargon, revealRule } from './glossary.ts';
import { joinCodeFrom, withoutJoin } from './invite.ts';
import { browserNetDeps } from './netDeps.ts';
import type { NetDeps } from './peer.ts';
import { shareText, type ShareNavigatorLike } from './share.ts';
import { createSampleCache } from './sound.ts';
import type { Store } from './storage.ts';

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

// ---- the boot ---------------------------------------------------------------------------------

/** A game's type bag with the store the edge builds (web/shared/edge/storage.ts): what `bootShell` reads of it. */
export type BootTypes = ShellTypes & Readonly<{ Store: Store }>;

/** What the boot reads of an App: the font every cue plays in, my view (the hook's `legal()`) and the finished games (the hook's `recentGames()`). */
export type BootApp<G extends BootTypes> = Readonly<{
  shell: Readonly<{
    soundFont: SoundFontName;
    view: G['View'] | null;
    recentGames: ReadonlyArray<RecentGame>;
  }>;
}>;

/** The page's `document` as the boot reads it: the paint's and the binders' view, plus its visibility. */
export type BootDocumentLike = PageLike & Readonly<{ visibilityState: string }>;

/** `fetch`'s answer as `fetchArrayBuffer` reads it. */
export type ResponseLike = Readonly<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

/** The page's `window` as the boot reads it (the invite readers' `location` and `history` included). */
export type BootWindowLike = InviteWindowLike &
  Readonly<{
    location: Readonly<{ origin: string }>;
    confirm: (message: string) => boolean;
    scrollTo: (x: number, y: number) => void;
    fetch: (url: string) => Promise<ResponseLike>;
    /** A seeded rng a harness installs before boot (docs/ARCHITECTURE.md "Documented test hooks"). */
    __rng?: Rng;
    AudioContext?: new () => unknown;
    webkitAudioContext?: new () => unknown;
  }>;

/**
 * The `navigator` as the wake lock and the share chain read it. `vibrate` is not named: the DOM lib
 * types it over a mutable array and the edge (fx.ts `NavigatorLike`) over readonly patterns, so
 * `bootShell` widens the real object to the structural subset, as both main.ts files did.
 */
export type BootNavigatorLike = ShareNavigatorLike &
  Readonly<{ wakeLock?: NavigatorLike['wakeLock'] }>;

/** The page's objects, injected: main.ts passes the real ones, boot.test.ts the fakes. */
export type BootPage<G extends BootTypes> = Readonly<{
  doc: BootDocumentLike;
  win: BootWindowLike;
  nav: BootNavigatorLike;
  store: G['Store'];
  clock: Clock;
}>;

/** A session as the boot drives it (web/shared/net): `kind` tells the host from the guest, `send` takes its side's frame. */
export type SessionLike<K extends 'host' | 'guest', F> = Readonly<{
  kind: K;
  send: (frame: F) => void;
  close: () => void;
}>;
export type HostDepsOf<G extends BootTypes> = NetDeps &
  Readonly<{ read: () => HostContextOf<G>; events: HostEvents<GuestFrameOf<G>> }>;
export type GuestDepsOf<G extends BootTypes> = NetDeps &
  Readonly<{ read: () => GuestContextOf; events: GuestEvents<HostFrameOf<G>> }>;
export type HostOptionsOf = Readonly<{ code: string; attempt: number; resume: boolean }>;
export type GuestOptionsOf = Readonly<{ code: string; attempt: number }>;

/** What a game's fx.ts `createFx` takes: the shared player's deps less the table and the persist it supplies. */
export type FxDepsOf<G extends BootTypes> = Omit<CuePlayerDeps<Cue<G>>, 'cues' | 'persist'> &
  Readonly<{ store: G['Store'] }>;

/** What the boot built, for the game's own hook members and effect adapters (`cfg.hooks`) and for main.ts. */
export type BootCtx<G extends BootTypes, App extends BootApp<G>> = Readonly<{
  dispatch: (intent: Intent<G>) => void;
  /** The current App (a function, so a reader always sees the latest record). */
  app: () => App;
  toast: Toast;
  fx: CuePlayer<Cue<G>>;
  store: G['Store'];
  now: () => number;
  rng: Rng;
  /** `readHome` after the stored sound font (and the game's own `hooks.home` guard) is checked: the `home/init` snapshot. */
  homeSnapshot: () => HomeSnapshot<G>;
}>;

/**
 * Everything the two main.ts files disagreed on, spelled by each (§4.5): `G` the game's type bag,
 * `App` its App (the boot reads `shell.soundFont` and `shell.view` of it), `Ex` the effect adapters
 * it has beside the shell's (gin's Score Counter and clipboard; backgammon none).
 */
export type BootConfig<G extends BootTypes, App extends BootApp<G>, Ex extends object> = Readonly<{
  page: BootPage<G>;
  game: Readonly<{
    /** The documented test hook's property on the window: `__gin`, `__backgammon` (tools/games.ts REGISTRY `hook`). */
    hook: string;
    /** The share sheet's title: the game's name as its legacy page spelled it. */
    title: string;
    /** The PeerJS log level the page's legacy set (REGISTRY `debug`; e2e `expectPeerOptions` pins each). */
    debug: number;
  }>;
  sound: Readonly<{
    /** The game's `soundEnabled(store)` (storage.ts): the preference under its own sound key. */
    enabled: (store: G['Store']) => boolean;
    /** The game's own sound-font key (`STORAGE_KEYS.soundFont`): checked before every home read, named in the console hook's refusal. */
    fontKey: string;
  }>;
  reducer: Readonly<{
    initialApp: App;
    reduce: (
      app: App,
      intent: Intent<G>,
      ctx: Ctx,
    ) => Readonly<{ app: App; effects: ReadonlyArray<Effect<G>> }>;
    runEffect: (app: App, effect: Effect<G>, deps: ShellEffectDeps<G> & Ex) => void;
    readHome: (store: G['Store']) => HomeSnapshot<G>;
    hostContextOf: (app: App) => HostContextOf<G>;
    guestContextOf: (app: App) => GuestContextOf;
  }>;
  paint: Readonly<{
    paint: (doc: PageLike, app: App) => void;
    bindAll: (doc: PageLike, dispatch: (intent: Intent<G>) => void) => void;
    paintSound: (doc: DocumentLike, enabled: boolean) => void;
    /** The classes a game puts on the toast for a message (backgammon's `hit`); none for gin. */
    toastMarks?: (message: string) => ToastMarks;
    /**
     * The three input writes the paint does not own (ui/home.ts): the game's, because gin fills the
     * Score Counter's inputs too. `isDefault` is the fill's `default` mark (shell.ts), which the
     * game's fill paints as `data-default` so the input clears on the first tap.
     */
    fillName: (doc: DocumentLike, name: string, isDefault: boolean) => void;
    fillP2Name: (doc: DocumentLike, name: string, isDefault: boolean) => void;
    setCode: (doc: DocumentLike, value: string) => void;
  }>;
  /** The game's fx.ts `createFx`: the shared cue player over its table and its sound key. */
  fx: (deps: FxDepsOf<G>) => CuePlayer<Cue<G>>;
  net: Readonly<{
    Host: new (deps: HostDepsOf<G>, opts: HostOptionsOf) => SessionLike<'host', HostFrameOf<G>>;
    Guest: new (
      deps: GuestDepsOf<G>,
      opts: GuestOptionsOf,
    ) => SessionLike<'guest', GuestFrameOf<G>>;
    /** The game's protocol.ts `isGuestFrame`: which side of the wire a `send` effect's frame belongs to. */
    isGuestFrame: (frame: HostFrameOf<G> | GuestFrameOf<G>) => frame is GuestFrameOf<G>;
  }>;
  /** The engine's legal actions for a view (the hook's `legal()`). */
  legal: (view: G['View']) => ReadonlyArray<G['Action']>;
  /** The game's own effect adapters beside the shell's (`Ex`): gin's `scorer` and `copy`; `{}` for backgammon. */
  deps: Ex;
  hooks?: Readonly<{
    /** Before every home read: gin drops a stored card back that names no preset. */
    home?: (store: G['Store']) => void;
    /** Before the binders: the static markup and screens a game renders first (gin: the rules, the About copy, the sandbox presets, the Score Counter). */
    render?: (ctx: BootCtx<G, App>) => void;
    /** After the binders: gin's `scorer.bind()`. */
    bind?: (ctx: BootCtx<G, App>) => void;
    /** The game's own members on the test hook, beside the shared ones (`act` is one: its intent is the game's). */
    hook?: (ctx: BootCtx<G, App>) => Readonly<Record<string, unknown>>;
  }>;
}>;

/** `SoundDeps.fetchBuffer` (sound.ts) over the page's `fetch`: the bytes, or a rejection naming the status and the URL. */
export const fetchArrayBuffer =
  (win: Readonly<{ fetch: BootWindowLike['fetch'] }>) =>
  (url: string): Promise<ArrayBuffer> =>
    win.fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${String(r.status)} ${url}`);
      return r.arrayBuffer();
    });

/**
 * The boot (docs/ARCHITECTURE.md "Module boundaries": it constructs the adapters and injects
 * them; no logic): the wake lock, Web Audio, the cue player, the toaster and the named timers, the
 * browser net deps, `dispatch` with the no-repaint rule, the sessions' events, the shell's effect
 * adapters, the binders, the warm-on-first-gesture and visibility listeners, the documented test
 * hook, then `home/init`, the invite link and the rule deep link, in the order both main.ts files
 * ran them. Returns what it built, so main.ts can reach the dispatch (nothing does today).
 */
export const bootShell = <
  G extends BootTypes,
  App extends BootApp<G> = ShellApp<G> & BootApp<G>,
  Ex extends object = object,
>(
  cfg: BootConfig<G, App, Ex>,
): BootCtx<G, App> => {
  const { doc, win, nav, store, clock } = cfg.page;
  // The sound font (docs/design/sound-fonts.md §6): a value the console left in storage that names
  // no preset is logged and dropped before every home read, so the default stands and a reload
  // logs it once; the game's own guard (gin's card back, `hooks.home`) runs first, as it did.
  const homeSnapshot = (): HomeSnapshot<G> => {
    cfg.hooks?.home?.(store);
    const storedFont = store.readText(cfg.sound.fontKey);
    if (storedFont.ok && !isSoundFont(storedFont.value)) {
      console.error(badSoundFontMsg(cfg.sound.fontKey, storedFont.value));
      store.remove(cfg.sound.fontKey);
    }
    return cfg.reducer.readHome(store);
  };
  // The seeded rng a harness installs before boot, read before anything draws so a seeded opening
  // roll is the seeded one (backgammon-board.md R27), else the real one.
  const rng: Rng = win.__rng ?? Math.random;
  const now = (): number => clock.now();
  // The DOM lib types `vibrate` over a mutable array and `AudioNode.connect` over full nodes; the
  // edge reads readonly patterns and calls the structural subset, so the real objects are widened.
  const navLike = nav as NavigatorLike;
  const wakeLock: WakeLock = createWakeLock(navLike);
  const AudioCtor = win.AudioContext ?? win.webkitAudioContext;
  const audio = createAudioCues({
    makeContext: AudioCtor === undefined ? undefined : () => new AudioCtor() as AudioContextLike,
    enabled: cfg.sound.enabled(store),
  });

  let app: App = cfg.reducer.initialApp;
  let session: SessionLike<'host', HostFrameOf<G>> | SessionLike<'guest', GuestFrameOf<G>> | null =
    null;
  /** The reducer's named timers (the Play tab's long press; backgammon's shake and R14 beat); arming one again restarts it. */
  const timers = createTimers<TimerId<G>>(clock);
  /** The legacy `toast(msg, ms)` with its 2.6 s default; a new toast restarts the one hide timer (backgammon's Kapará toast wears `hit`). */
  const toast = createToaster(doc, clock, undefined, cfg.paint.toastMarks);

  const fx = cfg.fx({
    audio,
    // The sample seam (docs/design/sound-fonts.md §3): a document-relative URL, so both origins serve it.
    sound: { fetchBuffer: fetchArrayBuffer(win), cache: createSampleCache() },
    vibrate: (pattern) => {
      vibrate(navLike, pattern);
    },
    store,
    onToggle: (enabled) => {
      cfg.paint.paintSound(doc, enabled);
    },
  });

  // PeerJS log level as the legacy page set it (e2e expectPeerOptions pins it); the shared deps
  // (web/shared/edge/netDeps.ts) read the ?peer= hook and wake the sessions on visibility/online.
  const netDeps: NetDeps = browserNetDeps({ search: win.location.search, debug: cfg.game.debug });

  const repaint = (): void => {
    cfg.paint.paint(doc, app);
  };

  const dispatch = (intent: Intent<G>): void => {
    const step = cfg.reducer.reduce(app, intent, { rng, now });
    // The paint is a function of the App, so an unchanged App needs none. This matters on a
    // card's or a checker's pointerdown: a repaint would replace the element under the pointer,
    // and the browser would then drop the click that was to follow.
    const changed = step.app !== app;
    app = step.app;
    step.effects.forEach((effect) => {
      cfg.reducer.runEffect(app, effect, deps);
    });
    if (changed) repaint();
  };

  // The sessions' events as intents, toasts and the wake lock.
  const { host: hostEvents, guest: guestEvents } = sessionEvents<GuestFrameOf<G>, HostFrameOf<G>>({
    dispatch,
    toast,
    wakeLock,
  });

  const deps: ShellEffectDeps<G> & Ex = {
    store,
    toast,
    fx: (what, font) => {
      if (typeof what === 'string') fx.play(what, font);
      else fx.playPhrases(what, font);
    },
    wakeLock: (hold) => {
      if (hold) void wakeLock.hold();
      else wakeLock.drop();
    },
    net: {
      startHost: (code, attempt, resume) => {
        session = new cfg.net.Host(
          { ...netDeps, read: () => cfg.reducer.hostContextOf(app), events: hostEvents },
          { code, attempt, resume },
        );
      },
      startGuest: (code, attempt) => {
        session = new cfg.net.Guest(
          { ...netDeps, read: () => cfg.reducer.guestContextOf(app), events: guestEvents },
          { code, attempt },
        );
      },
      send: (frame) => {
        if (session === null) return;
        if (session.kind === 'host') {
          if (!cfg.net.isGuestFrame(frame)) session.send(frame);
        } else if (cfg.net.isGuestFrame(frame)) session.send(frame);
      },
      close: () => {
        session?.close();
      },
    },
    confirm: (message) => win.confirm(message),
    scrollTop: () => {
      win.scrollTo(0, 0);
    },
    timers: {
      start: (id, ms, then) => {
        timers.start(id, ms, () => {
          dispatch(then);
        });
      },
      cancel: timers.cancel,
    },
    toggleSound: () => {
      fx.toggle(app.shell.soundFont);
    },
    share: (code) => {
      // The share sheet, else the clipboard with a toast, else the code itself (`shareInvite` above).
      void shareInvite(nav, {
        title: cfg.game.title,
        code,
        pageUrl: `${win.location.origin}${win.location.pathname}`,
        toast,
      });
    },
    revealRule: (slot, rule) => {
      revealRule(doc, slot, rule);
    },
    page: {
      fillName: (name, isDefault) => {
        cfg.paint.fillName(doc, name, isDefault);
      },
      fillP2Name: (name, isDefault) => {
        cfg.paint.fillP2Name(doc, name, isDefault);
      },
      setCode: (value) => {
        cfg.paint.setCode(doc, value);
      },
    },
    dispatch: (intent) => {
      dispatch(intent);
    },
    ...cfg.deps,
  };

  const ctx: BootCtx<G, App> = {
    dispatch,
    app: () => app,
    toast,
    fx,
    store,
    now,
    rng,
    homeSnapshot,
  };

  cfg.hooks?.render?.(ctx);
  cfg.paint.bindAll(doc, dispatch);
  // A tap on jargon in the About copy or in a rule (docs/design/glossary-links.md) shows that rule.
  bindJargon(doc, (rule) => {
    dispatch({ type: 'rules/show', rule });
  });
  cfg.hooks?.bind?.(ctx);
  cfg.paint.paintSound(doc, fx.enabled());
  // Browsers only let audio start after a user gesture: warm the context on the first tap, and
  // the table's samples in the App's font with it (cuePlayer.ts `warm`), so no phrase waits.
  ['pointerdown', 'touchstart', 'keydown'].forEach((event) => {
    doc.addEventListener(
      event,
      () => {
        fx.warm(app.shell.soundFont);
      },
      { passive: true },
    );
  });
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') dispatch({ type: 'visible' });
  });

  // The test/debug hook (docs/ARCHITECTURE.md "Documented test hooks"): read-only state, actions
  // through the reducer. `app` is a getter so a reader always sees the current record; the game's
  // own members (`hooks.hook`: gin's sandbox, card back and layoffs, backgammon's `setup`) follow.
  const hook: Readonly<Record<string, unknown>> = {
    get app(): App {
      return app;
    },
    dispatch,
    render: () => {
      dispatch({ type: 'render' });
    },
    showScreen: (screen: ScreenId<G>) => {
      dispatch({ type: 'screen/show', screen });
    },
    initHome: () => {
      dispatch({ type: 'home/init', home: homeSnapshot() });
    },
    fx,
    /** The engine's legal actions for my view. */
    legal: (): ReadonlyArray<G['Action']> =>
      app.shell.view === null ? [] : cfg.legal(app.shell.view),
    /** The sound font, from the console for now (docs/design/sound-fonts.md §6): a font plays from now on and is remembered; anything else is logged and refused. */
    soundFont: (name: string): void => {
      if (!isSoundFont(name)) {
        console.error(badSoundFontMsg(cfg.sound.fontKey, name));
        return;
      }
      dispatch({ type: 'soundFont/set', font: name });
    },
    soundFontName: (): string => app.shell.soundFont,
    /** The finished games this device remembers, newest first (web/shared/lib/recentGames.ts): what the history sheet lists. */
    recentGames: (): ReadonlyArray<RecentGame> => app.shell.recentGames,
    ...cfg.hooks?.hook?.(ctx),
  };
  // `window.__gin = { … }` as the legacy page wrote it: the one write the boot makes on the window.
  (win as unknown as Record<string, unknown>)[cfg.game.hook] = hook;

  dispatch({ type: 'home/init', home: homeSnapshot() });
  // An invite link (`?join=<code>`): into the join form now that the home screen is up, and out of
  // the address bar (`applyInviteLink` above).
  applyInviteLink(win, (code) => {
    dispatch({ type: 'join/link', code });
  });
  // A rule deep link (`#rule-<id>`, docs/design/glossary-links.md §1): the Rules tab, scrolled to
  // that rule. The hash stays, so the link can be copied from the address bar.
  const rule = ruleFromHash(win.location.hash);
  if (rule !== null) dispatch({ type: 'rules/show', rule });
  return ctx;
};
