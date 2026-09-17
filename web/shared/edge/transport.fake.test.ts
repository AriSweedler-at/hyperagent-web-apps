import { describe, expect, test } from 'vitest';

import { EXPECTED_CONTRACT_LOG, runContract } from './transport.contract.ts';
import { fakeBroker, fakeTransportPair } from './transport.fake.ts';
import type { Connection, PeerHandle, TransportError } from './transport.ts';

const opened = (peer: PeerHandle): Promise<string> =>
  new Promise((resolve) => {
    peer.on('open', resolve);
  });

const errorOf = (peer: PeerHandle): Promise<TransportError> =>
  new Promise((resolve) => {
    peer.on('error', resolve);
  });

const connectionOn = (peer: PeerHandle): Promise<Connection> =>
  new Promise((resolve) => {
    peer.on('connection', resolve);
  });

const connOpen = (conn: Connection): Promise<null> =>
  conn.open()
    ? Promise.resolve(null)
    : new Promise((resolve) => {
        conn.onOpen(() => {
          resolve(null);
        });
      });

/** Host under `hostId`, guest connected to it, both channels open (auto delivery). */
const connectedPair = async (
  hostId = 'ginrummy-ari-TEST',
): Promise<
  Readonly<{
    hostPeer: PeerHandle;
    guestPeer: PeerHandle;
    hostConn: Connection;
    guestConn: Connection;
    broker: ReturnType<typeof fakeBroker>;
  }>
> => {
  const { host, guest, broker } = fakeTransportPair();
  const hostPeer = host.open(hostId);
  await opened(hostPeer);
  const guestPeer = guest.open(undefined);
  await opened(guestPeer);
  const arriving = connectionOn(hostPeer);
  const guestConn = guestPeer.connect(hostId);
  const hostConn = await arriving;
  await Promise.all([connOpen(hostConn), connOpen(guestConn)]);
  return { hostPeer, guestPeer, hostConn, guestConn, broker };
};

describe('contract', () => {
  test('the fake pair produces exactly the expected log', async () => {
    const { host, guest } = fakeTransportPair();
    await expect(runContract(host, guest, 'ginrummy-ari-ABCD')).resolves.toEqual(
      EXPECTED_CONTRACT_LOG,
    );
  });

  test('the log is reported step by step as it happens', async () => {
    const { host, guest } = fakeTransportPair();
    const steps: string[] = [];
    await runContract(host, guest, 'fidice-abcde', { onStep: (s) => steps.push(s) });
    expect(steps).toEqual(EXPECTED_CONTRACT_LOG);
  });
});

describe('registration', () => {
  test('a host opens under its id; a guest is assigned one', async () => {
    const { host, guest, broker } = fakeTransportPair();
    const h = host.open('ginrummy-ari-ABCD');
    const g = guest.open(undefined);
    // Subscribe before yielding: like PeerJS, an `open` nobody listens to is simply missed.
    const [hOpen, gOpen] = [opened(h), opened(g)];
    expect(h.id()).toBe('ginrummy-ari-ABCD');
    expect(g.id()).toBe('fake-peer-1');
    await expect(hOpen).resolves.toBe('ginrummy-ari-ABCD');
    await expect(gOpen).resolves.toBe('fake-peer-1');
    expect(broker.peers()).toEqual(['fake-peer-1', 'ginrummy-ari-ABCD']);
  });

  test('a custom id generator', async () => {
    const broker = fakeBroker({ newId: () => 'guest-x' });
    const g = broker.transport().open(undefined);
    await expect(opened(g)).resolves.toBe('guest-x');
  });

  test('a taken id is an unavailable-id error, like PeerJS', async () => {
    const { host, guest } = fakeTransportPair();
    host.open('ginrummy-ari-ABCD');
    const dup = guest.open('ginrummy-ari-ABCD');
    await expect(errorOf(dup)).resolves.toEqual({
      type: 'unavailable-id',
      message: 'ID "ginrummy-ari-ABCD" is taken',
    });
    expect(dup.id()).toBeNull();
  });

  test('destroy before open swallows the open event and frees the id', () => {
    const { host, broker } = fakeTransportPair();
    const h = host.open('ginrummy-ari-ABCD');
    const seen: string[] = [];
    h.on('open', (id) => seen.push(id));
    h.on('close', () => seen.push('close'));
    h.destroy();
    expect(h.destroyed()).toBe(true);
    expect(broker.peers()).toEqual([]);
    broker.flush();
    expect(seen).toEqual(['close']);
    h.destroy();
    expect(seen).toEqual(['close']);
  });
});

