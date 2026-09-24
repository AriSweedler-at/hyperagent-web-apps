// The browser deps in node: the clock is the real one, the ICE loader the browser one, the
// Transport builds PeerJS options at the page's log level over the `?peer=` hook (a stand-in Peer
// records the constructor call, as transport.test.ts's does), and `onWake` is the legacy
// `keepPeerAlive` pair of listeners over stubbed `document` and `window` globals, or the
// subscription a page injects instead.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { realClock } from './clock.ts';
import { browserNetDeps, browserWake } from './netDeps.ts';

const { FakePeer, created } = vi.hoisted(() => {
  const created: unknown[][] = [];
  class FakePeer {
    constructor(...args: unknown[]) {
      created.push(args);
    }
    on(): this {
      return this;
    }
  }
  return { FakePeer, created };
});

// The stand-in Peer; the rest of the module (`util`) is the real one.
vi.mock('peerjs', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Peer: FakePeer,
}));

type Listener = () => void;
/** `document` and `window` as `browserWake` sees them: the listeners by event, a settable visibility. */
const fakePage = (): Readonly<{
  doc: { visibilityState: string; addEventListener: (type: string, fn: Listener) => void };
  win: { addEventListener: (type: string, fn: Listener) => void };
  fire: (type: string) => void;
}> => {
  const listeners = new Map<string, Listener[]>();
  const add = (type: string, fn: Listener): void => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  };
  return {
    doc: { visibilityState: 'visible', addEventListener: add },
    win: { addEventListener: add },
    fire: (type) => {
      (listeners.get(type) ?? []).forEach((fn) => {
        fn();
      });
    },
  };
};

beforeEach(() => {
  created.splice(0);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browserNetDeps', () => {
  test('the real clock, an ICE loader, and a Transport at the given log level over the ?peer= hook', () => {
    const deps = browserNetDeps({ search: '', debug: 1 });
    expect(deps.clock).toBe(realClock);
    expect(typeof deps.ice?.load).toBe('function');
    expect(typeof deps.ice?.describe).toBe('function');
    deps.transportFor(null).open(undefined);
    expect(created).toEqual([[{ debug: 1 }]]);

    const gin = browserNetDeps({ search: '?peer=127.0.0.1:9000', debug: 0 });
    gin.transportFor(null).open('ginrummy-ari-ABCD');
    expect(created.at(-1)).toEqual([
      'ginrummy-ari-ABCD',
      { debug: 0, host: '127.0.0.1', port: 9000, path: '/', secure: false },
    ]);
  });

  test("onWake is the browser's visibilitychange + online unless the page passes its own", () => {
    const own = (): void => undefined;
    expect(browserNetDeps({ search: '', debug: 0 }).onWake).toBe(browserWake);
    expect(browserNetDeps({ search: '', debug: 0, onWake: own }).onWake).toBe(own);
  });
});

describe('browserWake (the legacy keepPeerAlive listeners)', () => {
  test('fires on the page turning visible and on the network coming back, not on hiding', () => {
    const page = fakePage();
    vi.stubGlobal('document', page.doc);
    vi.stubGlobal('window', page.win);
    let woke = 0;
    browserWake(() => {
      woke += 1;
    });
    page.doc.visibilityState = 'hidden';
    page.fire('visibilitychange');
    expect(woke).toBe(0);
    page.doc.visibilityState = 'visible';
    page.fire('visibilitychange');
    expect(woke).toBe(1);
    page.fire('online');
    expect(woke).toBe(2);
  });
});
