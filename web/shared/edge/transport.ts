// The only module that imports "peerjs" (docs/ARCHITECTURE.md "Module boundaries"; the lint rule
// `no-restricted-imports` enforces it). net/ code is written against `Transport`, `PeerHandle` and
// `Connection` below and receives this real adapter from main.ts or `transport.fake.ts` from a
// test; `transport.contract.ts` is the behaviour both must show. Options follow the legacy pages
// exactly: `{ debug, config: peerConfig(ice) }` when ICE loaded, `{ debug }` when it did not, and
// the documented `?peer=host:port` test hook adds `{ host, port, path: '/', secure: false }`.
import { Peer, util, type DataConnection } from 'peerjs';

import { peerConfig, type IceResult, type PeerConnectionLike, type PeerIceConfig } from './ice.ts';

export type TransportError = Readonly<{ type: string; message: string }>;

/** One data channel to a remote peer (PeerJS `DataConnection`, `reliable: true`). */
export type Connection = Readonly<{
  /** The remote peer's broker id. */
  peer: string;
  /** True between the channel opening and either side closing it. */
  open: () => boolean;
  /**
   * Frames cross the wire as PeerJS BinaryPack (`serialization: 'default'`), not structured clone:
   * `undefined` arrives as `null` (in objects and arrays alike), a `Date` as its `toString()`,
   * `NaN` as a denormal, and `Infinity`, `Map`, `Set` and `BigInt` throw synchronously. Decoders
   * of optional fields must therefore accept `null` (see `wireClone`).
   */
  send: (data: unknown) => void;
  onOpen: (fn: () => void) => void;
  onMessage: (fn: (data: unknown) => void) => void;
  onClose: (fn: () => void) => void;
  onError: (fn: (error: TransportError) => void) => void;
  close: () => void;
  /** The underlying RTCPeerConnection for `ice.describe`; null before negotiation and on fakes. */
  peerConnection: () => PeerConnectionLike | null;
}>;

export type PeerEvents = Readonly<{
  /** Registered with the broker under `id`. */
  open: (id: string) => void;
  /** A remote peer connected to us (host side). */
  connection: (conn: Connection) => void;
  error: (error: TransportError) => void;
  /** The broker socket dropped; `reconnect` restores it (legacy `keepPeerAlive`). */
  disconnected: () => void;
  /** Destroyed. */
  close: () => void;
}>;

/** A registered peer: PeerJS `Peer`, narrowed to what the games use. */
export type PeerHandle = Readonly<{
  /** The broker id, once `open` fired; null before. */
  id: () => string | null;
  on: <K extends keyof PeerEvents>(event: K, fn: PeerEvents[K]) => void;
  /**
   * Open a channel to `peerId`. When the broker socket is down (or the peer is destroyed) PeerJS
   * refuses, emits `error{type:'disconnected'}` on the peer, and the Connection returned here is
   * inert: never opens, never fires, `send`/`close` are no-ops.
   */
  connect: (peerId: string) => Connection;
  /** No-op unless disconnected and not destroyed (legacy `keepPeerAlive`); never throws. */
  reconnect: () => void;
  destroy: () => void;
  destroyed: () => boolean;
  disconnected: () => boolean;
}>;

export type Transport = Readonly<{
  /** Register with the broker under `id` (a host), or let it assign one (`undefined`, a guest). */
  open: (id: string | undefined) => PeerHandle;
}>;

// ---------------------------------------------------------------------------------------------
// Options, exactly as the legacy pages build them
// ---------------------------------------------------------------------------------------------

/** The `?peer=host:port` hook: a local PeerServer instead of 0.peerjs.com. */
export type PeerOverride = Readonly<{ host: string; port: number; path: '/'; secure: false }>;

export const peerOverrideFrom = (search: string): PeerOverride | null => {
  const m = /^([^:/]+):(\d+)$/.exec(new URLSearchParams(search).get('peer') ?? '');
  return m?.[1] !== undefined && m[2] !== undefined
    ? { host: m[1], port: Number(m[2]), path: '/', secure: false }
    : null;
};

export type PeerJsOptions = Readonly<{
  debug: number;
  config?: PeerIceConfig;
  host?: string;
  port?: number;
  path?: '/';
  secure?: false;
}>;

/** Legacy gin `peerOptsFor(ice)` / fidice `withPeerOverride(...)`: ICE config first, then the override. */
export const peerOptionsFor = (
  ice: IceResult | null,
  override: PeerOverride | null,
  debug: number,
): PeerJsOptions => {
  const base: PeerJsOptions = ice === null ? { debug } : { debug, config: peerConfig(ice) };
  return override === null ? base : { ...base, ...override };
};

// ---------------------------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------------------------

const asError = (e: Readonly<{ type: string; message: string }>): TransportError => ({
  type: e.type,
  message: e.message,
});

/**
 * PeerJS types `Peer.id` and `DataConnection.peerConnection` as always present, but both are
 * undefined until the broker answers or negotiation starts. Widening through a call (not an
 * assertion) keeps the narrowing rules honest about that.
 */
const runtimeOptional = <T>(value: T): T | undefined => value;

