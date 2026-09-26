// The hook's legal list (src/legal.ts) against a seeded table: what the cup holder may do at each
// step of a round, as the table's action steps offer it.
import { describe, expect, test } from 'vitest';

import { must } from '../../../../test/shared/engine-helpers.ts';
import { mulberry32 } from '../../../shared/lib/rng.ts';
import { HOST, apply, bySeat, newGame } from './domain/game.ts';
import { TOP_RANK, asRank } from './domain/hands.ts';
import { makeHuman, seatPlayer } from './domain/lobby.ts';
import { redactFor } from './domain/publicState.ts';
import type { Rank, Seat, State } from './domain/types.ts';
import { legalActions, ranksAbove } from './legal.ts';

const rng = mulberry32(3);
const table = (lives: number): State =>
  must(
    seatPlayer(
      must(seatPlayer(newGame('ABCDE', lives), makeHuman('host', 'Ann', lives))),
      makeHuman('guest', 'Bob', lives),
    ),
  );
const holderOf = (s: State): Seat => {
  const r = s.round;
  if (r === null) throw new Error('no round');
  return r.holder;
};
const types = (s: State): ReadonlyArray<string> =>
  legalActions(redactFor(s, { kind: 'spectator' })).map((a) => a.type);
const bids = (s: State): ReadonlyArray<Rank> =>
  legalActions(redactFor(s, { kind: 'spectator' })).flatMap((a) =>
    a.type === 'bid' ? [a.rank] : [],
  );

describe('ranksAbove', () => {
  test('every rung above the bid, lowest first; every rung when there is none; none above the top', () => {
    expect(ranksAbove(null)).toHaveLength(TOP_RANK + 1);
    expect(ranksAbove(null)[0]).toBe(0);
    expect(ranksAbove(asRank(TOP_RANK - 2))).toEqual([TOP_RANK - 1, TOP_RANK]);
    expect(ranksAbove(TOP_RANK)).toEqual([]);
  });
});

describe('legalActions', () => {
  test('nothing in the lobby; at a fresh roll the holder bids (and may finish at a scoring table); facing a bid, call or peek; accepted, raise alone; a reveal waits for next', () => {
    const lobby = table(0);
    expect(types(lobby)).toEqual([]);
    const started = must(apply(lobby, HOST, { type: 'start' }, rng));
    expect(new Set(types(started))).toEqual(new Set(['bid', 'finish']));
    expect(bids(started)).toHaveLength(TOP_RANK + 1);
    const holder = holderOf(started);
    const bid = must(apply(started, bySeat(holder), { type: 'bid', rank: asRank(10) }, rng));
    expect(types(bid)).toEqual(['call', 'peek', 'finish']);
    const next = holderOf(bid);
    const peeked = must(apply(bid, bySeat(next), { type: 'peek' }, rng));
    expect(types(peeked)).not.toContain('call');
    expect(types(peeked)).not.toContain('peek');
    expect(bids(peeked)[0]).toBe(11);
    expect(bids(peeked)).toHaveLength(TOP_RANK - 10);
    const raised = must(apply(peeked, bySeat(next), { type: 'bid', rank: asRank(20) }, rng));
    expect(types(raised)).toEqual(['call', 'peek', 'finish']);
    const called = must(apply(raised, bySeat(holderOf(raised)), { type: 'call' }, rng));
    expect(types(called)).toEqual(['next']);
  });

  test('a table playing for kayaks offers no finish', () => {
    const started = must(apply(table(3), HOST, { type: 'start' }, rng));
    expect(types(started)).not.toContain('finish');
    expect(types(started)).toContain('bid');
  });
});
