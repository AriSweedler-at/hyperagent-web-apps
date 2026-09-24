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
// A heartbeat is not answered: the peer's own cadence is the only proof of life, so nothing can
// tell a dead guest from a quiet one sooner than its next beat is due. That is why a join that
// arrives while the current guest is quiet is held (host.ts `accept`, `probe` below) rather than
// refused: the guest's next frame, at most HB_MS away, makes the newcomer a third peer, and
// HB_MISSED_MS of silence makes it the guest's own return. Refusing at once, as the legacy did,
// showed a guest whose tab had just died "That room already has two players" five times over
// while it tried again every REJOIN_MS (the liveness review's L2-early).
//
// The RTCPeerConnection's ICE and connection states were not taken as the signal, even as a fast
// path: Chromium sat in `disconnected` without reaching `failed` in the review, `failed` when it
// comes follows Chromium's own consent timeout (about 30 s, slower than the grace), and neither
// transition can be driven inside the transport contract's bounded run, so the `Connection` type
// stays as it is and the fake needs no new lever. Everything here runs on the injected Clock,
// which clock.fake.ts drives in the tests; the grace is judged from `clock.now()` at the moment a
// timer fires, not from a count of fired timers, so a page whose timers were frozen in the
// background reaches the right verdict the moment it wakes. That clock is `Date.now()`, so a wall
// clock stepped forward by the grace or more (an NTP correction) reads as that much silence and
// calls a lively peer gone once, on both sides; the rejoin that follows repairs it, and a
// monotonic clock would cost the Clock type a second reading for a case no review reproduced.
import type { Clock, Timer } from '../lib/clock.ts';
import type { Connection } from '../edge/transport.ts';

/** A heartbeat leaves each side of an open channel this often. */
export const HB_MS = 5000;
/** Nothing heard for this long (two heartbeats missed with a full period of slack) is the peer gone. */
export const HB_GRACE_MS = 15_000;
/**
 * A join arriving while the current guest has been silent this long (one heartbeat missed, with a
 * whole period of slack for jitter) replaces the silent channel instead of being told the room is
 * full; one arriving earlier waits for this moment, or for the guest's next frame (host.ts).
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
  /**
   * Someone is waiting on this peer's next sign of life (host.ts holds a join this way): `alive`
   * runs on the next frame heard, `silent` the moment the silence reaches `ms` (judged from the
   * clock, as the verdict is), whichever comes first and only that one. `stop` cancels it without
   * a call, as does the function returned; a second probe replaces the first.
   */
  probe: (ms: number, alive: () => void, silent: () => void) => () => void;
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
  let probeTimer: Timer | null = null;
  let probeAlive: (() => void) | null = null;
  const silence = (): number => clock.now() - lastHeard;
  const clearProbe = (): void => {
    if (probeTimer !== null) clock.clearTimeout(probeTimer);
    probeTimer = null;
    probeAlive = null;
  };
  const stop = (): void => {
    running = false;
    if (beatTimer !== null) clock.clearTimeout(beatTimer);
    if (checkTimer !== null) clock.clearTimeout(checkTimer);
    beatTimer = null;
    checkTimer = null;
    clearProbe();
  };
  // Neither timer fires after `stop`, which clears both, so neither callback re-checks `running`.
  const beat = (): void => {
    if (conn.open()) conn.send(HEARTBEAT);
    beatTimer = clock.setTimeout(beat, HB_MS);
  };
  // Judged from the clock, not re-armed on every frame: frames can be frequent, and a check that
  // fires early simply waits out what is left of the grace.
  const check = (): void => {
    const gap = silence();
    if (gap >= HB_GRACE_MS) {
      stop();
      onGone();
      return;
    }
    checkTimer = clock.setTimeout(check, HB_GRACE_MS - gap);
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
      const alive = probeAlive;
      if (alive === null) return;
      clearProbe();
      alive();
    },
    silence,
    probe: (ms, alive, silent) => {
      clearProbe();
      probeAlive = alive;
      // Armed for what is left of `ms`. A frame meanwhile resolves the probe through `heard` and
      // clears this timer, so when it fires nothing was heard and the silence is at least `ms`
      // (a timer never fires early); no re-check of the clock is needed, unlike `check`, whose
      // grace is pushed back by frames without re-arming.
      probeTimer = clock.setTimeout(
        () => {
          clearProbe();
          silent();
        },
        Math.max(0, ms - silence()),
      );
      return clearProbe;
    },
    stop,
  };
};
