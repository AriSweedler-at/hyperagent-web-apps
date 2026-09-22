// PeerJS as the sessions see it (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html
// lines 2111-2212 (bundle section "// src/net/peerjs.ts") as a thin adapter over the shared
// Transport (web/shared/edge/transport.ts, the one importer of `peerjs`). What the legacy section
// did with `globalThis.Peer` and `globalThis.HyperIce` it now does with two injected
// dependencies: a Transport factory that takes the ICE result (main.ts hands it `realTransport`,
// which honours the `?peer=` hook), and the ICE loader (or null: the page without shared/ice.js).
// The Peer still exists only once `ice.load()` resolves, listeners registered before then are
// queued and replayed in order, and the relay probe runs on the injected Clock.
import type { IceResult, NetDeps } from '../../../../shared/edge/peer.ts';
import type { Connection, PeerHandle } from '../../../../shared/edge/transport.ts';
import { peerIdFor } from '../../../../shared/lib/roomCode.ts';
import type { ClientTransport, ErrorKind, HostTransport } from './session.ts';

export type { IceLoader, IceResult } from '../../../../shared/edge/peer.ts';

/**
 * The shared NetDeps (web/shared/edge/peer.ts) without `onWake`: this adapter has no keep-alive, so
 * nothing here listens for the page waking. main.ts passes `(ice) => realTransport({ ice, search,
 * debug: 1 })` as `transportFor`.
 */
export type PeerDeps = Omit<NetDeps, 'onWake'>;

/** How long after the channel opens the relay probe looks at the selected candidate pair. */
const PATH_PROBE_MS = 3000;
const NO_RELAY_INFO = 'No relay configured — players must be on the same network to join.';

type Ready = (peer: PeerHandle, ice: IceResult | null) => void;

type DeferredPeer = Readonly<{
  /** Run `fn` with the Peer, now or as soon as it exists. */
  ready: (fn: Ready) => void;
  onError: (fn: (kind: ErrorKind) => void) => void;
  close: () => void;
}>;

/**
 * A Peer whose ICE servers (STUN/TURN) come from the ICE loader. The Peer exists only once
 * `ice.load()` resolves, so listeners registered before then are queued and replayed. Without a
 * loader the Peer is created immediately with PeerJS defaults, as before.
 */
const deferredPeer = (id: string | undefined, deps: PeerDeps): DeferredPeer => {
  let peer: PeerHandle | null = null;
  let iceResult: IceResult | null = null;
  let closed = false;
  const queued: Ready[] = [];
  const errorFns: ((kind: ErrorKind) => void)[] = [];
  const ready = (fn: Ready): void => {
    if (peer) fn(peer, iceResult);
    else queued.push(fn);
  };
  const create = (res: IceResult | null): void => {
    if (closed) return;
    iceResult = res;
    try {
      peer = deps.transportFor(res).open(id);
    } catch (e) {
      errorFns.forEach((fn) => {
        fn(e instanceof Error ? e.message : String(e));
      });
      return;
    }
    const created = peer;
    queued.splice(0).forEach((fn) => {
      fn(created, iceResult);
    });
  };
  if (deps.ice)
    void deps.ice.load().then(create, () => {
      create(null);
    });
  else peer = deps.transportFor(null).open(id);
  return {
    ready,
    onError: (fn) => {
      errorFns.push(fn);
      ready((p) => {
        p.on('error', (e) => {
          fn(e.type);
        });
      });
    },
    close: () => {
      closed = true;
      peer?.destroy();
    },
  };
};

/**
 * A while after the data channel opens, say so if it runs through a TURN relay. Fires after
 * TOAST_MS so it never replaces an info toast the host sends in reply to hello; a direct path
 * is the ordinary case and stays silent.
 */
const describePath = (c: Connection, deps: PeerDeps, fn: (message: string) => void): void => {
  const ice = deps.ice;
  if (!ice) return;
  deps.clock.setTimeout(() => {
    if (!c.open()) return;
    void ice.describe(c.peerConnection()).then((d) => {
      if (d.path === 'relay') fn('Connected via relay');
    });
  }, PATH_PROBE_MS);
};

const hostTransport = (code: string, deps: PeerDeps): HostTransport => {
  const p = deferredPeer(peerIdFor('fidice', code), deps);
  return {
    onOpen: (fn) => {
      p.ready((peer) => {
        peer.on('open', () => {
          fn();
        });
      });
    },
    onError: p.onError,
    onConnection: (fn) => {
      p.ready((peer) => {
        peer.on('connection', (c) => {
          fn(c);
        });
      });
    },
    onInfo: (fn) => {
      p.ready((peer, res) => {
        if (res && !res.hasTurn)
          peer.on('open', () => {
            fn(NO_RELAY_INFO);
          });
      });
    },
    close: p.close,
  };
};

const clientTransport = (code: string, deps: PeerDeps): ClientTransport => {
  const p = deferredPeer(undefined, deps);
  const infoFns: ((message: string) => void)[] = [];
  return {
    onOpen: (fn) => {
      p.ready((peer) => {
        peer.on('open', () => {
          const c = peer.connect(peerIdFor('fidice', code));
          c.onOpen(() => {
            fn(c);
            describePath(c, deps, (m) => {
              infoFns.forEach((g) => {
                g(m);
              });
            });
          });
        });
      });
    },
    onError: p.onError,
    onInfo: (fn) => {
      infoFns.push(fn);
    },
    close: p.close,
  };
};

export { PATH_PROBE_MS, NO_RELAY_INFO, deferredPeer, describePath, hostTransport, clientTransport };
