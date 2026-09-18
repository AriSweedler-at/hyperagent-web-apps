// The host's side of a table (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html
// lines 1892-2108 (bundle section "// src/net/host.ts"); every frame, timer and event is the
// same, test/parity/fidice.sessions.test.ts drives this and the legacy class side by side over one
// fake broker and deep-equals what each sends. The host holds the only full State: it seats
// guests on `hello`, applies their actions through the pure `apply`, broadcasts a redaction to
// every channel after each commit, and runs the bot and auto-next timers on the injected Clock.
import type { Clock, Timer } from '../../../../shared/lib/clock.ts';
import type { Rng } from '../../../../shared/lib/rng.ts';
import { decide, emptyMemories, type Memories } from '../bots/brain.ts';
import { RANDOM_STRATEGY, describeProfile, profileFor } from '../bots/registry.ts';
import {
  HOST,
  apply,
  bySeat,
  newGame,
  scheduleAutoNext,
  stampLog,
  startGame,
} from '../domain/game.ts';
import {
  findSeat,
  hostSitsDown,
  hostStandsUp,
  makeBot,
  makeHuman,
  renameBot,
  seatPlayer,
  setBotProfile,
  setConnected,
  unseatPlayer,
  withSpectators,
} from '../domain/lobby.ts';
import { redactFor } from '../domain/publicState.ts';
import { expect } from '../domain/result.ts';
import type { Action, Actor, Seat, State, Viewer } from '../domain/types.ts';
import { decodeClientMessage, type Role, type ServerMessage } from './protocol.ts';
import type { Connection, HostEvents, HostTransport, Me } from './session.ts';

/** Reveal shown, then the next round starts by itself. */
const AUTO_NEXT_MS = 7e3;

export type HostDeps = Readonly<{
  transport: HostTransport;
  events: HostEvents;
  clock: Clock;
  rng: Rng;
  /** Player ids and reconnect tokens. */
  newId: () => string;
}>;

export type HostOptions = Readonly<{
  code: string;
  lives: number;
  hostName: string;
  /** The host watches instead of taking a seat. */
  watch: boolean;
  bots: number;
  autostart: boolean;
  /** Pass-the-phone players seated on this device besides the host. */
  locals?: ReadonlyArray<string>;
  /** A strategy id or `RANDOM_STRATEGY` for every bot seated at construction. */
  botChoice?: string;
}>;

/** What the host remembers about one channel. */
type Guest = Readonly<{ role: Role; playerId: string | null; token: string | null }>;

export class HostSession {
  readonly kind = 'host';
  private readonly transport: HostTransport;
  private readonly events: HostEvents;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly newId: () => string;
  private readonly hostId: string;
  private readonly guests = new Map<Connection, Guest>();
  private readonly tokens = new Map<string, string>();
  /** Players who act from this device (the host, plus pass-the-phone locals). */
  private readonly localIds: ReadonlySet<string>;
  private state: State;
  private botMemories: Memories = emptyMemories;
  private botTimer: Timer | null = null;
  private nextTimer: Timer | null = null;
  private closed = false;

  constructor(deps: HostDeps, opts: HostOptions) {
    this.transport = deps.transport;
    this.events = deps.events;
    this.clock = deps.clock;
    this.rng = deps.rng;
    this.newId = deps.newId;
    this.hostId = deps.newId();
    const base = newGame(opts.code, opts.lives);
    const seated = opts.watch
      ? { ...base, hostSeat: null }
      : expect(seatPlayer(base, makeHuman(this.hostId, opts.hostName, opts.lives)), 'seat host');
    const locals: ReadonlyArray<Readonly<{ id: string; name: string }>> = (opts.locals ?? []).map(
      (name) => ({ id: deps.newId(), name }),
    );
    const withLocals = locals.reduce(
      (s, l) => expect(seatPlayer(s, makeHuman(l.id, l.name, opts.lives)), 'seat local'),
      seated,
    );
    this.localIds = new Set([this.hostId, ...locals.map((l) => l.id)]);
    const withBots = Array.from({ length: opts.bots }).reduce<State>(
      (s) => this.addBotTo(s, opts.botChoice ?? RANDOM_STRATEGY),
      withLocals,
    );
    this.state = opts.autostart ? expect(startGame(withBots, this.rng), 'autostart') : withBots;
    this.transport.onOpen(() => {
      this.events.onReady();
      this.commit(this.state);
    });
    this.transport.onError((kind) => {
      this.events.onError(`Connection problem: ${kind}`);
    });
    this.transport.onConnection((c) => {
      this.accept(c);
    });
    this.transport.onInfo?.((m) => {
      if (this.events.onInfo) this.events.onInfo(m);
      else this.events.onError(m);
    });
  }

