// An in-memory broker with the Transport interface (docs/ARCHITECTURE.md "Testing pyramid":
// host/guest sessions run over this in unit tests). Every event and frame goes through one FIFO
// queue, so ordering is deterministic; `delivery: 'auto'` drains it on a microtask and `'manual'`
// waits for `flush()` / `deliverNext()`, which lets a test freeze the wire between two frames.
// Frames go through PeerJS's own BinaryPack codec on the way (`wireClone`), so what a receiver
// sees here is what it would see over a real data channel. Mutable state lives in closures behind
// readonly records, so the shared readonly-type rules stay on.
import {
  wireClone,
  type Connection,
  type PeerEvents,
  type PeerHandle,
  type Transport,
  type TransportError,
} from './transport.ts';

export type Delivery = 'auto' | 'manual';

export type FakeBrokerOptions = Readonly<{
  delivery?: Delivery;
  /** Ids handed to peers that open without one (a guest). */
  newId?: () => string;
}>;

export type FakeBroker = Readonly<{
  /** A Transport whose peers meet on this broker. */
  transport: () => Transport;
  /** Deliver everything queued (including what the deliveries themselves queue); count delivered. */
  flush: () => number;
  /** Deliver the oldest queued item only; false when the queue is empty. */
  deliverNext: () => boolean;
  pending: () => number;
  /** Ids registered right now. */
  peers: () => ReadonlyArray<string>;
  /** Drop a peer's broker socket: it sees `disconnected` and may `reconnect`. */
  dropSocket: (id: string) => void;
}>;

type Handlers = Readonly<{ [K in keyof PeerEvents]: PeerEvents[K][] }>;

/** One end of a fake data channel. */
type Endpoint = Readonly<{
  /** The remote peer's id. */
  peer: string;
  isOpen: () => boolean;
  isClosed: () => boolean;
  markOpen: () => void;
  markClosed: () => void;
  remote: () => Endpoint | null;
  link: (other: Endpoint) => void;
  onOpen: (() => void)[];
  onMessage: ((data: unknown) => void)[];
  onClose: (() => void)[];
  onError: ((error: TransportError) => void)[];
}>;

type PeerRecord = Readonly<{
  /** Null before registration and, as on PeerJS, while disconnected or destroyed. */
  id: () => string | null;
  /** The id last registered under, kept for `reconnect` (PeerJS `_lastServerId`). */
  lastId: () => string | null;
  setId: (id: string) => void;
  isDestroyed: () => boolean;
  markDestroyed: () => void;
  isDisconnected: () => boolean;
  setDisconnected: (value: boolean) => void;
  handlers: Handlers;
  connections: Endpoint[];
}>;

const newEndpoint = (peer: string): Endpoint => {
  let open = false;
  let closed = false;
  let remote: Endpoint | null = null;
  return {
    peer,
    isOpen: () => open,
    isClosed: () => closed,
    markOpen: () => {
      open = true;
    },
    markClosed: () => {
      closed = true;
      open = false;
    },
    remote: () => remote,
    link: (other) => {
      remote = other;
    },
    onOpen: [],
    onMessage: [],
    onClose: [],
    onError: [],
  };
};

const newRecord = (): PeerRecord => {
  let id: string | null = null;
  let destroyed = false;
  let disconnected = false;
  return {
    id: () => (disconnected || destroyed ? null : id),
    lastId: () => id,
    setId: (value) => {
      id = value;
    },
    isDestroyed: () => destroyed,
    markDestroyed: () => {
      destroyed = true;
    },
    isDisconnected: () => disconnected,
    setDisconnected: (value) => {
      disconnected = value;
    },
    handlers: { open: [], connection: [], error: [], disconnected: [], close: [] },
    connections: [],
  };
};

const NOT_OPEN: TransportError = {
  type: 'not-open-yet',
  message:
    'Connection is not open. You should listen for the `open` event before sending messages.',
};

const call = <A extends ReadonlyArray<unknown>>(
  fns: ReadonlyArray<(...args: A) => void>,
  ...args: A
): void => {
  fns.forEach((fn) => {
    fn(...args);
  });
};

