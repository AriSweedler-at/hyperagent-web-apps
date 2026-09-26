// Seeded random play to the end of the match (docs/design/briscola-rules.md §2.4): a policy over
// `legalActions` (a uniformly random legal card, the exchange at half the offers, `next` at over)
// drives `applyAction` for every seat count and every flag worth a suite, and after every step
// the invariants hold: the deck conserved across hands, stock, trick and piles with its 120
// points; whole draws and whole tricks; the trick led by the leader with the turn after its last
// card, the winner drawing first and leading; the running score read off the piles and never
// falling; the trump suit fixed and the trump card under the stock; the wrong seat, a card not
// held and an exchange not allowed refused; every view agreeing on the public fields and carrying
// no foreign hand outside scoperta and the partner peek; the event stream growing by exactly one
// per resolved trick, exchange, deal and result (numbered by index, the trick event agreeing with
// `lastTrick` and `trickFacts`);
// the rng read by the deal alone; byte-stable re-encoding; and every game ending after exactly
// deckSize / n tricks. Each suite also asserts outcome coverage. Loops and mutation are fine in a
// test; the driver has to live here because a helper module under engine/ would fall under the
// pure zone's rules and the coverage thresholds.
import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../shared/lib/rng.ts';
import * as B from './index.ts';
import type { Action, CreateGameOptions, Players, Seat, SeatCount, State, View } from './index.ts';

const P = {
  a: { id: 'a', name: 'Ari' },
  b: { id: 'b', name: 'Jeff' },
  c: { id: 'c', name: 'Kim' },
  d: { id: 'd', name: 'Dan' },
} as const;
const players = (n: SeatCount): Players =>
  n === 2 ? [P.a, P.b] : n === 3 ? [P.a, P.b, P.c] : [P.a, P.b, P.c, P.d];
const now = (): number => 0;
/** A match to 2 at two players runs about 120 steps; the cap only turns a hang into a failure. */
const STEP_CAP = 5_000;

type Counted = { n: number; rng: () => number };
const counting = (inner: () => number): Counted => {
  const c: Counted = {
    n: 0,
    rng: () => {
      c.n += 1;
      return inner();
    },
  };
  return c;
};

