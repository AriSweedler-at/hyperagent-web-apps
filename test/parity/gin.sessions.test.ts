// The typed gin sessions against the recorded wire corpus (docs/MIGRATION.md step 12): every
// frame in test/fixtures/legacy/gin-wire/*.json crosses a real fake channel (transport.fake.ts,
// PeerJS's BinaryPack round trip included) between a HostSession and a GuestSession, and the
// receiving session must hand its app the frame deep-equal to the corpus and re-encoding to the
// corpus bytes: guest frames (`join`, `action`) through `GuestSession.send` into the host's
// `events.frame`, host frames (`welcome`, `lobby`, `full`, `toast`, `state`) through
// `HostSession.send` into the guest's. The sessions' own frames (the `welcome` on open and the
// `join` on connect) are the corpus literals too.
import { describe, expect, test } from 'vitest';

import type { GuestFrame, HostFrame } from '../../web/games/gin-rummy/src/protocol.ts';
import { GuestSession, type GuestEvents } from '../../web/games/gin-rummy/src/net/guest.ts';
import { HostSession, type HostEvents } from '../../web/games/gin-rummy/src/net/host.ts';
import type { NetDeps } from '../../web/games/gin-rummy/src/net/peerjs.ts';
import { fakeClock } from '../../web/shared/edge/clock.fake.ts';
import { fakeBroker } from '../../web/shared/edge/transport.fake.ts';
import { GIN_PEER_PREFIX } from '../../web/shared/lib/roomCode.ts';
import { wireFrames, type WireFrame } from './gin.fixtures.ts';

const CODE = 'KQZM';
const GUEST_TAGS: ReadonlySet<string> = new Set(['join', 'action']);

type Table = Readonly<{
  host: HostSession;
  guest: GuestSession;
  hostGot: unknown[];
  guestGot: unknown[];
  flush: () => number;
}>;

/** A host and a guest connected over one fake broker, both sessions' `frame` events recorded. */
const connectedTable = (): Table => {
  const broker = fakeBroker({ delivery: 'manual' });
  const clock = fakeClock();
  const deps: NetDeps = {
    transportFor: () => broker.transport(),
    ice: null,
    clock,
    onWake: () => undefined,
  };
  const hostGot: unknown[] = [];
  const guestGot: unknown[] = [];
  const quiet = (): void => undefined;
  const hostEvents: HostEvents = {
    status: quiet,
    toast: quiet,
    holdWakeLock: quiet,
    persist: quiet,
    restart: quiet,
    frame: (frame) => hostGot.push(frame),
    guestGone: quiet,
  };
  const guestEvents: GuestEvents = {
    status: quiet,
    toast: quiet,
    holdWakeLock: quiet,
    persist: quiet,
    connected: quiet,
    frame: (frame) => guestGot.push(frame),
    lost: quiet,
  };
  const host = new HostSession(
    {
      ...deps,
      read: () => ({
        attempt: 1,
        role: 'host',
        code: CODE,
        myName: 'Ann',
        target: 100,
        hasGame: false,
        handoff: false,
        oppName: null,
        oppConnected: false,
      }),
      events: hostEvents,
    },
    { code: CODE, attempt: 1, resume: false },
  );
  broker.flush();
  expect(broker.peers()).toEqual([`${GIN_PEER_PREFIX}${CODE}`]);
  const guest = new GuestSession(
    {
      ...deps,
      read: () => ({ attempt: 1, role: 'guest', code: CODE, myName: 'Jeff', oppConnected: false }),
      events: guestEvents,
    },
    { code: CODE, attempt: 1 },
  );
  broker.flush();
  return { host, guest, hostGot, guestGot, flush: broker.flush };
};

const label = (f: WireFrame): string => `${f.file}[${String(f.index)}]`;
const frames = wireFrames();
const guestFrames = frames.filter((f) => GUEST_TAGS.has(String(f.frame['t'])));
const hostFrames = frames.filter((f) => !GUEST_TAGS.has(String(f.frame['t'])));

describe('the sessions over the wire corpus', () => {
  test('the corpus holds both directions', () => {
    expect(guestFrames.length).toBeGreaterThanOrEqual(14);
    expect(hostFrames.length).toBeGreaterThanOrEqual(40);
  });

  test('connecting exchanges the corpus literals: the welcome and the join', () => {
    const table = connectedTable();
    // The host's welcome (`welcome.json[0]`) reached the guest; the guest's join (`join.json[0]`)
    // reached the host.
    expect(table.guestGot).toEqual([{ t: 'welcome', hostName: 'Ann', target: 100 }]);
    expect(table.hostGot).toEqual([{ t: 'join', name: 'Jeff' }]);
    expect(frames.find((f) => f.file === 'welcome.json' && f.index === 0)?.frame).toEqual(
      table.guestGot[0],
    );
    expect(frames.find((f) => f.file === 'join.json' && f.index === 0)?.frame).toEqual(
      table.hostGot[0],
    );
  });

  test.each(guestFrames.map((f) => [label(f), f] as const))(
    'guest -> host %s arrives decoded and re-encodes to the corpus bytes',
    (_name, f) => {
      const table = connectedTable();
      table.hostGot.length = 0;
      table.guest.send(f.frame as unknown as GuestFrame);
      table.flush();
      expect(table.hostGot).toHaveLength(1);
      expect(table.hostGot[0]).toEqual(f.frame);
      expect(JSON.stringify(table.hostGot[0])).toBe(JSON.stringify(f.frame));
    },
  );

  test.each(hostFrames.map((f) => [label(f), f] as const))(
    'host -> guest %s arrives decoded and re-encodes to the corpus bytes',
    (_name, f) => {
      const table = connectedTable();
      table.guestGot.length = 0;
      table.host.send(f.frame as unknown as HostFrame);
      table.flush();
      expect(table.guestGot).toHaveLength(1);
      expect(table.guestGot[0]).toEqual(f.frame);
      expect(JSON.stringify(table.guestGot[0])).toBe(JSON.stringify(f.frame));
    },
  );

  test('the whole corpus in one sitting, in file order, arrives in order', () => {
    const table = connectedTable();
    table.hostGot.length = 0;
    table.guestGot.length = 0;
    frames.forEach((f) => {
      if (GUEST_TAGS.has(String(f.frame['t']))) table.guest.send(f.frame as unknown as GuestFrame);
      else table.host.send(f.frame as unknown as HostFrame);
    });
    table.flush();
    expect(table.hostGot).toEqual(guestFrames.map((f) => f.frame));
    expect(table.guestGot).toEqual(hostFrames.map((f) => f.frame));
  });
});