describe('connecting', () => {
  test('host sees connection before either channel opens; host channel opens first', () => {
    const { host, guest, broker } = fakeTransportPair({ delivery: 'manual' });
    const h = host.open('ginrummy-ari-ABCD');
    const g = guest.open(undefined);
    broker.flush();
    const log: string[] = [];
    h.on('connection', (c) => {
      log.push(`connection open=${String(c.open())}`);
      c.onOpen(() => log.push('host channel open'));
    });
    const gc = g.connect('ginrummy-ari-ABCD');
    gc.onOpen(() => log.push('guest channel open'));
    expect(gc.open()).toBe(false);
    expect(gc.peer).toBe('ginrummy-ari-ABCD');
    expect(broker.pending()).toBe(3);
    expect(broker.deliverNext()).toBe(true);
    expect(log).toEqual(['connection open=false']);
    broker.deliverNext();
    broker.deliverNext();
    expect(log).toEqual(['connection open=false', 'host channel open', 'guest channel open']);
    expect(broker.deliverNext()).toBe(false);
  });

  test('connecting to an unknown id is peer-unavailable', async () => {
    const { guest } = fakeTransportPair();
    const g = guest.open(undefined);
    await opened(g);
    const conn = g.connect('ginrummy-ari-NOPE');
    await expect(errorOf(g)).resolves.toEqual({
      type: 'peer-unavailable',
      message: 'Could not connect to peer ginrummy-ari-NOPE',
    });
    expect(conn.open()).toBe(false);
  });

  test('connecting to a destroyed host is peer-unavailable', async () => {
    const { host, guest } = fakeTransportPair();
    const h = host.open('ginrummy-ari-ABCD');
    const g = guest.open(undefined);
    await Promise.all([opened(h), opened(g)]);
    h.destroy();
    g.connect('ginrummy-ari-ABCD');
    await expect(errorOf(g)).resolves.toMatchObject({ type: 'peer-unavailable' });
  });

  test('a destroyed peer cannot connect', async () => {
    const { host, guest } = fakeTransportPair();
    host.open('ginrummy-ari-ABCD');
    const g = guest.open(undefined);
    await opened(g);
    g.destroy();
    g.connect('ginrummy-ari-ABCD');
    await expect(errorOf(g)).resolves.toMatchObject({ type: 'disconnected' });
  });

  test('the host-side connection carries the guest id', async () => {
    const { hostConn, guestPeer } = await connectedPair();
    expect(hostConn.peer).toBe(guestPeer.id());
  });

  test('peerConnection is null on the fake', async () => {
    const { hostConn, guestConn } = await connectedPair();
    expect(hostConn.peerConnection()).toBeNull();
    expect(guestConn.peerConnection()).toBeNull();
  });
});

describe('frames', () => {
  test('round-trip both ways, in order', async () => {
    const { hostConn, guestConn } = await connectedPair();
    const atHost: unknown[] = [];
    const atGuest: unknown[] = [];
    hostConn.onMessage((d) => atHost.push(d));
    guestConn.onMessage((d) => atGuest.push(d));
    guestConn.send({ t: 'hello', name: 'Jeff' });
    guestConn.send({ t: 'action', n: 1 });
    hostConn.send({ t: 'state', n: 2 });
    guestConn.send({ t: 'action', n: 3 });
    await Promise.resolve();
    expect(atHost).toEqual([
      { t: 'hello', name: 'Jeff' },
      { t: 'action', n: 1 },
      { t: 'action', n: 3 },
    ]);
    expect(atGuest).toEqual([{ t: 'state', n: 2 }]);
  });

  test('frames are cloned: the receiver never shares a reference with the sender', async () => {
    const { hostConn, guestConn } = await connectedPair();
    const atHost: unknown[] = [];
    hostConn.onMessage((d) => atHost.push(d));
    const frame = { hand: ['AS', '2S'] };
    guestConn.send(frame);
    frame.hand.push('3S');
    await Promise.resolve();
    expect(atHost).toEqual([{ hand: ['AS', '2S'] }]);
    expect(atHost[0]).not.toBe(frame);
  });

  test('manual delivery holds frames on the wire until flushed', async () => {
    const { host, guest, broker } = fakeTransportPair({ delivery: 'manual' });
    const h = host.open('ginrummy-ari-ABCD');
    const g = guest.open(undefined);
    const arriving = connectionOn(h);
    broker.flush();
    const gc = g.connect('ginrummy-ari-ABCD');
    broker.flush();
    const hc = await arriving;
    const atHost: unknown[] = [];
    hc.onMessage((d) => atHost.push(d));
    gc.send(1);
    gc.send(2);
    expect(atHost).toEqual([]);
    expect(broker.pending()).toBe(2);
    expect(broker.deliverNext()).toBe(true);
    expect(atHost).toEqual([1]);
    expect(broker.flush()).toBe(1);
    expect(atHost).toEqual([1, 2]);
  });

  test('sending before open is a not-open-yet error on the connection', async () => {
    const { host, guest } = fakeTransportPair();
    const h = host.open('ginrummy-ari-ABCD');
    const g = guest.open(undefined);
    await Promise.all([opened(h), opened(g)]);
    const gc = g.connect('ginrummy-ari-ABCD');
    const errors: TransportError[] = [];
    gc.onError((e) => errors.push(e));
    gc.send('too early');
    await connOpen(gc);
    expect(errors).toEqual([
      {
        type: 'not-open-yet',
        message:
          'Connection is not open. You should listen for the `open` event before sending messages.',
      },
    ]);
  });

  test('a frame in flight to a channel that closed meanwhile is dropped', async () => {
    const { host, guest, broker } = fakeTransportPair({ delivery: 'manual' });
    const h = host.open('ginrummy-ari-ABCD');
    const g = guest.open(undefined);
    const arriving = connectionOn(h);
    broker.flush();
    const gc = g.connect('ginrummy-ari-ABCD');
    broker.flush();
    const hc = await arriving;
    const atHost: unknown[] = [];
    hc.onMessage((d) => atHost.push(d));
    gc.send('late');
    hc.close();
    broker.flush();
    expect(atHost).toEqual([]);
  });
});

