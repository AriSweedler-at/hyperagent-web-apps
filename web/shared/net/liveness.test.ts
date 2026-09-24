// The heartbeat and the silence watch for one channel (liveness.ts), over the fake broker and the
// fake clock: the cadence, the verdict after HB_GRACE_MS of silence exactly once, a frame pushing
// the verdict back, `stop` cancelling both, nothing written to a channel that is not open, and the
// probe (a frame or `ms` of silence, whichever first, once). How the two sessions use it (the seat
// freed, the rejoin, a join held and then seated or refused) is pinned in sessions.test.ts.
import { describe, expect, test } from 'vitest';

import { fakeClock, type FakeClock } from '../edge/clock.fake.ts';
import { fakeBroker, type FakeBroker } from '../edge/transport.fake.ts';
import type { Connection, TransportError } from '../edge/transport.ts';
import {
  HB_GRACE_MS,
  HB_MISSED_MS,
  HB_MS,
  HEARTBEAT,
  isHeartbeat,
  liveness,
  type Liveness,
} from './liveness.ts';

type Pair = Readonly<{
  clock: FakeClock;
  broker: FakeBroker;
  /** The end the liveness under test drives. */
  local: Connection;
  /** What the other end received, and the errors the local end reported. */
  remoteGot: unknown[];
  localErrors: TransportError[];
  gone: number[];
  live: Liveness;
}>;

/** Two peers on one manual broker, one open channel between them, `liveness` on the local end. */
const pair = (): Pair => {
  const clock = fakeClock();
  const broker = fakeBroker({ delivery: 'manual' });
  const a = broker.transport().open('a');
  const b = broker.transport().open('b');
  const remoteGot: unknown[] = [];
  b.on('connection', (c) => {
    c.onMessage((data) => remoteGot.push(data));
  });
  broker.flush();
  const local = a.connect('b');
  const localErrors: TransportError[] = [];
  local.onError((e) => localErrors.push(e));
  broker.flush();
  expect(local.open()).toBe(true);
  const gone: number[] = [];
  const live = liveness(local, clock, () => gone.push(clock.now()));
  return { clock, broker, local, remoteGot, localErrors, gone, live };
};

/** Let `ms` pass a second at a time, delivering the broker's queue after each. */
const pass = (p: Pair, ms: number): void => {
  Array.from({ length: Math.floor(ms / 1000) }).forEach(() => {
    p.clock.advance(1000);
    p.broker.flush();
  });
  p.clock.advance(ms % 1000);
  p.broker.flush();
};

