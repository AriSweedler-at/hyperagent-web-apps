import { describe, expect, test } from 'vitest';

import { fakeClock } from './clock.fake.ts';
import { fakeBroker } from './transport.fake.ts';
import type { Connection } from './transport.ts';
import {
  ICE_FAILED_MSG,
  NO_RELAY_HINT,
  NO_ROUTE_MSG,
  PATH_DIRECT_MSG,
  PATH_RELAY_MSG,
  PATH_TOAST_MS,
  PEER_ERROR_TEXT,
  RECONNECT_CAP_MS,
  RECONNECT_FIRST_MS,
  WATCHDOG_MS,
  announcePath,
  backoffMs,
  describePeerError,
  keepPeerAlive,
  peerWatchdog,
  relayHint,
  whenTransportReady,
  type IceLoader,
  type IceResult,
  type NetDeps,
} from './peer.ts';

const STUN_ONLY: IceResult = { iceServers: [], source: 'fallback', hasTurn: false, error: null };
const WITH_TURN: IceResult = { iceServers: [], source: 'remote', hasTurn: true, error: null };

const loader = (result: IceResult, path = 'direct'): IceLoader => ({
  load: () => Promise.resolve(result),
  describe: () => Promise.resolve({ path }),
});

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the legacy strings', () => {
  test('relayHint warns only for an ICE list without TURN', () => {
    expect(relayHint(null)).toBe('');
    expect(relayHint(WITH_TURN)).toBe('');
    expect(relayHint(STUN_ONLY)).toBe(` ${NO_RELAY_HINT}`);
    expect(NO_RELAY_HINT).toBe(
      'No relay configured — this only works when both devices are on the same network.',
    );
    expect(ICE_FAILED_MSG).toBe(
      "The two devices couldn't reach each other — a relay (TURN) is required when they're on different networks.",
    );
  });

  test('describePeerError: the eleven known types, and the fallback with the message', () => {
    expect(Object.keys(PEER_ERROR_TEXT).sort()).toEqual(
      [
        'browser-incompatible',
        'network',
        'socket-error',
        'socket-closed',
        'server-error',
        'peer-unavailable',
        'unavailable-id',
        'webrtc',
        'negotiation-failed',
        'disconnected',
        'ssl-unavailable',
      ].sort(),
    );
    expect(describePeerError({ type: 'peer-unavailable', message: 'Could not connect' })).toBe(
      'Room not found — check the code. [peer-unavailable]',
    );
    expect(describePeerError({ type: 'webrtc', message: '' })).toBe(`${NO_ROUTE_MSG} [webrtc]`);
    expect(describePeerError({ type: 'negotiation-failed', message: 'x' })).toBe(
      `${NO_ROUTE_MSG} [negotiation-failed]`,
    );
    expect(describePeerError({ type: 'network', message: 'Lost connection to server.' })).toBe(
      "Can't reach the connection service — check your internet (VPNs and some Wi-Fi networks block it). [network]",
    );
    // Unknown type: the generic text, the tag and the message.
    expect(describePeerError({ type: 'weird', message: 'boom' })).toBe(
      'Connection error [weird]: boom',
    );
    expect(describePeerError({ type: 'weird', message: '' })).toBe('Connection error [weird]');
    expect(describePeerError({ type: '', message: 'boom' })).toBe('Connection error: boom');
  });
});

describe('the timings', () => {
  test('the constants are the legacy literals', () => {
    expect(WATCHDOG_MS).toBe(10_000);
    expect(RECONNECT_FIRST_MS).toBe(400);
    expect(RECONNECT_CAP_MS).toBe(15_000);
    expect(PATH_TOAST_MS).toBe(1500);
  });

  test('backoffMs is min(15000, 1500 * tries)', () => {
    expect([1, 2, 3, 9, 10, 11, 50].map(backoffMs)).toEqual([
      1500, 3000, 4500, 13_500, 15_000, 15_000, 15_000,
    ]);
  });
});

