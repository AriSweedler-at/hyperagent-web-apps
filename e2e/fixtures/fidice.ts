// Fidice's table on the shell path (docs/design/fidice-shell-adoption.md §4 M5), read through the
// documented hook (`window.__fidice`: `view()` my view, `legal()` the holder's choices, `act(a)`
// through the reducer) and the legacy game screen the shell mounts into `#fidiceTable`
// (src/view/screens/table.ts: `#screen-game`, its `.seat`s with the cup holder marked, the
// "Round N" label). The legacy lobby drivers that lived here (`#btnCreate`, `#screen-lobby`,
// `#joinCode`) retired at M5: the room is the shell's, e2e/fixtures/shell.ts told the game.
// Imports shell.ts, never online-games.ts (import-x/no-cycle); `fidiceStartLocal` composes
// `startLocal` as the other games' fixtures do.
import { expect, type Locator, type Page } from '@playwright/test';

import type { Action, PublicState } from '../../web/games/fidice/src/domain/types.ts';
import type { Viewport } from './geometry.ts';
import { DEFAULT_NAMES, startLocal, type Names } from './shell.ts';

/** The hook's view: my view of the table, or null before a deal. */
export const readView = (page: Page): Promise<PublicState | null> =>
  page.evaluate<PublicState | null>('window.__fidice.view()');

export const requireView = async (page: Page): Promise<PublicState> => {
  const v = await readView(page);
  if (v === null) throw new Error('fidice: no table in view');
  return v;
};

/** The holder's legal actions, as the table's action steps offer them (src/legal.ts). */
export const readLegal = (page: Page): Promise<ReadonlyArray<Action>> =>
  page.evaluate<ReadonlyArray<Action>>('window.__fidice.legal()');

/** An action through the reducer, as a tap on the table's controls would raise it. */
export const fidiceAct = (page: Page, action: Action): Promise<unknown> =>
  page.evaluate(`window.__fidice.act(${JSON.stringify(action)})`);

/** The "Round N" label on the game screen. */
export const fidiceRound = (page: Page): Locator =>
  page.locator('#screen-game').getByText(/^Round \d+$/);

/** The seats around the table; `.holder` marks the cup's. */
export const fidiceSeats = (page: Page): Locator => page.locator('#screen-game .seat');
export const fidiceHolder = (page: Page): Locator => page.locator('#screen-game .seat.holder');

/**
 * What every page at one table agrees on, as one comparable string: the round and its phase, the
 * cup holder, the bid on the table and who made it, which dice are out on the table, and the
 * players with their lives and losses. The dice values are left out (the holder alone sees the
 * cup, so two views differ by design) and so is the table talk (the log grows with the paint, not
 * the game).
 */
export const fidiceKey = (v: PublicState): string =>
  JSON.stringify([
    v.roundNo,
    v.phase,
    v.round?.holder ?? null,
    v.round?.bid ?? null,
    v.round?.bidder ?? null,
    v.round?.dice.map((d) => d.inCup) ?? null,
    v.players.map((p) => [p.name, p.lives, p.losses]),
  ]);

/** The table as one page shows it (`fidiceKey`), `none` before a deal. */
export const fidiceSnapshot = async (page: Page): Promise<string> => {
  const v = await readView(page);
  return v === null ? 'none' : fidiceKey(v);
};

/** The holder bids the first hand the ladder offers (a bid needs no peek); the cup passes. */
export const fidiceBid = async (page: Page): Promise<void> => {
  const bid = (await readLegal(page)).find((a) => a.type === 'bid');
  if (bid === undefined) throw new Error('fidice: no bid to make');
  await fidiceAct(page, bid);
};

/** Start pass the phone between `names` at `viewport`: the shell's start, the curtain up for the cup holder. */
export const fidiceStartLocal = (
  page: Page,
  url: string,
  viewport: Viewport,
  names: Names = DEFAULT_NAMES,
): Promise<void> => startLocal(page, url, viewport, names);

/**
 * Play one human turn on `page` for the player named `name` when the cup is theirs: with no bid
 * on the table, the first legal bid; facing a bid, a call. Returns what was played, or null when
 * the cup is elsewhere or the round is in its reveal.
 */
export const humanTurn = async (page: Page, name: string): Promise<'bid' | 'call' | null> => {
  const v = await readView(page);
  if (v === null) return null;
  const r = v.round;
  if (v.phase !== 'playing' || r === null || v.reveal !== null) return null;
  if (r.holder !== v.players.findIndex((p) => p.name === name)) return null;
  if (r.bid === null) {
    await fidiceBid(page);
    return 'bid';
  }
  await fidiceAct(page, { type: 'call' });
  return 'call';
};

/** Both game screens show `round`, with the cup at the same seat. */
export const fidiceSameRound = async (pages: ReadonlyArray<Page>, round: string): Promise<void> => {
  const [first, ...rest] = pages;
  if (first === undefined) return;
  await expect(fidiceRound(first)).toHaveText(round);
  await expect(fidiceHolder(first)).toHaveCount(1);
  const seat = (await fidiceHolder(first).getAttribute('data-seat')) ?? '';
  await Promise.all(
    rest.map(async (page) => {
      await expect(fidiceRound(page)).toHaveText(round);
      await expect(fidiceHolder(page)).toHaveAttribute('data-seat', seat);
    }),
  );
};
