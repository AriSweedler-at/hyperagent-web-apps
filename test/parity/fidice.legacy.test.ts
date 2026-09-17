// Characterization of the fidice core (docs/MIGRATION.md step 2; docs/ARCHITECTURE.md "Testing
// pyramid", parity). Every assertion is an executable oracle over seeded inputs, so the same suite
// runs unchanged on the de-bundled modules in step 6: add ['current', adapter] to `legs`.
import { createHash } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import { mulberry32, type Rng } from '../../web/shared/lib/rng.ts';
import {
  loadLegacyFidice,
  type Action,
  type FidiceCore,
  type GameState,
  type Hand,
  type Result,
} from './fidice.api.ts';

const legs: ReadonlyArray<readonly [string, FidiceCore]> = [['legacy', loadLegacyFidice()]];

const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
/** A bot game takes a few hundred steps; the cap turns a hang into a failure. */
const STEP_CAP = 20_000;

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const errorOf = <T>(r: Result<T>): string => (r.ok ? 'ok' : r.error);
const pairs = <T>(xs: ReadonlyArray<T>): [T, T][] =>
  xs.slice(1).flatMap((b, i) => {
    const a = xs[i];
    return a === undefined ? [] : [[a, b] as [T, T]];
  });
/** First 16 hex digits of sha256 over the JSON: a pinned golden without a goldens directory. */
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