/** The exchange at 50% when offered, `next` at over, otherwise a uniformly random legal card. */
const choose = (view: View, pick: () => number): Action => {
  const actions = B.legalActions(view);
  const exchange = actions.find((a) => a.type === 'exchange');
  if (exchange !== undefined && pick() < 0.5) return exchange;
  const plays = actions.filter((a) => a.type !== 'exchange');
  const a = plays[Math.floor(pick() * plays.length)];
  if (a === undefined) throw new Error('no legal action');
  return a;
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const sortedIds = (cards: B.Cards): string => [...B.idsOf(cards)].sort().join(' ');
const stable = (
  value: unknown,
  decode: (u: unknown) => { ok: boolean; value?: unknown },
): boolean => {
  const text = JSON.stringify(value);
  const r = decode(JSON.parse(text) as unknown);
  return r.ok && JSON.stringify(r.value) === text;
};
/** A cheap assertion for the per-step invariants: `expect` per check would dominate the run. */
const ensure = (ok: boolean, label: string, what: string): void => {
  if (!ok) throw new Error(`${label}: ${what}`);
};
const allCards = (s: State): B.Cards => [
  ...s.hands.flat(),
  ...s.stock,
  ...s.trick.map((p) => p.card),
  ...s.piles.flat(),
];

type Step = Readonly<{
  before: State;
  after: State;
  view: View;
  actor: Seat;
  action: Action;
  rngCalls: number;
  step: number;
  cov: Set<string>;
}>;

const checkStep = ({
  before,
  after,
  view,
  actor,
  action,
  rngCalls,
  step,
  cov,
}: Step): ReadonlyArray<View> => {
  const n = after.options.seatCount;
  const deck = B.deckFor(after.options);
  const label = `step ${String(step)} ${action.type}`;
  const sameGame = after.gameNo === before.gameNo;
  // 0. The policy sent an action the actor's view offered.
  ensure(
    B.legalActions(view).some((a) => same(a, action)),
    label,
    'the action was not offered',
  );
  // 1. Conservation: the deck exactly once, 120 points.
  const all = allCards(after);
  ensure(sortedIds(all) === sortedIds(deck), label, 'the cards are not the deck');
  ensure(B.pointsOf(all) === 120, label, '120 points');
  // 2. Sizes.
  ensure(after.stock.length % n === 0, label, 'a stock of whole draws');
  ensure(after.trick.length < n, label, 'a trick as long as the table');
  ensure(
    after.piles.every((p) => p.length % n === 0),
    label,
    'a pile with a part of a trick',
  );
  if (after.trick.length === 0 && after.phase === 'trick') {
    if (after.stock.length > 0)
      ensure(
        after.hands.every((h) => h.length === 3),
        label,
        'hands of 3 while the stock lasts',
      );
    else
      ensure(
        new Set(after.hands.map((h) => h.length)).size === 1,
        label,
        'unequal hands after the stock',
      );
  }
  // 3. Order.
  const [first] = after.trick;
  const last = after.trick.at(-1);
  if (first !== undefined && last !== undefined) {
    ensure(first.seat === after.leader, label, 'the trick is not led by the leader');
    ensure(after.turn === B.nextSeat(n, last.seat), label, 'the turn is not after the last card');
  } else ensure(after.turn === after.leader, label, 'an empty trick with turn != leader');
  if (action.type === 'play' && after.trick.length === 0 && sameGame) {
    const t = after.lastTrick;
    ensure(t !== null, label, 'a resolved trick with no lastTrick');
    if (t !== null) {
      ensure(
        after.leader === t.winner && after.turn === t.winner,
        label,
        'the winner does not lead',
      );
      ensure(t.winner === B.trickWinner(after.trumpCard.s, t.cards), label, 'lastTrick.winner');
      ensure(
        t.cards.length === n && t.no === after.trickNo && t.no === before.trickNo + 1,
        label,
        'lastTrick shape',
      );
      ensure(t.points === B.pointsOf(t.cards.map((p) => p.card)), label, 'lastTrick.points');
      const drawing = before.stock.length > 0;
      ensure(same(t.drew, drawing ? B.seatsFrom(n, t.winner) : []), label, 'drew');
      ensure(t.trumpTaken === (before.stock.length === n), label, 'trumpTaken');
      if (t.trumpTaken) {
        const taker = t.drew.at(-1);
        ensure(
          taker !== undefined &&
            (after.hands[taker] ?? []).some((c) => c.id === before.trumpCard.id),
          label,
          'the last drawer holds the trump card',
        );
        cov.add(`trumpTaken:${String(taker)}`);
      }
      if (t.points === 0) cov.add('zeroTrick');
      const led = t.cards[0]?.card.s;
      const winning = t.cards.find((p) => p.seat === t.winner)?.card;
      if (winning?.s === after.trumpCard.s && led !== after.trumpCard.s) cov.add('offSuitTrump');
    }
  }
  // 4. Score.
  const v0 = B.viewFor(after, 0);
  ensure(same(v0.taken, after.piles.map(B.pointsOf)), label, 'taken');
  ensure(
    same(
      v0.tricks,
      after.piles.map((p) => p.length / n),
    ),
    label,
    'tricks',
  );
  ensure(
    v0.taken.reduce((a, b) => a + b, 0) +
      B.pointsOf([...after.hands.flat(), ...after.stock, ...after.trick.map((p) => p.card)]) ===
      120,
    label,
    'score + play = 120',
  );
  if (sameGame) {
    const was = B.viewFor(before, 0).taken;
    ensure(
      v0.taken.every((t, s) => t >= (was[s] ?? 0)),
      label,
      'taken decreased',
    );
  }
  ensure(
    v0.sides.length === B.sidesOf(n) && same(v0.sides, B.sideTotals(n, after.piles)),
    label,
    'sides',
  );
  // 5. Trump.
  if (sameGame) ensure(after.trumpCard.s === before.trumpCard.s, label, 'the trump suit changed');
  ensure(
    after.stock.length === 0 || after.stock.at(-1)?.id === after.trumpCard.id,
    label,
    'the trump card is not under the stock',
  );
  ensure(after.exchanges.length <= 2, label, 'more than two exchanges');
  if (action.type === 'exchange') {
    const x = after.exchanges.at(-1);
    ensure(
      x?.seat === actor && x.took.id === before.trumpCard.id && after.trumpCard.id === x.gave.id,
      label,
      'the exchange record',
    );
    ensure(
      after.hands.every((h, s) => h.length === before.hands[s]?.length),
      label,
      'an exchange changed a hand size',
    );
    ensure(
      after.stock.length === before.stock.length && after.turn === before.turn,
      label,
      'an exchange moved the stock or the turn',
    );
    cov.add('exchange');
    if (after.exchanges.length === 2) cov.add('chain');
  }
  // 6. Refusals.
  if (before.phase === 'trick') {
    B.seatsOf(n)
      .filter((s) => s !== actor)
      .forEach((s) => {
        const wrong = B.applyAction(before, s, action, () => 0, now);
        ensure(
          !wrong.ok && wrong.error === B.MESSAGES.NOT_YOUR_TURN,
          label,
          'the wrong seat was not refused',
        );
      });
    if (step % 3 === 0) {
      const foreign = before.hands.find((_, s) => s !== actor)?.[0];
      if (foreign !== undefined) {
        const r = B.applyAction(before, actor, { type: 'play', cardId: foreign.id }, () => 0, now);
        ensure(!r.ok && r.error === B.MESSAGES.NOT_IN_HAND, label, 'a foreign card was accepted');
      }
    }
    if (!B.canExchange(before, actor)) {
      const r = B.applyAction(before, actor, { type: 'exchange' }, () => 0, now);
      const texts: ReadonlyArray<string> = [
        B.MESSAGES.NO_EXCHANGE,
        B.MESSAGES.TRUMP_GONE,
        B.MESSAGES.NO_TRICK_YET,
        B.MESSAGES.NO_SWAP_CARD,
      ];
      ensure(
        !r.ok && texts.includes(r.error),
        label,
        'a disallowed exchange was not refused with one of the four',
      );
    }
  }
  // 7. Views.
  const views = B.seatsOf(n).map((s) => B.viewFor(after, s));
  const nextActor = B.actorOf(after);
  views.forEach((v, s) => {
    ensure(v.me.idx === s && same(v.me.hand, after.hands[s]), label, 'me');
    ensure(
      same(
        v.others.map((o) => o.idx),
        B.seatsFrom(n, s as Seat).slice(1),
      ),
      label,
      'others order',
    );
    ensure(
      same(
        [
          v.trick,
          v.trumpCard,
          v.stockCount,
          v.taken,
          v.sides,
          v.lastTrick,
          v.match,
          v.events,
          v.exchanges,
          v.result,
        ],
        [
          v0.trick,
          v0.trumpCard,
          v0.stockCount,
          v0.taken,
          v0.sides,
          v0.lastTrick,
          v0.match,
          v0.events,
          v0.exchanges,
          v0.result,
        ],
      ),
      label,
      'the views disagree',
    );
    ensure(
      v.legal.length > 0 === (nextActor === s && after.phase === 'trick'),
      label,
      'legal for the wrong seat',
    );
    ensure(
      v.stockCount === after.stock.length && v.trumpOnTable === after.stock.length > 0,
      label,
      'stockCount',
    );
    ensure(
      v.stockTop === null ||
        (after.options.scoperta && after.stock.length > 1 && v.stockTop.id === after.stock[0]?.id),
      label,
      'stockTop',
    );
    v.others.forEach((o) => {
      ensure(o.handCount === (after.hands[o.idx] ?? []).length, label, 'handCount');
      const may =
        after.options.scoperta ||
        (after.options.partnerPeek &&
          after.stock.length === 0 &&
          B.sideOf(n, o.idx) === B.sideOf(n, s as Seat));
      ensure(
        'hand' in o === may,
        label,
        `a hand shown or hidden wrongly for seat ${String(o.idx)}`,
      );
      if ('hand' in o) {
        ensure(same(o.hand, after.hands[o.idx]), label, 'a revealed hand differs');
        if (after.options.partnerPeek) cov.add('peek');
      }
    });
  });
  // 8. The event stream: one event per resolved trick, exchange, deal and result, numbered by index.
  const grew = after.events.length - before.events.length;
  const kinds = after.events.slice(before.events.length).map((e) => e.kind);
  ensure(
    after.events.every((e, i) => e.id === i) && after.events.length >= before.events.length,
    label,
    'events numbered by index',
  );
  ensure(
    same(after.events.slice(0, before.events.length), before.events),
    label,
    'an earlier event changed',
  );
  switch (action.type) {
    case 'play':
      if (after.trick.length > 0) ensure(grew === 0, label, 'a play mid-trick made an event');
      else if (after.phase === 'over')
        ensure(same(kinds, ['trick', 'result']), label, 'the last trick: trick then result');
      else ensure(same(kinds, ['trick']), label, 'a resolved trick makes one event');
      break;
    case 'exchange':
      ensure(same(kinds, ['exchange']), label, 'an exchange makes one event');
      break;
    case 'next':
      ensure(same(kinds, ['game', 'deal']), label, 'a new game opens with game then deal');
      break;
  }
  const trickEvent = after.events.findLast((e) => e.kind === 'trick');
  const t = after.lastTrick;
  if (action.type === 'play' && after.trick.length === 0 && t !== null) {
    ensure(trickEvent !== undefined, label, 'a resolved trick with no trick event');
    if (trickEvent?.kind === 'trick') {
      const d = trickEvent.data;
      const trump = after.trumpCard.s;
      const facts = B.trickFacts(trump, t.cards);
      ensure(
        trickEvent.seat === t.winner &&
          d.no === t.no &&
          d.leader === t.leader &&
          d.winner === t.winner &&
          d.winnerSide === B.sideOf(n, t.winner) &&
          d.points === t.points &&
          same(d.cards, t.cards) &&
          same(d.drew, t.drew) &&
          d.trumpTaken === (t.trumpTaken ? (t.drew.at(-1) ?? null) : null),
        label,
        'the trick event disagrees with lastTrick',
      );
      ensure(
        same(
          [d.winningCard, d.winningClass, d.briscola, d.steal, d.overtrump, d.valueClass],
          [
            facts.winningCard,
            facts.winningClass,
            facts.briscola,
            facts.steal,
            facts.overtrump,
            facts.valueClass,
          ],
        ),
        label,
        'the trick event disagrees with trickFacts',
      );
      ensure(
        d.winningCard.id === t.cards.find((p) => p.seat === t.winner)?.card.id &&
          d.briscola === (d.winningCard.s === trump) &&
          (!d.steal || d.briscola) &&
          (!d.overtrump || d.briscola) &&
          d.valueClass === B.valueClassOf(d.points) &&
          d.carichiLost.every(
            (seat) =>
              B.sideOf(n, seat) !== d.winnerSide &&
              t.cards.some((p) => p.seat === seat && B.isCarico(p.card)),
          ),
        label,
        'the trick facts are not the facts',
      );
      if (d.steal) cov.add('steal');
      if (d.overtrump) cov.add('overtrump');
      if (d.carichiLost.length > 0) cov.add('carico');
      cov.add(`value:${d.valueClass}`);
    }
  }
  if (after.phase === 'over' && before.phase !== 'over') {
    const r = after.events.at(-1);
    ensure(
      r?.kind === 'result' &&
        r.seat === null &&
        same({ winner: r.data.winner, totals: r.data.totals, draw: r.data.draw }, after.result) &&
        r.data.decided === B.matchOver(after.match) &&
        same(r.data.wins, after.match.wins),
      label,
      'the result event',
    );
  }
  if (action.type === 'next') {
    const [g, dl] = after.events.slice(-2);
    ensure(
      g?.kind === 'game' &&
        g.seat === null &&
        g.data.gameNo === after.gameNo &&
        g.data.dealer === after.dealer &&
        dl?.kind === 'deal' &&
        dl.seat === after.dealer &&
        dl.data.dealer === after.dealer &&
        dl.data.trumpCard.id === after.trumpCard.id,
      label,
      'the opening events',
    );
  }
  // 9. Rng: the deal alone reads it.
  ensure(rngCalls === (action.type === 'next' ? deck.length - 1 : 0), label, 'rng reads');
  // 10. Byte stability every 25th step (decode.test.ts round-trips whole matches).
  if (step % 25 === 0)
    ensure(
      stable(after, B.decodeState) && views.every((v) => stable(v, B.decodeView)),
      label,
      'not byte-stable',
    );
  // 11. A finished game.
  if (after.phase === 'over' && before.phase !== 'over') {
    const r = after.result;
    ensure(
      r !== null && after.trickNo === deck.length / n,
      label,
      'the game ended at the wrong trick',
    );
    ensure(
      after.hands.every((h) => h.length === 0) && after.stock.length === 0,
      label,
      'cards left at over',
    );
    if (r !== null) {
      ensure(r.totals.reduce((a, b) => a + b, 0) === 120, label, 'totals');
      const top = Math.max(...r.totals);
      const leaders = r.totals.filter((t) => t === top).length;
      ensure(r.draw === leaders > 1 && (r.winner === null) === r.draw, label, 'the result');
      if (r.winner !== null)
        ensure(
          r.totals[r.winner] === top && leaders === 1,
          label,
          'the winner is not the unique top',
        );
      ensure(
        after.games.at(-1)?.gameNo === after.gameNo && after.endedAt !== null,
        label,
        'the record',
      );
      cov.add(r.draw ? 'draw' : `win:${String(r.winner)}`);
    }
  }
  return views;
};

type Run = Readonly<{ state: State; view: View; steps: number; done: boolean }>;

/** One seeded match to the end; the shuffle stream and the policy's picks are independent generators. */
const playMatch = (
  n: SeatCount,
  seed: number,
  opts: CreateGameOptions,
  cov: Set<string>,
): number => {
  const deal = counting(mulberry32(seed));
  const pick = mulberry32(seed * 7919 + n);
  const start = B.createGame(players(n), opts, deal.rng, now);
  expect(deal.n).toBe(B.deckFor(start.options).length);
  const run = Array.from({ length: STEP_CAP }).reduce<Run>(
    ({ state, view, steps, done }) => {
      if (done) return { state, view, steps, done };
      const actor = B.actorOf(state) ?? 0;
      const action = choose(view, pick);
      const before = deal.n;
      const r = B.applyAction(state, actor, action, deal.rng, now);
      expect(
        r.ok ? 'ok' : r.error,
        `seed ${String(seed)} step ${String(steps)} ${action.type}`,
      ).toBe('ok');
      if (!r.ok) return { state, view, steps, done: true };
      const views = checkStep({
        before: state,
        after: r.value,
        view,
        actor,
        action,
        rngCalls: deal.n - before,
        step: steps,
        cov,
      });
      const over = r.value.phase === 'over' && B.matchOver(r.value.match);
      return {
        state: r.value,
        view: views[B.actorOf(r.value) ?? 0] ?? view,
        steps: steps + 1,
        done: over,
      };
    },
    { state: start, view: B.viewFor(start, B.actorOf(start) ?? 0), steps: 0, done: false },
  );
  expect(run.done, `seed ${String(seed)} did not finish in ${String(STEP_CAP)} steps`).toBe(true);
  expect(B.matchWinner(run.state.match), `seed ${String(seed)}`).not.toBeNull();
  expect(B.applyAction(run.state, 0, { type: 'next' }, deal.rng, now)).toEqual({
    ok: false,
    error: B.MESSAGES.MATCH_OVER,
  });
  expect(B.legalActions(B.viewFor(run.state, 0))).toEqual([]);
  return run.steps;
};

const seeds = (from: number, count: number): ReadonlyArray<number> =>
  Array.from({ length: count }, (_, i) => from + i);

/**
 * How many matches the four suites play together: 200 by default (80 + 40 + 40 + 40; every push
 * and PR, a few seconds), `BRISCOLA_REPLAY_GAMES=1000` in .github/workflows/nightly.yml beside
 * gin's and backgammon's, lower for a quick local run. Each suite keeps its share and the
 * outcome-coverage assertions expect at least the default. Read off `globalThis`: this file is
 * compiled by tsconfig.pure.json (no node types) while vitest runs it in node.
 */
const env = (globalThis as { process?: { env?: Readonly<Record<string, string | undefined>> } })
  .process?.env;
const DEFAULT_MATCHES = 200;
const SCALE = Number(env?.['BRISCOLA_REPLAY_GAMES'] ?? DEFAULT_MATCHES) / DEFAULT_MATCHES;
const share = (base: number): number => Math.max(1, Math.round(base * SCALE));
const TIMEOUT_MS = Math.ceil(60_000 * Math.max(1, SCALE));

const expectCovered = (cov: ReadonlySet<string>, keys: ReadonlyArray<string>): void => {
  keys.forEach((k) => {
    expect(cov.has(k), k).toBe(true);
  });
};

describe('seeded random play to the end (§2.4)', () => {
  test(
    'two players, single games: every invariant every step',
    () => {
      const cov = new Set<string>();
      const steps = seeds(1, share(80)).map((seed) => playMatch(2, seed, { gamesToWin: 1 }, cov));
      // A single game is 40 plays; a draw replays it.
      expect(steps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(share(80) * 40);
      expectCovered(cov, [
        'win:0',
        'win:1',
        'draw',
        'trumpTaken:0',
        'trumpTaken:1',
        'zeroTrick',
        'offSuitTrump',
        'steal',
        'overtrump',
        'carico',
        'value:pointless',
        'value:small',
        'value:big',
        'value:huge',
      ]);
      expect(cov.has('exchange')).toBe(false);
      expect(cov.has('peek')).toBe(false);
    },
    TIMEOUT_MS,
  );

  test(
    'two players, best of 3 with the exchange and scoperta',
    () => {
      const cov = new Set<string>();
      seeds(1001, share(40)).forEach((seed) =>
        playMatch(2, seed, { gamesToWin: 2, exchange: true, scoperta: true }, cov),
      );
      expectCovered(cov, [
        'win:0',
        'win:1',
        'exchange',
        'chain',
        'trumpTaken:0',
        'trumpTaken:1',
        'zeroTrick',
      ]);
    },
    TIMEOUT_MS,
  );

  test(
    'three players, best of 3 with the exchange, every removed two',
    () => {
      const cov = new Set<string>();
      const suits = ['C', 'D', 'S', 'B'] as const;
      seeds(2001, share(40)).forEach((seed, i) =>
        playMatch(3, seed, { gamesToWin: 2, exchange: true, removedTwo: suits[i % 4] ?? 'C' }, cov),
      );
      expectCovered(cov, [
        'win:0',
        'win:1',
        'win:2',
        'exchange',
        'trumpTaken:0',
        'trumpTaken:1',
        'trumpTaken:2',
        'zeroTrick',
        'offSuitTrump',
      ]);
    },
    TIMEOUT_MS,
  );

  test(
    'four players, best of 3 with the exchange (the partner peek shows nothing: no partners)',
    () => {
      const cov = new Set<string>();
      seeds(3001, share(40)).forEach((seed) =>
        playMatch(4, seed, { gamesToWin: 2, exchange: true, partnerPeek: true }, cov),
      );
      expectCovered(cov, [
        'win:0',
        'win:1',
        'exchange',
        'trumpTaken:0',
        'trumpTaken:1',
        'trumpTaken:2',
        'trumpTaken:3',
        'zeroTrick',
        'offSuitTrump',
      ]);
    },
    TIMEOUT_MS,
  );
});
