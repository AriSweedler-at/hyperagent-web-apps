// Boot (docs/ARCHITECTURE.md "Module boundaries": main.ts constructs the adapters and injects
// them; no logic). Two boots while docs/design/fidice-shell-adoption.md is under way (§4 M4;
// briscola's `?story=` is the edge precedent for a second boot): `?shell=1` boots the shared shell
// (`bootShell`, web/shared/edge/boot.ts) over the reducer (src/ui/state.ts), the painters
// (src/ui/render.ts) and the shared N-seat sessions (src/net/shell) and is remembered
// (`fidice_shell`, src/flag.ts); `?shell=0` forgets it; otherwise the remembered flag decides, and
// the old boot below runs as it did (typed from legacy/fidice/index.html lines 4002-4030, bundle
// section "// src/app/main.ts"; docs/MIGRATION.md step 9: PeerJS is bundled through
// web/shared/edge/transport.ts and the ICE loader is web/shared/edge/ice.ts, so the page loads
// neither the PeerJS CDN <script> nor shared/ice.js). The old path's one new behaviour is the
// flag read, and `shell` stripped from its share base so an opt-out never rides a `#join=` link
// (§6 risk 10). M6 (the flip) deletes the old boot, the flag and the node removal.
import { bootShell } from '../../shared/edge/boot.ts';
import { realClock } from '../../shared/edge/clock.ts';
import { browserNetDeps } from '../../shared/edge/netDeps.ts';
import { browserStore } from '../../shared/edge/storage.ts';
import type { Rng } from '../../shared/lib/rng.ts';
import { Controller } from './src/app/controller.ts';
import { browserEffects } from './src/app/effects.ts';
import { DICE_IMAGES } from './src/assets/diceImages.ts';
import { adoptLegacyName, legacyInviteUrl, shellPathOn, withoutShellParam } from './src/flag.ts';
import { createFx } from './src/fx.ts';
import { legalActions } from './src/legal.ts';
import { ClientSession } from './src/net/client.ts';
import { HostSession } from './src/net/host.ts';
import { clientTransport, hostTransport, type PeerDeps } from './src/net/peerjs.ts';
import { GuestSession as ShellGuestSession } from './src/net/shell/guest.ts';
import { HostSession as ShellHostSession } from './src/net/shell/host.ts';
import { isGuestFrame } from './src/protocol.ts';
import { STORAGE_KEYS, soundEnabled } from './src/storage.ts';
import { fillNameInputs, fillP2NameInput, setCodeInput } from './src/ui/home.ts';
import { bindAll, paint, paintSound, renderAbout, renderRules } from './src/ui/render.ts';
import {
  guestContextOf,
  hostContextOf,
  initialApp,
  readHome,
  reduce,
  runEffect,
  type App,
  type Fidice,
  type HostContext,
} from './src/ui/state.ts';
import type { Action, PublicState } from './src/domain/types.ts';

const injectDiceStyles = (): void => {
  const style = document.createElement('style');
  style.textContent = Object.entries(DICE_IMAGES)
    .map(([v, url]: readonly [string, string]) => `.die.v${v}{background-image:url("${url}")}`)
    .join('\n');
  document.head.appendChild(style);
};

/**
 * M2 of docs/design/fidice-shell-adoption.md: index.html is the composed shell page (./page.ts),
 * dark on this path. The vdom's `mount` replaces `#app`'s children, so the shell screens inside it
 * never show, but the nodes the page puts outside `#app` (the curtain, the rules, history and
 * ladder sheets, the toast) would, and the composed `#toast` would double the vdom's own inside
 * `#app-root`. Empty `#app` and remove every body node but it and the script before the mount,
 * so the old boot sees the empty page it always had. M6 (the flip) deletes this with the old boot.
 */
const dropShellNodes = (root: Readonly<Element>): void => {
  root.replaceChildren();
  Array.from(document.body.children)
    .filter((node: Readonly<Element>) => node !== root && node.tagName !== 'SCRIPT')
    .forEach((node: Readonly<Element>) => {
      node.remove();
    });
};

