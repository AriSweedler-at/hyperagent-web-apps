// Boot (docs/ARCHITECTURE.md "Module boundaries": main.ts constructs the adapters and injects
// them; no logic). Gin's main.ts line for line where the games agree (design §5.3 "main.ts boot",
// docs/design/backgammon-board.md §5.2): the real Transport (web/shared/edge/transport.ts, which bundles PeerJS
// and honours `?peer=`), the ICE loader, localStorage, the clock, `Math.random` (or the harness's
// `window.__rng`, read before anything draws so a seeded opening roll is the seeded one, R27),
// Web Audio, vibration and the wake lock are built here and handed to the reducer (src/ui/state.ts)
// through `runEffect`, to the sessions (src/net) through their deps, and to the paint
// (src/ui/render.ts). `window.__backgammon` is the documented test hook (design Q5).
import { realClock } from '../../shared/edge/clock.ts';
import {
  createAudioCues,
  createWakeLock,
  vibrate,
  type AudioContextLike,
  type NavigatorLike,
} from '../../shared/edge/fx.ts';
import { joinCodeFrom, withoutJoin } from '../../shared/edge/invite.ts';
import { browserNetDeps } from '../../shared/edge/netDeps.ts';
import { shareText } from '../../shared/edge/share.ts';
import { bindJargon, revealRule } from '../../shared/edge/glossary.ts';
import { createSampleCache } from '../../shared/edge/sound.ts';
import { browserStore } from '../../shared/edge/storage.ts';
import type { Rng } from '../../shared/lib/rng.ts';
import { ruleFromHash } from '../../shared/ui/glossary.ts';
import { createTimers, createToaster } from '../../shared/ui/toast.ts';
import { badSoundFontMsg, isSoundFont } from '../../shared/lib/sound/fonts.ts';
import { legalActions, type Action, type View } from './src/engine/index.ts';
import { createFx } from './src/fx.ts';
import { GuestSession, type GuestEvents } from './src/net/guest.ts';
import { HostSession, type HostEvents } from './src/net/host.ts';
import type { NetDeps } from '../../shared/edge/peer.ts';
import { isGuestFrame } from './src/protocol.ts';
import { STORAGE_KEYS, soundEnabled } from './src/storage.ts';
import { fillNameInputs, fillP2NameInput, inviteUrl, setCodeInput } from './src/ui/home.ts';
import { bindAll, paint, paintSound, toastMarks } from './src/ui/render.ts';
import {
  INVITE_COPIED_MSG,
  SHARE_FALLBACK_MS,
  guestContextOf,
  hostContextOf,
  initialApp,
  readHome,
  reduce,
  runEffect,
  type App,
  type EffectDeps,
  type HomeSnapshot,
  type Intent,
  type ScreenId,
  type TimerId,
} from './src/ui/state.ts';

/** `shareText`'s last resort: the code itself, for the player to read out. */
const roomCodeMsg = (code: string): string => `Room code: ${code}`;

const boot = (): void => {
  // The documented test hooks on this page (docs/ARCHITECTURE.md "Documented test hooks"): a seeded
  // rng a harness installs before boot, and the app hook set after it.
  const page = window as Window & { __rng?: Rng; __backgammon?: unknown };
  const store = browserStore();
  // The sound font (docs/design/sound-fonts.md §6): a value the console left in storage that names
  // no preset is logged and dropped before every home read, so the default stands.
  const homeSnapshot = (): HomeSnapshot => {
    const storedFont = store.readText(STORAGE_KEYS.soundFont);
    if (storedFont.ok && !isSoundFont(storedFont.value)) {
      console.error(badSoundFontMsg(STORAGE_KEYS.soundFont, storedFont.value));
      store.remove(STORAGE_KEYS.soundFont);
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
  /** The reducer's named timers (the long press, the shake, the R14 beat); arming one again restarts it. */
  const timers = createTimers<TimerId>(realClock);
  /** Gin's `toast(msg, ms)` with its 2.6 s default (design Q12); the Kapará toast wears `hit`. */
  const toast = createToaster(document, realClock, undefined, toastMarks);

  const fx = createFx({
    audio,
    // The sample seam (docs/design/sound-fonts.md §3): a document-relative URL, so both origins serve it.
    sound: {
      fetchBuffer: (url) =>
        fetch(url).then((r) => {
          if (!r.ok) throw new Error(`${String(r.status)} ${url}`);
          return r.arrayBuffer();
        }),
      cache: createSampleCache(),
    },
    vibrate: (pattern) => {
      vibrate(nav, pattern);
    },
    store,
    onToggle: (enabled) => {
      paintSound(document, enabled);
    },
  });

  // PeerJS log level 0 as gin's page (e2e expectPeerOptions pins it); the shared deps
  // (web/shared/edge/netDeps.ts) read the ?peer= hook and wake the sessions on visibility/online.
  const netDeps: NetDeps = browserNetDeps({ search: location.search, debug: 0 });

  const repaint = (): void => {
    paint(document, app);
  };

  const dispatch = (intent: Intent): void => {
    const step = reduce(app, intent, { rng, now });
    // The paint is a function of the App, so an unchanged App needs none. This matters on a
    // checker's pointerdown: a repaint would replace the element under the pointer, and the
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
    fx: (cue, font) => {
      fx.play(cue, font);
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
      // Gin's chain: the share sheet (a phone's OS menu), else the clipboard with a toast
      // (desktop), else the code itself. The invite is the link alone (`?join=<code>` on the
      // page's origin and path, so a fragment on this page never lands in it): no text beside it.
      const pageUrl = `${location.origin}${location.pathname}`;
      void shareText(navigator, { title: 'Sheshbesh', url: inviteUrl(code, pageUrl) }).then(
        (outcome) => {
          if (outcome === 'copied') toast(INVITE_COPIED_MSG, null);
          else if (outcome === 'failed') toast(roomCodeMsg(code), SHARE_FALLBACK_MS);
        },
      );
    },
    revealRule: (slot, rule) => {
      revealRule(document, slot, rule);
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

  bindAll(document, dispatch);
  // A tap on jargon in the About copy or in a rule (docs/design/glossary-links.md) shows that rule.
  bindJargon(document, (rule) => {
    dispatch({ type: 'rules/show', rule });
  });
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

  // The test/debug hook (design §5.3, Q5): read-only state, actions through the reducer. `app` is
  // a getter so a reader always sees the current record; `setup` seats a position for e2e and
  // stories (pass-and-play only, ui/state.ts `sandbox/load`).
  page.__backgammon = {
    get app(): App {
      return app;
    },
    dispatch,
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
    /** The engine's legal actions for my view. */
    legal: (): ReadonlyArray<Action> =>
      app.shell.view === null ? [] : legalActions(app.shell.view),
    view: (): View | null => app.shell.view,
    setup: (state: unknown) => {
      dispatch({ type: 'sandbox/load', state });
    },
    /** The sound font, from the console for now (docs/design/sound-fonts.md §6): a font plays from now on and is remembered; anything else is logged and refused. */
    soundFont: (name: string): void => {
      if (!isSoundFont(name)) {
        console.error(badSoundFontMsg(STORAGE_KEYS.soundFont, name));
        return;
      }
      dispatch({ type: 'soundFont/set', font: name });
    },
    soundFontName: (): string => app.shell.soundFont,
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
  // A rule deep link (`#rule-<id>`, docs/design/glossary-links.md §1): the Rules tab, scrolled to
  // that rule. The hash stays, so the link can be copied from the address bar.
  const rule = ruleFromHash(location.hash);
  if (rule !== null) dispatch({ type: 'rules/show', rule });
};

boot();
