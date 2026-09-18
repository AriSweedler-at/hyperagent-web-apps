// Boot (docs/ARCHITECTURE.md "Module boundaries": main.ts constructs the adapters and injects
// them; no logic). Typed from legacy/fidice/index.html lines 4002-4030 (bundle section
// "// src/app/main.ts"). What the port changed (docs/MIGRATION.md step 9): PeerJS is bundled
// through web/shared/edge/transport.ts and the ICE loader is web/shared/edge/ice.ts, so the page
// loads neither the PeerJS CDN <script> nor shared/ice.js and defines neither `window.Peer` nor
// `window.HyperIce`. Both libraries now arrive with this module instead of before it; the ICE
// fetch itself still starts when a table is created or joined, as it did.
import { realClock } from '../../shared/edge/clock.ts';
import { browserIceDeps, createIce } from '../../shared/edge/ice.ts';
import { realTransport } from '../../shared/edge/transport.ts';
import type { Rng } from '../../shared/lib/rng.ts';
import { Controller } from './src/app/controller.ts';
import { browserEffects } from './src/app/effects.ts';
import { DICE_IMAGES } from './src/assets/diceImages.js';
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

const boot = (): void => {
  injectDiceStyles();
  // Lobby codes and ids draw from Math.random as on the legacy page (the e2e harness seeds it).
  const effects = browserEffects(Math.random);
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app root');
  const tokenKey = (code: string): string => `fidice-token-${code}`;
  // The documented test hooks on this page (docs/ARCHITECTURE.md "Module boundaries"): a seeded
  // rng a harness installs before boot, and the controller exposed after it.
  const page = window as Window & {
    __rng?: Rng;
    __fidice?: { controller: Controller };
  };
  // Only the host rolls dice; guests still get Math.random for nothing in particular, as before.
  const rng: Rng = page.__rng ?? Math.random;
  const peerDeps: PeerDeps = {
    // PeerJS log level 1 as on the legacy page; realTransport reads the ?peer= hook itself.
    transportFor: (ice) => realTransport({ ice, search: location.search, debug: 1 }),
    ice: createIce(browserIceDeps()),
    clock: realClock,
  };
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
