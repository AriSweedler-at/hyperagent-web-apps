// Boot (docs/ARCHITECTURE.md "Module boundaries": main.ts constructs the adapters and injects
// them; no logic). Phase 1 of docs/MIGRATION.md step 12: the real Transport (web/shared/edge/
// transport.ts, which bundles PeerJS and honours `?peer=`), the ICE loader, localStorage, the
// clock, `Math.random` (or the harness's `window.__rng`), Web Audio, vibration and the wake lock
// are built here and handed to the reducer (src/ui/state.ts) through `runEffect`, to the sessions
// (src/net) through their deps, and to the paint (src/ui/render.ts). What the legacy page did
// with the PeerJS CDN <script> and shared/ice.js arrives with this module instead, so index.html
// loads neither and defines neither `window.Peer` nor `window.HyperIce`; `window.__gin` stays as
// the documented test hook with the members the legacy exposed.
import { realClock } from '../../shared/edge/clock.ts';
import {
  createAudioCues,
  createWakeLock,
  vibrate,
  type AudioContextLike,
  type NavigatorLike,
} from '../../shared/edge/fx.ts';
import { browserIceDeps, createIce } from '../../shared/edge/ice.ts';
import { shareText } from '../../shared/edge/share.ts';
import { browserStore } from '../../shared/edge/storage.ts';
import { realTransport } from '../../shared/edge/transport.ts';
import type { Timer } from '../../shared/lib/clock.ts';
import type { Rng } from '../../shared/lib/rng.ts';
import type { Action } from './src/engine/types.ts';
import { createFx } from './src/fx.ts';
import { GuestSession, type GuestEvents } from './src/net/guest.ts';
import { HostSession, type HostEvents } from './src/net/host.ts';
import type { NetDeps } from './src/net/peerjs.ts';
import { isGuestFrame } from './src/protocol.ts';
import { soundEnabled } from './src/storage.ts';
import { fillNameInputs, inviteText, setCodeInput } from './src/ui/home.ts';
import { hideToast, paint, renderRules, showToast } from './src/ui/render.ts';
import {
  INVITE_COPIED_MSG,
  SHARE_FALLBACK_MS,
  guestContextOf,
  hostContextOf,
  initialApp,
  readHome,
  reduce,
  roomCodeMsg,
  runEffect,
  type App,
  type EffectDeps,
  type Intent,
  type ScreenId,
  type TimerId,
} from './src/ui/state.ts';

/** The legacy `toast(msg, ms)` default. */
const TOAST_MS = 2600;

type Scorer = Readonly<{ onShown: () => void; resume: () => void }>;

