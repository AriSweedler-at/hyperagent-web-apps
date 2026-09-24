// Peer-loss detection below the codec, for both two-seat sessions (host.ts, guest.ts;
// docs/design/shared-shell.md §4.5, docs/ARCHITECTURE.md "web/shared/net"). PeerJS fires `close`
// on a DataConnection only when the other side closes it on purpose (a reload, Leave, navigating
// away, ~2 ms); a tab the browser killed, a phone that lost its network or a page frozen in the
// background leaves the channel `open` for good, so the host kept a dead guest's seat until it
// restarted: the opponent dot green for minutes, and the same guest back in a new tab told the
// room was full (the online review's A13/A14, its loss.spec.ts: `context.close()` never noticed
// in 60 s for either game). So each side sends `{t: 'hb'}` every HB_MS on its open channel and
// takes HB_GRACE_MS with no inbound frame at all (a game frame counts too) as the peer gone. The
// frame is intercepted by the sessions before a game's codec sees it: the games' decoders know
// only WIRE_TAGS and would refuse `hb`, no game frame changes a byte, and the parity traces
// (test/parity/gin.sessions.test.ts) compare what the codecs handed the apps, which this never is.
//
// The RTCPeerConnection's ICE and connection states were not taken as the signal, even as a fast
// path: Chromium sat in `disconnected` without reaching `failed` in the review, `failed` when it
// comes follows Chromium's own consent timeout (about 30 s, slower than the grace), and neither
// transition can be driven inside the transport contract's bounded run, so the `Connection` type
// stays as it is and the fake needs no new lever. Everything here runs on the injected Clock,
// which clock.fake.ts drives in the tests; the grace is judged from `clock.now()` at the moment a
// timer fires, not from a count of fired timers, so a page whose timers were frozen in the
// background reaches the right verdict the moment it wakes.
import type { Clock, Timer } from '../lib/clock.ts';
import type { Connection } from '../edge/transport.ts';

/** A heartbeat leaves each side of an open channel this often. */
export const HB_MS = 5000;
/** Nothing heard for this long (two heartbeats missed with a full period of slack) is the peer gone. */
export const HB_GRACE_MS = 15_000;
/**
 * A join arriving while the current guest has been silent this long (one heartbeat missed, with a
 * whole period of slack for jitter) replaces the silent channel instead of being told the room is
 * full: a guest whose tab died and who is back in a new one need not wait out the grace.
 */
export const HB_MISSED_MS = 2 * HB_MS;

/** The liveness frame. No game frame carries this tag (web/shared/lib/protocol.ts WIRE_TAGS). */
export const HEARTBEAT: Readonly<{ t: 'hb' }> = { t: 'hb' };

export const isHeartbeat = (raw: unknown): boolean =>
  typeof raw === 'object' && raw !== null && (raw as { t?: unknown }).t === HEARTBEAT.t;

export type Liveness = Readonly<{
  /** The channel opened: heartbeats go out from now, and the silence watch starts. */
  start: () => void;
  /** Any inbound frame, heartbeat or not, is a sign of life. */
  heard: () => void;
  /** Milliseconds since the peer was last heard (since `start`, until a frame arrives). */
  silence: () => number;
  /** The channel closed or stopped being the session's current one: no more beats, no verdict. */
  stop: () => void;
}>;

/**
 * The heartbeat and the silence watch for one channel. `onGone` fires at most once, after `start`,
 * when HB_GRACE_MS pass without `heard`; `stop` cancels both timers. Heartbeats are sent only
 * while the channel reports open (a channel that closed underneath is not written to).
 */
export const liveness = (conn: Connection, clock: Clock, onGone: () => void): Liveness => {
  let lastHeard = clock.now();
  let running = false;
  let beatTimer: Timer | null = null;
  let checkTimer: Timer | null = null;
  const stop = (): void => {
    running = false;
    if (beatTimer !== null) clock.clearTimeout(beatTimer);
    if (checkTimer !== null) clock.clearTimeout(checkTimer);
    beatTimer = null;
    checkTimer = null;
  };
  // Neither timer fires after `stop`, which clears both, so neither callback re-checks `running`.
  const beat = (): void => {
    if (conn.open()) conn.send(HEARTBEAT);
    beatTimer = clock.setTimeout(beat, HB_MS);
  };
  // Judged from the clock, not re-armed on every frame: frames can be frequent, and a check that
  // fires early simply waits out what is left of the grace.
  const check = (): void => {
    const silent = clock.now() - lastHeard;
    if (silent >= HB_GRACE_MS) {
      stop();
      onGone();
      return;
    }
    checkTimer = clock.setTimeout(check, HB_GRACE_MS - silent);
  };
  return {
    start: () => {
      if (running) return;
      running = true;
      lastHeard = clock.now();
      beatTimer = clock.setTimeout(beat, HB_MS);
      checkTimer = clock.setTimeout(check, HB_GRACE_MS);
    },
    heard: () => {
      lastHeard = clock.now();
    },
    silence: () => clock.now() - lastHeard,
    stop,
  };
};
