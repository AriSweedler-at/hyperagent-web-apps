// Characterization of the gin engine (docs/MIGRATION.md steps 2 and 10; docs/ARCHITECTURE.md
// "Testing pyramid", parity). Every assertion here is an executable oracle over seeded inputs and
// runs on both legs: the sha256-pinned legacy fixture and the TypeScript engine behind the adapter
// in gin.api.ts. The legs disagree on three behaviours, each a `test.runIf(leg === ...)` pair: the
// `lastDrawn` leak (docs/MIGRATION.md step 15), the undo of a stock draw and the layoff of a card
// that fits two knocker melds (docs/design/gin-arrangement-and-discards.md §4 and §7); the legacy
// leg asserts each as it is, named "KNOWN DEFECT" where it is one, and the current leg asserts the
// rule; everything else is one assertion for both.
import { describe, expect, test } from 'vitest';

import {
  STOCK_DRAW_FINAL_MSG,
  bestLayoffActions,
  type State,
} from '../../web/games/gin-rummy/src/engine/index.ts';
import { mulberry32, type Rng } from '../../web/shared/lib/rng.ts';
import {
  loadCurrentGin,
  loadLegacyGin,
  type Card,
  type GinAction,
  type GinEngine,
  type GinState,
  type Suit,
} from './gin.api.ts';
import { actor, policy } from './gin.policy.ts';

const legs: ReadonlyArray<readonly [string, GinEngine]> = [
  ['legacy', loadLegacyGin()],
  ['current', loadCurrentGin()],
];

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

