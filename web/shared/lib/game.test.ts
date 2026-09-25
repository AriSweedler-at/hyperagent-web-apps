// The two-seat primitives (DRY round 2, F1): the helpers gin's game.ts and backgammon's board.ts
// declared, the three decoders both decode.ts files opened with (their error texts are the ones the
// engines' own tests assert), and `TwoSeatEngine` over a two-line coin game, so the contract is
// exercised by a fixture that knows no rules of either real game.
import { describe, expect, expectTypeOf, test } from 'vitest';

import {
  SEATS,
  count,
  otherSeat,
  seat,
  setAt,
  timestamp,
  type Pair,
  type Seat,
  type TwoSeatEngine,
} from './game.ts';
import {
  boolean,
  formatError,
  literal,
  nullable,
  number,
  object,
  pair,
  string,
  type DecodeError,
  type Decoder,
} from './json.ts';
import { err, ok, type Result } from './result.ts';

const failureOf = (r: Result<unknown, DecodeError>): string => (r.ok ? 'ok' : formatError(r.error));

describe('the seat helpers', () => {
  test('SEATS lists both seats in order; otherSeat flips; setAt replaces one side only', () => {
    expect(SEATS).toEqual([0, 1]);
    expect(otherSeat(0)).toBe(1);
    expect(otherSeat(1)).toBe(0);
    const pair: Pair<string> = ['a', 'b'];
    expect(setAt(pair, 0, 'x')).toEqual(['x', 'b']);
    expect(setAt(pair, 1, 'y')).toEqual(['a', 'y']);
    expect(pair).toEqual(['a', 'b']);
  });
});

describe('the decoders both engines open with', () => {
  test('seat is 0 or 1', () => {
    expect(seat(0)).toEqual(ok(0));
    expect(seat(1)).toEqual(ok(1));
    expect(failureOf(seat(2))).toBe('$: expected one of 0 | 1');
    expect(failureOf(seat('0'))).toBe('$: expected one of 0 | 1');
  });

  test('count and timestamp are non-negative integers', () => {
    expect(count(0)).toEqual(ok(0));
    expect(count(7)).toEqual(ok(7));
    expect(failureOf(count(-1))).toBe('$: expected integer in [0, 9007199254740991]');
    expect(failureOf(count(1.5))).toBe('$: expected integer in [0, 9007199254740991]');
    expect(timestamp(1_700_000_000_000)).toEqual(ok(1_700_000_000_000));
    expect(failureOf(timestamp(-1))).toBe('$: expected integer in [0, 9007199254740991]');
  });
});

describe('TwoSeatEngine', () => {
  // A coin game: each seat flips once, in seat order; the higher flip wins. `create` seats the
  // players, `apply` reads the rng once per flip, `viewFor` hides the other seat's flip until both
  // have flipped, `over` is the second flip.
  type State = Readonly<{
    players: Pair<{ id: string; name: string }>;
    flips: Pair<number | null>;
  }>;
  type View = Readonly<{ me: Seat; mine: number | null; theirs: number | null; done: boolean }>;
  type Action = Readonly<{ type: 'flip' }>;
  const player = object({ id: string, name: string });
  const decodeState: Decoder<State> = object({
    players: pair(player),
    flips: pair(nullable(number)),
  });
  const decodeView: Decoder<View> = object({
    me: seat,
    mine: nullable(number),
    theirs: nullable(number),
    done: boolean,
  });
  const COIN: TwoSeatEngine<State, View, Action, Readonly<Record<string, never>>> = {
    create: (players) => ({ players, flips: [null, null] }),
    apply: (state, s, _action, rng) => {
      const actor = state.flips[0] === null ? 0 : state.flips[1] === null ? 1 : null;
      return actor === s ? ok({ ...state, flips: setAt(state.flips, s, rng()) }) : err('Not you.');
    },
    viewFor: (state, s) => {
      const done = state.flips[0] !== null && state.flips[1] !== null;
      return { me: s, mine: state.flips[s], theirs: done ? state.flips[otherSeat(s)] : null, done };
    },
    legalActions: (view) => (view.done || view.mine !== null ? [] : [{ type: 'flip' }]),
    actorOf: (state) => (state.flips[0] === null ? 0 : state.flips[1] === null ? 1 : null),
    over: (view) => view.done,
    decodeState,
    decodeView,
    decodeAction: object({ type: literal('flip') }),
  };

  test('the contract drives a game from create to over through the injected rng and clock', () => {
    const players: Pair<{ id: string; name: string }> = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const rolls = [0.25, 0.75];
    const rng = (): number => rolls.shift() ?? 0;
    const now = (): number => 0;
    const g0 = COIN.create(players, {}, rng, now);
    expect(COIN.actorOf(g0)).toBe(0);
    expect(COIN.legalActions(COIN.viewFor(g0, 0))).toEqual([{ type: 'flip' }]);
    expect(COIN.legalActions(COIN.viewFor(g0, 1))).toEqual([{ type: 'flip' }]);
    expect(COIN.apply(g0, 1, { type: 'flip' }, rng, now)).toEqual(err('Not you.'));
    const g1 = COIN.apply(g0, 0, { type: 'flip' }, rng, now);
    expect(g1.ok && COIN.viewFor(g1.value, 1)).toEqual({
      me: 1,
      mine: null,
      theirs: null,
      done: false,
    });
    const g2 = g1.ok ? COIN.apply(g1.value, 1, { type: 'flip' }, rng, now) : g1;
    expect(g2.ok && COIN.viewFor(g2.value, 0)).toEqual({
      me: 0,
      mine: 0.25,
      theirs: 0.75,
      done: true,
    });
    expect(g2.ok && COIN.over(COIN.viewFor(g2.value, 0))).toBe(true);
    expect(g2.ok && COIN.actorOf(g2.value)).toBeNull();
    expect(COIN.decodeAction({ type: 'flip', extra: 1 })).toEqual(ok({ type: 'flip' }));
    expect(COIN.decodeState(JSON.parse(JSON.stringify(g0)))).toEqual(ok(g0));
    expect(g2.ok && COIN.decodeView(COIN.viewFor(g2.value, 1))).toEqual(
      ok({ me: 1, mine: 0.75, theirs: 0.25, done: true }),
    );
    expectTypeOf(COIN.apply).returns.toEqualTypeOf<Result<State, string>>();
  });
});
