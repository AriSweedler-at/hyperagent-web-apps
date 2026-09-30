// Boot (docs/ARCHITECTURE.md "Module boundaries": main.ts constructs the adapters and injects
// them; no logic). The shared boot (web/shared/edge/boot.ts `bootShell`, docs/design/shared-shell.md
// §4.5, §5 C3) builds what gin's main.ts and this one spelled line for line (design §5.3 "main.ts
// boot", docs/design/backgammon-board.md §5.2): the real Transport (web/shared/edge/transport.ts,
// which bundles PeerJS and honours `?peer=`), the ICE loader, localStorage, the clock,
// `Math.random` (or the harness's `window.__rng`, read before anything draws so a seeded opening
// roll is the seeded one, R27), Web Audio, vibration and the wake lock, handed to the reducer
// (src/ui/state.ts) through `runEffect`, to the sessions (src/net) through their deps, and to the
// paint (src/ui/render.ts). This file passes the page's objects and what is this game's: its
// reducer, painters, sessions, cue table, sound keys, the two members of `window.__backgammon`
// (the documented test hook, design Q5) beyond the shared ones, and its shell config (`shell`:
// its `orientation: 'landscape'` has the boot watch the phone's orientation and paint the turn
// gate; docs/design/shared-shell.md "Playing sideways", docs/design/backgammon-landscape.md §5D).
// After the boot, the safe-area map on the root (src/safeArea.ts): the rail's side sideways.
import { bootShell } from '../../shared/edge/boot.ts';
import { realClock } from '../../shared/edge/clock.ts';
import { browserStore } from '../../shared/edge/storage.ts';
import { legalActions, type Action, type View } from './src/engine/index.ts';
import { createFx } from './src/fx.ts';
import { GuestSession } from './src/net/guest.ts';
import { HostSession } from './src/net/host.ts';
import { isGuestFrame } from './src/protocol.ts';
import { STORAGE_KEYS, soundEnabled } from './src/storage.ts';
import { fillNameInputs, fillP2NameInput, setCodeInput } from './src/ui/home.ts';
import { bindAll, paint, paintSound, toastMarks } from './src/ui/render.ts';
import { watchSafeArea } from './src/safeArea.ts';
import {
  BACKGAMMON,
  guestContextOf,
  hostContextOf,
  initialApp,
  readHome,
  reduce,
  runEffect,
  type App,
  type Backgammon,
} from './src/ui/state.ts';

bootShell<Backgammon, App>({
  page: { doc: document, win: window, nav: navigator, store: browserStore(), clock: realClock },
  // PeerJS log level 0 as gin's page (e2e expectPeerOptions pins it, tools/games.ts REGISTRY).
  game: { hook: '__backgammon', title: 'Sheshbesh', debug: 0 },
  sound: { enabled: soundEnabled, fontKey: STORAGE_KEYS.soundFont },
  reducer: { initialApp, reduce, runEffect, readHome, hostContextOf, guestContextOf },
  // The Kapará toast wears `hit` (`toastMarks`); `paintSound` adds `aria-pressed` to the shared paint.
  paint: {
    paint,
    bindAll,
    paintSound,
    toastMarks,
    fillName: fillNameInputs,
    fillP2Name: fillP2NameInput,
    setCode: setCodeInput,
  },
  fx: createFx,
  net: { Host: HostSession, Guest: GuestSession, isGuestFrame },
  legal: legalActions,
  deps: {},
  shell: BACKGAMMON,
  hooks: {
    // `act` through the reducer; `view` my view; `setup` seats a position for e2e and stories
    // (pass-and-play only: the shell's `position/load`, web/shared/ui/shell.ts).
    hook: ({ app, dispatch }) => ({
      act: (action: Action) => {
        dispatch({ type: 'act', action });
      },
      view: (): View | null => app().shell.view,
      setup: (state: unknown) => {
        dispatch({ type: 'position/load', state });
      },
    }),
  },
});
watchSafeArea(document, window);
