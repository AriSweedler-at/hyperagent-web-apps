// The real adapter over a scripted stand-in for PeerJS: the options it builds (legacy shapes and
// the ?peer= hook), the constructor call shapes, and the event and connection plumbing. The real
// PeerJS runs only in a browser; test/integration/transport.integration.test.ts covers that.
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { IceResult } from './ice.ts';
import {
  peerOptionsFor,
  peerOverrideFrom,
  realTransport,
  wireClone,
  type Connection,
  type TransportError,
} from './transport.ts';

type Listener = (...args: unknown[]) => void;

const { FakePeer, FakeDataConnection, created } = vi.hoisted(() => {
  const created: unknown[] = [];
  class Emitter {
    readonly listeners = new Map<string, Listener[]>();
    on(event: string, fn: Listener): this {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      (this.listeners.get(event) ?? []).forEach((fn) => {
        fn(...args);
      });
    }
  }
  class FakeDataConnection extends Emitter {
    readonly peer: string;
    readonly options: unknown;
    open = false;
    peerConnection: unknown = undefined;
    readonly sent: unknown[] = [];
    closed = 0;
    constructor(peer: string, options: unknown) {
      super();
      this.peer = peer;
      this.options = options;
    }
    send(data: unknown): void {
      this.sent.push(data);
    }
    close(): void {
      this.closed += 1;
    }
  }
  class FakePeer extends Emitter {
    readonly args: unknown[];
    id: string | undefined = undefined;
    destroyed = false;
    disconnected = false;
    reconnects = 0;
    readonly connections: FakeDataConnection[] = [];
    constructor(...args: unknown[]) {
      super();
      this.args = args;
      created.push(this);
    }
    // Like PeerJS 1.5.4: a disconnected peer emits the error and returns nothing (typed as a
    // DataConnection all the same).
    connect(peer: string, options: unknown): FakeDataConnection | undefined {
      if (this.disconnected) {
        this.emit(
          'error',
          Object.assign(new Error('Cannot connect to new Peer after disconnecting from server.'), {
            type: 'disconnected',
          }),
        );
        return undefined;
      }
      const dc = new FakeDataConnection(peer, options);
      this.connections.push(dc);
      return dc;
    }
    // Like PeerJS 1.5.4: throws unless disconnected and not destroyed.
    reconnect(): void {
      if (this.destroyed) throw new Error('This peer cannot reconnect to the server.');
      if (!this.disconnected) throw new Error('cannot reconnect because it is not disconnected');
      this.reconnects += 1;
      this.disconnected = false;
    }
    destroy(): void {
      this.destroyed = true;
      this.disconnected = true;
    }
  }
  return { FakePeer, FakeDataConnection, created };
});

// The stand-in Peer, with the real `util` (BinaryPack) that `wireClone` needs.
vi.mock('peerjs', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Peer: FakePeer,
}));

const lastPeer = (): InstanceType<typeof FakePeer> => {
  const peer = created.at(-1);
  if (!(peer instanceof FakePeer)) throw new Error('no Peer constructed');
  return peer;
};

const ICE: IceResult = {
  iceServers: [{ urls: 'turn:relay.example', username: 'u', credential: 'c' }],
  source: 'remote',
  hasTurn: true,
  error: null,
};

beforeEach(() => {
  created.splice(0);
});

describe('peerOverrideFrom (the ?peer=host:port hook)', () => {
  test('parses host and port into the legacy override shape', () => {
    expect(peerOverrideFrom('?peer=127.0.0.1:9000')).toEqual({
      host: '127.0.0.1',
      port: 9000,
      path: '/',
      secure: false,
    });
    expect(peerOverrideFrom('?ice=https://x&peer=localhost:1234')).toEqual({
      host: 'localhost',
      port: 1234,
      path: '/',
      secure: false,
    });
  });

  test('anything else leaves the default broker alone', () => {
    expect(peerOverrideFrom('')).toBeNull();
    expect(peerOverrideFrom('?peer=')).toBeNull();
    expect(peerOverrideFrom('?peer=host')).toBeNull();
    expect(peerOverrideFrom('?peer=host:port')).toBeNull();
    expect(peerOverrideFrom('?peer=http://host:9000')).toBeNull();
    expect(peerOverrideFrom('?peer=host:9000/path')).toBeNull();
  });
});