describe('whenTransportReady', () => {
  test('without a loader the callback runs at once with null', () => {
    const broker = fakeBroker();
    const seen: (IceResult | null)[] = [];
    // The sessions' full NetDeps passes: the helper reads `ice` alone (its parameter is the Pick).
    const deps: NetDeps = {
      transportFor: () => broker.transport(),
      ice: null,
      clock: fakeClock(),
      onWake: () => undefined,
    };
    whenTransportReady(deps, (ice) => seen.push(ice));
    expect(seen).toEqual([null]);
  });

  test('with a loader it runs once the load resolves; a rejection counts as no ICE', async () => {
    const broker = fakeBroker();
    const seen: (IceResult | null)[] = [];
    const base = {
      transportFor: () => broker.transport(),
      clock: fakeClock(),
      onWake: () => undefined,
    };
    whenTransportReady({ ...base, ice: loader(STUN_ONLY) }, (ice) => seen.push(ice));
    expect(seen).toEqual([]);
    await settle();
    expect(seen).toEqual([STUN_ONLY]);
    const failing: IceLoader = {
      load: () => Promise.reject(new Error('no')),
      describe: () => Promise.resolve({ path: 'unknown' }),
    };
    whenTransportReady({ ...base, ice: failing }, (ice) => seen.push(ice));
    await settle();
    expect(seen).toEqual([STUN_ONLY, null]);
  });
});

describe('peerWatchdog', () => {
  test('fires after ms unless the Peer opened or was destroyed', () => {
    const broker = fakeBroker({ delivery: 'manual' });
    const clock = fakeClock();
    const fired: string[] = [];
    const watch = (id: string): ReturnType<ReturnType<typeof broker.transport>['open']> => {
      const peer = broker.transport().open(id);
      peerWatchdog(peer, clock, WATCHDOG_MS, () => fired.push(id));
      return peer;
    };
    watch('opened');
    broker.flush(); // registers before the deadline
    watch('doomed').destroy();
    watch('slow'); // the broker never answers
    clock.advance(WATCHDOG_MS - 1);
    expect(fired).toEqual([]);
    clock.advance(1);
    expect(fired).toEqual(['slow']);
    clock.advance(WATCHDOG_MS * 3);
    expect(fired).toEqual(['slow']);
  });
});