  /* ---------- public API used by the controller ---------- */

  get snapshot(): State {
    return this.state;
  }

  /** True when several humans share this device (pass the phone). */
  get local(): boolean {
    return this.localIds.size > 1;
  }

  /** The seat whose turn it is, if that player acts from this device: the one holding the phone. */
  localHolder(): Seat | null {
    const r = this.state.round;
    if (this.state.phase !== 'playing' || !r || this.state.reveal) return null;
    const p = this.state.players[r.holder];
    return p && this.localIds.has(p.id) ? r.holder : null;
  }

  act(action: Action): void {
    const holder = this.localHolder();
    const actor: Actor =
      holder !== null
        ? bySeat(holder)
        : this.state.hostSeat === null
          ? HOST
          : bySeat(this.state.hostSeat);
    const r = apply(this.state, actor, action, this.rng);
    if (r.ok) this.commit(r.value);
    else this.events.onError(r.error);
  }

  addBot(): void {
    const next = this.addBotTo(this.state);
    if (next === this.state) this.events.onError('Table is full.');
    else this.commit(next);
  }

  removeBot(at: Seat): void {
    const p = this.state.players[at];
    if (!p?.bot || this.state.phase !== 'lobby') return;
    this.commit(unseatPlayer(this.state, p.id));
  }

  renameBot(at: Seat, name: string): void {
    const p = this.state.players[at];
    if (!p?.bot) return;
    const next = renameBot(this.state, p.id, name);
    if (next !== this.state) this.commit(next);
  }

  /** `choice` is a strategy id or "random". */
  setBot(at: Seat, choice: string): void {
    const p = this.state.players[at];
    if (!p?.bot) return;
    const profile = profileFor(choice, this.rng);
    const next = setBotProfile(this.state, p.id, profile, describeProfile(profile));
    if (next !== this.state) this.commit(next);
  }

  hostWatches(watching: boolean, hostName: string): void {
    if (this.state.phase !== 'lobby') return;
    this.commit(
      watching
        ? hostStandsUp(this.state)
        : hostSitsDown(this.state, makeHuman(this.hostId, hostName, this.state.lives)),
    );
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    this.guests.forEach((_, c) => {
      c.close();
    });
    this.transport.close();
  }

  /* ---------- internals ---------- */

  private addBotTo(s: State, choice: string = RANDOM_STRATEGY): State {
    const r = seatPlayer(s, makeBot(s, this.newId(), profileFor(choice, this.rng)));
    return r.ok ? r.value : s;
  }

  private viewerFor(g: Guest): Viewer {
    const at = g.playerId ? findSeat(this.state, g.playerId) : null;
    return g.role === 'player' && at !== null ? { kind: 'seat', seat: at } : { kind: 'spectator' };
  }

  /** This device sees the table as whoever holds the phone; otherwise as the host. */
  private mySeat(): Seat | null {
    const holder = this.localHolder();
    return holder !== null && this.local ? holder : this.state.hostSeat;
  }

  private myViewer(): Viewer {
    const seat = this.mySeat();
    return seat === null ? { kind: 'spectator' } : { kind: 'seat', seat };
  }

  private me(): Me {
    const seat = this.mySeat();
    return { seat, role: seat === null ? 'spectator' : 'player' };
  }

  private send(c: Connection, msg: ServerMessage): void {
    if (c.open()) c.send(msg);
  }

  private broadcast(): void {
    this.guests.forEach((g, c) => {
      const viewer = this.viewerFor(g);
      this.send(c, {
        t: 'state',
        state: redactFor(this.state, viewer),
        you: { seat: viewer.kind === 'seat' ? viewer.seat : null, token: g.token, role: g.role },
      });
    });
    this.events.onState(redactFor(this.state, this.myViewer()), this.me());
  }