describe.each(legs)('fidice core: %s', (_leg, F) => {
  const seat = F.bySeat;
  const fixed = (): Rng => () => 0.3;
  const table = (n: number, lives = 3): GameState =>
    Array.from({ length: n }, (_, i) =>
      F.makeHuman(`h${String(i)}`, `P${String(i)}`, lives),
    ).reduce((s, p) => unwrap(F.seatPlayer(s, p)), F.newGame('ABCDE', lives));
  const started = (n: number, rng: Rng = fixed()): GameState =>
    unwrap(F.apply(table(n), F.HOST, { type: 'start' }, rng));
  const values = (
    s: GameState,
    viewer: Parameters<FidiceCore['redactFor']>[1],
  ): (number | null)[] => F.redactFor(s, viewer).round?.dice.map((d) => d.value) ?? [];

  describe('hand ladder', () => {
    test('252 rows ranked 0..251, strictly ascending under compareShapes', () => {
      expect([F.HAND_COUNT, F.BOTTOM_RANK, F.TOP_RANK]).toEqual([252, 0, 251]);
      expect(F.HANDS).toHaveLength(252);
      F.HANDS.forEach((h, i) => {
        expect(h.rank).toBe(i);
      });
      pairs(F.HANDS).forEach(([a, b]) => {
        expect(F.compareShapes(a, b)).toBeLessThan(0);
      });
      expect(new Set(F.HANDS.map((h) => h.name)).size).toBe(252);
    });

    test.each(F.HANDS.map((h) => [h.rank, h.name, h] as const))(
      'row %i "%s" round-trips through rankOf and classify',
      (rank, name, h: Hand) => {
        expect(F.rankOf(h.dice)).toBe(rank);
        expect(F.rankOf([...h.dice].reverse())).toBe(rank);
        expect(F.handAt(rank).name).toBe(name);
        const { cat, primary, secondary, kickers } = F.classify(h.dice);
        expect({ cat, primary, secondary, kickers }).toEqual({
          cat: h.cat,
          primary: h.primary,
          secondary: h.secondary,
          kickers: h.kickers,
        });
        expect(h.dice).toHaveLength(5);
        expect(h.dice.every((d) => F.DIE_VALUES.includes(d))).toBe(true);
      },
    );

    test('categories, strongest first, with their row counts and rank spans', () => {
      expect(F.CATEGORY_INFO.map((c) => [c.cat, c.hands.length, c.minRank, c.maxRank])).toEqual([
        ['five', 6, 246, 251],
        ['quads', 30, 216, 245],
        ['fullhouse', 30, 186, 215],
        ['straight', 2, 184, 185],
        ['trips', 60, 124, 183],
        ['twopair', 60, 64, 123],
        ['pair', 60, 4, 63],
        ['high', 4, 0, 3],
      ]);
      expect(F.CATEGORIES).toEqual([
        'high',
        'pair',
        'twopair',
        'trips',
        'straight',
        'fullhouse',
        'quads',
        'five',
      ]);
    });

    test('groups partition the ladder', () => {
      expect(F.GROUPS).toHaveLength(48);
      expect(F.GROUPS.filter((g) => g.collapsible)).toHaveLength(40);
      expect(F.GROUPS.reduce((n, g) => n + g.hands.length, 0)).toBe(252);
      F.GROUPS.forEach((g) => {
        g.hands.forEach((h) => {
          expect(h.groupKey).toBe(g.key);
        });
        expect(g.maxRank).toBe(Math.max(...g.hands.map((h) => h.rank)));
        expect(g.minRank).toBe(Math.min(...g.hands.map((h) => h.rank)));
        expect(g.collapsible).toBe(g.hands.length > 1);
      });
      F.HANDS.forEach((h) => {
        expect(F.groupOf(h).key).toBe(h.groupKey);
        expect(F.groupTop(h.rank)).toBe(F.groupOf(h).maxRank);
      });
    });

    test('named anchors', () => {
      expect(F.HANDS[0]).toMatchObject({
        name: 'High die 6 (6-4-3-2-1)',
        dice: [6, 4, 3, 2, 1],
        cat: 'high',
      });
      expect(F.HANDS[251]).toMatchObject({
        name: 'Five 6s',
        dice: [6, 6, 6, 6, 6],
        group: 'Five 6s',
      });
      expect(F.rankOf([6, 6, 6, 5, 5])).toBe(215);
      expect(F.handAt(215)).toMatchObject({ name: '6s full of 5s', group: '6s full' });
      expect(F.HANDS.filter((h) => h.cat === 'straight').map((h) => [h.rank, h.name])).toEqual([
        [184, 'Straight 1–5'],
        [185, 'Straight 2–6'],
      ]);
      // spokenName says the group name at a collapsible group's top rung, the hand name elsewhere.
      expect(F.spokenName(215)).toBe('6s full');
      expect(F.spokenName(214)).toBe(F.handAt(214).name);
      expect(F.spokenName(251)).toBe('Five 6s');
      expect(F.spokenName(0)).toBe('High die 6 (6-4-3-2-1)');
    });

    test('isRank and asRank', () => {
      expect([0, 251, 100].map(F.isRank)).toEqual([true, true, true]);
      expect([-1, 252, 1.5, '3', null, undefined].map(F.isRank)).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
      expect(F.asRank(7)).toBe(7);
      expect(() => F.asRank(252)).toThrow(new RangeError('Not a rank: 252'));
    });
  });

  describe('probability', () => {
    test('survival curves are non-increasing and total one', () => {
      const all = F.survivalFor([], 5);
      expect(all).toHaveLength(253);
      expect(all[0]).toBeCloseTo(1, 10);
      expect(all[252]).toBe(0);
      pairs(all).forEach(([a, b]) => {
        expect(b).toBeLessThanOrEqual(a + 1e-12);
      });
      pairs(F.survivalFor([1, 2], 3)).forEach(([a, b]) => {
        expect(b).toBeLessThanOrEqual(a + 1e-12);
      });
    });

    test('spot values', () => {
      expect(F.probabilityAtLeast([], 5, 0)).toBeCloseTo(1, 10);
      expect(F.probabilityAtLeast([], 5, 251)).toBeCloseTo(1 / 7776, 12);
      expect(F.probabilityAtLeast([6, 6, 6, 6, 6], 0, 251)).toBe(1);
      expect(F.probabilityAtLeast([6, 6, 6, 6], 1, 251)).toBeCloseTo(1 / 6, 12);
      expect(F.probabilityAtLeast([6, 6, 6, 6], 1, 216)).toBeCloseTo(1, 12);
    });
  });

  describe('lobby', () => {
    test('a new table', () => {
      expect(F.newGame('ABCDE', 3)).toEqual({
        code: 'ABCDE',
        lives: 3,
        phase: 'lobby',
        players: [],
        spectators: 0,
        roundNo: 0,
        round: null,
        reveal: null,
        winner: null,
        log: [],
        records: [],
        hostSeat: 0,
        autoNextAt: null,
      });
      expect([F.MAX_SEATS, F.MIN_PLAYERS]).toEqual([6, 2]);
    });

    test('names are trimmed to 16 characters; seats are limited to six', () => {
      expect(F.makeHuman('x', '  Averyveryverylongname  ', 3)).toEqual({
        id: 'x',
        name: 'Averyveryverylon',
        lives: 3,
        losses: 0,
        connected: true,
        bot: null,
      });
      expect(F.makeHuman('y', '   ', 3).name).toBe('Player');
      const full = table(6);
      expect(errorOf(F.seatPlayer(full, F.makeHuman('p6', 'P6', 3)))).toBe('Table is full (6).');
      expect(full.log.map((e) => e.text)).toEqual(
        Array.from({ length: 6 }, (_, i) => `P${String(i)} sits down at the table.`),
      );
    });

    test('bots take unused lake names and the requested strategy', () => {
      const s = table(1);
      const bot = F.makeBot(s, 'b1', { strategy: 'trapper', random: false });
      expect(bot).toMatchObject({
        name: 'Loon',
        lives: 3,
        bot: { strategy: 'trapper', random: false },
      });
      const seated = unwrap(F.seatPlayer(s, bot));
      expect(seated.log.at(-1)?.text).toBe('Loon (a computer) sits down.');
      expect(F.makeBot(seated, 'b2', { strategy: 'gambler', random: true }).name).toBe('Moose');
      expect(
        unwrap(
          F.seatPlayer(seated, F.makeBot(seated, 'b2', { strategy: 'gambler', random: true })),
        ).log.at(-1)?.text,
      ).toBe('Moose (a computer, strategy drawn at random) sits down.');
    });
  });

  describe('apply phase gates', () => {
    test('lobby: only the host can start, and only with two or more players', () => {
      const s = table(3);
      expect(errorOf(F.apply(s, F.HOST, { type: 'peek' }, fixed()))).toBe(
        'The game has not started.',
      );
      expect(errorOf(F.apply(s, seat(1), { type: 'start' }, fixed()))).toBe(
        'Only the host can start.',
      );
      expect(errorOf(F.apply(table(1), F.HOST, { type: 'start' }, fixed()))).toBe(
        'Need at least 2 players.',
      );
      expect(errorOf(F.apply(s, seat(0), { type: 'start' }, fixed()))).toBe('ok');
      const playing = unwrap(F.apply(s, F.HOST, { type: 'start' }, fixed()));
      expect(playing.phase).toBe('playing');
      expect(playing.roundNo).toBe(1);
      expect(playing.round).toMatchObject({
        holder: 0,
        bid: null,
        bidder: null,
        rolled: false,
        touched: false,
        history: [],
      });
      expect(playing.round?.dice).toEqual(
        Array.from({ length: 5 }, () => ({ value: 2, inCup: true })),
      );
      expect(playing.players.map((p) => [p.lives, p.losses])).toEqual([
        [3, 0],
        [3, 0],
        [3, 0],
      ]);
      expect(playing.log.slice(-2).map((e) => e.text)).toEqual([
        'Game on! 3 players, 3 lives each.',
        'Round 1: P0 shakes the cup.',
      ]);
      expect(errorOf(F.seatPlayer(playing, F.makeHuman('h3', 'Dee', 3)))).toBe(
        'The game already started.',
      );
    });

    test('playing: holder-only moves, and the exact refusal for every other move', () => {
      const s = started(3);
      const at = (actor: Parameters<FidiceCore['apply']>[1], action: Action, from = s): string =>
        errorOf(F.apply(from, actor, action, fixed()));
      expect(at(seat(0), { type: 'start' })).toBe('Not now.');
      expect(at(seat(1), { type: 'peek' })).toBe("It's not your turn.");
      expect(at(F.HOST, { type: 'peek' })).toBe('Only a seated player can play.');
      expect(at(seat(0), { type: 'call' })).toBe('There is no bid to call.');
      expect(at(seat(1), { type: 'finish' })).toBe('Only the host can end the game.');
      expect(at(seat(0), { type: 'pull', die: 7 })).toBe('No such die.');
      expect(at(seat(0), { type: 'roll', cup: false, table: [], intoCup: [] })).toBe(
        'Pick something to roll.',
      );

      const peeked = unwrap(F.apply(s, seat(0), { type: 'peek' }, fixed()));
      expect(at(seat(0), { type: 'peek' }, peeked)).toBe('You already accepted the cup.');
      const pulled = unwrap(F.apply(peeked, seat(0), { type: 'pull', die: 0 }, fixed()));
      expect(pulled.round?.dice[0]).toEqual({ value: 2, inCup: false });
      expect(at(seat(0), { type: 'pull', die: 0 }, pulled)).toBe('That die is already out.');
      expect(pulled.log.at(-1)?.text).toBe('P0 pulls a 2 out from under the cup.');
      // A pull accepts the cup too: with no bid yet the holder may pull unseen, and may not peek after.
      const pulledUnseen = unwrap(F.apply(s, seat(0), { type: 'pull', die: 0 }, fixed()));
      expect(pulledUnseen.round?.touched).toBe(true);
      expect(at(seat(0), { type: 'peek' }, pulledUnseen)).toBe('You already accepted the cup.');
      const rolled = unwrap(
        F.apply(pulled, seat(0), { type: 'roll', cup: true, table: [], intoCup: [] }, fixed()),
      );
      expect(at(seat(0), { type: 'roll', cup: true, table: [], intoCup: [] }, rolled)).toBe(
        'You already rolled this turn.',
      );
      expect(rolled.log.at(-1)?.text).toBe('P0 shakes the cup (4 dice).');
      expect(at(seat(0), { type: 'roll', cup: false, table: [], intoCup: [] }, pulled)).toBe(
        'Pick something to roll.',
      );
      expect(
        at(
          seat(0),
          { type: 'roll', cup: true, table: [], intoCup: [] },
          {
            ...pulled,
            round: pulled.round && {
              ...pulled.round,
              dice: pulled.round.dice.map((d) => ({ ...d, inCup: false })),
            },
          },
        ),
      ).toBe('Nothing left under the cup.');

      const bidded = unwrap(F.apply(rolled, seat(0), { type: 'bid', rank: 100 }, fixed()));
      expect(bidded.round).toMatchObject({
        holder: 1,
        bid: 100,
        bidder: 0,
        rolled: false,
        touched: false,
        history: [{ seat: 0, rank: 100 }],
      });
      expect(bidded.log.at(-1)?.text).toBe(`P0 bids ${F.spokenName(100)}.`);
      expect(at(seat(0), { type: 'peek' }, bidded)).toBe("It's not your turn.");
      expect(at(seat(1), { type: 'bid', rank: 120 }, bidded)).toBe(
        'Accept the cup before bidding.',
      );
      expect(at(seat(1), { type: 'pull', die: 1 }, bidded)).toBe('Peek first.');
      expect(at(seat(1), { type: 'roll', cup: true, table: [], intoCup: [] }, bidded)).toBe(
        'Peek first.',
      );

      const accepted = unwrap(F.apply(bidded, seat(1), { type: 'peek' }, fixed()));
      expect(at(seat(1), { type: 'bid', rank: 100 }, accepted)).toBe(
        'Your bid must be higher than the current bid.',
      );
      expect(at(seat(1), { type: 'bid', rank: 99 }, accepted)).toBe(
        'Your bid must be higher than the current bid.',
      );
      expect(at(seat(1), { type: 'call' }, accepted)).toBe('You accepted the cup — you must bid.');
      expect(at(seat(1), { type: 'bid', rank: 101 }, accepted)).toBe('ok');

      const called = unwrap(F.apply(bidded, seat(1), { type: 'call' }, fixed()));
      expect(called.reveal).toEqual({
        dice: [2, 2, 2, 2, 2],
        real: 247,
        bid: 100,
        holds: true,
        caller: 1,
        bidder: 0,
        loser: 1,
      });
      expect(F.handAt(247).name).toBe('Five 2s');
      expect(called.players.map((p) => [p.lives, p.losses])).toEqual([
        [3, 0],
        [2, 1],
        [3, 0],
      ]);
      expect(called.records).toEqual([
        {
          roundNo: 1,
          bids: [{ seat: 0, rank: 100 }],
          bidder: 0,
          caller: 1,
          bid: 100,
          real: 247,
          holds: true,
          loser: 1,
        },
      ]);
      expect(called.log.at(-1)?.text).toBe(
        'P1 calls liar! Under the cup: Five 2s. The bid holds — P1 loses a life.',
      );
      expect(at(seat(1), { type: 'peek' }, called)).toBe('Waiting for the next round.');
      expect(at(seat(2), { type: 'next' }, called)).toBe('ok');
      const next = unwrap(F.apply(called, F.HOST, { type: 'next' }, fixed()));
      expect([next.roundNo, next.reveal, next.round?.holder]).toEqual([2, null, 1]);
      expect(next.log.at(-1)?.text).toBe('Round 2: P1 shakes the cup.');

      const over = unwrap(F.apply(called, F.HOST, { type: 'finish' }, fixed()));
      expect([over.phase, over.winner]).toEqual(['over', null]);
      expect(over.log.at(-1)?.text).toBe(
        '🏁 The host ends the game. Rounds lost — P0 0, P2 0, P1 1. A tie at the top!',
      );
      expect(at(F.HOST, { type: 'next' }, over)).toBe('The game is over.');
      expect(at(seat(0), { type: 'peek' }, over)).toBe('The game is over.');
    });

    test('keeping score (lives = 0): rounds lost count, and the host ends the game', () => {
      const s = unwrap(F.apply(table(2, 0), F.HOST, { type: 'start' }, fixed()));
      expect(s.players.map((p) => p.lives)).toEqual([0, 0]);
      expect(s.log.at(-2)?.text).toBe('Game on! 2 players, keeping score.');
      const over = unwrap(F.apply(s, seat(0), { type: 'finish' }, fixed()));
      expect(over.phase).toBe('over');
    });

    /** Seat 0 has peeked and pulled `pulls`, then shaken the cup when `shake`; every die shows 2. */
    const opened = (pulls: ReadonlyArray<number>, shake: boolean): GameState => {
      const peeked = unwrap(F.apply(started(3), seat(0), { type: 'peek' }, fixed()));
      const pulled = pulls.reduce(
        (st, die) => unwrap(F.apply(st, seat(0), { type: 'pull', die }, fixed())),
        peeked,
      );
      return shake
        ? unwrap(
            F.apply(pulled, seat(0), { type: 'roll', cup: true, table: [], intoCup: [] }, fixed()),
          )
        : pulled;
    };

    test('call: a bid equal to the real hand holds; one rung above it is busted', () => {
      const rolled = opened([0], true);
      expect(F.rankOf([2, 2, 2, 2, 2])).toBe(247);
      const exact = unwrap(F.apply(rolled, seat(0), { type: 'bid', rank: 247 }, fixed()));
      const held = unwrap(F.apply(exact, seat(1), { type: 'call' }, fixed()));
      expect(held.reveal).toEqual({
        dice: [2, 2, 2, 2, 2],
        real: 247,
        bid: 247,
        holds: true,
        caller: 1,
        bidder: 0,
        loser: 1,
      });
      expect(held.players.map((p) => [p.lives, p.losses])).toEqual([
        [3, 0],
        [2, 1],
        [3, 0],
      ]);
      expect(held.log.at(-1)?.text).toBe(
        'P1 calls liar! Under the cup: Five 2s. The bid holds — P1 loses a life.',
      );

      const above = unwrap(F.apply(rolled, seat(0), { type: 'bid', rank: 248 }, fixed()));
      const busted = unwrap(F.apply(above, seat(1), { type: 'call' }, fixed()));
      expect(busted.reveal).toEqual({
        dice: [2, 2, 2, 2, 2],
        real: 247,
        bid: 248,
        holds: false,
        caller: 1,
        bidder: 0,
        loser: 0,
      });
      expect(busted.players.map((p) => [p.lives, p.losses])).toEqual([
        [2, 1],
        [3, 0],
        [3, 0],
      ]);
      expect(busted.log.at(-1)?.text).toBe(
        'P1 calls liar! Under the cup: Five 2s. Busted — P0 loses a life.',
      );
      expect(busted.records[0]).toMatchObject({ bid: 248, real: 247, holds: false, loser: 0 });
    });

    test('roll: named table dice are rerolled, tucked dice go back under a shaken cup, the rest stay', () => {
      const twoOut = opened([0, 1], false);
      expect(twoOut.round?.dice.map((d) => d.inCup)).toEqual([false, false, true, true, true]);
      const sixes: Rng = () => 0.99;
      // Tucking die 1 shakes the cup, so dice 2-4 reroll with it; die 0 is rerolled on the table.
      const tucked = unwrap(
        F.apply(twoOut, seat(0), { type: 'roll', cup: false, table: [0], intoCup: [1] }, sixes),
      );
      expect(tucked.round?.dice).toEqual([
        { value: 6, inCup: false },
        { value: 6, inCup: true },
        { value: 6, inCup: true },
        { value: 6, inCup: true },
        { value: 6, inCup: true },
      ]);
      expect(tucked.round).toMatchObject({ rolled: true, touched: true });
      expect(tucked.log.at(-1)?.text).toBe(
        'P0 rolls 1 die on the table → 6, tucks 1 die back under the cup, shakes the cup (4 dice).',
      );
      // Rerolling a table die alone leaves the cup untouched.
      const tableOnly = unwrap(
        F.apply(twoOut, seat(0), { type: 'roll', cup: false, table: [0], intoCup: [] }, sixes),
      );
      expect(tableOnly.round?.dice).toEqual([
        { value: 6, inCup: false },
        { value: 2, inCup: false },
        { value: 2, inCup: true },
        { value: 2, inCup: true },
        { value: 2, inCup: true },
      ]);
      expect(tableOnly.log.at(-1)?.text).toBe('P0 rolls 1 die on the table → 6.');
    });

    test('records keep the most recent 60 rounds', () => {
      const bidded = unwrap(
        F.apply(opened([0], true), seat(0), { type: 'bid', rank: 100 }, fixed()),
      );
      const filler = (roundNo: number): GameState['records'][number] => ({
        roundNo,
        bids: [],
        bidder: 0,
        caller: 1,
        bid: 1,
        real: 2,
        holds: true,
        loser: 1,
      });
      const stuffed = { ...bidded, records: Array.from({ length: 61 }, (_, i) => filler(i + 1)) };
      const called = unwrap(F.apply(stuffed, seat(1), { type: 'call' }, fixed()));
      expect(called.records).toHaveLength(60);
      expect(called.records[0]?.roundNo).toBe(3);
      expect(called.records.at(-1)).toMatchObject({ roundNo: 1, bid: 100, real: 247 });
    });

    test('finish: standings order by rounds lost, then lives, then seat; a tie at the top has no winner', () => {
      const s = started(3);
      const withPlayers = (lives: number[], losses: number[]): GameState => ({
        ...s,
        players: s.players.map((p, i) => ({ ...p, lives: lives[i] ?? 0, losses: losses[i] ?? 0 })),
      });
      const tied = unwrap(
        F.apply(withPlayers([1, 3, 2], [0, 0, 0]), F.HOST, { type: 'finish' }, fixed()),
      );
      expect(tied.winner).toBeNull();
      expect(tied.log.at(-1)?.text).toBe(
        '🏁 The host ends the game. Rounds lost — P1 0, P2 0, P0 0. A tie at the top!',
      );
      const won = unwrap(
        F.apply(withPlayers([1, 3, 2], [2, 2, 1]), F.HOST, { type: 'finish' }, fixed()),
      );
      expect(won.winner).toBe(2);
      expect(won.log.at(-1)?.text).toBe(
        '🏁 The host ends the game. Rounds lost — P2 1, P1 2, P0 2. P2 wins.',
      );
    });
  });

  describe('redactFor', () => {
    test('the holder sees the cup before any bid; others see null values under the cup', () => {
      const s = started(3);
      expect(values(s, { kind: 'seat', seat: 0 })).toEqual([2, 2, 2, 2, 2]);
      expect(values(s, { kind: 'seat', seat: 1 })).toEqual([null, null, null, null, null]);
      expect(values(s, { kind: 'spectator' })).toEqual([2, 2, 2, 2, 2]);
      expect(F.canSeeCup(s, { kind: 'seat', seat: 0 })).toBe(true);
      expect(F.canSeeCup(s, { kind: 'seat', seat: 1 })).toBe(false);
    });

    test('after a bid the new holder sees nothing until they peek; a pulled die is public', () => {
      const s = started(3);
      const pulled = unwrap(
        F.apply(
          unwrap(F.apply(s, seat(0), { type: 'peek' }, fixed())),
          seat(0),
          { type: 'pull', die: 2 },
          fixed(),
        ),
      );
      const bidded = unwrap(F.apply(pulled, seat(0), { type: 'bid', rank: 100 }, fixed()));
      expect(values(bidded, { kind: 'seat', seat: 1 })).toEqual([null, null, 2, null, null]);
      expect(values(bidded, { kind: 'seat', seat: 0 })).toEqual([null, null, 2, null, null]);
      expect(values(bidded, { kind: 'seat', seat: 2 })).toEqual([null, null, 2, null, null]);
      expect(values(bidded, { kind: 'spectator' })).toEqual([2, 2, 2, 2, 2]);
      const peeked = unwrap(F.apply(bidded, seat(1), { type: 'peek' }, fixed()));
      expect(values(peeked, { kind: 'seat', seat: 1 })).toEqual([2, 2, 2, 2, 2]);
      expect(values(peeked, { kind: 'seat', seat: 0 })).toEqual([null, null, 2, null, null]);
      const called = unwrap(F.apply(bidded, seat(1), { type: 'call' }, fixed()));
      expect(values(called, { kind: 'seat', seat: 2 })).toEqual([2, 2, 2, 2, 2]);
    });

    test('redaction touches only the dice values; every other field is the state itself', () => {
      const s = started(3);
      const { round: redactedRound, ...redactedRest } = F.redactFor(s, { kind: 'seat', seat: 1 });
      const { round, ...rest } = s;
      expect(redactedRest).toEqual(rest);
      expect(redactedRound && { ...redactedRound, dice: [] }).toEqual(
        round && { ...round, dice: [] },
      );
      expect(redactedRound?.dice.map((d) => d.inCup)).toEqual(round?.dice.map((d) => d.inCup));
    });
  });

  describe('bots', () => {
    const STRATEGY_IDS = [
      'gambler',
      'profiler',
      'pressure',
      'trapper',
      'classic-cautious',
      'classic-steady',
      'classic-reckless',
      'learner-10',
      'learner-100',
      'learner-300',
    ];

    const botTable = (seed: number): GameState => {
      const n = 3 + (seed % 4);
      return Array.from({ length: n }, (_, i) => i).reduce(
        (s, i) =>
          unwrap(
            F.seatPlayer(
              s,
              F.makeBot(s, `bot${String(i)}`, {
                strategy: STRATEGY_IDS[(seed + i) % STRATEGY_IDS.length] ?? 'gambler',
                random: false,
              }),
            ),
          ),
        F.newGame('ABCDE', 3),
      );
    };

    type BotGame = {
      state: GameState;
      steps: number;
      rejected: string[];
      decisionPoints: GameState[];
    };
    /** Drives the game the way HostSession.schedule() does, minus the timers. */
    const playBots = (seed: number): BotGame => {
      const rng = mulberry32(seed);
      const decisionPoints: GameState[] = [];
      const rejected: string[] = [];
      let state = unwrap(F.apply(botTable(seed), F.HOST, { type: 'start' }, rng));
      let memories = F.emptyMemories;
      let steps = 0;
      // `some` stops at the first true: game over, a rejected bot action (HostSession would hang
      // there too) or the cap.
      const advance = (): boolean => {
        if (state.phase === 'over') return true;
        steps += 1;
        if (state.reveal) {
          state = unwrap(F.apply(state, F.HOST, { type: 'next' }, rng));
          return false;
        }
        const holder = state.round?.holder;
        const decision = F.decide(state, memories, rng);
        if (holder === undefined || decision === null)
          throw new Error(`no bot move in ${state.phase}`);
        decisionPoints.push(state);
        memories = decision.memories;
        const r = F.apply(state, seat(holder), decision.step.action, rng);
        if (r.ok) state = r.value;
        else rejected.push(`${JSON.stringify(decision.step.action)}: ${r.error}`);
        return !r.ok;
      };
      Array.from({ length: STEP_CAP }).some(advance);
      return { state, steps, rejected, decisionPoints };
    };

    test('the pool', () => {
      expect(F.POOL.map((s) => s.id)).toEqual(STRATEGY_IDS);
      expect(F.SHIPPED.map((s) => s.id)).toEqual(['gambler', 'profiler', 'pressure']);
      expect(F.RANDOM_STRATEGY).toBe('random');
      expect(F.strategyFor({ strategy: 'nope', random: false }).id).toBe('gambler');
      expect(F.profileFor('random', () => 0.5)).toEqual({ strategy: 'profiler', random: true });
      expect(F.profileFor('trapper', fixed())).toEqual({ strategy: 'trapper', random: false });
      expect(F.profileFor('nope', fixed())).toEqual({ strategy: 'gambler', random: false });
    });

    /**
     * Pinned digests of every state along each seeded bot game (decision points, then the final
     * state). They freeze `apply` and the strategies together; a change to either is a diff here.
     */
    const BOT_GAME_DIGESTS: Readonly<Record<number, string>> = {
      1: '3670a940c8d086cf',
      2: 'ccf33a215de00c76',
      3: '2e7e08864f6dfb37',
      4: 'f95d1368e1442bed',
      5: '47a4ee41c9543341',
      6: '57ad2d2803b31b86',
      7: '18221833744663c5',
      8: '93450c3ddd05e172',
      9: '752e133b78f768a8',
      10: 'ba84f19e18e68ae6',
      11: 'eafed36192751a0c',
      12: 'f5df3d427a88b782',
    };

    test.each(SEEDS)(
      'seed %i: a 3-6 bot table plays to "over" with no rejected bot action',
      (seed) => {
        const { state, rejected, steps, decisionPoints } = playBots(seed);
        expect(digest([...decisionPoints, state])).toBe(BOT_GAME_DIGESTS[seed]);
        expect(rejected).toEqual([]);
        expect(state.phase).toBe('over');
        expect(steps).toBeLessThan(STEP_CAP);
        const [sole, ...others] = state.players.filter((p) => p.lives > 0);
        expect(others).toEqual([]);
        if (sole === undefined) throw new Error('no player left alive');
        expect(state.winner).toBe(state.players.indexOf(sole));
        expect(state.log.at(-1)?.text).toBe(`🏆 ${sole.name} wins — last kayak on the lake!`);
        expect(state.records).toHaveLength(state.roundNo);
        state.records.forEach((r) => {
          expect(r.loser).toBe(r.holds ? r.caller : r.bidder);
        });
        expect(state.log.length).toBeLessThanOrEqual(80);
        expect(state.reveal).not.toBeNull();
      },
    );

    test('the same seed replays the same game', () => {
      const a = playBots(3);
      const b = playBots(3);
      expect(a.state).toEqual(b.state);
      expect(a.steps).toBe(b.steps);
      expect(a.decisionPoints.length).toBe(b.decisionPoints.length);
    });

    /**
     * Pinned digests of each strategy's `[action, round(delay), memory]` over the 30 seeded views
     * below, from a fresh memory each time. Thresholds and styles are frozen here.
     */
    const DECIDE_DIGESTS: Readonly<Record<string, string>> = {
      gambler: 'ad7c9e61c65fa159',
      profiler: 'b3b7bfb48586f837',
      pressure: '2eba6bcdb45a0206',
      trapper: '5ac868ba963bba1c',
      'classic-cautious': '0cd3aae7bb819490',
      'classic-steady': '8521817fcbb82d3b',
      'classic-reckless': '3d1189fa5478924a',
      'learner-10': 'b7156c2f05526602',
      'learner-100': '6826ab1c4c35184f',
      'learner-300': '51ab2f4c276ed549',
    };

    describe.each(F.POOL.map((s) => [s.id, s] as const))('strategy %s', (id, strategy) => {
      const points = playBots(5).decisionPoints.slice(0, 30);
      const viewAt = (s: GameState): Parameters<typeof strategy.decide>[0] => {
        const holder = s.round?.holder ?? 0;
        return { state: F.redactFor(s, { kind: 'seat', seat: holder }), me: holder };
      };

      test('decide() is a pure function of (view, memory, rng) and proposes well-formed actions', () => {
        expect(points.length).toBe(30);
        points.forEach((s, k) => {
          const view = viewAt(s);
          const once = strategy.decide(view, strategy.fresh(), mulberry32(k));
          const twice = strategy.decide(view, strategy.fresh(), mulberry32(k));
          expect(once).toEqual(twice);
          expect(F.decodeAction(once.step.action)).toEqual({ ok: true, value: once.step.action });
          expect(Number.isFinite(once.step.delay) && once.step.delay >= 0).toBe(true);
        });
      });

      test('decide() over the 30 seeded views matches its pinned digest', () => {
        const decisions = points.map((s, k) => {
          const { step, memory } = strategy.decide(viewAt(s), strategy.fresh(), mulberry32(k));
          return [step.action, Math.round(step.delay), memory];
        });
        expect(digest(decisions)).toBe(DECIDE_DIGESTS[id]);
      });

      test('a fresh memory is the same every time', () => {
        expect(strategy.fresh()).toEqual(strategy.fresh());
        expect(typeof strategy.name).toBe('string');
        expect(typeof strategy.blurb).toBe('string');
      });
    });
  });

  describe('protocol codecs', () => {
    test.each<[unknown, string]>([
      [null, 'Message must be an object.'],
      ['hello', 'Message must be an object.'],
      [{ t: 'hello' }, 'hello needs a role.'],
      [{ t: 'hello', role: 'host' }, 'hello needs a role.'],
      [{ t: 'nope' }, 'Unknown client message: nope'],
      [{}, 'Unknown client message: undefined'],
      [{ t: 'act' }, 'Action must have a type.'],
      [{ t: 'act', action: 'bid' }, 'Action must have a type.'],
      [{ t: 'act', action: { type: 7 } }, 'Action must have a type.'],
      [{ t: 'act', action: { type: 'dance' } }, 'Unknown action type: dance'],
      [{ t: 'act', action: { type: 'pull' } }, 'pull needs a die index 0–4.'],
      [{ t: 'act', action: { type: 'pull', die: 5 } }, 'pull needs a die index 0–4.'],
      [{ t: 'act', action: { type: 'pull', die: -1 } }, 'pull needs a die index 0–4.'],
      [{ t: 'act', action: { type: 'pull', die: 1.5 } }, 'pull needs a die index 0–4.'],
      [
        { t: 'act', action: { type: 'roll', cup: 'yes', table: [] } },
        'roll needs cup:boolean, table:number[] and optionally intoCup:number[].',
      ],
      [
        { t: 'act', action: { type: 'roll', cup: true, table: [5] } },
        'roll needs cup:boolean, table:number[] and optionally intoCup:number[].',
      ],
      [
        { t: 'act', action: { type: 'roll', cup: true, table: [], intoCup: [0, 'x'] } },
        'roll needs cup:boolean, table:number[] and optionally intoCup:number[].',
      ],
      [{ t: 'act', action: { type: 'bid' } }, 'bid needs a rank 0–251.'],
      [{ t: 'act', action: { type: 'bid', rank: 252 } }, 'bid needs a rank 0–251.'],
      [{ t: 'act', action: { type: 'bid', rank: -1 } }, 'bid needs a rank 0–251.'],
      [{ t: 'act', action: { type: 'bid', rank: '3' } }, 'bid needs a rank 0–251.'],
    ])('decodeClientMessage(%j) is refused: %s', (frame, message) => {
      expect(F.decodeClientMessage(frame)).toEqual({ ok: false, error: message });
    });

    test('accepted client frames are rebuilt field by field: names and tokens are cut, extras and prototype keys dropped', () => {
      expect(F.decodeClientMessage({ t: 'hello', role: 'spectator' })).toEqual({
        ok: true,
        value: { t: 'hello', role: 'spectator', name: null, token: null },
      });
      expect(
        F.decodeClientMessage({
          t: 'hello',
          role: 'player',
          name: 'x'.repeat(20),
          token: 't'.repeat(70),
          extra: 1,
        }),
      ).toEqual({
        ok: true,
        value: { t: 'hello', role: 'player', name: 'x'.repeat(16), token: 't'.repeat(64) },
      });
      expect(
        F.decodeClientMessage({ t: 'act', action: { type: 'roll', cup: false, table: [0, 4] } }),
      ).toEqual({
        ok: true,
        value: { t: 'act', action: { type: 'roll', cup: false, table: [0, 4], intoCup: [] } },
      });
      expect(F.decodeClientMessage({ t: 'act', action: { type: 'peek', die: 3 } })).toEqual({
        ok: true,
        value: { t: 'act', action: { type: 'peek' } },
      });
      const hostile: unknown = JSON.parse(
        '{"t":"act","action":{"type":"bid","rank":5,"__proto__":{"polluted":true},"extra":1}}',
      );
      const decoded = F.decodeClientMessage(hostile);
      expect(decoded).toEqual({ ok: true, value: { t: 'act', action: { type: 'bid', rank: 5 } } });
      expect(
        decoded.ok && Object.keys(decoded.value.t === 'act' ? decoded.value.action : {}),
      ).toEqual(['type', 'rank']);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    test.each<[unknown, string]>([
      [42, 'Message must be an object.'],
      [{ t: 'state' }, 'Unknown server message: state'],
      [{ t: 'state', state: {}, you: { role: 'nope' } }, 'Unknown server message: state'],
      [{ t: 'error' }, 'Unknown server message: error'],
      [{ t: 'info', message: 7 }, 'Unknown server message: info'],
      [{ t: 'hello' }, 'Unknown server message: hello'],
    ])('decodeServerMessage(%j) is refused: %s', (frame, message) => {
      expect(F.decodeServerMessage(frame)).toEqual({ ok: false, error: message });
    });

    test('accepted server frames', () => {
      expect(
        F.decodeServerMessage({
          t: 'state',
          state: {},
          you: { role: 'player', seat: 2, token: 'abc' },
        }),
      ).toEqual({
        ok: true,
        value: { t: 'state', state: {}, you: { seat: 2, token: 'abc', role: 'player' } },
      });
      expect(F.decodeServerMessage({ t: 'state', state: {}, you: { role: 'spectator' } })).toEqual({
        ok: true,
        value: { t: 'state', state: {}, you: { seat: null, token: null, role: 'spectator' } },
      });
      expect(F.decodeServerMessage({ t: 'info', message: 'hi' })).toEqual({
        ok: true,
        value: { t: 'info', message: 'hi' },
      });
      expect(F.decodeServerMessage({ t: 'error', message: 'no' })).toEqual({
        ok: true,
        value: { t: 'error', message: 'no' },
      });
    });
  });

  describe('search', () => {
    test('tokenize folds number words and drops stop words', () => {
      expect(F.tokenize('Sixes full of fives, with a kicker')).toEqual(['6', 'full', '5']);
      expect(F.tokenize('Straight 2-6')).toEqual(['straight', '2-6']);
    });

    test('suggestHands', () => {
      expect(F.suggestHands('five 6s', null)[0]).toMatchObject({
        group: true,
        label: 'Five 6s',
        rank: 251,
      });
      expect(F.suggestHands('#252', null)[0]).toMatchObject({
        group: false,
        label: 'Five 6s',
        rank: 251,
        score: 100,
      });
      expect(F.suggestHands('sixes full of fives', null)[0]).toMatchObject({
        group: false,
        label: '6s full of 5s',
        rank: 215,
      });
      expect(F.suggestHands('', null)).toHaveLength(40);
      expect(F.suggestHands('', 250).map((s) => s.label)).toEqual(['Five 6s']);
      expect(F.suggestHands('five 6s', 251)).toEqual([]);
    });
  });
});
