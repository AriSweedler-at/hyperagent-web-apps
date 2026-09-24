// Two-peer Sheshbesh through the local PeerServer (docs/design/backgammon-board.md "Online";
// gin's e2e/gin-online.spec.ts, step for step): the host opens a table, the guest sits down by
// the code read off the host's screen, the host starts the match, both boards show the same
// seeded opening (the same position, turn and dice), a roll out of turn is refused with a toast,
// the guest's Roll is rolled by the host (its `roll` is an `action` frame; the dice come back in
// the next `state` frame) and both see the same dice, one move by taps propagates to the other
// board, and the recorded Peer constructions prove the ?peer= broker override and the ?ice=
// configuration reached PeerJS under the `sheshbesh-` peer id.
import type { Page } from '@playwright/test';

import { MESSAGES, type Action } from '../web/games/backgammon/src/engine/index.ts';
import {
  bgBoardsAgree,
  bgHostStarts,
  bgMove,
  bgRoll,
  boardKey,
  ownPlace,
  readBoard,
  requireBoard,
} from './fixtures/backgammon.ts';
import { expectPeerOptions, openGame } from './fixtures/player.ts';
import { expect, hostRoom, joinByCode, test } from './fixtures/two-players.ts';

/** An action through the documented hook, as the sandbox and the style driver play (docs/ARCHITECTURE.md). */
const act = (page: Page, action: Action): Promise<void> =>
  page.evaluate(`window.__backgammon.act(${JSON.stringify(action)})`);

/** The host's first legal move through the hook, until its turn is over or `left` moves are played (a double has four). */
const hostMoves = async (host: Page, left: number): Promise<void> => {
  const now = await requireBoard(host);
  if (left === 0 || now.turn === 1 || now.phase !== 'moving') return;
  const move = now.legal[0];
  if (move === undefined) throw new Error('moving with no legal move');
  await act(host, { type: 'move', from: move.from, to: move.to, die: move.die });
  await expect.poll(async () => boardKey(await readBoard(host))).not.toBe(boardKey(now));
  await hostMoves(host, left - 1);
};

/**
 * The host plays its turn through the hook until the turn passes to the guest; a spec about the
 * guest's roll needs the guest to be the one to roll.
 */
const hostPlaysUntilGuestRolls = async (host: Page, guest: Page): Promise<void> => {
  const v = await bgBoardsAgree(host, guest);
  if (v.turn === 1) return;
  await bgRoll(host);
  await hostMoves(host, 4);
  await expect.poll(async () => (await readBoard(guest))?.turn).toBe(1);
};

test(
  'host opens a table, guest joins by code, both see the seeded opening, the host rolls for the guest, a move propagates',
  { tag: '@online' },
  async ({ players, project }) => {
    const { host, guest } = players;
    await openGame(host, project, 'backgammon');
    await openGame(guest, project, 'backgammon');

    const code = await hostRoom(host, 'backgammon', 'Host');
    await joinByCode(guest, 'backgammon', code, 'Guest');
    await expect(host.page.locator('#hostWaitStatus')).toContainText('Guest joined!');
    await bgHostStarts(host.page, guest.page);

    // Both boards agree on the opening: the host is seat 0 and the guest seat 1, the opening roll
    // resolved and the winner to roll; the names cross over.
    const opening = await bgBoardsAgree(host.page, guest.page);
    expect(opening).toMatchObject({ gameNo: 1, phase: 'toRoll', me: { idx: 0 } });
    expect(await requireBoard(guest.page)).toMatchObject({ me: { idx: 1 }, turn: opening.turn });
    await expect(host.page.locator('#oppName')).toHaveText('Guest');
    await expect(guest.page.locator('#oppName')).toHaveText('Host');
    await expect(host.page.locator('#gameBadge')).toHaveText('Game 1 · 0–0 · to 5');
    await expect(guest.page.locator('#gameBadge')).toHaveText('Game 1 · 0–0 · to 5');

    // Out of turn: the waiting seat's roll is refused with the engine's message (for the guest it
    // comes back as a toast frame from the host).
    const waiting = opening.turn === 0 ? guest.page : host.page;
    await act(waiting, { type: 'roll' });
    await expect(waiting.locator('#toast')).toHaveText(MESSAGES.NOT_YOUR_TURN);
    expect(await requireBoard(waiting)).toMatchObject({ phase: 'toRoll', dice: null });

    // The guest rolls: its page sends `roll`, the host rolls and both boards show the same dice.
    await hostPlaysUntilGuestRolls(host.page, guest.page);
    const rolled = await bgRoll(guest.page);
    const shared = await bgBoardsAgree(host.page, guest.page);
    expect(shared.dice).toEqual(rolled.dice);
    expect(shared.phase).toBe('moving');

    // One move by taps on the guest's board: the host applies it and both boards agree.
    const move = rolled.legal[0];
    if (move === undefined) throw new Error('the guest rolled and has no legal move');
    await bgMove(guest.page, ownPlace(rolled, move.from), ownPlace(rolled, move.to));
    const moved = await bgBoardsAgree(host.page, guest.page);
    expect(moved.board).not.toEqual(rolled.board);
    await expect(host.page.locator('#curtainOverlay')).toBeHidden();
    await expect(guest.page.locator('#curtainOverlay')).toBeHidden();

    // PeerJS was constructed with the harness's broker and ICE configuration on both sides.
    const hostCall = (await host.peerCalls()).at(-1);
    const guestCall = (await guest.peerCalls()).at(-1);
    expect(hostCall?.id).toBe(`sheshbesh-${code}`);
    expectPeerOptions(hostCall, 0);
    expect(guestCall?.id).toBeNull();
    expectPeerOptions(guestCall, 0);
  },
);
