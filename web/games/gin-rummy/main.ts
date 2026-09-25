// Boot (docs/ARCHITECTURE.md "Module boundaries": main.ts constructs the adapters and injects
// them; no logic). Phase 1 of docs/MIGRATION.md step 12: the real Transport (web/shared/edge/
// transport.ts, which bundles PeerJS and honours `?peer=`), the ICE loader, localStorage, the
// clock, `Math.random` (or the harness's `window.__rng`), Web Audio, vibration and the wake lock
// are built by the shared boot (web/shared/edge/boot.ts `bootShell`, docs/design/shared-shell.md
// §4.5, §5 C3: what this file and backgammon's spelled line for line) and handed to the reducer
// (src/ui/state.ts) through `runEffect`, to the sessions (src/net) through their deps, and to the
// paint (src/ui/render.ts). What the legacy page did with the PeerJS CDN <script> and
// shared/ice.js arrives with this module instead, so index.html loads neither and defines neither
// `window.Peer` nor `window.HyperIce`; `window.__gin` stays as the documented test hook with the
// members the legacy exposed. This file keeps what is gin's alone: the stories page, the Score
// Counter, the card back, the sandbox, the layoffs hook and the clipboard `copy`.
import { bootShell, type BootCtx } from '../../shared/edge/boot.ts';
import { realClock } from '../../shared/edge/clock.ts';
import type { ShareNavigatorLike } from '../../shared/edge/share.ts';
import { browserStore, type Store } from '../../shared/edge/storage.ts';
import { bestLayoffActions, legalActions } from './src/engine/index.ts';
import type { Action } from './src/engine/types.ts';
import { createFx } from './src/fx.ts';
import { GuestSession } from './src/net/guest.ts';
import { HostSession } from './src/net/host.ts';
import { isGuestFrame } from './src/protocol.ts';
import { createScorer, type Scorer, type SpeechRecognizerLike } from './src/scorer/main.ts';
import { STORAGE_KEYS, migrateCardBack, soundEnabled } from './src/storage.ts';
import { badCardBackMsg, isCardBack, type CardBack } from './src/cardBack.ts';
import { formatMap, mapOf } from './src/sandbox.ts';
import { slotHandView } from './src/ui/hand/SlotHandView.ts';
import { fillNameInputs, fillP2NameInput, renderSandbox, setCodeInput } from './src/ui/home.ts';
import { bindAll, fmtTime, paint, paintSound, renderAbout, renderRules } from './src/ui/render.ts';
import {
  guestContextOf,
  hostContextOf,
  initialApp,
  readHome,
  reduce,
  runEffect,
  type App,
  type EffectDeps,
  type Gin,
} from './src/ui/state.ts';

/** Gin's effect adapters beside the shell's: the Score Counter and the clipboard. */
type GinDeps = Pick<EffectDeps, 'scorer' | 'copy'>;

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

/** The card back (src/cardBack.ts): a value the console left in storage that names no preset is logged and dropped before every home read, so the default stands and a reload logs it once. */
const dropBadCardBack = (store: Store): void => {
  const storedBack = store.readText(STORAGE_KEYS.cardPack);
  if (storedBack.ok && !isCardBack(storedBack.value)) {
    console.error(badCardBackMsg(storedBack.value));
    store.remove(STORAGE_KEYS.cardPack);
  }
};

/**
 * The Score Counter (src/scorer/main.ts): `window.SpeechRecognition || window.webkitSpeechRecognition`
 * as the legacy read it, the reducer's screens through `dispatch`, and the legacy `window.__scorer`.
 */
