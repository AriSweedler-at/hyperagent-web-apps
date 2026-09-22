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
import { shareText, type ShareNavigatorLike } from '../../shared/edge/share.ts';
import { browserStore } from '../../shared/edge/storage.ts';
import { realTransport } from '../../shared/edge/transport.ts';
import type { Timer } from '../../shared/lib/clock.ts';
import { joinCodeFrom, withoutJoin } from '../../shared/edge/invite.ts';
import type { Rng } from '../../shared/lib/rng.ts';
import { bestLayoffActions, legalActions } from './src/engine/index.ts';
import type { Action } from './src/engine/types.ts';
import { createFx } from './src/fx.ts';
import { GuestSession, type GuestEvents } from './src/net/guest.ts';
import { HostSession, type HostEvents } from './src/net/host.ts';
import type { NetDeps } from './src/net/peerjs.ts';
import { isGuestFrame } from './src/protocol.ts';
import { createScorer, type SpeechRecognizerLike } from './src/scorer/main.ts';
import { STORAGE_KEYS, soundEnabled } from './src/storage.ts';
import { badCardBackMsg, isCardBack } from './src/cardBack.ts';
import { formatMap, mapOf } from './src/sandbox.ts';
import { slotHandView } from './src/ui/hand/SlotHandView.ts';
import {
  fillNameInputs,
  fillP2NameInput,
  inviteUrl,
  renderSandbox,
  setCodeInput,
} from './src/ui/home.ts';
import {
  bindAll,
  fmtTime,
  hideToast,
  paint,
  paintSound,
  renderRules,
  showToast,
} from './src/ui/render.ts';
import {
  INVITE_COPIED_MSG,
  SHARE_FALLBACK_MS,
  guestContextOf,
  hostContextOf,
  initialApp,
  readHome,
  type HomeSnapshot,
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

type Scorer = Readonly<{ resume: () => void }>;

/** `exportGame()`'s download: a Blob behind an anchor clicked once, its URL revoked 2 s later. */
const downloadText = (fileName: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  realClock.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 2000);
};