/** The old boot, as it was; the share base drops `shell` (§6 risk 10). */
const bootLegacy = (): void => {
  injectDiceStyles();
  // Lobby codes and ids draw from Math.random as on the legacy page (the e2e harness seeds it).
  const effects = browserEffects(Math.random);
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app root');
  dropShellNodes(root);
  const tokenKey = (code: string): string => `fidice-token-${code}`;
  // The documented test hooks on this page (docs/ARCHITECTURE.md "Module boundaries"): a seeded
  // rng a harness installs before boot, and the controller exposed after it.
  const page = window as Window & {
    __rng?: Rng;
    __fidice?: { controller: Controller };
  };
  // Only the host rolls dice; guests still get Math.random for nothing in particular, as before.
  const rng: Rng = page.__rng ?? Math.random;
  // PeerJS log level 1 as on the legacy page (e2e expectPeerOptions pins it); the shared deps
  // (web/shared/edge/netDeps.ts) read the ?peer= hook. This adapter has no keep-alive, so their
  // `onWake` is never subscribed here.
  const peerDeps: PeerDeps = browserNetDeps({ search: location.search, debug: 1 });
  const controller = new Controller(
    {
      effects,
      clock: realClock,
      doc: document,
      root,
      makeHost: (opts, events) =>
        new HostSession(
          {
            transport: hostTransport(opts.code, peerDeps),
            events,
            clock: realClock,
            rng,
            newId: effects.randomId,
          },
          opts,
        ),
      makeClient: (code, role, name, events) =>
        new ClientSession(
          {
            transport: clientTransport(code, peerDeps),
            events,
            clock: realClock,
            rememberToken: (t) => {
              effects.storage.set(tokenKey(code), t);
            },
          },
          {
            role,
            name,
            savedToken: role === 'player' ? effects.storage.get(tokenKey(code)) : null,
          },
        ),
    },
    `${location.origin}${location.pathname}${withoutShellParam(location.search)}`,
  );
  page.__fidice = { controller };
  controller.start();
};

/**
 * The shell path (§4 M4): the shared boot over fidice's reducer, painters, sessions and cue table.
 * The host context is the shell's plus `seats` (the codec's welcome lists the table past two
 * seats), and the seated adapter names each guest frame's seat (n-seat-sessions.md §7).
 */
const bootShellPath = (): void => {
  bootShell<Fidice, App, object, HostContext>({
    page: { doc: document, win: window, nav: navigator, store: browserStore(), clock: realClock },
    // PeerJS log level 1 as the legacy page set it (e2e expectPeerOptions pins it, tools/games.ts REGISTRY).
    game: { hook: '__fidice', title: 'Fidice', debug: 1 },
    // The shell's four cues alone until M9 (plan §7 D11); muted by default on a coarse pointer (the boot's fallback).
    sound: { enabled: soundEnabled, fontKey: STORAGE_KEYS.soundFont },
    reducer: { initialApp, reduce, runEffect, readHome, hostContextOf, guestContextOf },
    // `paintSound` adds `aria-pressed` to the shared paint; the toast wears no marks.
    paint: {
      paint,
      bindAll,
      paintSound,
      fillName: fillNameInputs,
      fillP2Name: fillP2NameInput,
      setCode: setCodeInput,
    },
    fx: createFx,
    net: { Host: ShellHostSession, Guest: ShellGuestSession, isGuestFrame, seats: true },
    legal: legalActions,
    deps: {},
    hooks: {
      // Before every home read: the legacy page's saved name follows the player onto this path
      // (§6 risk 14), and a bookmarked legacy invite (`#join=CODE`) becomes the shell's
      // `?join=CODE` before the boot's `applyInviteLink` reads the query (§7 D2, §6 lesson (e)).
      home: (store) => {
        adoptLegacyName(store);
        const url = legacyInviteUrl(location);
        if (url !== null) history.replaceState(null, '', url);
      },
      // The dice faces' styles (the old boot injects the same), then the rules into both slots and
      // the About copy (ui/rules.ts, ui/about.ts), once, before any paint.
      render: () => {
        injectDiceStyles();
        renderRules(document);
        renderAbout(document);
      },
      // `act` through the reducer; `view` my view; `setup` seats a position for e2e (pass the
      // phone only: the shell's `position/load` over the engine's decoder).
      hook: ({ app, dispatch }) => ({
        act: (action: Action) => {
          dispatch({ type: 'act', action });
        },
        view: (): PublicState | null => app().shell.view,
        setup: (state: unknown) => {
          dispatch({ type: 'position/load', state });
        },
      }),
    },
  });
};

const boot = (): void => {
  const shell = new URLSearchParams(location.search).get('shell');
  if (shellPathOn(browserStore(), shell)) bootShellPath();
  else bootLegacy();
};

boot();