const bootScorer = (ctx: BootCtx<Gin, App>): Scorer => {
  const { dispatch, homeSnapshot } = ctx;
  const speechGlobals = globalThis as unknown as Readonly<{
    SpeechRecognition?: new () => SpeechRecognizerLike;
    webkitSpeechRecognition?: new () => SpeechRecognizerLike;
  }>;
  const SpeechCtor = speechGlobals.SpeechRecognition ?? speechGlobals.webkitSpeechRecognition;
  return createScorer({
    doc: document,
    store: ctx.store,
    now: ctx.now,
    rng: ctx.rng,
    fx: (cue) => {
      ctx.fx.play(cue, ctx.app().shell.soundFont);
    },
    toast: (message) => {
      ctx.toast(message, null);
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

  // The Score Counter's screen registers itself as the legacy `window.__scorer` did, and the
  // `scorer` effect resumes it through that name (the screen is built after the effect adapters).
  const page = window as Window & { __scorer?: Scorer };
  const store = browserStore();
  // The card back's key was renamed when the shared card packs landed (docs/design/card-packs.md
  // §2.2): a value left under the old key moves over once, and one that names no preset is logged
  // under the new key's message and dropped.
  const strayBack = migrateCardBack(store);
  if (strayBack !== null) console.error(badCardBackMsg(strayBack));
  bootShell<Gin, App, GinDeps>({
    page: { doc: document, win: window, nav: navigator, store, clock: realClock },
    // PeerJS log level 0 as on the legacy page (e2e expectPeerOptions pins it, tools/games.ts REGISTRY).
    game: { hook: '__gin', title: 'Gin Rummy', debug: 0 },
    sound: { enabled: soundEnabled, fontKey: STORAGE_KEYS.soundFont },
    reducer: { initialApp, reduce, runEffect, readHome, hostContextOf, guestContextOf },
    paint: {
      // The hand is drawn by the slot view with the ghost draw slot (docs/ARCHITECTURE.md "Seams
      // reserved": the view is another module and this choice; docs/design/gin-draw-ghost-slot.md).
      // Nothing is measured after a paint: the table's geometry is bounded by the viewport in theme.css.
      paint: (doc, app) => {
        paint(doc, app, slotHandView);
      },
      bindAll,
      paintSound,
      fillName: fillNameInputs,
      fillP2Name: fillP2NameInput,
      setCode: setCodeInput,
    },
    fx: createFx,
    net: { Host: HostSession, Guest: GuestSession, isGuestFrame },
    legal: legalActions,
    deps: {
      scorer: {
        resume: () => page.__scorer?.resume(),
      },
      copy: (text) => {
        // The clipboard alone, no share sheet: a console call is for the keyboard, not a friend.
        const nav: ShareNavigatorLike = navigator;
        void nav.clipboard?.writeText(text).catch(() => undefined);
      },
    },
    hooks: {
      home: dropBadCardBack,
      // The static markup and the Score Counter's screen before the binders; its controls bound after them.
      render: (ctx) => {
        page.__scorer = bootScorer(ctx);
        renderRules(document);
        renderAbout(document);
        renderSandbox(document);
      },
      bind: () => {
        page.__scorer?.bind();
      },
      // The members the legacy exposed beyond the shared ones (read-only state; actions go through the reducer).
      hook: ({ app, dispatch }) => ({
        act: (action: Action) => {
          dispatch({ type: 'act', action });
        },
        setHomeTab: (tab: string, opts?: Readonly<{ persist?: boolean }>) => {
          dispatch({
            type: 'tab/set',
            tab,
            ...(opts?.persist === false ? { persist: false } : {}),
          });
        },
        setPlayMode: (mode: string) => {
          dispatch({ type: 'mode/set', mode });
        },
        /**
         * The layoffs the engine used to make by itself, then `finishLayoff` (§7b): what the drivers
         * (e2e/fixtures/gin-play.ts, tools/parity) play through a knock's layoff phase to land where
         * the automatic layoff landed. Host and pass-and-play only (the game is here).
         */
        layoffs: (): ReadonlyArray<Action> => {
          const game = app().shell.game;
          return game === null ? [] : bestLayoffActions(game);
        },
        // The sandbox from the console (src/sandbox.ts): deal a map; read the table back as one.
        sandbox: (map: string) => {
          dispatch({ type: 'sandbox/start', map });
        },
        sandboxMap: (): string | null => {
          const game = app().shell.game;
          return game === null ? null : formatMap(mapOf(game));
        },
        /**
         * The card pack, from the console for now (docs/design/card-packs.md §2.2): a pack that draws
         * a French deck is shown and remembered; anything else is logged and refused. `cardBack` is
         * the documented older name of the same hook, kept as an alias for one release.
         */
        cardPack: (name: string): void => {
          if (!isCardBack(name)) {
            console.error(badCardBackMsg(name));
            return;
          }
          dispatch({ type: 'cardBack/set', back: name });
        },
        cardPackName: (): CardBack => app().table.cardBack,
        cardBack: (name: string): void => {
          if (!isCardBack(name)) {
            console.error(badCardBackMsg(name));
            return;
          }
          dispatch({ type: 'cardBack/set', back: name });
        },
      }),
    },
  });
};

boot();