export const fakeBroker = (options: FakeBrokerOptions = {}): FakeBroker => {
  const delivery = options.delivery ?? 'auto';
  let serial = 0;
  const newId =
    options.newId ??
    ((): string => {
      serial += 1;
      return `fake-peer-${String(serial)}`;
    });
  const registry = new Map<string, PeerRecord>();
  let queue: ReadonlyArray<() => void> = [];
  let draining = false;

  const deliverNext = (): boolean => {
    const [next, ...rest] = queue;
    if (next === undefined) return false;
    queue = rest;
    next();
    return true;
  };

  const flush = (): number => {
    const drainFrom = (count: number): number => (deliverNext() ? drainFrom(count + 1) : count);
    return drainFrom(0);
  };

  const schedule = (fn: () => void): void => {
    queue = [...queue, fn];
    if (delivery === 'auto' && !draining) {
      draining = true;
      queueMicrotask(() => {
        draining = false;
        flush();
      });
    }
  };

  const fail = (record: PeerRecord, error: TransportError): void => {
    schedule(() => {
      call(record.handlers.error, error);
    });
  };

  const closeEndpoint = (ep: Endpoint): void => {
    if (ep.isClosed()) return;
    const wasOpen = ep.isOpen();
    ep.markClosed();
    // PeerJS emits the local `close` synchronously, and only for a channel that had opened; the
    // remote learns of it over the wire.
    if (wasOpen) call(ep.onClose);
    const remote = ep.remote();
    if (remote !== null)
      schedule(() => {
        closeEndpoint(remote);
      });
  };

  const openEndpoint = (ep: Endpoint): void => {
    if (ep.isClosed()) return;
    ep.markOpen();
    call(ep.onOpen);
  };

  const wrapEndpoint = (ep: Endpoint): Connection => ({
    peer: ep.peer,
    open: () => ep.isOpen(),
    send: (data) => {
      if (!ep.isOpen()) {
        schedule(() => {
          call(ep.onError, NOT_OPEN);
        });
        return;
      }
      const frame: unknown = wireClone(data);
      const remote = ep.remote();
      schedule(() => {
        if (remote?.isOpen() === true) call(remote.onMessage, frame);
      });
    },
    onOpen: (fn) => {
      ep.onOpen.push(fn);
    },
    onMessage: (fn) => {
      ep.onMessage.push(fn);
    },
    onClose: (fn) => {
      ep.onClose.push(fn);
    },
    onError: (fn) => {
      ep.onError.push(fn);
    },
    close: () => {
      closeEndpoint(ep);
    },
    peerConnection: () => null,
  });

  const connect = (from: PeerRecord, peerId: string): Connection => {
    const local = newEndpoint(peerId);
    const target = registry.get(peerId);
    // PeerJS refuses while the broker socket is down (destroy implies disconnected) and hands
    // back nothing; the adapter turns that into an inert Connection, as this does.
    if (from.isDestroyed() || from.isDisconnected()) {
      fail(from, {
        type: 'disconnected',
        message: 'Cannot connect to new Peer after disconnecting from server.',
      });
      return wrapEndpoint(local);
    }
    if (target === undefined || target.isDestroyed()) {
      fail(from, { type: 'peer-unavailable', message: `Could not connect to peer ${peerId}` });
      return wrapEndpoint(local);
    }
    const remote = newEndpoint(from.id() ?? '');
    local.link(remote);
    remote.link(local);
    from.connections.push(local);
    target.connections.push(remote);
    // Like PeerJS: the host learns of the connection (offer) first, then both channels open.
    schedule(() => {
      call(target.handlers.connection, wrapEndpoint(remote));
    });
    schedule(() => {
      openEndpoint(remote);
    });
    schedule(() => {
      openEndpoint(local);
    });
    return wrapEndpoint(local);
  };

  const register = (record: PeerRecord, id: string): void => {
    if (registry.has(id)) {
      fail(record, { type: 'unavailable-id', message: `ID "${id}" is taken` });
      return;
    }
    record.setId(id);
    registry.set(id, record);
    schedule(() => {
      if (!record.isDestroyed()) call(record.handlers.open, id);
    });
  };

  const openPeer = (requested: string | undefined): PeerHandle => {
    const record = newRecord();
    register(record, requested ?? newId());
    return {
      id: () => record.id(),
      on: (event, fn) => {
        (record.handlers[event] as PeerEvents[typeof event][]).push(fn);
      },
      connect: (peerId) => connect(record, peerId),
      reconnect: () => {
        const id = record.lastId();
        if (record.isDestroyed() || !record.isDisconnected() || id === null) return;
        // PeerJS restores the id synchronously and `open` follows from the server.
        record.setDisconnected(false);
        registry.set(id, record);
        schedule(() => {
          call(record.handlers.open, id);
        });
      },
      destroy: () => {
        if (record.isDestroyed()) return;
        const id = record.lastId();
        if (id !== null && registry.get(id) === record) registry.delete(id);
        // PeerJS: destroy() calls disconnect() first, which emits `disconnected` synchronously
        // (unless the socket was already down), then closes every connection, then emits `close`.
        // A `disconnected` handler that calls `reconnect()` here must find it a no-op.
        const wasConnected = !record.isDisconnected();
        record.setDisconnected(true);
        record.markDestroyed();
        if (wasConnected) call(record.handlers.disconnected);
        record.connections.forEach(closeEndpoint);
        call(record.handlers.close);
      },
      destroyed: () => record.isDestroyed(),
      disconnected: () => record.isDisconnected(),
    };
  };

  return {
    transport: () => ({ open: openPeer }),
    flush,
    deliverNext,
    pending: () => queue.length,
    peers: () => [...registry.keys()].sort(),
    dropSocket: (id) => {
      const record = registry.get(id);
      if (record === undefined || record.isDestroyed()) return;
      record.setDisconnected(true);
      registry.delete(id);
      // PeerJS on a lost socket: `error{type:'network'}` first, then disconnect(), which nulls the
      // id and emits `disconnected`. Both land in one delivery, as they do from one socket event.
      schedule(() => {
        call(record.handlers.error, { type: 'network', message: 'Lost connection to server.' });
        call(record.handlers.disconnected);
      });
    },
  };
};

export type FakeTransportPair = Readonly<{ host: Transport; guest: Transport; broker: FakeBroker }>;

/** Two Transports on one fake broker, the shape a Session test needs. */
export const fakeTransportPair = (options: FakeBrokerOptions = {}): FakeTransportPair => {
  const broker = fakeBroker(options);
  return { host: broker.transport(), guest: broker.transport(), broker };
};
