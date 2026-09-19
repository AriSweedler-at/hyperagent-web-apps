import { describe, expect, test } from 'vitest';

import {
  KNOCK_LABELS,
  computeRoundScores,
  ranked,
  totalFor,
  winnerOf,
  type ScorerState,
} from './scores.ts';

const ann = { id: 'a', name: 'Ann' };
const bob = { id: 'b', name: 'Bob' };
const cy = { id: 'c', name: 'Cy' };
const players = [ann, bob, cy];

describe('computeRoundScores', () => {
  test('a knock pays the knocker the difference from each player over their count', () => {
    // The e2e scorer spec's hand: Ann knocked with 5 against Bob's 20.
    expect(
      computeRoundScores([ann, bob], {
        deadwood: { a: 5, b: 20 },
        knockerId: 'a',
        knockType: 'knock',
      }),
    ).toEqual({ a: 15, b: 0 });
  });

  test('a player at or under the knocker undercuts for the difference plus 25', () => {
    expect(
      computeRoundScores(players, {
        deadwood: { a: 5, b: 20, c: 3 },
        knockerId: 'a',
        knockType: 'knock',
      }),
    ).toEqual({ a: 15, b: 0, c: 27 });
    expect(
      computeRoundScores([ann, bob], {
        deadwood: { a: 5, b: 5 },
        knockerId: 'a',
        knockType: 'knock',
      }),
    ).toEqual({ a: 0, b: 25 });
  });

  test('gin pays 25 plus every opponent count to the knocker; the knocker has no deadwood', () => {
    expect(
      computeRoundScores(players, {
        deadwood: { a: 12, b: 0, c: 40 },
        knockerId: 'b',
        knockType: 'gin',
      }),
    ).toEqual({ a: 0, b: 102, c: 0 });
  });

  test('a missing count reads as 0; the keys follow the players order', () => {
    // Cy knocked with nothing recorded (0): Ann at 0 undercuts for 25, Bob pays his 10 to Cy.
    const scores = computeRoundScores(players, {
      deadwood: { b: 10 },
      knockerId: 'c',
      knockType: 'knock',
    });
    expect(scores).toEqual({ a: 25, b: 0, c: 10 });
    expect(Object.keys(scores)).toEqual(['a', 'b', 'c']);
  });
});

describe('totals and standings', () => {
  const state: ScorerState = {
    players,
    target: 100,
    rounds: [
      {
        deadwood: { a: 5, b: 20, c: 3 },
        knockerId: 'a',
        knockType: 'knock',
        scores: { a: 15, b: 0, c: 27 },
        ts: 1,
      },
      {
        deadwood: { a: 12, b: 0, c: 40 },
        knockerId: 'b',
        knockType: 'gin',
        scores: { a: 0, b: 102, c: 0 },
        ts: 2,
      },
    ],
    startedAt: 0,
  };

  test('totalFor sums a player across hands; an unknown id is 0', () => {
    expect(totalFor(state.rounds, 'a')).toBe(15);
    expect(totalFor(state.rounds, 'b')).toBe(102);
    expect(totalFor(state.rounds, 'zz')).toBe(0);
    expect(totalFor([], 'a')).toBe(0);
  });

  test('ranked orders by total, ties keep the players order', () => {
    expect(ranked(state).map((s) => [s.player.name, s.total])).toEqual([
      ['Bob', 102],
      ['Cy', 27],
      ['Ann', 15],
    ]);
    expect(ranked({ ...state, rounds: [] }).map((s) => s.player.name)).toEqual([
      'Ann',
      'Bob',
      'Cy',
    ]);
  });

  test('winnerOf is the leader once they reach the target', () => {
    expect(winnerOf(state)).toEqual({ player: bob, total: 102 });
    expect(winnerOf({ ...state, target: 150 })).toBeNull();
    expect(winnerOf({ ...state, players: [], rounds: [] })).toBeNull();
  });

  test('the chip labels', () => {
    expect(KNOCK_LABELS).toEqual({ knock: 'Knock', gin: 'Gin' });
  });
});
