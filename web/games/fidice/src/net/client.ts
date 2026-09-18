// A guest's side of a table (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html
// lines 610-663 (bundle section "// src/net/client.ts"); every frame, timer and event is the same,
// test/parity/fidice.sessions.test.ts drives this and the legacy class side by side. The client
// says `hello` once its channel opens, forwards actions, and keeps the reconnect token the host
// hands it so a reload can sit back down in the same seat.
import type { Clock } from '../../../../shared/lib/clock.ts';
import type { Action, Seat } from '../domain/types.ts';
import { decodeServerMessage, type ClientMessage, type Role } from './protocol.ts';
import type { ClientTransport, Connection, SessionEvents } from './session.ts';

/** How long the guest waits for the host's channel before giving up. */
const CONNECT_TIMEOUT_MS = 12e3;

export type ClientDeps = Readonly<{
  transport: ClientTransport;
  events: SessionEvents;
  clock: Clock;
  /** Persist the token the host issued (app/effects storage under `fidice-token-<code>`). */
  rememberToken: (token: string) => void;
}>;

export type ClientOptions = Readonly<{
  role: Role;
  /** null for a spectator. */
  name: string | null;
  /** The token remembered from a previous session at this code, or null. */
  savedToken: string | null;
}>;

export class ClientSession {
  readonly kind = 'client';
  private readonly transport: ClientTransport;
  private readonly events: SessionEvents;
  private readonly rememberToken: (token: string) => void;
  private conn: Connection | null = null;
  private token: string | null;

  constructor(deps: ClientDeps, opts: ClientOptions) {
    this.transport = deps.transport;
    this.events = deps.events;
    this.rememberToken = deps.rememberToken;
    this.token = opts.savedToken;
    const timeout = deps.clock.setTimeout(() => {
      if (!this.conn)
        this.events.onClosed(
          "Could not reach the host. Make sure their tab is still open, then try again — and if you're on a different network than the host, a relay (TURN) must be configured.",
        );
    }, CONNECT_TIMEOUT_MS);
    this.transport.onOpen((c) => {
      deps.clock.clearTimeout(timeout);
      this.conn = c;
      c.onMessage((raw) => {
        this.receive(raw);
      });
      c.onClose(() => {
        this.events.onClosed('The host closed the table.');
      });
      this.events.onReady();
      this.send({ t: 'hello', role: opts.role, name: opts.name, token: this.token });
    });
    this.transport.onError((kind) => {
      if (kind === 'peer-unavailable')
        this.events.onClosed('No lobby found with that code. Check the code with your host.');
      else if (!this.conn) this.events.onClosed(`Connection problem: ${kind}`);
    });
    this.transport.onInfo?.((m) => {
      this.events.onInfo(m);
    });
  }

  act(action: Action): void {
    this.send({ t: 'act', action });
  }

  close(): void {
    this.conn?.close();
    this.transport.close();
  }

  private send(msg: ClientMessage): void {
    if (this.conn?.open()) this.conn.send(msg);
  }

  private receive(raw: unknown): void {
    const decoded = decodeServerMessage(raw);
    if (!decoded.ok) return;
    const msg = decoded.value;
    if (msg.t === 'state') {
      if (msg.you.token && msg.you.token !== this.token) {
        this.token = msg.you.token;
        this.rememberToken(msg.you.token);
      }
      // The host's seat number is trusted like the state it comes with (net/protocol.ts).
      const seat: Seat | null = msg.you.seat;
      this.events.onState(msg.state, { seat, role: msg.you.role });
      return;
    }
    if (msg.t === 'error') this.events.onError(msg.message);
    else this.events.onInfo(msg.message);
  }
}

export { CONNECT_TIMEOUT_MS };