const boot = (): void => {
  // The documented test hooks on this page (docs/ARCHITECTURE.md "Documented test hooks"): a seeded
  // rng a harness installs before boot, the app hook set after it, and the Score Counter's screen
  // (src/scorer/main.ts, phase 2) registering itself as the legacy `window.__scorer` did.
  const page = window as Window & { __rng?: Rng; __gin?: unknown; __scorer?: Scorer };
  const store = browserStore();
  const rng: Rng = page.__rng ?? Math.random;
  const now = (): number => realClock.now();
  // The DOM lib types `vibrate` over a mutable array and `AudioNode.connect` over full nodes; the
  // edge reads readonly patterns and calls the structural subset, so the real objects are widened.
  const nav = navigator as unknown as NavigatorLike;
  const wakeLock = createWakeLock(nav);
  const audioGlobals = globalThis as unknown as Readonly<{
    AudioContext?: new () => unknown;
    webkitAudioContext?: new () => unknown;
  }>;
  const AudioCtor = audioGlobals.AudioContext ?? audioGlobals.webkitAudioContext;
  const audio = createAudioCues({
    makeContext: AudioCtor === undefined ? undefined : () => new AudioCtor() as AudioContextLike,
    enabled: soundEnabled(store),
  });

  let app: App = initialApp;
  let session: HostSession | GuestSession | null = null;
  let toastTimer: Timer | null = null;
  /** The reducer's named timers (the Play tab's long press); arming one again restarts it. */
  const timers = new Map<TimerId, Timer>();
  const cancelTimer = (id: TimerId): void => {
    const armed = timers.get(id);
    if (armed !== undefined) realClock.clearTimeout(armed);
    timers.delete(id);
  };

  const toast = (message: string, ms: number | null): void => {
    showToast(document, message);
    if (toastTimer !== null) realClock.clearTimeout(toastTimer);
    toastTimer = realClock.setTimeout(() => {
      hideToast(document);
    }, ms ?? TOAST_MS);
  };

  const fx = createFx({
    audio,
    vibrate: (pattern) => {
      vibrate(nav, pattern);
    },
    store,
    onToggle: () => {
      paint(document, app);
    },
  });

  const netDeps: NetDeps = {
    // PeerJS log level 0 as on the legacy page; realTransport reads the ?peer= hook itself.
    transportFor: (ice) => realTransport({ ice, search: location.search, debug: 0 }),
    ice: createIce(browserIceDeps()),
    clock: realClock,
    onWake: (fn) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') fn();
      });
      window.addEventListener('online', fn);
    },
  };

  const dispatch = (intent: Intent): void => {
    const step = reduce(app, intent, { rng, now });
    app = step.app;
    step.effects.forEach((effect) => {
      runEffect(app, effect, deps);
    });
    paint(document, app);
  };

  const hostEvents: HostEvents = {
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

  const guestEvents: GuestEvents = {
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

  const deps: EffectDeps = {
    store,
    toast,
    fx: (cue) => {
      fx.play(cue);
    },
    wakeLock: (hold) => {
      if (hold) void wakeLock.hold();
      else wakeLock.drop();
    },
    net: {
      startHost: (code, attempt, resume) => {
        session = new HostSession(
          { ...netDeps, read: () => hostContextOf(app), events: hostEvents },
          { code, attempt, resume },
        );
      },
      startGuest: (code, attempt) => {
        session = new GuestSession(
          { ...netDeps, read: () => guestContextOf(app), events: guestEvents },
          { code, attempt },
        );
      },
      send: (frame) => {
        if (session === null) return;
        if (session.kind === 'host') {
          if (!isGuestFrame(frame)) session.send(frame);
        } else if (isGuestFrame(frame)) session.send(frame);
      },
      close: () => {
        session?.close();
      },
    },
    confirm: (message) => window.confirm(message),
    scrollTop: () => {
      window.scrollTo(0, 0);
    },
    scorer: {
      shown: () => page.__scorer?.onShown(),
      resume: () => page.__scorer?.resume(),
    },
    timers: {
      start: (id, ms, then) => {
        cancelTimer(id);
        timers.set(
          id,
          realClock.setTimeout(() => {
            timers.delete(id);
            dispatch(then);
          }, ms),
        );
      },
      cancel: cancelTimer,
    },
    toggleSound: () => {
      fx.toggle();
    },
    share: (code) => {
      // The legacy handler: the share sheet, else the clipboard with a toast, else the code itself.
      const pageUrl = location.href.split('?')[0] ?? location.href;
      void shareText(navigator, { title: 'Gin Rummy', text: inviteText(code, pageUrl) }).then(
        (outcome) => {
          if (outcome === 'copied') toast(INVITE_COPIED_MSG, null);
          else if (outcome === 'failed') toast(roomCodeMsg(code), SHARE_FALLBACK_MS);
        },
      );
    },
    page: {
      fillName: (name) => {
        fillNameInputs(document, name);
      },
      setCode: (value) => {
        setCodeInput(document, value);
      },
    },
    dispatch: (intent) => {
      dispatch(intent);
    },
  };

  renderRules(document);
  // Browsers only let audio start after a user gesture: warm the context on the first tap.
  ['pointerdown', 'touchstart', 'keydown'].forEach((event) => {
    document.addEventListener(
      event,
      () => {
        fx.warm();
      },
      { passive: true },
    );
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') dispatch({ type: 'visible' });
  });

  // The test/debug hook, with the members the legacy exposed (read-only state; actions go through
  // the reducer). `app` is a getter so a reader always sees the current record.
  page.__gin = {
    get app(): App {
      return app;
    },
    act: (action: Action) => {
      dispatch({ type: 'act', action });
    },
    render: () => {
      dispatch({ type: 'render' });
    },
    showScreen: (screen: ScreenId) => {
      dispatch({ type: 'screen/show', screen });
    },
    initHome: () => {
      dispatch({ type: 'home/init', home: readHome(store) });
    },
    fx,
    setHomeTab: (tab: string, opts?: Readonly<{ persist?: boolean }>) => {
      dispatch({ type: 'tab/set', tab, ...(opts?.persist === false ? { persist: false } : {}) });
    },
    setPlayMode: (mode: string) => {
      dispatch({ type: 'mode/set', mode });
    },
    dispatch,
  };

  dispatch({ type: 'home/init', home: readHome(store) });
};

boot();
