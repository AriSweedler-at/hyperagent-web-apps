// The peer-level plumbing both gin sessions share (docs/MIGRATION.md step 12), ported from the
// legacy multiplayer UI (legacy/gin-rummy/index.html, `whenTransportReady`, `peerWatchdog`,
// `keepPeerAlive`, `announcePath`, `describePeerError`, `relayHint`) over the shared Transport
// (web/shared/edge/transport.ts, the one importer of `peerjs`). What the legacy did with
// `window.Peer` and `window.HyperIce` it does with two injected dependencies: a Transport factory
// that takes the ICE result (main.ts hands it `realTransport`, which honours the `?peer=` hook) and
// the ICE loader (or null: the page without shared/ice.js, which still connects same-network
// devices on PeerJS's STUN). Every timer runs on the injected Clock, so net/host.test.ts and
// net/guest.test.ts drive the schedules by hand. The legacy `whenPeerReady` poll and its "library
// didn't load" branch have no counterpart: PeerJS arrives with the bundle.
import type { Clock, Timer } from '../../../../shared/lib/clock.ts';
import type {
  Connection,
  PeerHandle,
  RealTransportOptions,
  Transport,
  TransportError,
} from '../../../../shared/edge/transport.ts';

// The ICE shapes are named through transport.ts and Connection rather than imported from ice.ts:
// net/ may reach only the transport and clock edges (docs/ARCHITECTURE.md "Module boundaries"),
// and web/shared/edge/ice.ts's `Ice` satisfies `IceLoader` structurally.
/** What `ice.load()` resolves to (web/shared/edge/ice.ts `IceResult`). */
export type IceResult = NonNullable<RealTransportOptions['ice']>;
/** The two members of `Ice` the sessions call. */
export type IceLoader = Readonly<{
  load: () => Promise<IceResult>;
  describe: (pc: ReturnType<Connection['peerConnection']>) => Promise<Readonly<{ path: string }>>;
}>;

export type NetDeps = Readonly<{
  /** A Transport whose Peers carry `ice`: main.ts passes `(ice) => realTransport({ ice, search, debug: 0 })`. */
  transportFor: (ice: IceResult | null) => Transport;
  /** The ICE loader; null when there is none (the Peer is then created at once, PeerJS defaults). */
  ice: IceLoader | null;
  clock: Clock;
  /**
   * Subscribe to "the page is visible again" and "the network is back": the legacy `keepPeerAlive`
   * listened to `document` visibilitychange and `window` online and retried the broker on both.
   */
  onWake: (fn: () => void) => void;
}>;

// ---- timings, as the legacy page had them ----------------------------------------------------

/** `peerWatchdog(peer, 10000, ...)`: how long a Peer may take to register before the status warns. */
export const WATCHDOG_MS = 10_000;
/** `keepPeerAlive`: the first reconnect attempt after the broker socket drops. */
export const RECONNECT_FIRST_MS = 400;
/** `keepPeerAlive`: the cap of the reconnect backoff. */
export const RECONNECT_CAP_MS = 15_000;
/** `announcePath`: the selected candidate pair settles a moment after `open`. */
export const PATH_TOAST_MS = 1500;

/** `Math.min(15000, 1500 * tries)`: the delay before reconnect attempt `tries + 1`. */
export const backoffMs = (tries: number): number => Math.min(RECONNECT_CAP_MS, 1500 * tries);

// ---- strings, as the legacy page had them ----------------------------------------------------

export const NO_RELAY_HINT =
  'No relay configured — this only works when both devices are on the same network.';
export const ICE_FAILED_MSG =
  "The two devices couldn't reach each other — a relay (TURN) is required when they're on different networks.";
// PeerJS reports an ICE failure as a peer-level 'webrtc' error or, on a DataConnection, as 'negotiation-failed'.
export const NO_ROUTE_MSG =
  "WebRTC failed — the two devices couldn't reach each other (a relay is needed across networks).";
export const PATH_DIRECT_MSG = 'Connected directly';
export const PATH_RELAY_MSG = 'Connected via relay';

const SERVICE_UNREACHABLE =
  "Can't reach the connection service — check your internet (VPNs and some Wi-Fi networks block it).";