describe('closing', () => {
  test('close fires locally at once and propagates to the remote', async () => {
    const { host, guest, broker } = fakeTransportPair({ delivery: 'manual' });
    const h = host.open('ginrummy-ari-ABCD');
    const g = guest.open(undefined);
    const arriving = connectionOn(h);
    broker.flush();
    const gc = g.connect('ginrummy-ari-ABCD');
    broker.flush();
    const hc = await arriving;
    const log: string[] = [];
    gc.onClose(() => log.push('guest close'));
    hc.onClose(() => log.push('host close'));
    gc.close();
    expect(gc.open()).toBe(false);
    expect(hc.open()).toBe(true);
    expect(log).toEqual(['guest close']);
    broker.flush();
    expect(hc.open()).toBe(false);
    expect(log).toEqual(['guest close', 'host close']);
    // Closing again on either side is a no-op.
    gc.close();
    hc.close();
    broker.flush();
    expect(log).toEqual(['guest close', 'host close']);
  });

  test('destroying a peer closes its connections, tells the remotes and emits close', async () => {
    const { hostPeer, guestPeer, hostConn, guestConn } = await connectedPair();
    const log: string[] = [];
    hostPeer.on('close', () => log.push('host peer close'));
    hostConn.onClose(() => log.push('host conn close'));
    guestConn.onClose(() => log.push('guest conn close'));
    hostPeer.destroy();
    expect(log).toEqual(['host conn close', 'host peer close']);
    await Promise.resolve();
    expect(log).toEqual(['host conn close', 'host peer close', 'guest conn close']);
    expect(guestConn.open()).toBe(false);
    expect(guestPeer.destroyed()).toBe(false);
  });
});

describe('broker socket', () => {
  test('dropSocket -> disconnected; reconnect -> open again under the same id', async () => {
    const { host, broker } = fakeTransportPair();
    const h = host.open('ginrummy-ari-ABCD');
    await opened(h);
    const log: string[] = [];
    h.on('disconnected', () => log.push('disconnected'));
    h.on('open', (id) => log.push(`open ${id}`));
    broker.dropSocket('ginrummy-ari-ABCD');
    expect(h.disconnected()).toBe(true);
    expect(broker.peers()).toEqual([]);
    await Promise.resolve();
    expect(log).toEqual(['disconnected']);
    h.reconnect();
    expect(h.disconnected()).toBe(false);
    await Promise.resolve();
    expect(log).toEqual(['disconnected', 'open ginrummy-ari-ABCD']);
    expect(broker.peers()).toEqual(['ginrummy-ari-ABCD']);
  });

  test('reconnect is a no-op when connected, destroyed or never opened; dropSocket on unknown too', async () => {
    const { host, broker } = fakeTransportPair();
    const h = host.open('ginrummy-ari-ABCD');
    await opened(h);
    const log: string[] = [];
    h.on('open', (id) => log.push(id));
    h.reconnect();
    await Promise.resolve();
    expect(log).toEqual([]);
    broker.dropSocket('nobody');
    broker.dropSocket('ginrummy-ari-ABCD');
    h.destroy();
    h.reconnect();
    broker.dropSocket('ginrummy-ari-ABCD');
    await Promise.resolve();
    expect(log).toEqual([]);
  });
});
