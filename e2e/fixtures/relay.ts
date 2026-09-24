// What the relay-forced specs share (e2e/shell-relay.spec.ts for gin and backgammon,
// e2e/fidice-relay.spec.ts): the skip when no TURN relay is at hand, the toast a page writes once
// its channel runs through one (PATH_RELAY_MSG in web/shared/edge/peer.ts, shared by gin and
// backgammon; fidice's describePath in web/games/fidice/src/net/peerjs.ts), and the proof from the
// connection itself that the selected candidate pair goes through the relay.
import { expect, type Page } from '@playwright/test';

import { selectedPairs } from './peer-connections.ts';
import { TURN_SKIP_REASON, turnStatus } from './site.ts';
import { test } from './two-players.ts';

export const RELAY_TOAST = 'Connected via relay';

/** Skip unless the harness's coturn is at hand (the deployed run relays through it too). */
export const skipWithoutRelay = (): void => {
  const status = turnStatus();
  if (status !== 'on') test.skip(true, TURN_SKIP_REASON[status]);
};

/**
 * With `iceTransportPolicy: 'relay'` the page gathers relay candidates only, so the selected
 * pair's local end must be `relay`; the remote end is the peer's relay candidate, or the
 * peer-reflexive view of it when a connectivity check arrived before signalling delivered it.
 */
export const expectRelayPath = async (page: Page, side: string): Promise<void> => {
  const pairs = await selectedPairs(page);
  const selected = pairs.filter((pair) => pair.local !== null);
  expect(selected, `${side}: a connection with a selected candidate pair`).not.toEqual([]);
  selected.forEach((pair) => {
    expect(pair.local, `${side}: local candidate type`).toBe('relay');
    expect(['relay', 'prflx'], `${side}: remote candidate type`).toContain(pair.remote);
  });
};