const boot = (): void => {
  // The stories page (docs/design/gin-draw-ghost-slot.md §8; docs/ARCHITECTURE.md "Documented test
  // hooks"): `?story=<id>` paints one catalogued table state and constructs no adapter at all. The
  // catalogue arrives as its own chunk (a dynamic import), so the game's entry carries none of it.
  const params = new URLSearchParams(location.search);
  const story = params.get('story');
  if (story !== null) {
    void import('./src/stories/boot.ts').then((stories) => {
      stories.bootStory(document, story, params.has('nav'), params.has('live'));
    });
    return;
  }

  // The documented test hooks on this page (docs/ARCHITECTURE.md "Documented test hooks"): a seeded
  // rng a harness installs before boot, the app hook set after it, and the Score Counter's screen
  // (src/scorer/main.ts) registering itself as the legacy `window.__scorer` did.
  const page = window as Window & { __rng?: Rng; __gin?: unknown; __scorer?: Scorer };
  const store = browserStore();
  // The card back (src/cardBack.ts): a value the console left in storage that names no preset is
  // logged and dropped before every home read, so the default stands and a reload logs it once.
  const homeSnapshot = (): HomeSnapshot => {
    const storedBack = store.readText(STORAGE_KEYS.cardBack);
    if (storedBack.ok && !isCardBack(storedBack.value)) {
      console.error(badCardBackMsg(storedBack.value));
      store.remove(STORAGE_KEYS.cardBack);
    }
    return readHome(store);
  };
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
    onToggle: (enabled) => {
      paintSound(document, enabled);
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

  // The hand is drawn by the slot view with the ghost draw slot (docs/ARCHITECTURE.md "Seams
  // reserved": the view is another module and this choice; docs/design/gin-draw-ghost-slot.md).
  // Nothing is measured after a paint: the table's geometry is bounded by the viewport in theme.css.
  const repaint = (): void => {
    paint(document, app, slotHandView);
  };

  const dispatch = (intent: Intent): void => {
    const step = reduce(app, intent, { rng, now });
    // The paint is a function of the App, so an unchanged App needs none. This matters on a
    // card's pointerdown: a repaint would replace the element under the pointer, and the
    // browser would then drop the click that was to follow.
    const changed = step.app !== app;
    app = step.app;
    step.effects.forEach((effect) => {
      runEffect(app, effect, deps);
    });
    if (changed) repaint();
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
      // The legacy handler's chain: the share sheet (a phone's OS menu), else the clipboard with a
      // toast (desktop), else the code itself. The invite is the link alone (`?join=<code>` on the
      // page's origin and path, so a fragment on this page never lands in it): no text beside it.
      const pageUrl = `${location.origin}${location.pathname}`;
      void shareText(navigator, { title: 'Gin Rummy', url: inviteUrl(code, pageUrl) }).then(
        (outcome) => {
          if (outcome === 'copied') toast(INVITE_COPIED_MSG, null);
          else if (outcome === 'failed') toast(roomCodeMsg(code), SHARE_FALLBACK_MS);
        },
      );
    },
    copy: (text) => {
      // The clipboard alone, no share sheet: a console call is for the keyboard, not a friend.
      const nav: ShareNavigatorLike = navigator;
      void nav.clipboard?.writeText(text).catch(() => undefined);
    },
    page: {
      fillName: (name) => {
        fillNameInputs(document, name);
      },
      fillP2Name: (name) => {
        fillP2NameInput(document, name);
      },
      setCode: (value) => {
        setCodeInput(document, value);
      },
    },
    dispatch: (intent) => {
      dispatch(intent);
    },
  };

  // The Score Counter: `window.SpeechRecognition || window.webkitSpeechRecognition` as the legacy read it.
  const speechGlobals = globalThis as unknown as Readonly<{
    SpeechRecognition?: new () => SpeechRecognizerLike;
    webkitSpeechRecognition?: new () => SpeechRecognizerLike;
  }>;
  const SpeechCtor = speechGlobals.SpeechRecognition ?? speechGlobals.webkitSpeechRecognition;
  const scorer = createScorer({
    doc: document,
    store,
    now,
    rng,
    fx: (cue) => {
      fx.play(cue);
    },
    toast: (message) => {
      toast(message, null);
    },
    dialogs: {
      prompt: (message, initial) => window.prompt(message, initial),
      confirm: (message) => window.confirm(message),
    },
    screens: {
      show: (screen) => {
        dispatch({ type: 'screen/show', screen });
      },
      initHome: () => {
        dispatch({ type: 'home/init', home: homeSnapshot() });
      },
      showScoreTab: () => {
        dispatch({ type: 'tab/set', tab: 'score' });
      },
      openRules: () => {
        dispatch({ type: 'rules/open' });
      },
      openHistory: () => {
        dispatch({ type: 'history/open', who: 'scorer' });
      },
    },
    download: downloadText,
    speech: SpeechCtor === undefined ? null : () => new SpeechCtor(),
    formatTime: fmtTime,
    formatDateTime: (ts) => new Date(ts).toLocaleString(),
  });
  page.__scorer = scorer;

  renderRules(document);
  renderSandbox(document);
  bindAll(document, dispatch);
  scorer.bind();
  paintSound(document, fx.enabled());
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
      dispatch({ type: 'home/init', home: homeSnapshot() });
    },
    fx,
    setHomeTab: (tab: string, opts?: Readonly<{ persist?: boolean }>) => {
      dispatch({ type: 'tab/set', tab, ...(opts?.persist === false ? { persist: false } : {}) });
    },
    setPlayMode: (mode: string) => {
      dispatch({ type: 'mode/set', mode });
    },
    /** The engine's legal actions for my view. */
    legal: (): ReadonlyArray<Action> => (app.view === null ? [] : legalActions(app.view)),
    /**
     * The layoffs the engine used to make by itself, then `finishLayoff` (§7b): what the drivers
     * (e2e/fixtures/gin-play.ts, tools/parity) play through a knock's layoff phase to land where
     * the automatic layoff landed. Host and pass-and-play only (the game is here).
     */
    layoffs: (): ReadonlyArray<Action> => (app.game === null ? [] : bestLayoffActions(app.game)),
    // The sandbox from the console (src/sandbox.ts): deal a map; read the table back as one.
    sandbox: (map: string) => {
      dispatch({ type: 'sandbox/start', map });
    },
    sandboxMap: (): string | null => (app.game === null ? null : formatMap(mapOf(app.game))),
    /** The card back, from the console for now: a preset is shown and remembered; anything else is logged and refused. */
    cardBack: (name: string): void => {
      if (!isCardBack(name)) {
        console.error(badCardBackMsg(name));
        return;
      }
      dispatch({ type: 'cardBack/set', back: name });
    },
    dispatch,
  };

  dispatch({ type: 'home/init', home: homeSnapshot() });
  // An invite link (`?join=<code>`, docs/ARCHITECTURE.md "Documented test hooks"): the code goes
  // into the join form once the home screen is up and leaves the address bar, so a reload or a
  // bookmark of this page lands on the ordinary home screen (the other hooks, `?peer=` and
  // `?ice=`, stay).
  const join = joinCodeFrom(location.search);
  if (join !== null) {
    dispatch({ type: 'join/link', code: join });
    const query = withoutJoin(location.search);
    history.replaceState(
      null,
      '',
      `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`,
    );
  }
};

boot();
