// Characterization of the gin engine (docs/MIGRATION.md step 2; docs/ARCHITECTURE.md "Testing
// pyramid", parity). Every assertion here is an executable oracle over seeded inputs, so the same
// suite runs unchanged on the TypeScript engine in step 10: add ['current', adapter] to `legs`.
// Known legacy defects are asserted as they are and named "KNOWN DEFECT"; step 15 flips them.
import { describe, expect, test } from 'vitest';

import { mulberry32, type Rng } from '../../web/shared/lib/rng.ts';
import {
  loadLegacyGin,
  type Card,
  type GinAction,
  type GinEngine,
  type GinState,
  type GinView,
  type Suit,
} from './gin.api.ts';

const legs: ReadonlyArray<readonly [string, GinEngine]> = [['legacy', loadLegacyGin()]];

const PLAYERS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
];
const SEEDED_GAMES = 300;
/** A seeded game averages ~430 steps; the cap only exists to turn a hang into a failure. */
const STEP_CAP = 5000;

const RANKS: Readonly<Record<string, number>> = { A: 1, J: 11, Q: 12, K: 13 };
const isSuit = (s: string): s is Suit => s === 'S' || s === 'H' || s === 'D' || s === 'C';
const ids = (cards: ReadonlyArray<Card>): string[] => cards.map((c) => c.id);
const check = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

/** Deep copy with the wall-clock fields zeroed, so two seeded runs compare equal. */
const masked = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (key: string, v: unknown) =>
      key === 'ts' || key === 'startedAt' ? 0 : v,
    ),
  );