describe.each(legs)('gin engine: %s', (leg, E) => {
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
  /**
   * RULE CHANGE (docs/design/gin-arrangement-and-discards.md §7b): the legacy scores a knock at
   * once; the current leg opens the layoff phase, so the layoffs the legacy would have made are
   * played and finished here, and both legs land on the same scored result.
   */
  const settle = (s: GinState): void => {
    if (leg !== 'current') return;
    bestLayoffActions(s as unknown as State).forEach((a) => {
      const r = E.applyAction(s, s.turn, a as GinAction);
      check(r.ok, `layoff step refused: ${r.ok ? '' : r.error}`);
    });
  };
  /** Seat 0 knocks with `cardId` and the knock is answered: the result the legacy would have scored. */
  const knockWith = (s: GinState, cardId: string): ReturnType<GinEngine['applyAction']> => {
    const r = E.applyAction(s, 0, { type: 'knock', cardId });
    if (r.ok) settle(s);
    return r;
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
      expect(knockWith(s, 'KC').ok).toBe(true);
      expect(E.legalActions(E.viewFor(s, 0))).toEqual([{ type: 'ready' }]);
      expect(E.legalActions(E.viewFor(s, 1))).toEqual([{ type: 'ready' }]);
      expect(errorOf(s, 0, { type: 'drawStock' })).toBe('Waiting for both players to continue.');
      expect(E.applyAction(s, 0, { type: 'ready' }).ok).toBe(true);
      expect(E.legalActions(E.viewFor(s, 0))).toEqual([]);
      expect(E.legalActions(E.viewFor(s, 1))).toEqual([{ type: 'ready' }]);
    });
  });

  describe('turn flow and rule errors', () => {
    /** Seed 2, dealer 0: both pass the upcard and Bob draws from the stock, every refusal checked. */
    const drewFromStock = (): GinState => {
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
      return s;
    };
    /** Bob, holding eleven, discards; Alice takes from the discard pile: the rest of the refusals. */
    const restOfTheOpening = (s: GinState): void => {
      expect(errorOf(s, 1, { type: 'discard', cardId: 'ZZ' })).toBe(
        "That card isn't in your hand.",
      );
      expect(errorOf(s, 1, { type: 'discard', cardId: hand(s, 1)[0]?.id ?? '' })).toBe('ok');
      expect([s.phase, s.turn]).toEqual(['draw', 0]);
      expect(errorOf(s, 0, { type: 'drawDiscard' })).toBe('ok');
      expect(s.drawnFromDiscard).toBe(hand(s, 0).at(-1)?.id);
      // A draw from the discard pile undoes on both legs (public information), and can be redone.
      expect(E.viewFor(s, 0).canUndo).toBe(true);
      expect(E.legalActions(E.viewFor(s, 0))).toContainEqual({ type: 'undoDraw' });
      expect(errorOf(s, 0, { type: 'undoDraw' })).toBe('ok');
      expect([s.phase, hand(s, 0).length, s.discard.length, s.drawnFromDiscard]).toEqual([
        'draw',
        10,
        2,
        null,
      ]);
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
    };

    test.runIf(leg === 'legacy')(
      'the exact refusal for every out-of-turn or out-of-phase move; legacy only: a stock draw undoes too',
      () => {
        const s = drewFromStock();
        expect(E.viewFor(s, 1).canUndo).toBe(true);
        expect(E.legalActions(E.viewFor(s, 1))).toContainEqual({ type: 'undoDraw' });
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
        restOfTheOpening(s);
      },
    );

    test.runIf(leg === 'current')(
      'the exact refusal for every out-of-turn or out-of-phase move; a stock draw is final (docs/design/gin-arrangement-and-discards.md §4)',
      () => {
        const s = drewFromStock();
        expect(E.viewFor(s, 1).canUndo).toBe(false);
        expect(E.legalActions(E.viewFor(s, 1))).not.toContainEqual({ type: 'undoDraw' });
        expect(errorOf(s, 1, { type: 'undoDraw' })).toBe(STOCK_DRAW_FINAL_MSG);
        expect(STOCK_DRAW_FINAL_MSG).toBe("You can't undo a draw from the stock.");
        expect([s.phase, hand(s, 1).length, s.stock.length, s.pendingDraw?.from]).toEqual([
          'discard',
          11,
          30,
          'stock',
        ]);
        // The card drawn is still marked fresh: the ghost cell shows it, and only accepting remains.
        expect(E.viewFor(s, 1).lastDrawnId).toBe(s.pendingDraw?.cardId);
        restOfTheOpening(s);
      },
    );

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
      expect(knockWith(knocked, 'KC')).toEqual({ ok: true });
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
      expect(knockWith(s, 'KC')).toEqual({ ok: true });
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
      expect(knockWith(s, 'KC')).toEqual({ ok: true });
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

    /**
     * Alice knocks on three sevens, 4-5-6 of clubs and A-2-3 of spades with the 4D as deadwood; Bob
     * holds 7C 8C beside two melds and QD KD. The 7C fits the sevens and the clubs run; only the
     * run lets the 8C follow (docs/design/gin-arrangement-and-discards.md §7).
     */
    const sevenAndEightOfClubs = (): GinState =>
      position(
        ['7S', '7H', '7D', '4C', '5C', '6C', 'AS', '2S', '3S', '4D', 'KC'],
        ['7C', '8C', '10H', 'JH', 'QH', '4H', '5H', '6H', 'QD', 'KD'],
        '9D',
      );

    test.runIf(leg === 'legacy')(
      'KNOWN DEFECT (greedy layoff), legacy only: a card fitting a set and a run goes onto the set, stranding the card the run would have taken next',
      () => {
        const s = sevenAndEightOfClubs();
        expect(knockWith(s, 'KC')).toEqual({ ok: true });
        const r = scored(s);
        expect(meldStrings(r.knocker.melds)).toEqual(['7S 7H 7D', '4C 5C 6C', 'AS 2S 3S']);
        expect(r.opponent.laidOff.map((x) => [x.card.id, x.onto])).toEqual([['7C', 0]]);
        expect(meldStrings(r.opponent.extendedMelds)).toEqual([
          '7S 7H 7D 7C',
          '4C 5C 6C',
          'AS 2S 3S',
        ]);
        expect(ids(r.opponent.deadwood)).toEqual(['QD', 'KD', '8C']);
        expect([r.knocker.value, r.opponent.value]).toEqual([4, 28]);
        expect(r.scores).toEqual([24, 0]);
      },
    );

    test.runIf(leg === 'current')(
      'knock: a card fitting a set and a run goes where the next card can follow (7C then 8C onto 4-5-6 of clubs)',
      () => {
        const s = sevenAndEightOfClubs();
        expect(knockWith(s, 'KC')).toEqual({ ok: true });
        const r = scored(s);
        expect(r.outcome).toBe('knock');
        expect(meldStrings(r.knocker.melds)).toEqual(['7S 7H 7D', '4C 5C 6C', 'AS 2S 3S']);
        const clubRun = meldStrings(r.knocker.melds).indexOf('4C 5C 6C');
        expect(r.opponent.laidOff.map((x) => [x.card.id, x.onto])).toEqual([
          ['7C', clubRun],
          ['8C', clubRun],
        ]);
        expect(meldStrings(r.opponent.extendedMelds)).toEqual([
          '7S 7H 7D',
          '4C 5C 6C 7C 8C',
          'AS 2S 3S',
        ]);
        expect(meldStrings(r.opponent.melds)).toEqual(['10H JH QH', '4H 5H 6H']);
        expect(ids(r.opponent.deadwood)).toEqual(['QD', 'KD']);
        expect([r.knocker.value, r.opponent.value]).toEqual([4, 20]);
        expect(r.scores).toEqual([16, 0]);
        expect(s.lastAction?.text).toBe('Alice knocked with 4.');
        expect(s.players.map((p) => p.total)).toEqual([16, 0]);
      },
    );

    test('knock: the opponent lays off below the run too (4S then 3S under 5-6-7 of spades)', () => {
      const s = position(
        ['5S', '6S', '7S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
        ['3S', '4S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
        'AD',
      );
      expect(knockWith(s, 'KC')).toEqual({ ok: true });
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

    test.runIf(leg === 'current')(
      'the layoff phase (§7b): the defender lays off by hand, takes back, finishes; the knocker waits',
      () => {
        const s = position(
          ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
          ['4S', '5S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
          '7C',
        );
        const opened = E.applyAction(s, 0, { type: 'knock', cardId: 'KC' });
        expect(opened).toEqual({ ok: true });
        expect([s.phase, s.turn, s.result]).toEqual(['layoff', 1, null]);
        expect(s.lastAction?.text).toBe('Alice knocked with 2. Bob may lay off.');
        const spadeRun = meldStrings(s.knock?.melding.melds ?? []).indexOf('AS 2S 3S');
        // The knocker waits; their melds are on the table.
        expect(E.legalActions(E.viewFor(s, 0))).toEqual([]);
        expect(errorOf(s, 0, { type: 'setMelds', melds: [] })).toBe('Your melds are on the table.');
        expect(errorOf(s, 0, { type: 'finishLayoff' })).toBe("It's not your turn.");
        // The defender: only the 4S fits so far (the 5S needs the 4S first), and finishing is open.
        const before = E.legalActions(E.viewFor(s, 1));
        expect(before).toContainEqual({ type: 'layOff', cardId: '4S', onto: spadeRun });
        expect(before).not.toContainEqual({ type: 'layOff', cardId: '5S', onto: spadeRun });
        expect(before.at(-1)).toEqual({ type: 'finishLayoff' });
        expect(errorOf(s, 1, { type: 'layOff', cardId: '5S', onto: spadeRun })).toBe(
          "The 5♠ doesn't fit that meld.",
        );
        expect(errorOf(s, 1, { type: 'layOff', cardId: 'QD', onto: spadeRun })).toBe(
          "The Q♦ doesn't fit that meld.",
        );
        expect(errorOf(s, 1, { type: 'drawStock' })).toBe(
          'Lay off onto the melds, take a card back, or finish.',
        );
        expect(errorOf(s, 1, { type: 'layOff', cardId: '4S', onto: spadeRun })).toBe('ok');
        expect(E.viewFor(s, 1).layoff?.extended.map((m) => ids(m).join(' '))).toContain(
          'AS 2S 3S 4S',
        );
        // The hand keeps its ten; the melding counts the kept cards only (the 5S still counts).
        expect(hand(s, 1)).toHaveLength(10);
        expect(E.viewFor(s, 1).me.deadwoodValue).toBe(25);
        expect(errorOf(s, 1, { type: 'layOff', cardId: '4S', onto: spadeRun })).toBe(
          'That card is laid off already.',
        );
        expect(errorOf(s, 1, { type: 'layOff', cardId: '5S', onto: spadeRun })).toBe('ok');
        expect(E.viewFor(s, 1).me.deadwoodValue).toBe(20);
        expect(E.viewFor(s, 0).layoff?.laidOff.map((e) => e.card.id)).toEqual(['4S', '5S']);
        // The 4S holds the 5S on: it comes back only after the 5S.
        expect(errorOf(s, 1, { type: 'takeBack', cardId: '4S' })).toBe(
          'Take back the cards laid off after it first.',
        );
        expect(errorOf(s, 1, { type: 'takeBack', cardId: 'QD' })).toBe("That card isn't laid off.");
        expect(errorOf(s, 1, { type: 'takeBack', cardId: '5S' })).toBe('ok');
        expect(s.lastAction?.text).toBe('Bob took the 5♠ back.');
        expect(errorOf(s, 1, { type: 'layOff', cardId: '5S', onto: spadeRun })).toBe('ok');
        expect(s.lastAction?.text).toBe('Bob laid off the 5♠.');
        expect(errorOf(s, 1, { type: 'finishLayoff' })).toBe('ok');
        const r = scored(s);
        expect([s.phase, r.outcome, r.knocker.value, r.opponent.value]).toEqual([
          'roundOver',
          'knock',
          2,
          20,
        ]);
        expect(r.opponent.laidOff.map((x) => [x.card.id, x.onto])).toEqual([
          ['4S', spadeRun],
          ['5S', spadeRun],
        ]);
        expect(r.scores).toEqual([18, 0]);
        expect(s.knock).toBeUndefined();
        // Finishing with nothing laid off counts everything: the result the defender chose.
        const alone = position(
          ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '2C', 'KC'],
          ['4S', '5S', '10H', 'JH', 'QH', '7C', '8C', '9C', 'QD', 'KD'],
          '7C',
        );
        E.applyAction(alone, 0, { type: 'knock', cardId: 'KC' });
        expect(errorOf(alone, 1, { type: 'finishLayoff' })).toBe('ok');
        expect([scored(alone).opponent.value, scored(alone).scores]).toEqual([29, [27, 0]]);
      },
    );

    test('the scoring constants', () => {
      expect([E.GIN_BONUS, E.UNDERCUT_BONUS, E.KNOCK_LIMIT]).toEqual([25, 25, 10]);
    });

    test('undercut: equal or lower opponent deadwood scores the difference plus 25 for the opponent', () => {
      const s = position(
        ['AS', '2S', '3S', '4H', '5H', '6H', '7D', '8D', '9D', '8C', 'KC'],
        ['10S', 'JS', 'QS', '10C', 'JC', 'QC', '2D', '3D', '4D', '5C'],
        '7C',
      );
      expect(knockWith(s, 'KC')).toEqual({ ok: true });
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
      expect(knockWith(tie, 'KC')).toEqual({ ok: true });
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
      knockWith(s, 'KC');
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
      knockWith(s, 'KC');
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

  describe('lastDrawn across a redeal (docs/MIGRATION.md step 15: the legs disagree)', () => {
    /**
     * Seed 2 leaves AS out of seat 0's hand; the redeal with seed 1 puts AS in it. `lastDrawn` is
     * set by hand, as a takeUpcard/drawStock/drawDiscard of AS in the previous hand leaves it.
     */
    const redealtWithAS = (): GinState => {
      const s = newGame(mulberry32(2), 0);
      expect(ids(hand(s, 0))).not.toContain('AS');
      s.lastDrawn = { p: 0, id: 'AS' };
      E.dealHand(s, mulberry32(1));
      expect(ids(hand(s, 0))).toContain('AS');
      expect(s.pendingDraw).toBeNull();
      expect(E.viewFor(s, 0).canUndo).toBe(false);
      return s;
    };
    type Redeal = { lastDrawn: unknown; shown: (string | null)[] };
    /** `s.lastDrawn` and both seats' `lastDrawnId` at every deal after the first of a seeded game. */
    const atRedeals = (seed: number): Redeal[] => {
      const redeals: Redeal[] = [];
      const hands = { seen: 1 };
      play(seed, (s) => {
        if (s.handNumber === hands.seen) return;
        hands.seen = s.handNumber;
        redeals.push({
          lastDrawn: s.lastDrawn,
          shown: [E.viewFor(s, 0).lastDrawnId, E.viewFor(s, 1).lastDrawnId],
        });
      });
      expect(redeals.length).toBeGreaterThan(0);
      return redeals;
    };
    /**
     * The rematch: a seeded game played to gameOver, then `ready` from both seats. `readyAfterGame`
     * redeals over the finished state, whose `lastDrawn` key exists, so the two legs disagree here
     * exactly as at a round's redeal; `before` is the finished game's last draw.
     */
    const rematch = (seed: number): { before: unknown; s: GinState } => {
      const { state: s } = play(seed);
      const before = s.lastDrawn;
      expect(before).toEqual({ p: expect.any(Number) as number, id: expect.any(String) as string });
      expect(E.applyAction(s, 0, { type: 'ready' }, mulberry32(seed)).ok).toBe(true);
      expect(E.applyAction(s, 1, { type: 'ready' }, mulberry32(seed)).ok).toBe(true);
      expect(s.handNumber).toBe(1);
      expect(s.phase).toBe('upcard');
      return { before, s };
    };

    test.runIf(leg === 'legacy')(
      'KNOWN DEFECT (lastDrawn leak), legacy only: dealHand does not reset lastDrawn, so a card drawn in the previous hand is marked "last drawn" when the redeal happens to give it back',
      () => {
        const s = redealtWithAS();
        expect(s.lastDrawn).toEqual({ p: 0, id: 'AS' });
        expect(E.viewFor(s, 0).lastDrawnId).toBe('AS');
        // Whether the leak shows is down to the shuffle: redeal without AS and it stays hidden.
        E.dealHand(s, mulberry32(2));
        expect(ids(hand(s, 0))).not.toContain('AS');
        expect(E.viewFor(s, 0).lastDrawnId).toBeNull();
        expect(s.lastDrawn).toEqual({ p: 0, id: 'AS' });
        // Through the real path (`ready` x2 or a void hand): every redeal keeps the stale draw.
        atRedeals(3).forEach(({ lastDrawn }) => {
          expect(lastDrawn).toEqual({
            p: expect.any(Number) as number,
            id: expect.any(String) as string,
          });
        });
        // The rematch too: the finished game's last draw survives into hand 1 of the next game.
        // Seed 2's deal keeps its stale QS out of sight; seed 5's hands 4C back to seat 1, who
        // sees it marked fresh.
        [2, 5].forEach((seed) => {
          const { before, s: next } = rematch(seed);
          expect(next.lastDrawn).toEqual(before);
        });
        expect(rematch(2).before).toEqual({ p: 1, id: 'QS' });
        expect(E.viewFor(rematch(2).s, 1).lastDrawnId).toBeNull();
        expect(rematch(5).before).toEqual({ p: 1, id: '4C' });
        expect(E.viewFor(rematch(5).s, 1).lastDrawnId).toBe('4C');
      },
    );

    test.runIf(leg === 'current')(
      'dealHand resets lastDrawn: the redeal that hands back the last card drawn does not mark it fresh',
      () => {
        const s = redealtWithAS();
        expect(s.lastDrawn).toBeNull();
        expect(E.viewFor(s, 0).lastDrawnId).toBeNull();
        E.dealHand(s, mulberry32(2));
        expect(s.lastDrawn).toBeNull();
        // Through the real path (`ready` x2 or a void hand): nothing is fresh right after a deal.
        [3, 4, 5].forEach((seed) => {
          atRedeals(seed).forEach(({ lastDrawn, shown }) => {
            expect(lastDrawn).toBeNull();
            expect(shown).toEqual([null, null]);
          });
        });
        // The rematch too (seed 5's deal hands the legacy's stale 4C back to seat 1).
        [2, 5].forEach((seed) => {
          const { s: next } = rematch(seed);
          expect(next.lastDrawn).toBeNull();
          expect([E.viewFor(next, 0).lastDrawnId, E.viewFor(next, 1).lastDrawnId]).toEqual([
            null,
            null,
          ]);
        });
      },
    );

    test('the first deal leaves lastDrawn absent, as the wire has it; the first draw adds the key', () => {
      const s = newGame(mulberry32(2), 0);
      expect('lastDrawn' in s).toBe(false);
      expect(E.viewFor(s, 0).lastDrawnId).toBeNull();
      expect(E.viewFor(s, 1).lastDrawnId).toBeNull();
      E.applyAction(s, 1, { type: 'takeUpcard' });
      expect(Object.keys(s).at(-1)).toBe('lastDrawn');
    });

    test('undoDraw clears lastDrawn', () => {
      const s = newGame(mulberry32(2), 0);
      E.applyAction(s, 1, { type: 'takeUpcard' });
      expect(s.lastDrawn).toEqual({ p: 1, id: hand(s, 1).at(-1)?.id });
      E.applyAction(s, 1, { type: 'undoDraw' });
      expect(s.lastDrawn).toBeNull();
    });
  });
});