/** `describePeerError`'s map, keyed by PeerJS error type. */
export const PEER_ERROR_TEXT: Readonly<Record<string, string>> = {
  'browser-incompatible': "This browser can't do peer-to-peer connections.",
  network: SERVICE_UNREACHABLE,
  'socket-error': SERVICE_UNREACHABLE,
  'socket-closed': 'Lost the connection service. Try again.',
  'server-error': 'The connection service is having trouble. Try again in a moment.',
  'peer-unavailable': 'Room not found — check the code.',
  'unavailable-id': 'That room code is taken.',
  webrtc: NO_ROUTE_MSG,
  'negotiation-failed': NO_ROUTE_MSG,
  disconnected: 'Disconnected from the connection service.',
  'ssl-unavailable': 'Secure connection unavailable.',
};

/** ` No relay configured…` when the ICE list has no TURN server; empty otherwise (or without ICE). */
export const relayHint = (ice: IceResult | null): string =>
  ice !== null && !ice.hasTurn ? ` ${NO_RELAY_HINT}` : '';

/** `Room not found — check the code. [peer-unavailable]`, or `Connection error [x]: message`. */
export const describePeerError = (e: TransportError): string => {
  const known = PEER_ERROR_TEXT[e.type];
  const tag = e.type !== '' ? ` [${e.type}]` : '';
  const detail = known === undefined && e.message !== '' ? `: ${e.message}` : '';
  return `${known ?? 'Connection error'}${tag}${detail}`;
};

// ---- the four helpers --------------------------------------------------------------------------

/**
 * `whenTransportReady`: run `ready(ice)` once the ICE servers are in hand, or at once with null when
 * there is no loader. `ice.load()` never rejects (web/shared/edge/ice.ts); a rejection is treated
 * as no ICE all the same.
 */
export const whenTransportReady = (deps: NetDeps, ready: (ice: IceResult | null) => void): void => {
  if (deps.ice === null) {
    ready(null);
    return;
  }
  void deps.ice.load().then(ready, () => {
    ready(null);
  });
};

/** `peerWatchdog`: `onTimeout` after `ms` unless the Peer registered (or was destroyed) meanwhile. */
export const peerWatchdog = (
  peer: PeerHandle,
  clock: Clock,
  ms: number,
  onTimeout: () => void,
): void => {
  let opened = false;
  peer.on('open', () => {
    opened = true;
  });
  clock.setTimeout(() => {
    if (!opened && !peer.destroyed()) onTimeout();
  }, ms);
};

/**
 * `keepPeerAlive`: mobile browsers suspend background pages, which drops the broker socket.
 * Reconnect RECONNECT_FIRST_MS after `disconnected`, then again after `backoffMs(tries)` while the
 * Peer stays disconnected; `onStatus(tries)` before each attempt; a wake-up retries at once.
 */
export const keepPeerAlive = (
  peer: PeerHandle,
  deps: Pick<NetDeps, 'clock' | 'onWake'>,
  onStatus: (tries: number) => void,
): void => {
  let tries = 0;
  let timer: Timer | null = null;
  const clear = (): void => {
    if (timer !== null) deps.clock.clearTimeout(timer);
    timer = null;
  };
  const attempt = (): void => {
    if (peer.destroyed() || !peer.disconnected()) return;
    tries += 1;
    onStatus(tries);
    // The adapter's reconnect never throws (the legacy wrapped PeerJS's in try/catch).
    peer.reconnect();
    timer = deps.clock.setTimeout(attempt, backoffMs(tries));
  };
  peer.on('disconnected', () => {
    clear();
    timer = deps.clock.setTimeout(attempt, RECONNECT_FIRST_MS);
  });
  peer.on('open', () => {
    tries = 0;
    clear();
  });
  deps.onWake(() => {
    if (!peer.destroyed() && peer.disconnected()) {
      clear();
      attempt();
    }
  });
};

/**
 * `announcePath`: PATH_TOAST_MS after the channel opens, toast whether it is direct or relayed,
 * provided it is still the session's current channel and still open. Nothing without an ICE loader.
 */
export const announcePath = (
  conn: Connection,
  isCurrent: () => boolean,
  deps: Pick<NetDeps, 'clock' | 'ice'>,
  toast: (message: string) => void,
): void => {
  const ice = deps.ice;
  if (ice === null) return;
  deps.clock.setTimeout(() => {
    if (!isCurrent() || !conn.open()) return;
    void ice.describe(conn.peerConnection()).then((d) => {
      if (d.path === 'direct') toast(PATH_DIRECT_MSG);
      else if (d.path === 'relay') toast(PATH_RELAY_MSG);
    });
  }, PATH_TOAST_MS);
};

/** The app's role, as the sessions read it back to check their ticket. */
export type NetRole = 'host' | 'guest' | 'local';