describe.each(legs)('gin engine: %s', (_leg, E) => {
  const card = (id: string): Card => {
    const suit = id.slice(-1);
    const label = id.slice(0, -1);
    if (!isSuit(suit)) throw new Error(`bad card id ${id}`);
    return E.makeCard(RANKS[label] ?? Number(label), suit);
  };
  const newGame = (rng: Rng, dealer = 0, target = 100): GinState =>
    E.createGame({ players: PLAYERS, target, dealer, rng });
  const hand = (s: GinState, seat: number): Card[] => s.hands[seat] ?? [];
  const errorOf = (s: GinState, seat: number, action: GinAction): string => {
    const r = E.applyAction(s, seat, action, mulberry32(99));
    return r.ok ? 'ok' : r.error;
  };

  /** A discard-phase position: seat 0 holds `mine` (11 cards) and is about to discard or knock. */
  const position = (mine: string[], theirs: string[], discardTop: string): GinState => {
    const s = newGame(mulberry32(1), 1);
    const used = new Set([...mine, ...theirs, discardTop]);
    s.hands = [mine.map(card), theirs.map(card)];
    s.stock = E.makeDeck().filter((c) => !used.has(c.id));
    s.discard = [card(discardTop)];
    s.phase = 'discard';
    s.turn = 0;
    s.upcardStage = null;
    s.forceStock = false;
    s.drawnFromDiscard = null;
    s.pendingDraw = null;
    s.meldPref = [null, null];
    return s;
  };
  const scored = (s: GinState): Extract<NonNullable<GinState['result']>, { void: false }> => {
    const r = s.result;
    if (!r || r.void) throw new Error('expected a scored result');
    return r;
  };
  const meldStrings = (melds: ReadonlyArray<Card[]>): string[] =>
    melds.map((m) => ids(m).join(' '));

  const expectConserved = (s: GinState, where: string): void => {
    const all = ids([...s.hands.flat(), ...s.stock, ...s.discard]);
    check(all.length === 52 && new Set(all).size === 52, `52 unique cards expected ${where}`);
    s.hands.forEach((h) => {
      check(h.length === 10 || h.length === 11, `hand size 10/11 ${where}`);
    });
  };

  /** Seat whose move it is: in roundOver/gameOver the first player not yet ready. */
  const actor = (s: GinState): number =>
    s.phase === 'roundOver' || s.phase === 'gameOver' ? (s.ready[0] === true ? 1 : 0) : s.turn;

  const deadwoodAfter = (view: GinView, a: GinAction): number => {
    if (a.type !== 'discard' && a.type !== 'knock') return Infinity;
    const option = view.discardOptions?.[a.cardId];
    return option === undefined || option.locked === true ? Infinity : option.deadwood;
  };
  const leastDeadwood = (view: GinView, acts: GinAction[]): GinAction | undefined =>
    acts.reduce<GinAction | undefined>(
      (best, a) =>
        best === undefined || deadwoodAfter(view, a) < deadwoodAfter(view, best) ? a : best,
      undefined,
    );
  /**
   * Seeded legal play. A uniform choice over legalActions does not finish: random hands almost
   * never reach knocking deadwood, so every hand ends void when the stock runs out, and void
   * hands score nothing. So: knock whenever knocking is legal (the least-deadwood knock), discard
   * the least-deadwood card three times in four, and choose uniformly otherwise. Every choice is
   * an element of legalActions(view).
   */
  const policy = (rng: Rng, view: GinView, acts: GinAction[]): GinAction => {
    const knocks = acts.filter((a) => a.type === 'knock');
    const discards = acts.filter((a) => a.type === 'discard');
    const preferred =
      knocks.length > 0
        ? leastDeadwood(view, knocks)
        : discards.length > 0 && rng() < 0.75
          ? leastDeadwood(view, discards)
          : undefined;
    const uniform = acts[Math.floor(rng() * acts.length)];
    const chosen = preferred ?? uniform;
    if (chosen === undefined) throw new Error('no legal action');
    return chosen;
  };

  type Played = { state: GinState; steps: number; outcomes: string[]; trace: string[] };
  const outcomeOf = (s: GinState): string => {
    const last = s.rounds.at(-1);
    return last?.void === true ? 'void' : (last?.outcome ?? 'none');
  };
  const play = (seed: number, onStep?: (s: GinState) => void): Played => {
    const rng = mulberry32(seed);
    const state = newGame(rng, seed % 2);
    const outcomes: string[] = [];
    const trace: string[] = [];
    // `some` stops at the first true: the game is over, or the cap turned a hang into a failure.
    const advance = (): boolean => {
      if (state.phase === 'gameOver') return true;
      const seat = actor(state);
      const view = E.viewFor(state, seat);
      const acts = E.legalActions(view);
      check(acts.length > 0, `legalActions empty in ${state.phase} for seat ${String(seat)}`);
      const action = policy(rng, view, acts);
      const rounds = state.rounds.length;
      const r = E.applyAction(state, seat, action, rng);
      check(r.ok, `legal action rejected: ${JSON.stringify(action)} ${r.ok ? '' : r.error}`);
      trace.push(`${String(seat)} ${JSON.stringify(action)} -> ${state.phase}`);
      if (state.rounds.length > rounds) outcomes.push(outcomeOf(state));
      expectConserved(state, `after ${trace.length.toString()} steps of seed ${String(seed)}`);
      onStep?.(state);
      return false;
    };
    const finished = Array.from({ length: STEP_CAP }).some(advance);
    check(finished, `seed ${String(seed)} did not reach gameOver in ${String(STEP_CAP)} steps`);
    return { state, steps: trace.length, outcomes, trace };
  };

  describe('deck and deal', () => {
    test('the deck has 52 unique cards, 13 per suit, values capped at 10', () => {
      const deck = E.makeDeck();
      expect(deck).toHaveLength(52);
      expect(new Set(ids(deck)).size).toBe(52);
      E.SUITS.forEach((s) => {
        expect(deck.filter((c) => c.s === s)).toHaveLength(13);
      });
      expect(E.sumValue(deck)).toBe(4 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 * 4));
      expect(ids(deck.slice(0, 3))).toEqual(['AS', '2S', '3S']);
      expect(E.pretty(card('QH'))).toBe('Q♥');
    });

    test('shuffle is a seeded permutation', () => {
      const deck = E.makeDeck();
      const a = E.shuffle(deck, mulberry32(3));
      expect(ids(a).sort()).toEqual(ids(deck).sort());
      expect(ids(a)).not.toEqual(ids(deck));
      expect(ids(E.shuffle(deck, mulberry32(3)))).toEqual(ids(a));
      expect(ids(deck.slice(0, 3))).toEqual(['AS', '2S', '3S']);
    });

    test('a new game deals 10/10, one upcard, 31 in the stock; the non-dealer acts first', () => {
      const s = newGame(mulberry32(1), 0);
      expect(hand(s, 0)).toHaveLength(10);
      expect(hand(s, 1)).toHaveLength(10);
      expect(s.discard).toHaveLength(1);
      expect(s.stock).toHaveLength(31);
      expectConserved(s, 'after the deal');
      expect(s.phase).toBe('upcard');
      expect(s.upcardStage).toBe('nonDealer');
      expect(s.turn).toBe(1);
      expect(s.handNumber).toBe(1);
      expect(s.players.map((p) => p.total)).toEqual([0, 0]);
      expect(s.lastAction?.text).toBe('Alice dealt hand 1. Bob may take the upcard or pass.');
    });

    test('the dealer is drawn from the rng when not given', () => {
      const dealers = new Set(
        Array.from(
          { length: 20 },
          (_, i) => E.createGame({ players: PLAYERS, rng: mulberry32(i) }).dealer,
        ),
      );
      expect([...dealers].sort()).toEqual([0, 1]);
    });
  });

  describe('legalActions', () => {
    test('upcard stage: the non-dealer may take or pass; the dealer has no move', () => {
      const s = newGame(mulberry32(1), 0);
      expect(E.legalActions(E.viewFor(s, 1))).toEqual([
        { type: 'takeUpcard' },
        { type: 'passUpcard' },
      ]);
      expect(E.legalActions(E.viewFor(s, 0))).toEqual([]);
    });

    test('after a draw every card is a discard, and a knock where deadwood allows', () => {
      const s = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
        ['4S', '5S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
        '7C',
      );
      const acts = E.legalActions(E.viewFor(s, 0));
      expect(acts.filter((a) => a.type === 'discard')).toHaveLength(11);
      expect(acts).toContainEqual({ type: 'knock', cardId: 'KC' });
      expect(acts).toContainEqual({ type: 'knock', cardId: '2C' });
      expect(acts).not.toContainEqual({ type: 'knock', cardId: 'AS' });
      expect(acts).not.toContainEqual({ type: 'undoDraw' });
    });

    test('roundOver: only ready, only for a player not yet ready', () => {
      const s = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
        ['4S', '5S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
        '7C',
      );
      expect(E.applyAction(s, 0, { type: 'knock', cardId: 'KC' }).ok).toBe(true);
      expect(E.legalActions(E.viewFor(s, 0))).toEqual([{ type: 'ready' }]);
      expect(E.legalActions(E.viewFor(s, 1))).toEqual([{ type: 'ready' }]);
      expect(errorOf(s, 0, { type: 'drawStock' })).toBe('Waiting for both players to continue.');
      expect(E.applyAction(s, 0, { type: 'ready' }).ok).toBe(true);
      expect(E.legalActions(E.viewFor(s, 0))).toEqual([]);
      expect(E.legalActions(E.viewFor(s, 1))).toEqual([{ type: 'ready' }]);
    });
  });

  describe('turn flow and rule errors', () => {
    test('the exact refusal for every out-of-turn or out-of-phase move', () => {
      const s = newGame(mulberry32(2), 0);
      expect(errorOf(s, 0, { type: 'takeUpcard' })).toBe("It's not your turn.");
      expect(errorOf(s, 1, { type: 'drawStock' })).toBe('Take the upcard or pass.');
      expect(errorOf(s, 1, { type: 'passUpcard' })).toBe('ok');
      expect([s.turn, s.upcardStage]).toEqual([0, 'dealer']);
      expect(errorOf(s, 0, { type: 'passUpcard' })).toBe('ok');
      expect([s.phase, s.turn, s.forceStock]).toEqual(['draw', 1, true]);
      expect(s.lastAction?.text).toBe('Both passed. Bob must draw from the stock.');
      expect(errorOf(s, 1, { type: 'drawDiscard' })).toBe(
        'After both players pass, you must draw from the stock.',
      );
      expect(errorOf(s, 1, { type: 'discard', cardId: hand(s, 1)[0]?.id ?? '' })).toBe(
        'Draw a card from the stock or the discard pile.',
      );
      expect(errorOf(s, 1, { type: 'drawStock' })).toBe('ok');
      expect([s.phase, hand(s, 1).length, s.stock.length]).toEqual(['discard', 11, 30]);
      expect(E.viewFor(s, 1).canUndo).toBe(true);
      expect(errorOf(s, 1, { type: 'undoDraw' })).toBe('ok');
      expect([s.phase, hand(s, 1).length, s.stock.length, s.forceStock]).toEqual([
        'draw',
        10,
        31,
        true,
      ]);
      expect(errorOf(s, 1, { type: 'undoDraw' })).toBe(
        'Draw a card from the stock or the discard pile.',
      );
      expect(errorOf(s, 1, { type: 'drawStock' })).toBe('ok');
      expect(errorOf(s, 1, { type: 'discard', cardId: 'ZZ' })).toBe(
        "That card isn't in your hand.",
      );
      expect(errorOf(s, 1, { type: 'discard', cardId: hand(s, 1)[0]?.id ?? '' })).toBe('ok');
      expect([s.phase, s.turn]).toEqual(['draw', 0]);
      expect(errorOf(s, 0, { type: 'drawDiscard' })).toBe('ok');
      expect(s.drawnFromDiscard).toBe(hand(s, 0).at(-1)?.id);
      expect(errorOf(s, 0, { type: 'discard', cardId: s.drawnFromDiscard ?? '' })).toBe(
        "You can't discard the card you just took from the discard pile.",
      );
      expect(errorOf(s, 0, { type: 'ready' })).toBe('Discard a card, knock, or undo your draw.');
      expect(errorOf(s, 0, { type: 'setMelds', melds: [['XX']] })).toBe(
        "That meld arrangement doesn't fit your hand.",
      );
      expectConserved(s, 'after the scripted opening');
    });

    test('the upcard taken is locked against discard and knock; melds are frozen once the hand is over', () => {
      const s = newGame(mulberry32(2), 0);
      const up = s.discard.at(-1)?.id ?? '';
      expect(errorOf(s, 1, { type: 'takeUpcard' })).toBe('ok');
      expect([s.phase, s.drawnFromDiscard]).toEqual(['discard', up]);
      expect(s.lastAction?.text).toBe('Bob took the 8♣ upcard.');
      expect(errorOf(s, 1, { type: 'discard', cardId: up })).toBe(
        "You can't discard the card you just took from the discard pile.",
      );
      expect(errorOf(s, 1, { type: 'knock', cardId: up })).toBe(
        "You can't discard the card you just took from the discard pile.",
      );
      expect(E.viewFor(s, 1).discardOptions?.[up]).toEqual({ locked: true });
      expect(E.viewFor(s, 1).canUndo).toBe(true);

      const knocked = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
        ['4S', '5S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
        '7C',
      );
      expect(errorOf(knocked, 0, { type: 'knock', cardId: 'KC' })).toBe('ok');
      expect(knocked.phase).toBe('roundOver');
      expect(errorOf(knocked, 0, { type: 'setMelds', melds: [] })).toBe(
        'You can only rearrange melds during play.',
      );
      expect(errorOf(knocked, 1, { type: 'setMelds', melds: [['10H', 'JH', 'QH']] })).toBe(
        'You can only rearrange melds during play.',
      );
    });

    test('drawing from the stock reports the private card only to the drawer', () => {
      const s = newGame(mulberry32(2), 0);
      E.applyAction(s, 1, { type: 'passUpcard' });
      E.applyAction(s, 0, { type: 'passUpcard' });
      const top = s.stock.at(-1)?.id;
      const r = E.applyAction(s, 1, { type: 'drawStock' });
      expect(r).toEqual({ ok: true, privateCard: top });
      expect(E.viewFor(s, 1).lastDrawnId).toBe(top);
      expect(E.viewFor(s, 0).lastDrawnId).toBeNull();
    });
  });

  describe('seeded legal play', () => {
    test(`${String(SEEDED_GAMES)} seeded games terminate at gameOver, conserve 52 cards and keep 10/11-card hands at every step`, () => {
      const games = Array.from({ length: SEEDED_GAMES }, (_, i) => play(i + 1));
      games.forEach(({ state }) => {
        expect(state.phase).toBe('gameOver');
        const winner = state.winner;
        expect(winner === 0 || winner === 1).toBe(true);
        const totals = state.players.map((p) => p.total);
        expect(Math.max(...totals)).toBeGreaterThanOrEqual(state.target);
        expect(totals[winner ?? 0]).toBe(Math.max(...totals));
        expect(state.rounds.length).toBe(state.handNumber);
      });
      const outcomes = games.flatMap((g) => g.outcomes);
      // The corpus exercises every way a hand can end.
      expect(new Set(outcomes)).toEqual(new Set(['gin', 'knock', 'undercut', 'void']));
      expect(games.reduce((n, g) => n + g.steps, 0)).toBeGreaterThan(SEEDED_GAMES * 100);
    }, 120_000);

    test('the same seed replays the same game (ts and startedAt masked)', () => {
      const a = play(11);
      const b = play(11);
      expect(a.trace).toEqual(b.trace);
      expect(masked(a.state)).toEqual(masked(b.state));
      expect(masked(E.viewFor(a.state, 0))).toEqual(masked(E.viewFor(b.state, 0)));
    });

    test('totals never decrease and the loser of a scored hand deals the next', () => {
      const totals: number[][] = [];
      const dealers: { loser: number | null; dealer: number }[] = [];
      play(4, (s) => {
        totals.push(s.players.map((p) => p.total));
        const r = s.result;
        if (s.phase === 'upcard' && s.handNumber > 1 && r === null) {
          dealers.push({ loser: null, dealer: s.dealer });
        }
      });
      totals.slice(1).forEach((t, i) => {
        const prev = totals[i] ?? [0, 0];
        expect(t[0]).toBeGreaterThanOrEqual(prev[0] ?? 0);
        expect(t[1]).toBeGreaterThanOrEqual(prev[1] ?? 0);
      });
      expect(dealers.length).toBeGreaterThan(0);
    });
  });

  describe('viewFor redaction', () => {
    const hidesOtherHand = (s: GinState, seat: number): void => {
      const view = E.viewFor(s, seat);
      expect(Object.keys(view.opp)).toEqual(['idx', 'id', 'name', 'total', 'cardCount']);
      expect(view.opp.cardCount).toBe(hand(s, 1 - seat).length);
      expect(ids(view.me.hand)).toEqual(ids(hand(s, seat)));
      expect(view.stockCount).toBe(s.stock.length);
      expect(view.discardTop?.id).toBe(s.discard.at(-1)?.id);
      const json = JSON.stringify(view);
      expect(json).not.toContain('"hands"');
      // A card taken from the discard pile is public knowledge: the view names it in
      // drawnFromDiscard and lastAction.card. Every other card of the other hand stays out.
      const known = new Set([view.drawnFromDiscard, view.lastAction?.card]);
      ids(hand(s, 1 - seat))
        .filter((id) => !known.has(id))
        .forEach((id) => {
          expect(json).not.toContain(`"${id}"`);
        });
    };

    test('a fresh deal shows the viewer their own hand and only a count of the other', () => {
      const s = newGame(mulberry32(5));
      hidesOtherHand(s, 0);
      hidesOtherHand(s, 1);
    });

    test('the other hand stays hidden through a seeded game while a hand is in play', () => {
      const checked = { n: 0 };
      play(6, (s) => {
        if (s.phase === 'upcard' || s.phase === 'draw' || s.phase === 'discard') {
          hidesOtherHand(s, 0);
          hidesOtherHand(s, 1);
          checked.n += 1;
        }
      });
      expect(checked.n).toBeGreaterThan(100);
    });

    test('discardOptions exist only for the 11-card holder on their discard turn', () => {
      const s = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
        ['4S', '5S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
        '7C',
      );
      const mine = E.viewFor(s, 0);
      expect(Object.keys(mine.discardOptions ?? {}).sort()).toEqual(ids(hand(s, 0)).sort());
      expect(mine.discardOptions?.['KC']).toEqual({ deadwood: 2, canKnock: true, isGin: false });
      // Without AS: 4H 5H 6H and 7D 8D 9D meld; 2S 3S 2C KC are deadwood (2 + 3 + 2 + 10).
      expect(mine.discardOptions?.['AS']).toEqual({ deadwood: 17, canKnock: false, isGin: false });
      expect(mine.me.deadwoodValue).toBe(12);
      expect(E.viewFor(s, 1).discardOptions).toBeNull();
      expect(E.viewFor(s, 1).isMyTurn).toBe(false);
    });
  });

  describe('scoring on constructed hands (seat 0 knocks with KC; 7C is the upcard)', () => {
    test('gin: 25 plus all of the opponent deadwood, and nothing may be laid off', () => {
      const s = position(
        ['AS', '2S', '3S', '4S', '5H', '6H', '7H', '8D', '9D', '10D', 'KC'],
        // 5S would extend the spade run, but there is no layoff against gin: it counts.
        ['AH', '2H', '3D', '4D', '5C', '6C', '7S', '8S', '9H', '5S'],
        '7C',
      );
      expect(E.applyAction(s, 0, { type: 'knock', cardId: 'KC' })).toEqual({ ok: true });
      const r = scored(s);
      expect(r.outcome).toBe('gin');
      expect([r.knocker.value, r.opponent.value]).toEqual([0, 50]);
      expect(r.scores).toEqual([E.GIN_BONUS + 50, 0]);
      expect(r.opponent.laidOff).toEqual([]);
      expect(meldStrings(r.knocker.melds)).toEqual(['AS 2S 3S 4S', '5H 6H 7H', '8D 9D 10D']);
      expect(meldStrings(r.opponent.extendedMelds)).toEqual(meldStrings(r.knocker.melds));
      expect([r.scorerIdx, r.loserIdx, r.knockCard]).toEqual([0, 1, 'KC']);
      expect(s.players.map((p) => p.total)).toEqual([75, 0]);
      expect(s.lastAction?.text).toBe('Alice went GIN!');
      expect(s.rounds).toEqual([
        {
          handNumber: 1,
          ts: r.ts,
          knockerIdx: 0,
          outcome: 'gin',
          deadwood: { a: 0, b: 50 },
          scores: { a: 75, b: 0 },
        },
      ]);
      expect(s.phase).toBe('roundOver');
      expect(s.ready).toEqual([false, false]);
    });

    test('knock: the opponent lays off in a chain (4S then 5S onto A-2-3 of spades) before counting', () => {
      const s = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
        ['4S', '5S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
        '7C',
      );
      expect(E.applyAction(s, 0, { type: 'knock', cardId: 'KC' })).toEqual({ ok: true });
      const r = scored(s);
      expect(r.outcome).toBe('knock');
      expect([r.knocker.value, r.opponent.value]).toEqual([2, 20]);
      expect(r.scores).toEqual([18, 0]);
      const spadeRun = meldStrings(r.knocker.melds).indexOf('AS 2S 3S');
      expect(spadeRun).toBeGreaterThanOrEqual(0);
      expect(r.opponent.laidOff.map((x) => [x.card.id, x.onto])).toEqual([
        ['4S', spadeRun],
        ['5S', spadeRun],
      ]);
      expect(meldStrings(r.opponent.extendedMelds)).toContain('AS 2S 3S 4S 5S');
      expect(ids(r.opponent.deadwood)).toEqual(['QD', 'KD']);
      expect(s.lastAction?.text).toBe('Alice knocked with 2.');
      expect(s.players.map((p) => p.total)).toEqual([18, 0]);
    });

    test('knock: the opponent lays off below the run too (4S then 3S under 5-6-7 of spades)', () => {
      const s = position(
        ['5S', '6S', '7S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
        ['3S', '4S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
        'AD',
      );
      expect(E.applyAction(s, 0, { type: 'knock', cardId: 'KC' })).toEqual({ ok: true });
      const r = scored(s);
      expect(r.outcome).toBe('knock');
      expect(meldStrings(r.knocker.melds)).toEqual(['5S 6S 7S', '4H 5H 6H', '7D 8D 9D']);
      expect(r.opponent.laidOff.map((x) => [x.card.id, x.onto])).toEqual([
        ['4S', 0],
        ['3S', 0],
      ]);
      expect(meldStrings(r.opponent.extendedMelds)).toEqual([
        '3S 4S 5S 6S 7S',
        '4H 5H 6H',
        '7D 8D 9D',
      ]);
      expect(meldStrings(r.opponent.melds)).toEqual(['10H JH QH', '7C 8C 9C']);
      expect(ids(r.opponent.deadwood)).toEqual(['QD', 'KD']);
      expect([r.knocker.value, r.opponent.value]).toEqual([2, 20]);
      expect(r.scores).toEqual([18, 0]);
      expect(s.players.map((p) => p.total)).toEqual([18, 0]);
    });

    test('the scoring constants', () => {
      expect([E.GIN_BONUS, E.UNDERCUT_BONUS, E.KNOCK_LIMIT]).toEqual([25, 25, 10]);
    });

    test('undercut: equal or lower opponent deadwood scores the difference plus 25 for the opponent', () => {
      const s = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '8C', 'KC'],
        ['10S', 'JS', 'QS', '10C', 'JC', 'QC', '2D', '3D', '4D', '5C'],
        '7C',
      );
      expect(E.applyAction(s, 0, { type: 'knock', cardId: 'KC' })).toEqual({ ok: true });
      const r = scored(s);
      expect(r.outcome).toBe('undercut');
      expect([r.knocker.value, r.opponent.value]).toEqual([8, 5]);
      // 8 - 5 deadwood plus the 25-point undercut bonus.
      expect(r.scores).toEqual([0, 28]);
      expect([r.scorerIdx, r.loserIdx]).toEqual([1, 0]);
      expect(s.players.map((p) => p.total)).toEqual([0, 28]);
      expect(s.lastAction?.text).toBe('Alice knocked but was undercut by Bob!');

      const tie = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '8C', 'KC'],
        ['10S', 'JS', 'QS', '10C', 'JC', 'QC', '2D', '3D', '4D', '8H'],
        '7C',
      );
      expect(E.applyAction(tie, 0, { type: 'knock', cardId: 'KC' })).toEqual({ ok: true });
      expect(scored(tie).outcome).toBe('undercut');
      expect(scored(tie).scores).toEqual([0, 25]);
    });

    test('a knock above the limit is refused with the deadwood it would leave', () => {
      const s = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '2C', '9C', 'KC'],
        ['10S', 'JS', 'QS', '10C', 'JC', 'QC', '2D', '3D', '4D', '8H'],
        '7C',
      );
      expect(E.KNOCK_LIMIT).toBe(10);
      expect(errorOf(s, 0, { type: 'knock', cardId: 'KC' })).toBe(
        "You need 10 or fewer deadwood points to knock (you'd have 26).",
      );
      expect(s.phase).toBe('discard');
      expect(hand(s, 0)).toHaveLength(11);
    });

    test('after a scored hand both ready: the loser deals the next hand', () => {
      const s = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
        ['4S', '5S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
        '7C',
      );
      E.applyAction(s, 0, { type: 'knock', cardId: 'KC' });
      expect(errorOf(s, 1, { type: 'ready' })).toBe('ok');
      expect(s.phase).toBe('roundOver');
      expect(errorOf(s, 0, { type: 'ready' })).toBe('ok');
      expect([s.phase, s.dealer, s.turn, s.handNumber, s.result]).toEqual([
        'upcard',
        1,
        0,
        2,
        null,
      ]);
      expect(s.players.map((p) => p.total)).toEqual([18, 0]);
      expectConserved(s, 'after the redeal');
    });

    test('reaching the target ends the game after both ready; only ready remains legal', () => {
      const s = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
        ['4S', '5S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
        '7C',
      );
      s.players[0] = { id: 'a', name: 'Alice', total: 90 };
      E.applyAction(s, 0, { type: 'knock', cardId: 'KC' });
      E.applyAction(s, 0, { type: 'ready' });
      E.applyAction(s, 1, { type: 'ready' });
      expect([s.phase, s.winner]).toEqual(['gameOver', 0]);
      expect(s.players.map((p) => p.total)).toEqual([108, 0]);
      expect(s.lastAction?.text).toBe('Alice wins the game!');
      expect(E.legalActions(E.viewFor(s, 0))).toEqual([{ type: 'ready' }]);
      expect(E.legalActions(E.viewFor(s, 1))).toEqual([{ type: 'ready' }]);
      expect(errorOf(s, 0, { type: 'drawStock' })).toBe('The game is over.');
      // Both ready again: a fresh game, totals cleared, dealer from the rng.
      E.applyAction(s, 0, { type: 'ready' }, mulberry32(1));
      E.applyAction(s, 1, { type: 'ready' }, mulberry32(1));
      expect([s.phase, s.handNumber, s.rounds, s.winner]).toEqual(['upcard', 1, [], null]);
      expect(s.players.map((p) => p.total)).toEqual([0, 0]);
    });

    test('a discard with two or fewer stock cards left voids the hand; the same dealer redeals', () => {
      const s = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
        ['4S', '5S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
        '7C',
      );
      s.stock = s.stock.slice(0, 2);
      expect(E.applyAction(s, 0, { type: 'discard', cardId: 'KC' })).toEqual({ ok: true });
      expect(s.result).toMatchObject({ void: true, totals: [0, 0] });
      expect(s.rounds).toHaveLength(1);
      expect(s.rounds[0]).toMatchObject({ handNumber: 1, void: true, scores: { a: 0, b: 0 } });
      expect(s.lastAction?.text).toBe(
        'Only two cards left in the stock — the hand is void. Same dealer redeals.',
      );
      E.applyAction(s, 0, { type: 'ready' }, mulberry32(1));
      E.applyAction(s, 1, { type: 'ready' }, mulberry32(1));
      expect([s.phase, s.dealer, s.handNumber]).toEqual(['upcard', 1, 2]);

      // Three left is the other side of the boundary: the discard passes the turn as usual.
      const three = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
        ['4S', '5S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
        '7C',
      );
      three.stock = three.stock.slice(0, 3);
      expect(E.applyAction(three, 0, { type: 'discard', cardId: 'KC' })).toEqual({ ok: true });
      expect([three.phase, three.turn, three.result, three.rounds]).toEqual(['draw', 1, null, []]);
      expect(three.stock).toHaveLength(3);
      expect(three.lastAction?.text).toBe('Alice discarded the K♣.');
    });
  });

  describe('meld arrangements', () => {
    // 5S can go in the 4-5-6 run or the set of fives; both leave 51 deadwood.
    const mine = ['4S', '5S', '6S', '5H', '5D', '9C', 'JD', 'KH', '2C', '10H'];
    const theirs = ['AH', '2H', '3H', '4H', '5C', '6C', '7C', '8C', '9D', '10D'];

    test('allOptimalMeldings lists every arrangement with the minimum deadwood', () => {
      const options = E.allOptimalMeldings(mine.map(card), 12);
      expect(options.map((o) => [o.sig, o.value])).toEqual([
        ['4S+5S+6S', 51],
        ['5D+5H+5S', 51],
      ]);
      expect(E.bestMelding(mine.map(card)).value).toBe(51);
    });

    test('a four-of-a-kind may give up one card to a run: allMelds lists its 3-card subsets', () => {
      const fives = ['5S', '5H', '5D', '5C'].map(card);
      expect(meldStrings(E.allMelds(fives))).toEqual([
        '5S 5H 5D 5C',
        '5H 5D 5C',
        '5S 5D 5C',
        '5S 5H 5C',
        '5S 5H 5D',
      ]);
      // Keeping all four fives strands 6C 7C (44 deadwood); splitting 5C off melds them (31).
      const split = E.bestMelding(
        ['5S', '5H', '5D', '5C', '6C', '7C', 'KH', 'QD', '9S', '2H'].map(card),
      );
      expect(split.value).toBe(31);
      expect(meldStrings(split.melds)).toEqual(['5S 5H 5D', '5C 6C 7C']);
      expect(ids(split.deadwood)).toEqual(['9S', '2H', 'KH', 'QD']);
    });

    test('setMelds accepts an equal-value arrangement and refuses anything else', () => {
      const s = position(mine, theirs, '7S');
      expect(E.viewFor(s, 0).meldOptions.map((o) => o.sig)).toEqual(['4S+5S+6S', '5D+5H+5S']);
      // The solver's own pick is the set of fives; the player may switch to the run.
      expect(E.viewFor(s, 0).activeMeldSig).toBe('5D+5H+5S');
      expect(errorOf(s, 0, { type: 'setMelds', melds: [['4S', '5S', '6S']] })).toBe('ok');
      expect(E.viewFor(s, 0).activeMeldSig).toBe('4S+5S+6S');
      expect(errorOf(s, 0, { type: 'setMelds', melds: [['5S', '5H', '5D']] })).toBe('ok');
      expect(E.viewFor(s, 0).activeMeldSig).toBe('5D+5H+5S');
      expect(errorOf(s, 0, { type: 'setMelds', melds: [] })).toBe(
        'That arrangement would leave 66 deadwood instead of 51.',
      );
      expect(errorOf(s, 0, { type: 'setMelds', melds: [['4S', '5S', '6S', '5H']] })).toBe(
        "That meld arrangement doesn't fit your hand.",
      );
      expect(errorOf(s, 1, { type: 'setMelds', melds: [] })).toBe(
        // AH-4H and 5C-8C meld for seat 1; 9D and 10D are their deadwood.
        'That arrangement would leave 55 deadwood instead of 19.',
      );
    });
  });

  describe('known defects, preserved until docs/MIGRATION.md step 15', () => {
    test('KNOWN DEFECT (lastDrawn leak): dealHand does not reset lastDrawn, so a card drawn in the previous hand is marked "last drawn" when the redeal happens to give it back', () => {
      // Seed 2 leaves AS out of seat 0's hand; the redeal with seed 1 puts AS in it.
      const s = newGame(mulberry32(2), 0);
      expect(ids(hand(s, 0))).not.toContain('AS');
      s.lastDrawn = { p: 0, id: 'AS' }; // as a takeUpcard/drawStock/drawDiscard of AS leaves it
      E.dealHand(s, mulberry32(1));
      expect(ids(hand(s, 0))).toContain('AS');
      expect(s.lastDrawn).toEqual({ p: 0, id: 'AS' });
      const view = E.viewFor(s, 0);
      expect(view.lastDrawnId).toBe('AS');
      expect(view.canUndo).toBe(false);
      expect(s.pendingDraw).toBeNull();
      // Whether the leak shows is down to the shuffle: redeal without AS and it stays hidden.
      E.dealHand(s, mulberry32(2));
      expect(ids(hand(s, 0))).not.toContain('AS');
      expect(E.viewFor(s, 0).lastDrawnId).toBeNull();
      expect(s.lastDrawn).toEqual({ p: 0, id: 'AS' });
    });

    test('undoDraw is the only action that clears lastDrawn', () => {
      const s = newGame(mulberry32(2), 0);
      E.applyAction(s, 1, { type: 'takeUpcard' });
      expect(s.lastDrawn).toEqual({ p: 1, id: hand(s, 1).at(-1)?.id });
      E.applyAction(s, 1, { type: 'undoDraw' });
      expect(s.lastDrawn).toBeNull();
    });
  });
});
