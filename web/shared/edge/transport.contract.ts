// What every Transport must do, as one scripted scenario with a fixed log. transport.fake.test.ts
// runs it over the fake; test/integration/transport.integration.test.ts runs the same function in
// Chromium over the real PeerJS adapter and a local PeerServer, and both must produce
// EXPECTED_CONTRACT_LOG. A Session written against Transport therefore cannot tell them apart in
// any way this scenario exercises: open, connect, ordered frames both ways, isolation of sent
// data, close propagation and destroy.
import type { Connection, PeerHandle, Transport } from './transport.ts';

export { EXPECTED_CONTRACT_LOG } from './transport.contract.log.ts';

export type ContractOptions = Readonly<{
  /** Called with each log line as it happens, so a timeout can report how far things got. */
  onStep?: (entry: string) => void;
}>;

const once = <T>(subscribe: (fn: (value: T) => void) => void): Promise<T> =>
  new Promise((resolve) => {
    subscribe(resolve);
  });

const whenOpen = (peer: PeerHandle): Promise<string> =>
  once<string>((fn) => {
    peer.on('open', fn);
  });

const whenConnOpen = (conn: Connection): Promise<null> =>
  conn.open()
    ? Promise.resolve(null)
    : once<null>((fn) => {
        conn.onOpen(() => {
          fn(null);
        });
      });

type Frame = Readonly<{ t?: unknown; n?: unknown; tags?: unknown }>;

const asFrame = (data: unknown): Frame => (typeof data === 'object' && data !== null ? data : {});

/** Run the scenario; resolves with the log, which must equal EXPECTED_CONTRACT_LOG. */
export const runContract = async (
  host: Transport,
  guest: Transport,
  hostId: string,
  options: ContractOptions = {},
): Promise<ReadonlyArray<string>> => {
  const log: string[] = [];
  const step = (entry: string): void => {
    log.push(entry);
    options.onStep?.(entry);
  };

  const hostPeer = host.open(hostId);
  const hostOpened = await whenOpen(hostPeer);
  step(hostOpened === hostId && hostPeer.id() === hostId ? 'host:open' : `host:open ${hostOpened}`);

  const guestPeer = guest.open(undefined);
  const guestId = await whenOpen(guestPeer);
  step(guestId !== '' && guestPeer.id() === guestId ? 'guest:open' : 'guest:open (no id)');

  const hostConnArrived = once<Connection>((fn) => {
    hostPeer.on('connection', fn);
  });
  const guestConn = guestPeer.connect(hostId);
  const hostConn = await hostConnArrived;
  await Promise.all([whenConnOpen(guestConn), whenConnOpen(hostConn)]);
  step(guestConn.open() && hostConn.open() ? 'connected' : 'connected (flags wrong)');
  step(
    guestConn.peer === hostId && hostConn.peer === guestId
      ? 'peers:ok'
      : `peers:${guestConn.peer}/${hostConn.peer}`,
  );

  const pings = once<ReadonlyArray<unknown>>((fn) => {
    const seen: unknown[] = [];
    hostConn.onMessage((data) => {
      seen.push(data);
      if (seen.length === 2) fn(seen);
    });
  });
  const pong = once<unknown>((fn) => {
    guestConn.onMessage(fn);
  });
  const frame = { t: 'ping', n: 1, tags: ['a'] };
  guestConn.send(frame);
  // Mutating the sent object after `send` must not reach the receiver.
  frame.tags.push('mutated-after-send');
  guestConn.send({ t: 'ping', n: 2 });
  const received = await pings;
  received.forEach((data) => {
    const f = asFrame(data);
    step(f.t === 'ping' ? `host:got ping ${String(f.n)}` : `host:got ${JSON.stringify(data)}`);
  });
  const tags = asFrame(received[0]).tags;
  const isolated = Array.isArray(tags) && tags.length === 1;
  hostConn.send({ t: 'pong', n: received.length });
  const reply = asFrame(await pong);
  step(
    reply.t === 'pong' ? `guest:got pong ${String(reply.n)}` : `guest:got ${JSON.stringify(reply)}`,
  );
  step(isolated ? 'isolated' : 'shared reference leaked');

  const hostClosed = once<null>((fn) => {
    hostConn.onClose(() => {
      fn(null);
    });
  });
  guestConn.close();
  await hostClosed;
  step(hostConn.open() ? 'host:still open' : 'host:closed');
  step(guestConn.open() ? 'guest:still open' : 'guest:closed');

  hostPeer.destroy();
  guestPeer.destroy();
  step(hostPeer.destroyed() && guestPeer.destroyed() ? 'destroyed' : 'destroy flags wrong');
  return log;
};