/**
 * What the receiver sees when `data` crosses a real data channel: a round trip through the
 * BinaryPack codec PeerJS 1.5.4 uses for `serialization: 'default'` (re-exported as `util.pack`
 * and `util.unpack`). `transport.fake.ts` clones every frame with this, so a Session that passes
 * over the fake has already met the wire's rewrites (`undefined` -> `null`, `Date` -> string) and
 * its throws (`Infinity`, `Map`, `Set`, `BigInt`). Blob frames pack asynchronously and are not
 * something the games send, so they are refused rather than modelled.
 */
export const wireClone = (data: unknown): unknown => {
  const packed = util.pack(data as Parameters<typeof util.pack>[0]);
  if (packed instanceof Promise) throw new Error('Blob frames are not supported');
  return util.unpack(packed);
};

const noop = (): void => undefined;

/** What `connect` returns when PeerJS refused: the error has already been emitted on the peer. */
const closedConnection = (peer: string): Connection => ({
  peer,
  open: () => false,
  send: noop,
  onOpen: noop,
  onMessage: noop,
  onClose: noop,
  onError: noop,
  close: noop,
  peerConnection: () => null,
});

// PeerJS objects are taken readonly: only their methods are called.
const wrapConnection = (dc: Readonly<DataConnection>): Connection => ({
  peer: dc.peer,
  open: () => dc.open,
  send: (data) => {
    void dc.send(data);
  },
  onOpen: (fn) => {
    dc.on('open', fn);
  },
  onMessage: (fn) => {
    dc.on('data', fn);
  },
  onClose: (fn) => {
    dc.on('close', fn);
  },
  onError: (fn) => {
    dc.on('error', (e: TransportError) => {
      fn(asError(e));
    });
  },
  close: () => {
    dc.close();
  },
  peerConnection: () => runtimeOptional(dc.peerConnection) ?? null,
});

/** One subscriber per event, so `on` needs no cast from the generic event name. */
const peerListeners = (
  peer: Readonly<Peer>,
): Readonly<{ [K in keyof PeerEvents]: (fn: PeerEvents[K]) => void }> => ({
  open: (fn) => {
    peer.on('open', fn);
  },
  connection: (fn) => {
    peer.on('connection', (dc: Readonly<DataConnection>) => {
      fn(wrapConnection(dc));
    });
  },
  error: (fn) => {
    peer.on('error', (e: TransportError) => {
      fn(asError(e));
    });
  },
  disconnected: (fn) => {
    peer.on('disconnected', () => {
      fn();
    });
  },
  close: (fn) => {
    peer.on('close', fn);
  },
});

const wrapPeer = (peer: Readonly<Peer>): PeerHandle => {
  const listeners = peerListeners(peer);
  return {
    id: () => runtimeOptional(peer.id) ?? null,
    on: (event, fn) => {
      listeners[event](fn);
    },
    connect: (peerId) => {
      // Typed as always returning a DataConnection, but a disconnected peer returns undefined
      // after emitting `error{type:'disconnected'}` (legacy gin's tryJoin guarded the same case).
      const dc = runtimeOptional(peer.connect(peerId, { reliable: true }));
      return dc === undefined ? closedConnection(peerId) : wrapConnection(dc);
    },
    reconnect: () => {
      // PeerJS throws when destroyed or not disconnected; legacy keepPeerAlive guarded both.
      if (!peer.destroyed && peer.disconnected) peer.reconnect();
    },
    destroy: () => {
      peer.destroy();
    },
    destroyed: () => peer.destroyed,
    disconnected: () => peer.disconnected,
  };
};

/**
 * Test hook (docs/ARCHITECTURE.md "Documented test hooks"): the arguments of every `new Peer(...)`
 * this adapter makes are pushed onto `globalThis.__peerCalls` (created if absent), `[id, options]`
 * for a host and `[options]` for a guest, `options` being the very object handed to PeerJS. The
 * Playwright harness reads it to assert that the `?ice=` configuration and the `?peer=` override
 * reached PeerJS on a page that no longer exposes `window.Peer` (e2e/fixtures/peer-calls.ts); it
 * is the same shape e2e/browser/record-peer.js records for the legacy pages. Additive: nothing
 * reads it back here.
 */
const recordPeerCall = (args: ReadonlyArray<unknown>): void => {
  const g = globalThis as { __peerCalls?: unknown[] };
  g.__peerCalls ??= [];
  g.__peerCalls.push(args);
};

const newPeer = (id: string | undefined, opts: PeerJsOptions): Peer => {
  // Same call shapes as the legacy pages: (id, options) for a host, (options) for a guest.
  recordPeerCall(id === undefined ? [opts] : [id, opts]);
  return id === undefined ? new Peer(opts) : new Peer(id, opts);
};

export type RealTransportOptions = Readonly<{
  /** What `ice.load()` resolved to, or null when the loader was unavailable. */
  ice: IceResult | null;
  /** The page's `location.search`, for the `?peer=` hook. */
  search: string;
  /** PeerJS log level: gin uses 0, fidice 1. */
  debug?: number;
}>;

/** PeerJS 1.5.4 as a Transport. Constructed in main.ts only. */
export const realTransport = (options: RealTransportOptions): Transport => {
  const opts = peerOptionsFor(options.ice, peerOverrideFrom(options.search), options.debug ?? 0);
  return { open: (id) => wrapPeer(newPeer(id, opts)) };
};
