// The shapes a fidice session is written against (docs/MIGRATION.md step 9): typed from
// legacy/fidice/index.html lines 2215-2219 (bundle section "// src/net/session.ts") and the
// implicit contracts of the host and client sections. A session sees the broker through a
// `HostTransport` or `ClientTransport` (net/peerjs.ts builds them over web/shared/edge/transport.ts)
// and reports to its `SessionEvents` (app/controller); every data channel is the shared
// `Connection`, so a session that passes over `transport.fake.ts` has met the wire's rewrites.
// `realClock` is the binding the legacy section held; main.ts constructs the clock it injects.
import type { Connection } from '../../../../shared/edge/transport.ts';
import type { Action, PublicState, Seat } from '../domain/types.ts';
import type { Role } from './protocol.ts';

export { realClock } from '../../../../shared/edge/clock.ts';
export type { Connection };

/** A broker error, as PeerJS names them: `peer-unavailable`, `network`, `disconnected`, ... */
export type ErrorKind = string;

/** What the host session needs from the broker: its own registration and the guests' channels. */
export type HostTransport = Readonly<{
  onOpen: (fn: () => void) => void;
  onError: (fn: (kind: ErrorKind) => void) => void;
  onConnection: (fn: (c: Connection) => void) => void;
  /** Advisory text for the player (no relay configured); absent on a transport with nothing to say. */
  onInfo?: (fn: (message: string) => void) => void;
  close: () => void;
}>;

/** What the client session needs: one channel to the host, once it opens. */
export type ClientTransport = Readonly<{
  onOpen: (fn: (c: Connection) => void) => void;
  onError: (fn: (kind: ErrorKind) => void) => void;
  /** Advisory text for the player (connected via relay); absent on a transport with nothing to say. */
  onInfo?: (fn: (message: string) => void) => void;
  close: () => void;
}>;

/** Who this device is at the table, as sent with every state: a seat, or a spectator. */
export type Me = Readonly<{ seat: Seat | null; role: Role }>;

/** What a session reports to the controller. */
export type SessionEvents = Readonly<{
  /** Registered with the broker (host) or connected to the host (client). */
  onReady: () => void;
  onState: (state: PublicState, me: Me) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
  /** The session is over: the host closed the table, the code was wrong, the host was unreachable. */
  onClosed: (reason: string) => void;
}>;

/** The host may leave `onInfo` out; its advisories then land on `onError` (legacy behaviour). */
export type HostEvents = Readonly<
  Omit<SessionEvents, 'onInfo'> & { onInfo?: SessionEvents['onInfo'] }
>;

/** The surface the controller drives on either kind of session. */
export type Session = Readonly<{
  kind: 'host' | 'client';
  act: (action: Action) => void;
  close: () => void;
}>;
