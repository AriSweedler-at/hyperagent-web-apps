import { describe, expect, test } from 'vitest';

import { fakeClock } from '../../../../shared/edge/clock.fake.ts';
import { fakeBroker } from '../../../../shared/edge/transport.fake.ts';
import { clientTransport, hostTransport, type PeerDeps } from './peerjs.ts';

// The legacy id was `fidice-${code.toLowerCase()}`; web/shared/lib/roomCode.ts spells the same
// literal for every game, and test/parity/fidice.sessions.test.ts pins the ids of every trace.
describe('the broker id', () => {
  const deps = (broker: ReturnType<typeof fakeBroker>): PeerDeps => ({
    transportFor: () => broker.transport(),
    ice: null,
    clock: fakeClock(0),
  });

  test('the host registers under fidice-<code>, lower-cased', () => {
    const broker = fakeBroker({ delivery: 'manual' });
    const host = hostTransport('AB2CD', deps(broker));
    expect(broker.peers()).toEqual(['fidice-ab2cd']);
    host.close();
  });

  test('the client dials the same id', async () => {
    const broker = fakeBroker({ newId: () => 'guest-1' });
    const host = hostTransport('AB2CD', deps(broker));
    const client = clientTransport('ab2cd', deps(broker));
    const opened = new Promise<void>((resolve) => {
      host.onConnection(() => {
        resolve();
      });
    });
    client.onOpen(() => undefined);
    await opened;
    expect(broker.peers()).toEqual(['fidice-ab2cd', 'guest-1']);
    client.close();
    host.close();
  });
});
