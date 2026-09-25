// Two-peer Sheshbesh through the local PeerServer (docs/design/backgammon-board.md "Online"),
// backgammon's half: once the shell has connected the two pages and the host has started the
// match, a roll out of turn is refused with a toast, the guest's Roll is rolled by the host (its
// `roll` is an `action` frame; the dice come back in the next `state` frame) and both see the same
// dice, and one move by taps propagates to the other board. The shell's half (the table, the join,
// the seeded opening on both boards with the seats and the names, the recorded Peer constructions
// with the ?peer= and ?ice= hooks under the `sheshbesh-` peer id) is e2e/shell-online.spec.ts, for
// both shell games.
import type { Page } from '@playwright/test';

import { MESSAGES, type Action } from '../web/games/backgammon/src/engine/index.ts';
import {
  bgBoardsAgree,
  bgMove,
  bgRoll,
  boardKey,
  ownPlace,
  readBoard,
  requireBoard,
} from './fixtures/backgammon.ts';
import { SHELL_DRIVERS, connect } from './fixtures/online-games.ts';
import { expect, test } from './fixtures/two-players.ts';

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
  'after the start a roll out of turn is refused, the host rolls for the guest, a move propagates',
  { tag: '@online' },
  async ({ players, project }) => {
    const { host, guest } = players;
    await connect(players, project, 'backgammon');
    // The shell's start plus backgammon's no-curtain asserts: its SHELL_DRIVERS row (dry-round-2.md I5).
    await SHELL_DRIVERS.backgammon.start(host.page, guest.page);
    // The opening both boards agree on; whose turn it is decides which seat is refused below.
    const opening = await bgBoardsAgree(host.page, guest.page);

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
  },
);