describe('keepPeerAlive', () => {
  test('reconnects 400 ms after the socket drops, then backs off min(15000, 1500 * tries)', () => {
    const broker = fakeBroker({ delivery: 'manual' });
    const clock = fakeClock();
    const peer = broker.transport().open('room');
    broker.flush();
    const statuses: number[] = [];
    const at: number[] = [];
    const wake: (() => void)[] = [];
    keepPeerAlive(peer, { clock, onWake: (fn) => wake.push(fn) }, (tries) => {
      statuses.push(tries);
      at.push(clock.now());
    });
    broker.dropSocket('room');
    broker.flush(); // error(network) + disconnected
    expect(peer.disconnected()).toBe(true);
    // The fake's reconnect re-registers at once but `open` is only delivered on flush, so the peer
    // stays "disconnected" from the session's point of view until then... except that the fake
    // flips its flag synchronously. Hold the flag down by dropping the socket again after each try.
    const dropAgain = (): void => {
      broker.dropSocket('room');
    };
    clock.advance(RECONNECT_FIRST_MS);
    expect(statuses).toEqual([1]);
    dropAgain();
    clock.advance(1500);
    expect(statuses).toEqual([1, 2]);
    dropAgain();
    clock.advance(3000);
    expect(statuses).toEqual([1, 2, 3]);
    dropAgain();
    clock.advance(4500 - 1);
    expect(statuses).toEqual([1, 2, 3]);
    clock.advance(1);
    expect(statuses).toEqual([1, 2, 3, 4]);
    // Straight to the cap: nine more attempts land on the 1500 * tries ladder, then 15 s apart.
    Array.from({ length: 6 }).forEach((_, i) => {
      dropAgain();
      clock.advance(backoffMs(4 + i));
    });
    expect(statuses).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    dropAgain();
    clock.advance(RECONNECT_CAP_MS - 1);
    expect(statuses.length).toBe(10);
    clock.advance(1);
    expect(statuses.length).toBe(11);
    expect(at.slice(1).map((t, i) => t - (at[i] ?? 0))).toEqual([
      1500, 3000, 4500, 6000, 7500, 9000, 10_500, 12_000, 13_500, 15_000,
    ]);
    // `open` resets the counter and cancels the pending attempt.
    broker.flush();
    expect(peer.disconnected()).toBe(false);
    clock.advance(RECONNECT_CAP_MS * 2);
    expect(statuses.length).toBe(11);
    broker.dropSocket('room');
    broker.flush();
    clock.advance(RECONNECT_FIRST_MS);
    expect(statuses.at(-1)).toBe(1);
  });

  test('a wake-up while disconnected retries at once; while connected or destroyed it does nothing', () => {
    const broker = fakeBroker({ delivery: 'manual' });
    const clock = fakeClock();
    const peer = broker.transport().open('room');
    broker.flush();
    const statuses: number[] = [];
    const wake: (() => void)[] = [];
    keepPeerAlive(peer, { clock, onWake: (fn) => wake.push(fn) }, (tries) => statuses.push(tries));
    expect(wake).toHaveLength(1);
    wake[0]?.();
    expect(statuses).toEqual([]);
    broker.dropSocket('room');
    broker.flush();
    wake[0]?.();
    expect(statuses).toEqual([1]);
    // The 400 ms attempt was cancelled by the wake-up; the backoff timer took its place.
    clock.advance(RECONNECT_FIRST_MS);
    expect(statuses).toEqual([1]);
    peer.destroy();
    wake[0]?.();
    clock.advance(RECONNECT_CAP_MS);
    expect(statuses).toEqual([1]);
  });
});

describe('announcePath', () => {
  const connected = (): Readonly<{ conn: Connection; clock: ReturnType<typeof fakeClock> }> => {
    const broker = fakeBroker();
    const clock = fakeClock();
    broker.transport().open('h');
    const guest = broker.transport().open(undefined);
    const conn = guest.connect('h');
    broker.flush();
    expect(conn.open()).toBe(true);
    return { conn, clock };
  };

  test('toasts direct or relay 1.5 s after open, nothing for unknown, nothing without ICE', async () => {
    const toasts: string[] = [];
    const run = async (ice: IceLoader | null): Promise<void> => {
      const { conn, clock } = connected();
      announcePath(
        conn,
        () => true,
        { clock, ice },
        (m) => toasts.push(m),
      );
      clock.advance(PATH_TOAST_MS - 1);
      await settle();
      expect(toasts).toEqual([]);
      clock.advance(1);
      await settle();
    };
    await run(loader(STUN_ONLY, 'direct'));
    expect(toasts).toEqual([PATH_DIRECT_MSG]);
    toasts.length = 0;
    await run(loader(STUN_ONLY, 'relay'));
    expect(toasts).toEqual([PATH_RELAY_MSG]);
    toasts.length = 0;
    await run(loader(STUN_ONLY, 'unknown'));
    expect(toasts).toEqual([]);
    await run(null);
    expect(toasts).toEqual([]);
  });

  test('stays quiet when the channel is no longer current or has closed', async () => {
    const toasts: string[] = [];
    const a = connected();
    announcePath(
      a.conn,
      () => false,
      { clock: a.clock, ice: loader(STUN_ONLY) },
      (m) => toasts.push(m),
    );
    a.clock.advance(PATH_TOAST_MS);
    await settle();
    const b = connected();
    announcePath(
      b.conn,
      () => true,
      { clock: b.clock, ice: loader(STUN_ONLY) },
      (m) => toasts.push(m),
    );
    b.conn.close();
    b.clock.advance(PATH_TOAST_MS);
    await settle();
    expect(toasts).toEqual([]);
  });
});
