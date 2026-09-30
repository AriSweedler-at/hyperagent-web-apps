// Boot (docs/ARCHITECTURE.md "Module boundaries": main.ts constructs the adapters and injects them;
// no logic). A solo reaction game (docs/design/rps-island.md D1, §3): no seats, no room, no
// transport, so this page boots itself rather than through the shared shell. localStorage, the
// clock, `Math.random` (or the harness's `window.__rng`), Web Audio and vibration, `performance.now()`
// for the reaction time, handed to the reducer (src/ui/state.ts) through `run` and to the paint
// (src/ui/render.ts). `window.__rps` is the documented test hook: `app` as a getter, `dispatch`,
// `progress()`, `mood()`, and `rig({ computer, scrollMs })`, which fixes the next round's draws so
// e2e/rps.spec.ts plays a known round. The island half (src/island.ts, §8, §11) mounts into
// `#islandSlot` on an iPhone with a Dynamic Island: its reducer runs here the same way, with the
// fetch to the Worker, sessionStorage and two more named timers as its adapters; every save posts
// the round's mood. `window.__rps.island()` reads its state.
import { realClock } from '../../shared/edge/clock.ts';
import { createCuePlayer } from '../../shared/edge/cuePlayer.ts';
import { listen, requireId, type Element } from '../../shared/edge/dom.ts';
import {
  createAudioCues,
  vibrate,
  type AudioContextLike,
  type NavigatorLike,
} from '../../shared/edge/fx.ts';
import { reducedMotion } from '../../shared/edge/motion.ts';
import { applyLayout, readDevice, watchLayout } from '../../shared/edge/screen.ts';
import { createSampleCache } from '../../shared/edge/sound.ts';
import {
  browserStore,
  createStore,
  unavailableStore,
  type StorageLike,
  type Store,
} from '../../shared/edge/storage.ts';
import { deviceOf } from '../../shared/lib/devices.ts';
import type { Rng } from '../../shared/lib/rng.ts';
import { DEFAULT_SOUND_FONT } from '../../shared/lib/sound/fonts.ts';
import { createTimers } from '../../shared/ui/toast.ts';
import { moodOf, type Hand } from './src/engine/engine.ts';
import {
  MOOD_URL,
  OFF,
  bindIsland,
  hasIsland,
  newSession,
  pairUrl,
  paintIsland,
  pollAnswer,
  reduceIsland,
  rememberSession,
  sessionOf,
  startIsland,
  type IslandEffect,
  type IslandEvent,
  type IslandState,
  type IslandTimerId,
} from './src/island.ts';
import { readProgress, soundEnabled, writeProgress, writeSoundState } from './src/storage.ts';
import { RESET_CONFIRM, bind, paint, paintSound } from './src/ui/render.ts';
import { CUES, RESOLVE_BUZZ_MS } from './src/ui/sound.ts';
import {
  drawHand,
  drawScrollMs,
  initialApp,
  reduce,
  type App,
  type Effect,
  type Intent,
  type TimerId,
} from './src/ui/state.ts';

/** What the test hook may fix for the next round: the computer's hand, the scroll's length. */
type Rig = Readonly<{ computer?: Hand; scrollMs?: number }>;

type BootWindow = Readonly<{
  __rng?: Rng;
  __rps?: unknown;
  AudioContext?: new () => unknown;
  webkitAudioContext?: new () => unknown;
  sessionStorage?: StorageLike;
}>;

/** The tab's sessionStorage as a Store (the island's session, island.ts SESSION_KEY); naming it can throw in a private window. */
const sessionStore = (win: BootWindow): Store => {
  try {
    return win.sessionStorage === undefined
      ? unavailableStore('no sessionStorage')
      : createStore(win.sessionStorage);
  } catch (e) {
    return unavailableStore(e instanceof Error ? e.message : String(e));
  }
};