describe('peerOptionsFor (legacy peerOptsFor / withPeerOverride)', () => {
  test('without ICE: just the debug level', () => {
    expect(peerOptionsFor(null, null, 0)).toEqual({ debug: 0 });
    expect(peerOptionsFor(null, null, 1)).toEqual({ debug: 1 });
  });

  test('with ICE: config from peerConfig', () => {
    expect(peerOptionsFor(ICE, null, 0)).toEqual({
      debug: 0,
      config: { iceServers: ICE.iceServers, sdpSemantics: 'unified-plan' },
    });
  });

  test('the override is spread last, with and without ICE', () => {
    const override = { host: '127.0.0.1', port: 9000, path: '/', secure: false } as const;
    expect(peerOptionsFor(null, override, 0)).toEqual({ debug: 0, ...override });
    expect(peerOptionsFor(ICE, override, 1)).toEqual({
      debug: 1,
      config: { iceServers: ICE.iceServers, sdpSemantics: 'unified-plan' },
      ...override,
    });
  });
});

describe('wireClone (a round trip through PeerJS BinaryPack)', () => {
  test('rewrites undefined to null and Date to its string, keeps the JSON scalars', () => {
    expect(
      wireClone({
        tok: undefined,
        when: new Date(0),
        nested: { u: undefined, arr: [undefined, 1] },
        n: null,
        f: 1.5,
        i: -3,
        s: 'x',
        b: true,
      }),
    ).toEqual({
      tok: null,
      when: new Date(0).toString(),
      nested: { u: null, arr: [null, 1] },
      n: null,
      f: 1.5,
      i: -3,
      s: 'x',
      b: true,
    });
  });

  test('returns a copy', () => {
    const frame = { tags: ['a'] };
    const clone = wireClone(frame);
    expect(clone).toEqual(frame);
    expect(clone).not.toBe(frame);
  });

  test('throws on what BinaryPack cannot carry: Infinity, Map, Set, BigInt, Blob', () => {
    expect(() => wireClone(Infinity)).toThrow('Invalid integer');
    expect(() => wireClone(new Map())).toThrow('not yet supported');
    expect(() => wireClone(new Set())).toThrow('not yet supported');
    expect(() => wireClone(1n)).toThrow();
    expect(() => wireClone(new Blob(['x']))).toThrow('Blob frames are not supported');
  });
});

