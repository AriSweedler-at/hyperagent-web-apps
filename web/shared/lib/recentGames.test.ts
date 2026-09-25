import { describe, expect, test } from 'vitest';

import {
  OUTCOMES,
  RECENT_GAMES_CAP,
  appendCapped,
  decodeRecentGame,
  decodeRecentGames,
  outcomeFor,
  type RecentGame,
} from './recentGames.ts';

const game = (at: number, over: Partial<RecentGame> = {}): RecentGame => ({
  at,
  mode: 'local',
  players: ['Ann', 'Bob'],
  score: '104–87',
  winner: 0,
  outcome: 'win',
  ...over,
});

describe('appendCapped', () => {
  test('the new entry goes first; the list never exceeds the cap (20), the oldest falling off', () => {
    expect(RECENT_GAMES_CAP).toBe(20);
    expect(appendCapped([], game(1))).toEqual([game(1)]);
    expect(appendCapped([game(1)], game(2))).toEqual([game(2), game(1)]);
    const full = Array.from({ length: RECENT_GAMES_CAP }, (_, i) => game(100 - i));
    const more = appendCapped(full, game(101));
    expect(more).toHaveLength(RECENT_GAMES_CAP);
    expect(more[0]).toEqual(game(101));
    expect(more.at(-1)).toEqual(game(100 - (RECENT_GAMES_CAP - 2)));
    expect(more).not.toContainEqual(game(100 - (RECENT_GAMES_CAP - 1)));
    // A smaller cap, for a caller that wants one.
    expect(appendCapped([game(1), game(2)], game(3), 2)).toEqual([game(3), game(1)]);
  });
});

describe('outcomeFor', () => {
  test("the user's seat won, somebody else did, or nobody", () => {
    expect(outcomeFor(0, 0)).toBe('win');
    expect(outcomeFor(1, 1)).toBe('win');
    expect(outcomeFor(0, 1)).toBe('loss');
    expect(outcomeFor(1, 0)).toBe('loss');
    expect(outcomeFor(0, null)).toBe('draw');
    expect(OUTCOMES).toEqual(['win', 'loss', 'draw']);
  });
});

describe('the decoders', () => {
  test('a record round-trips through JSON; a bad field names its path', () => {
    const stored = game(1_700_000_000_000, { mode: 'online', winner: null, outcome: 'draw' });
    expect(decodeRecentGame(JSON.parse(JSON.stringify(stored)))).toEqual({
      ok: true,
      value: stored,
    });
    expect(decodeRecentGame({ ...stored, outcome: 'tie' })).toEqual({
      ok: false,
      error: { path: ['outcome'], expected: 'one of "win" | "loss" | "draw"' },
    });
    expect(decodeRecentGame({ ...stored, winner: 'Ann' }).ok).toBe(false);
    expect(decodeRecentGame({ ...stored, at: -1 }).ok).toBe(false);
    expect(decodeRecentGame({ ...stored, players: 'Ann' }).ok).toBe(false);
    expect(decodeRecentGame(null).ok).toBe(false);
  });

  test('a list decodes; what is not a list is []; a bad entry is dropped, the rest kept', () => {
    const a = game(1);
    const b = game(2, { outcome: 'loss', winner: 1 });
    expect(decodeRecentGames([b, a])).toEqual({ ok: true, value: [b, a] });
    expect(decodeRecentGames([])).toEqual({ ok: true, value: [] });
    expect(decodeRecentGames('nope')).toEqual({ ok: true, value: [] });
    expect(decodeRecentGames({ at: 1 })).toEqual({ ok: true, value: [] });
    expect(decodeRecentGames(null)).toEqual({ ok: true, value: [] });
    expect(decodeRecentGames([b, { junk: true }, a, 7])).toEqual({ ok: true, value: [b, a] });
  });
});