/** A same-origin JSON request to the Worker; the reply's status and parsed body (null when not JSON), or status 0 when the network failed. */
const callWorker = (
  url: string,
  init: Readonly<RequestInit>,
): Promise<Readonly<{ status: number; body: unknown }>> =>
  fetch(url, { ...init, cache: 'no-store' }).then(
    (r) =>
      r.json().then(
        (body: unknown) => ({ status: r.status, body }),
        () => ({ status: r.status, body: null }),
      ),
    () => ({ status: 0, body: null }),
  );

/** `SoundDeps.fetchBuffer` over the page's fetch (the sample seam; nothing in the shipped fonts uses it). */
const fetchArrayBuffer = (url: string): Promise<ArrayBuffer> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${String(r.status)} ${url}`);
    return r.arrayBuffer();
  });

const boot = (): void => {
  const doc = document;
  const win = window as unknown as BootWindow;
  const nav = navigator as NavigatorLike;
  const store = browserStore();
  const clock = realClock;
  const rng: Rng = win.__rng ?? Math.random;
  const font = DEFAULT_SOUND_FONT;
  const timers = createTimers<TimerId | 'hop' | IslandTimerId>(clock);
  // A phone starts muted (docs/design/sound-fonts.md §12); a remembered preference wins.
  const coarsePointer = matchMedia('(pointer: coarse)').matches;
  const AudioCtor = win.AudioContext ?? win.webkitAudioContext;
  const audio = createAudioCues({
    makeContext: AudioCtor === undefined ? undefined : () => new AudioCtor() as AudioContextLike,
    enabled: soundEnabled(store, !coarsePointer),
  });
  const fx = createCuePlayer({
    audio,
    sound: { fetchBuffer: fetchArrayBuffer, cache: createSampleCache() },
    vibrate: (pattern) => {
      vibrate(nav, pattern);
    },
    cues: CUES,
    persist: (state) => {
      writeSoundState(store, state);
    },
    onToggle: (enabled) => {
      paintSound(doc, enabled);
    },
  });
  const now = (): number => performance.now();

  let app: App = initialApp(readProgress(store));
  let rig: Rig = {};
  const options = {
    reducedMotion: reducedMotion(),
    afterHop: (ms: number, fn: () => void) => {
      timers.start('hop', ms, fn);
    },
  };

  const go = (): void => {
    const scrollMs = rig.scrollMs ?? drawScrollMs(rng);
    dispatch({ type: 'go', scrollMs });
  };

  const fire = (id: TimerId): void => {
    switch (id) {
      case 'scroll':
        dispatch({ type: 'scroll/tick' });
        return;
      case 'resolve': {
        const computer = rig.computer ?? drawHand(rng);
        rig = {};
        dispatch({ type: 'resolve', computer, at: now() });
        return;
      }
      case 'window':
        dispatch({ type: 'timeout' });
        return;
      case 'next':
        go();
        return;
      default: {
        const never: never = id;
        return never;
      }
    }
  };

  const run = (effect: Effect): void => {
    switch (effect.kind) {
      case 'timer':
        timers.start(effect.id, effect.ms, () => {
          fire(effect.id);
        });
        return;
      case 'cancel':
        timers.cancel(effect.id);
        return;
      case 'cue':
        fx.play(effect.cue, font);
        // The cue player skips a muted row's buzz; the resolve's haptic is a game signal, not a sound.
        if (effect.cue === 'resolve' && !fx.enabled()) vibrate(nav, RESOLVE_BUZZ_MS);
        return;
      case 'save':
        writeProgress(store, app.progress);
        dispatchIsland({ type: 'round', progress: app.progress, at: clock.now() });
        return;
      default: {
        const never: never = effect;
        return never;
      }
    }
  };

  const dispatch = (intent: Intent): void => {
    const step = reduce(app, intent);
    app = step.app;
    step.effects.forEach(run);
    paint(doc, app, options);
  };

  bind(doc, {
    dispatch,
    go,
    now,
    reset: () => {
      if (confirm(RESET_CONFIRM)) dispatch({ type: 'reset' });
    },
    toggleSound: () => {
      fx.toggle(font);
    },
  });
  // Desktop: 1, 2, 3 (or r, p, s) are the hands; Space or Enter is Go.
  listen(doc, 'keydown', (e) => {
    const key = (e as Partial<KeyboardEvent>).key ?? '';
    const hand: Hand | undefined = {
      '1': 'rock',
      r: 'rock',
      '2': 'paper',
      p: 'paper',
      '3': 'scissors',
      s: 'scissors',
    }[key] as Hand | undefined;
    if (hand !== undefined) dispatch({ type: 'tap', hand, at: now() });
    else if (
      (key === ' ' || key === 'Enter') &&
      app.phase.kind !== 'scrolling' &&
      app.phase.kind !== 'armed'
    ) {
      e.preventDefault();
      go();
    }
  });
  // Browsers start audio after a gesture: the first one warms the context.
  listen(doc, 'pointerdown', () => {
    fx.warm(font);
  });

  // The island (src/island.ts): the reducer's effects onto the fetch, the timers and sessionStorage.
  const head: Element = doc.head;
  const sessions = sessionStore(win);
  let island: IslandState = OFF;
  const runIsland = (effect: IslandEffect): void => {
    switch (effect.kind) {
      case 'poll':
        void callWorker(pairUrl(effect.session), { method: 'GET' }).then(({ status, body }) => {
          dispatchIsland({
            type: 'poll/result',
            answer: pollAnswer(status, body),
            at: clock.now(),
          });
        });
        return;
      case 'post':
        void callWorker(MOOD_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(effect.body),
        }).then(({ status }) => {
          dispatchIsland({ type: 'post/done', status, at: clock.now() });
        });
        return;
      case 'timer':
        timers.start(effect.id, effect.ms, () => {
          dispatchIsland(effect.id === 'island/poll' ? { type: 'poll/tick' } : { type: 'flush' });
        });
        return;
      case 'cancel':
        timers.cancel(effect.id);
        return;
      case 'remember':
        rememberSession(sessions, effect.session);
        return;
      case 'sync':
        dispatchIsland({ type: 'round', progress: app.progress, at: clock.now() });
        return;
      default: {
        const never: never = effect;
        return never;
      }
    }
  };
  const dispatchIsland = (event: IslandEvent): void => {
    const step = reduceIsland(island, event);
    island = step.state;
    step.effects.forEach(runIsland);
    paintIsland(doc, head, island);
  };
  const inputs = readDevice(doc, win as Parameters<typeof readDevice>[1]);
  if (hasIsland(inputs === null ? null : deviceOf(inputs))) {
    const session = sessionOf(sessions) ?? newSession();
    rememberSession(sessions, session);
    bindIsland(doc, (action) => {
      if (action === 'send') dispatchIsland({ type: 'send', at: clock.now() });
      else if (action === 'retry') dispatchIsland({ type: 'retry', at: clock.now() });
      else dispatchIsland({ type: 'home', session: newSession() });
    });
    const start = startIsland(session);
    island = start.state;
    paintIsland(doc, head, island);
    start.effects.forEach(runIsland);
  } else {
    requireId(doc, 'islandSlot');
  }

  // The layout bucket on `<body data-layout>` (docs/design/layout-buckets.md §3; theme.css lays the
  // wide grid out for every bucket but the upright ones), as the shell's boot writes it for a game,
  // kept live over a turn of the phone or a window dragged.
  const screenDoc = doc as unknown as Parameters<typeof applyLayout>[0];
  const screenWin = win as unknown as Parameters<typeof applyLayout>[1];
  applyLayout(screenDoc, screenWin);
  watchLayout(screenWin, () => {
    applyLayout(screenDoc, screenWin);
  });

  paintSound(doc, fx.enabled());
  paint(doc, app, options);

  const hook = {
    get app() {
      return app;
    },
    dispatch,
    progress: () => app.progress,
    mood: () => moodOf(app.progress.counter),
    island: () => island,
    rig: (next: Rig) => {
      rig = { ...rig, ...next };
    },
  };
  (win as unknown as Record<string, unknown>)['__rps'] = hook;
};

boot();
