// Boot (docs/ARCHITECTURE.md "Module boundaries": main.ts constructs the adapters and injects
// them; no logic). Typed from legacy/fidice/index.html lines 4002-4030 (bundle section
// "// src/app/main.ts"). What the port changed (docs/MIGRATION.md step 9): PeerJS is bundled
// through web/shared/edge/transport.ts and the ICE loader is web/shared/edge/ice.ts, so the page
// loads neither the PeerJS CDN <script> nor shared/ice.js and defines neither `window.Peer` nor
// `window.HyperIce`. Both libraries now arrive with this module instead of before it; the ICE
// fetch itself still starts when a table is created or joined, as it did.
import { realClock } from '../../shared/edge/clock.ts';
import { browserNetDeps } from '../../shared/edge/netDeps.ts';
import type { Rng } from '../../shared/lib/rng.ts';
import { Controller } from './src/app/controller.ts';
import { browserEffects } from './src/app/effects.ts';
import { DICE_IMAGES } from './src/assets/diceImages.ts';
import { ClientSession } from './src/net/client.ts';
import { HostSession } from './src/net/host.ts';
import { clientTransport, hostTransport, type PeerDeps } from './src/net/peerjs.ts';

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

const boot = (): void => {
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
    `${location.origin}${location.pathname}${location.search}`,
  );
  page.__fidice = { controller };
  controller.start();
};

boot();