describe('liveness', () => {
  test('the constants and the frame: 5 s beats, a 15 s grace, 10 s counts as a missed beat; `hb` is no game tag', () => {
    expect(HB_MS).toBe(5000);
    expect(HB_GRACE_MS).toBe(15_000);
    expect(HB_MISSED_MS).toBe(10_000);
    expect(HB_GRACE_MS).toBeGreaterThan(2 * HB_MS);
    expect(HEARTBEAT).toEqual({ t: 'hb' });
    expect(isHeartbeat({ t: 'hb' })).toBe(true);
    expect(isHeartbeat({ t: 'hb', extra: 1 })).toBe(true);
    expect(isHeartbeat({ t: 'join', name: 'Jeff' })).toBe(false);
    expect(isHeartbeat('hb')).toBe(false);
    expect(isHeartbeat(null)).toBe(false);
    expect(isHeartbeat(undefined)).toBe(false);
  });

  test('beats every HB_MS from start, nothing before start, nothing after stop', () => {
    const p = pair();
    pass(p, HB_MS * 3);
    expect(p.remoteGot).toEqual([]);
    p.live.start();
    pass(p, HB_MS - 1);
    expect(p.remoteGot).toEqual([]);
    pass(p, 1);
    expect(p.remoteGot).toEqual([HEARTBEAT]);
    pass(p, HB_MS);
    expect(p.remoteGot).toEqual([HEARTBEAT, HEARTBEAT]);
    // What crosses the wire is the frame, BinaryPack round trip included.
    expect(isHeartbeat(p.remoteGot[0])).toBe(true);
    p.live.stop();
    pass(p, HB_MS * 4);
    expect(p.remoteGot).toHaveLength(2);
    expect(p.gone).toEqual([]);
    expect(p.clock.pending()).toBe(0);
    // A second start after a stop begins a fresh cadence and a fresh grace.
    p.live.start();
    pass(p, HB_MS);
    expect(p.remoteGot).toHaveLength(3);
    p.live.start(); // already running: no second cadence
    pass(p, HB_MS);
    expect(p.remoteGot).toHaveLength(4);
  });

  test('HB_GRACE_MS of silence is the verdict, once, and the beats stop with it', () => {
    const p = pair();
    p.live.start();
    pass(p, HB_GRACE_MS - 1);
    expect(p.gone).toEqual([]);
    expect(p.live.silence()).toBe(HB_GRACE_MS - 1);
    pass(p, 1);
    expect(p.gone).toEqual([HB_GRACE_MS]);
    // Two beats went out (5 s, 10 s); the check fired before the third and stopped it.
    expect(p.remoteGot).toEqual([HEARTBEAT, HEARTBEAT]);
    pass(p, HB_GRACE_MS * 3);
    expect(p.gone).toEqual([HB_GRACE_MS]);
    expect(p.remoteGot).toHaveLength(2);
    expect(p.clock.pending()).toBe(0);
  });

  test('a frame heard pushes the verdict back to HB_GRACE_MS after it; silence() reads the gap', () => {
    const p = pair();
    p.live.start();
    pass(p, 12_000);
    p.live.heard();
    expect(p.live.silence()).toBe(0);
    pass(p, 2000);
    expect(p.live.silence()).toBe(2000);
    // The check armed at start fires at 15 s, finds 3 s of silence and waits out the other 12.
    pass(p, HB_GRACE_MS - 2000 - 1);
    expect(p.gone).toEqual([]);
    pass(p, 1);
    expect(p.gone).toEqual([12_000 + HB_GRACE_MS]);
    // Heard again after the verdict: nothing is armed any more.
    p.live.heard();
    pass(p, HB_GRACE_MS * 2);
    expect(p.gone).toHaveLength(1);
  });

  test('stop before the grace cancels the verdict; a channel that closed underneath is not written to', () => {
    const p = pair();
    p.live.start();
    pass(p, HB_GRACE_MS - 1);
    p.live.stop();
    pass(p, HB_GRACE_MS);
    expect(p.gone).toEqual([]);
    const q = pair();
    q.live.start();
    q.local.close();
    q.broker.flush();
    pass(q, HB_MS * 2);
    // No send on the closed channel, so the fake raised no not-open error; the watch still runs
    // (the sessions stop it themselves on close) and gives its verdict.
    expect(q.remoteGot).toEqual([]);
    expect(q.localErrors).toEqual([]);
    pass(q, HB_GRACE_MS);
    expect(q.gone).toEqual([HB_GRACE_MS]);
  });

  test('probe: a frame heard first is `alive`, once; the silence reaching `ms` first is `silent`, once; judged from the clock', () => {
    const p = pair();
    p.live.start();
    pass(p, 3000);
    const calls: string[] = [];
    p.live.probe(
      HB_MISSED_MS,
      () => calls.push(`alive@${String(p.clock.now())}`),
      () => calls.push(`silent@${String(p.clock.now())}`),
    );
    // Silent for 3 s when armed: the answer is due 7 s on...
    pass(p, HB_MISSED_MS - 3000 - 1);
    expect(calls).toEqual([]);
    // ...unless a frame comes first.
    p.live.heard();
    expect(calls).toEqual([`alive@${String(HB_MISSED_MS - 1)}`]);
    // Resolved: neither a later frame nor the timer that was armed says anything more.
    p.live.heard();
    pass(p, HB_MISSED_MS * 2);
    expect(calls).toHaveLength(1);
    // A fresh probe on a peer that stays quiet: `silent` exactly when the silence reaches `ms`.
    const q = pair();
    q.live.start();
    pass(q, 4000);
    const answers: string[] = [];
    q.live.probe(
      HB_MISSED_MS,
      () => answers.push('alive'),
      () => answers.push(`silent@${String(q.live.silence())}`),
    );
    pass(q, HB_MISSED_MS - 4000 - 1);
    expect(answers).toEqual([]);
    pass(q, 1);
    expect(answers).toEqual([`silent@${String(HB_MISSED_MS)}`]);
    q.live.heard();
    pass(q, HB_MISSED_MS);
    expect(answers).toHaveLength(1);
    // The verdict still comes on its own schedule: the probe took nothing from the watch.
    expect(q.gone).toEqual([]);
    pass(q, HB_GRACE_MS);
    expect(q.gone).toHaveLength(1);
  });

  test('probe: `stop` and the returned cancel answer nothing; a second probe replaces the first', () => {
    const p = pair();
    p.live.start();
    const calls: string[] = [];
    const cancel = p.live.probe(
      HB_MISSED_MS,
      () => calls.push('alive-1'),
      () => calls.push('silent-1'),
    );
    cancel();
    p.live.heard();
    pass(p, HB_MISSED_MS);
    expect(calls).toEqual([]);
    p.live.probe(
      HB_MISSED_MS,
      () => calls.push('alive-2'),
      () => calls.push('silent-2'),
    );
    // Replaced before it could answer: only the third speaks, and only once.
    p.live.probe(
      HB_MISSED_MS,
      () => calls.push('alive-3'),
      () => calls.push('silent-3'),
    );
    p.live.heard();
    expect(calls).toEqual(['alive-3']);
    p.live.probe(
      HB_MISSED_MS,
      () => calls.push('alive-4'),
      () => calls.push('silent-4'),
    );
    p.live.stop();
    pass(p, HB_GRACE_MS * 2);
    expect(calls).toEqual(['alive-3']);
    expect(p.clock.pending()).toBe(0);
    // Armed on a peer already silent past `ms`: answered on the next tick, not synchronously.
    const q = pair();
    q.live.start();
    pass(q, HB_MISSED_MS + 1);
    const late: string[] = [];
    q.live.probe(
      HB_MISSED_MS,
      () => late.push('alive'),
      () => late.push('silent'),
    );
    expect(late).toEqual([]);
    q.clock.advance(0);
    expect(late).toEqual(['silent']);
  });
});