describe('realTransport', () => {
  test('a host is new Peer(id, options); a guest is new Peer(options)', () => {
    const t = realTransport({ ice: ICE, search: '?peer=127.0.0.1:9000', debug: 1 });
    t.open('ginrummy-ari-ABCD');
    expect(lastPeer().args).toEqual([
      'ginrummy-ari-ABCD',
      {
        debug: 1,
        config: { iceServers: ICE.iceServers, sdpSemantics: 'unified-plan' },
        host: '127.0.0.1',
        port: 9000,
        path: '/',
        secure: false,
      },
    ]);
    t.open(undefined);
    expect(lastPeer().args).toEqual([
      {
        debug: 1,
        config: { iceServers: ICE.iceServers, sdpSemantics: 'unified-plan' },
        host: '127.0.0.1',
        port: 9000,
        path: '/',
        secure: false,
      },
    ]);
  });

  test('every construction is recorded on globalThis.__peerCalls with its exact arguments (test hook)', () => {
    const g = globalThis as { __peerCalls?: unknown[] };
    const before = g.__peerCalls;
    delete g.__peerCalls;
    try {
      const t = realTransport({ ice: ICE, search: '', debug: 1 });
      t.open('fidice-abcde');
      t.open(undefined);
      // Read through a fresh reference: `delete` above narrowed `g.__peerCalls` to undefined.
      const calls = (globalThis as { __peerCalls?: unknown[] }).__peerCalls ?? [];
      const peers = created.slice(-2).map((peer) => (peer as { args: unknown[] }).args);
      // The same argument lists PeerJS received, the options object by identity.
      expect(calls).toEqual(peers);
      expect((calls[0] as unknown[])[1]).toBe(peers[0]?.[1]);
      expect((calls[1] as unknown[])[0]).toBe(peers[1]?.[0]);
      // An array that already exists (the Playwright recorder's) is appended to, not replaced.
      const seeded: unknown[] = ['seeded'];
      g.__peerCalls = seeded;
      realTransport({ ice: null, search: '' }).open('x');
      expect(seeded).toEqual(['seeded', ['x', { debug: 0 }]]);
    } finally {
      if (before === undefined) delete g.__peerCalls;
      else g.__peerCalls = before;
    }
  });

  test('defaults: debug 0, no override, no config without ICE (exactly gin PEER_OPTS)', () => {
    realTransport({ ice: null, search: '' }).open('x');
    expect(lastPeer().args).toEqual(['x', { debug: 0 }]);
  });

  test('peer events are forwarded with the adapter shapes', () => {
    const handle = realTransport({ ice: null, search: '' }).open('ginrummy-ari-ABCD');
    const peer = lastPeer();
    const log: unknown[] = [];
    handle.on('open', (id) => log.push(['open', id]));
    handle.on('error', (e) => log.push(['error', e]));
    handle.on('disconnected', () => log.push(['disconnected']));
    handle.on('close', () => log.push(['close']));
    handle.on('connection', (c) => log.push(['connection', c.peer]));
    expect(handle.id()).toBeNull();
    peer.id = 'ginrummy-ari-ABCD';
    peer.emit('open', 'ginrummy-ari-ABCD');
    expect(handle.id()).toBe('ginrummy-ari-ABCD');
    const err = Object.assign(new Error('Could not connect to peer x'), {
      type: 'peer-unavailable',
    });
    peer.emit('error', err);
    peer.emit('disconnected', 'ginrummy-ari-ABCD');
    peer.emit('connection', new FakeDataConnection('guest-1', {}));
    peer.emit('close');
    expect(log).toEqual([
      ['open', 'ginrummy-ari-ABCD'],
      ['error', { type: 'peer-unavailable', message: 'Could not connect to peer x' }],
      ['disconnected'],
      ['connection', 'guest-1'],
      ['close'],
    ]);
  });

  test('reconnect, destroy and the flags pass through', () => {
    const handle = realTransport({ ice: null, search: '' }).open('x');
    const peer = lastPeer();
    expect(handle.destroyed()).toBe(false);
    expect(handle.disconnected()).toBe(false);
    peer.disconnected = true;
    expect(handle.disconnected()).toBe(true);
    handle.reconnect();
    expect(peer.reconnects).toBe(1);
    handle.destroy();
    expect(handle.destroyed()).toBe(true);
  });

  test('reconnect is guarded like legacy keepPeerAlive: never called on an open or destroyed peer', () => {
    const handle = realTransport({ ice: null, search: '' }).open('x');
    const peer = lastPeer();
    // PeerJS would throw here ("not disconnected"); the handle does not call it.
    expect(() => {
      handle.reconnect();
    }).not.toThrow();
    expect(peer.reconnects).toBe(0);
    handle.destroy();
    // Destroyed implies disconnected on PeerJS; reconnect would throw "already been destroyed".
    expect(handle.disconnected()).toBe(true);
    expect(() => {
      handle.reconnect();
    }).not.toThrow();
    expect(peer.reconnects).toBe(0);
  });

  test('connect on a disconnected peer: PeerJS returns nothing, the handle returns an inert Connection', () => {
    const handle = realTransport({ ice: null, search: '' }).open(undefined);
    const peer = lastPeer();
    const errors: TransportError[] = [];
    handle.on('error', (e) => errors.push(e));
    peer.disconnected = true;
    const conn = handle.connect('ginrummy-ari-ABCD');
    expect(peer.connections).toEqual([]);
    expect(errors).toEqual([
      {
        type: 'disconnected',
        message: 'Cannot connect to new Peer after disconnecting from server.',
      },
    ]);
    expect(conn.peer).toBe('ginrummy-ari-ABCD');
    expect(conn.open()).toBe(false);
    expect(conn.peerConnection()).toBeNull();
    const fired: string[] = [];
    conn.onOpen(() => fired.push('open'));
    conn.onMessage(() => fired.push('message'));
    conn.onClose(() => fired.push('close'));
    conn.onError(() => fired.push('error'));
    expect(() => {
      conn.send({ t: 'hello' });
      conn.close();
    }).not.toThrow();
    expect(fired).toEqual([]);
    expect(conn.open()).toBe(false);
  });

  test('connect asks for a reliable channel and wraps the DataConnection', () => {
    const handle = realTransport({ ice: null, search: '' }).open(undefined);
    const conn: Connection = handle.connect('ginrummy-ari-ABCD');
    const peer = lastPeer();
    const dc = peer.connections[0];
    if (dc === undefined) throw new Error('no connection');
    expect(dc.options).toEqual({ reliable: true });
    expect(conn.peer).toBe('ginrummy-ari-ABCD');
    expect(conn.open()).toBe(false);
    expect(conn.peerConnection()).toBeNull();

    const log: unknown[] = [];
    const errors: TransportError[] = [];
    conn.onOpen(() => log.push('open'));
    conn.onMessage((d) => log.push(['data', d]));
    conn.onClose(() => log.push('close'));
    conn.onError((e) => errors.push(e));

    dc.open = true;
    const pc = { getStats: () => Promise.resolve([]) };
    dc.peerConnection = pc;
    dc.emit('open');
    dc.emit('data', { t: 'state', n: 1 });
    dc.emit('error', Object.assign(new Error('nope'), { type: 'negotiation-failed' }));
    dc.emit('close');
    expect(conn.open()).toBe(true);
    expect(conn.peerConnection()).toBe(pc);
    expect(log).toEqual(['open', ['data', { t: 'state', n: 1 }], 'close']);
    expect(errors).toEqual([{ type: 'negotiation-failed', message: 'nope' }]);

    conn.send({ t: 'hello' });
    expect(dc.sent).toEqual([{ t: 'hello' }]);
    conn.close();
    expect(dc.closed).toBe(1);
  });
});