  private commit(next: State): void {
    if (this.closed) return;
    this.state = stampLog(next, this.clock.now());
    this.broadcast();
    this.schedule();
  }

  private accept(c: Connection): void {
    c.onMessage((raw) => {
      const decoded = decodeClientMessage(raw);
      if (!decoded.ok) {
        this.send(c, { t: 'error', message: decoded.error });
        return;
      }
      const msg = decoded.value;
      if (msg.t === 'hello') {
        this.greet(c, msg.role, msg.name, msg.token);
        return;
      }
      const g = this.guests.get(c);
      if (!g?.playerId) {
        this.send(c, { t: 'error', message: 'Spectators cannot act.' });
        return;
      }
      const at = findSeat(this.state, g.playerId);
      if (at === null) return;
      const r = apply(this.state, bySeat(at), msg.action, this.rng);
      if (r.ok) this.commit(r.value);
      else this.send(c, { t: 'error', message: r.error });
    });
    c.onClose(() => {
      this.farewell(c);
    });
  }

  private greet(c: Connection, role: Role, name: string | null, token: string | null): void {
    const returning = role === 'player' && token ? (this.tokens.get(token) ?? null) : null;
    if (returning && findSeat(this.state, returning) !== null) {
      this.guests.set(c, { role: 'player', playerId: returning, token });
      this.commit(setConnected(this.state, returning, true, name ?? undefined));
      return;
    }
    if (role === 'player') {
      const id = this.newId();
      const seated = seatPlayer(this.state, makeHuman(id, name ?? 'Player', this.state.lives));
      if (seated.ok) {
        const fresh = this.newId();
        this.tokens.set(fresh, id);
        this.guests.set(c, { role: 'player', playerId: id, token: fresh });
        this.commit(seated.value);
        return;
      }
      this.send(c, { t: 'info', message: `${seated.error} You're watching as a spectator.` });
    }
    this.guests.set(c, { role: 'spectator', playerId: null, token: null });
    this.commit(withSpectators(this.state, 1));
  }

  private farewell(c: Connection): void {
    const g = this.guests.get(c);
    if (!g) return;
    this.guests.delete(c);
    if (g.role === 'spectator') {
      this.commit(withSpectators(this.state, -1));
      return;
    }
    if (!g.playerId) return;
    this.commit(
      this.state.phase === 'lobby'
        ? unseatPlayer(this.state, g.playerId)
        : setConnected(this.state, g.playerId, false),
    );
  }

  private clearTimers(): void {
    if (this.botTimer !== null) this.clock.clearTimeout(this.botTimer);
    if (this.nextTimer !== null) this.clock.clearTimeout(this.nextTimer);
    this.botTimer = this.nextTimer = null;
  }

  /** After every commit: start the round timer if a reveal is showing, else queue the next bot step. */
  private schedule(): void {
    const s = this.state;
    if (this.botTimer !== null) {
      this.clock.clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    if (s.phase === 'playing' && s.reveal) {
      if (this.nextTimer !== null) return;
      this.nextTimer = this.clock.setTimeout(() => {
        this.nextTimer = null;
        this.autoNext();
      }, AUTO_NEXT_MS);
      this.state = scheduleAutoNext(s, this.clock.now() + AUTO_NEXT_MS);
      this.broadcast();
      return;
    }
    if (this.nextTimer !== null) {
      this.clock.clearTimeout(this.nextTimer);
      this.nextTimer = null;
    }
    const decision = decide(s, this.botMemories, this.rng);
    const holder = s.round?.holder;
    if (!decision || holder === undefined) return;
    this.botMemories = decision.memories;
    this.botTimer = this.clock.setTimeout(() => {
      this.botTimer = null;
      const r = apply(this.state, bySeat(holder), decision.step.action, this.rng);
      if (r.ok) this.commit(r.value);
    }, decision.step.delay);
  }

  private autoNext(): void {
    if (!this.state.reveal || this.state.phase !== 'playing') return;
    const r = apply(this.state, HOST, { type: 'next' }, this.rng);
    if (r.ok) this.commit(r.value);
  }
}

export { AUTO_NEXT_MS };
