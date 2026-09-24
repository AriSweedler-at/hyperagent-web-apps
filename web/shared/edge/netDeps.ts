// The browser NetDeps an online page hands its sessions (scratchpad/bg/shared-shell.md §5 A4),
// moved verbatim from the three main.ts files: a Transport factory over `realTransport` (the one
// importer of peerjs; it reads the `?peer=` and `?ice-policy=` hooks from `search` itself) at the
// page's PeerJS log level, the ICE loader over the browser's fetch, the real clock, and `onWake`,
// the legacy `keepPeerAlive`'s two listeners (`document` visibilitychange, `window` online). Only
// `debug` differed between the pages (gin 0, backgammon 0, fidice 1, as their legacy pages had it;
// e2e `expectPeerOptions` pins each), so it is a parameter with no default. fidice's adapter has no
// keep-alive (its `PeerDeps` omits `onWake`) and never subscribes, so nothing is registered on its
// page. `document` and `window` are touched only inside `onWake`, when a session subscribes, so
// netDeps.test.ts constructs the deps in node and stubs the two globals for the wake test alone.
import { realClock } from './clock.ts';
import { browserIceDeps, createIce } from './ice.ts';
import type { NetDeps } from './peer.ts';
import { realTransport } from './transport.ts';

export type BrowserNetDepsOptions = Readonly<{
  /** The page's `location.search`: `realTransport` reads the `?peer=` hook from it. */
  search: string;
  /** The PeerJS log level the page's legacy set: 0 on gin's and backgammon's, 1 on fidice's. */
  debug: number;
  /** A page that wakes its sessions otherwise; by default the browser's visibilitychange + online. */
  onWake?: NetDeps['onWake'];
}>;

/** The legacy `keepPeerAlive` listeners: the page visible again, the network back. */
export const browserWake: NetDeps['onWake'] = (fn) => {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fn();
  });
  window.addEventListener('online', fn);
};

export const browserNetDeps = (options: BrowserNetDepsOptions): NetDeps => ({
  transportFor: (ice) => realTransport({ ice, search: options.search, debug: options.debug }),
  ice: createIce(browserIceDeps()),
  clock: realClock,
  onWake: options.onWake ?? browserWake,
});
