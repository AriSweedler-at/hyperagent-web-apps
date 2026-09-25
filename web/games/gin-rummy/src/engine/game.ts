// The rules (docs/MIGRATION.md step 10): ported from the legacy GinEngine block
// (test/fixtures/legacy/gin-engine.cjs); every phase transition, refusal text, score and history
// line is unchanged, test/parity/gin.legacy.test.ts and gin.replay.test.ts are the oracle, but for
// the two rules of docs/design/gin-arrangement-and-discards.md: a stock draw cannot be undone (§4,
// `undoDraw`) and a layoff follows the meld that lets more cards follow (§7, layoff.ts); both are
// pinned per leg there.
// `applyAction(state, seat, action, rng, now)` is the reducer: it returns a new State or a
// RuleError worded for the player, never mutates and never throws. Randomness and the clock are
// injected: the legacy defaulted to `Math.random` and read `Date.now()` for `startedAt` and every
// round's `ts`; both are banned here, so callers pass an `Rng` and a `Now`.
import { SEATS, otherSeat as otherPlayer, setAt } from '../../../../shared/lib/game.ts';
import { err, ok, type Result } from '../../../../shared/lib/result.ts';
import type { Rng } from '../../../../shared/lib/rng.ts';
import { makeDeck, pretty, shuffle } from './cards.ts';
import {
  bestMeldingWithLayoffs,
  canTakeBack,
  extendedMelds,
  fitsOnto,
  layoffMeldingFrom,
} from './layoff.ts';
import { meldingFromGroups } from './melds.ts';
import { bestMelding } from './melds.algorithms.ts';
import {
  DEFAULT_TARGET,
  GIN_BONUS,
  HAND_SIZE,
  KNOCK_LIMIT,
  UNDERCUT_BONUS,
  type Action,
  type Card,
  type Cards,
  type CreateGameOptions,
  type Knock,
  type LayoffEntry,
  type LayoffMelding,
  type MeldGroups,
  type Now,
  type Outcome,
  type Pair,
  type PlayerInfo,
  type PlayerState,
  type RoundRecord,
  type RuleError,
  type ScoredResult,
  type Seat,
  type State,
  type View,
} from './types.ts';
import type { Phase } from './types.ts';

type Applied = Result<State, RuleError>;

// SEATS, otherPlayer (the shared `otherSeat`) and setAt are web/shared/lib/game.ts's (DRY round 2,
// F1); otherPlayer keeps its gin name here and in the export list, since view.ts imports it.
const cardById = (cards: Cards, id: string): Card | null => cards.find((c) => c.id === id) ?? null;
const without = (cards: Cards, id: string): Cards => cards.filter((c) => c.id !== id);
const player = (p: PlayerInfo): PlayerState => ({ id: p.id, name: p.name, total: 0 });
const totalsOf = (players: Pair<PlayerState>): Pair<number> => [players[0].total, players[1].total];

/** The dealer draws from `rng` when `opts.dealer` is absent; `startedAt` is read from `now`. */
const createGame = (opts: CreateGameOptions, rng: Rng, now: Now): State => {
  const dealer: Seat = opts.dealer ?? (rng() < 0.5 ? 0 : 1);
  // `opts.target || 100` in the legacy: 0 falls back too.
  const target = opts.target === undefined || opts.target === 0 ? DEFAULT_TARGET : opts.target;
  return dealHand(
    {
      players: [player(opts.players[0]), player(opts.players[1])],
      target,
      dealer,
      turn: 0,
      phase: 'roundOver',
      hands: [[], []],
      stock: [],
      discard: [],
      upcardStage: null,
      drawnFromDiscard: null,
      forceStock: false,
      pendingDraw: null,
      meldPref: [null, null],
      lastAction: null,
      handNumber: 0,
      rounds: [],
      result: null,
      ready: [false, false],
      winner: null,
      startedAt: now(),
    },
    rng,
  );
};

/**
 * Shuffle a fresh deck and deal from its top: non-dealer, dealer, ten cards each, then the upcard;
 * the rest is the stock. Resets everything about the hand, `lastDrawn` included (docs/MIGRATION.md
 * step 15; the legacy left it alone, so a card drawn in the previous hand showed as "last drawn"
 * when the redeal happened to give it back). The key stays absent until the first draw, as on the
 * wire (types.ts), so the first deal adds nothing. The rng is consumed exactly as the legacy
 * `shuffle` did.
 */
const dealHand = (state: State, rng: Rng): State => {
  const deck = shuffle(makeDeck(), rng);
  const nonDealer = otherPlayer(state.dealer);
  const topOfStock = deck.length - 2 * HAND_SIZE - 1;
  const dealt = deck.slice(topOfStock + 1).reverse();
  const toNonDealer = dealt.filter((_, i) => i % 2 === 0);
  const toDealer = dealt.filter((_, i) => i % 2 === 1);
  const handNumber = state.handNumber + 1;
  return {
    ...state,
    ...(state.lastDrawn === undefined ? {} : { lastDrawn: null }),
    hands: setAt(setAt(state.hands, nonDealer, toNonDealer), state.dealer, toDealer),
    discard: deck.slice(topOfStock, topOfStock + 1),
    stock: deck.slice(0, topOfStock),
    turn: nonDealer,
    phase: 'upcard',
    upcardStage: 'nonDealer',
    drawnFromDiscard: null,
    forceStock: false,
    pendingDraw: null,
    meldPref: [null, null],
    handNumber,
    result: null,
    ready: [false, false],
    lastAction: {
      text: `${state.players[state.dealer].name} dealt hand ${String(handNumber)}. ${state.players[nonDealer].name} may take the upcard or pass.`,
    },
  };
};

// The phases a hand is played in, the answer to a knock included; a round over or a game over is neither.
const inPlay = (phase: Phase): boolean =>
  phase === 'upcard' || phase === 'draw' || phase === 'discard' || phase === 'layoff';

/**
 * The cards `seat` still holds as their own: while answering a knock (§7b) the cards laid off
 * stay in the hand until the round scores, so what melds and counts is the hand without them.
 */
const keptHand = (state: State, seat: Seat): Cards => {
  const k = state.knock ?? null;
  if (state.phase !== 'layoff' || k === null || seat === k.by) return state.hands[seat];
  const laid = new Set(k.laidOff.map((e) => e.cardId));
  return state.hands[seat].filter((c) => !laid.has(c.id));
};

/** The knock's layoffs with their cards, from the defender's hand. */
const laidEntries = (state: State, k: Knock): ReadonlyArray<LayoffEntry> =>
  k.laidOff.flatMap((e) => {
    const card = cardById(state.hands[otherPlayer(k.by)], e.cardId);
    return card === null ? [] : [{ card, onto: e.onto }];
  });

// Choosing how to arrange your own melds is a declaration, not a move: it is allowed any time
// during play, including while waiting for the opponent.
const setMelds = (state: State, seat: Seat, groups: MeldGroups): Applied => {
  if (!inPlay(state.phase)) return err('You can only rearrange melds during play.');
  if (state.phase === 'layoff' && state.knock?.by === seat)
    return err('Your melds are on the table.');
  const myHand = keptHand(state, seat);
  const m = meldingFromGroups(myHand, groups);
  if (!m) return err("That meld arrangement doesn't fit your hand.");
  const auto = bestMelding(myHand);
  if (m.value !== auto.value)
    return err(
      `That arrangement would leave ${String(m.value)} deadwood instead of ${String(auto.value)}.`,
    );
  return ok({
    ...state,
    meldPref: setAt(
      state.meldPref,
      seat,
      groups.map((g) => [...g]),
    ),
  });
};

/** Both ready after the game: totals cleared, a new dealer from the rng, a fresh first hand. */
const readyAfterGame = (state: State, seat: Seat, rng: Rng, now: Now): Applied => {
  const ready = setAt(state.ready, seat, true);
  if (!(ready[0] && ready[1])) return ok({ ...state, ready });
  const players: Pair<PlayerState> = [
    { ...state.players[0], total: 0 },
    { ...state.players[1], total: 0 },
  ];
  return ok(
    dealHand(
      {
        ...state,
        ready,
        players,
        rounds: [],
        winner: null,
        handNumber: 0,
        startedAt: now(),
        dealer: rng() < 0.5 ? 0 : 1,
      },
      rng,
    ),
  );
};

/**
 * Both ready after a hand: the game ends when a total has reached the target (the higher total
 * wins; at a tie, seat 0), else the loser of a scored hand deals the next (the same dealer
 * redeals a void hand).
 */
const readyAfterRound = (state: State, seat: Seat, rng: Rng): Applied => {
  const ready = setAt(state.ready, seat, true);
  if (!(ready[0] && ready[1])) return ok({ ...state, ready });
  const reached = SEATS.map((i): Readonly<{ i: Seat; t: number }> => ({
    i,
    t: state.players[i].total,
  }))
    .filter((x) => x.t >= state.target)
    .sort((a, b) => b.t - a.t);
  const top = reached[0];
  if (top !== undefined)
    return ok({
      ...state,
      phase: 'gameOver',
      lastAction: { text: `${state.players[top.i].name} wins the game!` },
      ready: [false, false],
      winner: top.i,
    });
  const r = state.result;
  const dealer = r !== null && !r.void ? r.loserIdx : state.dealer;
  return ok(dealHand({ ...state, ready, dealer }, rng));
};

/**
 * The drawn card joins the hand; what the draw changed is kept so `undoDraw` can put it back. A
 * stock draw records it too, although it can no longer be undone: `State` stays byte-identical
 * with the legacy's, and the view still reads `pendingDraw.from`.
 */
const drawn = (
  state: State,
  seat: Seat,
  c: Card,
  from: 'stock' | 'discard',
  prevPhase: 'upcard' | 'draw',
): State => ({
  ...state,
  pendingDraw: {
    from,
    cardId: c.id,
    prevPhase,
    prevUpcardStage: state.upcardStage,
    prevForceStock: state.forceStock,
    prevTurn: state.turn,
  },
  hands: setAt(state.hands, seat, [...state.hands[seat], c]),
  lastDrawn: { p: seat, id: c.id },
});

const upcardPhase = (state: State, seat: Seat, action: Action): Applied => {
  const me = state.players[seat];
  if (action.type === 'takeUpcard') {
    const c = state.discard.at(-1);
    // Unreachable: the deal always leaves an upcard (the legacy would have thrown here).
    if (c === undefined) return err('The discard pile is empty.');
    return ok({
      ...drawn({ ...state, discard: state.discard.slice(0, -1) }, seat, c, 'discard', 'upcard'),
      drawnFromDiscard: c.id,
      phase: 'discard',
      upcardStage: null,
      lastAction: { text: `${me.name} took the ${pretty(c)} upcard.`, card: c.id, by: seat },
    });
  }
  if (action.type === 'passUpcard') {
    if (state.upcardStage === 'nonDealer')
      return ok({
        ...state,
        upcardStage: 'dealer',
        turn: state.dealer,
        lastAction: {
          text: `${me.name} passed on the upcard. ${state.players[state.dealer].name} may take it or pass.`,
          by: seat,
        },
      });
    const turn = otherPlayer(state.dealer);
    return ok({
      ...state,
      upcardStage: null,
      phase: 'draw',
      turn,
      forceStock: true,
      lastAction: {
        text: `Both passed. ${state.players[turn].name} must draw from the stock.`,
        by: seat,
      },
    });
  }
  return err('Take the upcard or pass.');
};

const drawPhase = (state: State, seat: Seat, action: Action): Applied => {
  const me = state.players[seat];
  if (action.type === 'drawStock') {
    const c = state.stock.at(-1);
    // Unreachable: a discard that leaves two or fewer stock cards voids the hand first.
    if (c === undefined) return err('The stock is empty.');
    return ok({
      ...drawn({ ...state, stock: state.stock.slice(0, -1) }, seat, c, 'stock', 'draw'),
      drawnFromDiscard: null,
      forceStock: false,
      phase: 'discard',
      lastAction: { text: `${me.name} drew from the stock.`, by: seat },
    });
  }
  if (action.type === 'drawDiscard') {
    if (state.forceStock) return err('After both players pass, you must draw from the stock.');
    const c = state.discard.at(-1);
    if (c === undefined) return err('The discard pile is empty.');
    return ok({
      ...drawn({ ...state, discard: state.discard.slice(0, -1) }, seat, c, 'discard', 'draw'),
      drawnFromDiscard: c.id,
      phase: 'discard',
      lastAction: {
        text: `${me.name} took the ${pretty(c)} from the discard pile.`,
        card: c.id,
        by: seat,
      },
    });
  }
  return err('Draw a card from the stock or the discard pile.');
};

/**
 * The one refusal the legacy never had (docs/design/gin-arrangement-and-discards.md §4): a card
 * drawn from the stock is private information the ghost cell already showed, so putting it back
 * would be a free peek. A card taken from the discard pile is public, and that draw undoes as before.
 */
const STOCK_DRAW_FINAL_MSG = "You can't undo a draw from the stock.";

const undoDraw = (state: State, seat: Seat): Applied => {
  const pd = state.pendingDraw;
  if (!pd) return err('Nothing to undo.');
  if (pd.from === 'stock') return err(STOCK_DRAW_FINAL_MSG);
  const hand = state.hands[seat];
  const drawnCard = cardById(hand, pd.cardId);
  if (!drawnCard) return err('Nothing to undo.');
  return ok({
    ...state,
    hands: setAt(state.hands, seat, without(hand, drawnCard.id)),
    discard: [...state.discard, drawnCard],
    stock: state.stock,
    phase: pd.prevPhase,
    upcardStage: pd.prevUpcardStage,
    forceStock: pd.prevForceStock,
    turn: pd.prevTurn,
    drawnFromDiscard: null,
    lastDrawn: null,
    pendingDraw: null,
    lastAction: { text: `${state.players[seat].name} undid their draw.`, by: seat },
  });
};

/** Two or fewer stock cards after a discard: nobody scores and the same dealer redeals. */
const finishVoid = (state: State, now: Now): State => ({
  ...state,
  result: { void: true, ts: now(), totals: totalsOf(state.players) },
  rounds: [
    ...state.rounds,
    {
      handNumber: state.handNumber,
      ts: now(),
      void: true,
      scores: { [state.players[0].id]: 0, [state.players[1].id]: 0 },
    },
  ],
  phase: 'roundOver',
  ready: [false, false],
  lastAction: { text: 'Only two cards left in the stock — the hand is void. Same dealer redeals.' },
});

/**
 * Knock with `card` discarded and `remaining` kept. The player's chosen arrangement is honoured
 * when it still fits the kept cards and scores the same, since it decides what the opponent can
 * lay off. Gin (no deadwood) allows no layoff and scores at once (`finishKnock`): GIN_BONUS plus
 * the opponent's deadwood. Any other knock opens the `layoff` phase (§7b): the melds are laid out,
 * the turn passes to the defender, who lays off by hand and finishes, and only then does the round
 * score, with the layoffs as laid.
 */
const knock = (state: State, seat: Seat, card: Card, remaining: Cards, now: Now): Applied => {
  const me = state.players[seat];
  const opp = otherPlayer(seat);
  const autoMine = bestMelding(remaining);
  const prefGroups = state.meldPref[seat];
  const prefMine = prefGroups ? meldingFromGroups(remaining, prefGroups) : null;
  const mine = prefMine?.value === autoMine.value ? prefMine : autoMine;
  if (mine.value > KNOCK_LIMIT)
    return err(
      `You need ${String(KNOCK_LIMIT)} or fewer deadwood points to knock (you'd have ${String(mine.value)}).`,
    );
  const k: Knock = { by: seat, card: card.id, melding: mine, laidOff: [] };
  if (mine.value === 0) {
    const oppAlone = bestMelding(state.hands[opp]);
    return finishKnock(
      state,
      k,
      {
        melds: oppAlone.melds,
        laidOff: [],
        deadwood: oppAlone.deadwood,
        value: oppAlone.value,
        extendedMelds: mine.melds,
      },
      now,
    );
  }
  return ok({
    ...state,
    phase: 'layoff',
    turn: opp,
    knock: k,
    ready: [false, false],
    lastAction: {
      text: `${me.name} knocked with ${String(mine.value)}. ${state.players[opp].name} may lay off.`,
      by: seat,
    },
  });
};

/**
 * The defender's answer to a knock (§7b): lay a card off onto a meld it extends (a fourth to a set,
 * the next rank either end of a run, the meld as extended so far), take a laid card back while its
 * meld stays a meld without it, or finish, which scores the round with the layoffs as laid.
 */
const layoffPhase = (state: State, seat: Seat, action: Action, now: Now): Applied => {
  const k = state.knock ?? null;
  if (k === null) return err('No knock to answer.');
  const hand = state.hands[seat];
  const entries = laidEntries(state, k);
  const name = state.players[seat].name;
  if (action.type === 'layOff') {
    const card = cardById(hand, action.cardId);
    if (!card) return err("That card isn't in your hand.");
    if (k.laidOff.some((e) => e.cardId === card.id)) return err('That card is laid off already.');
    const meld = extendedMelds(k.melding.melds, entries)[action.onto];
    if (meld === undefined) return err('No such meld.');
    if (!fitsOnto(card, meld)) return err(`The ${pretty(card)} doesn't fit that meld.`);
    return ok({
      ...state,
      knock: { ...k, laidOff: [...k.laidOff, { cardId: card.id, onto: action.onto }] },
      lastAction: { text: `${name} laid off the ${pretty(card)}.`, by: seat },
    });
  }
  if (action.type === 'takeBack') {
    const card = cardById(hand, action.cardId);
    if (!card || !k.laidOff.some((e) => e.cardId === card.id))
      return err("That card isn't laid off.");
    if (!canTakeBack(k.melding.melds, entries, card.id))
      return err('Take back the cards laid off after it first.');
    return ok({
      ...state,
      knock: { ...k, laidOff: k.laidOff.filter((e) => e.cardId !== card.id) },
      lastAction: { text: `${name} took the ${pretty(card)} back.`, by: seat },
    });
  }
  if (action.type === 'finishLayoff')
    return finishKnock(state, k, layoffMeldingFrom(hand, k.melding.melds, entries), now);
  return err('Lay off onto the melds, take a card back, or finish.');
};

/** `state` without its `knock` key: outside the layoff phase the key is absent, as every legacy state is. */
const withoutKnock = (state: State): State => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the key is dropped by the rest
  const { knock: _answered, ...rest } = state;
  return rest;
};

/**
 * Score the knock `k` against the defender's answer `theirs`: an opponent at or under the knocker's
 * count undercuts for the difference plus UNDERCUT_BONUS; gin scores GIN_BONUS plus the opponent's
 * deadwood; a knock scores the difference. The result, the round line and the totals follow.
 */
const finishKnock = (state: State, k: Knock, theirs: LayoffMelding, now: Now): Applied => {
  const seat = k.by;
  const me = state.players[seat];
  const opp = otherPlayer(seat);
  const mine = k.melding;
  const gin = mine.value === 0;
  const outcome: Outcome = gin ? 'gin' : theirs.value <= mine.value ? 'undercut' : 'knock';
  const none: Pair<number> = [0, 0];
  const scores: Pair<number> =
    outcome === 'gin'
      ? setAt(none, seat, GIN_BONUS + theirs.value)
      : outcome === 'undercut'
        ? setAt(none, opp, mine.value - theirs.value + UNDERCUT_BONUS)
        : setAt(none, seat, theirs.value - mine.value);
  const players: Pair<PlayerState> = [
    { ...state.players[0], total: state.players[0].total + scores[0] },
    { ...state.players[1], total: state.players[1].total + scores[1] },
  ];
  const scorerIdx = scores[seat] > 0 ? seat : opp;
  const loserIdx = otherPlayer(scorerIdx);
  const ts = now();
  const result: ScoredResult = {
    void: false,
    knockerIdx: seat,
    outcome,
    knockCard: k.card,
    knocker: { melds: mine.melds, deadwood: mine.deadwood, value: mine.value },
    opponent: {
      melds: theirs.melds,
      laidOff: theirs.laidOff,
      deadwood: theirs.deadwood,
      value: theirs.value,
      extendedMelds: theirs.extendedMelds,
    },
    scores,
    scorerIdx,
    loserIdx,
    ts,
    totals: totalsOf(players),
  };
  const round: RoundRecord = {
    handNumber: state.handNumber,
    ts,
    knockerIdx: seat,
    outcome,
    deadwood: { [me.id]: mine.value, [state.players[opp].id]: theirs.value },
    scores: { [state.players[0].id]: scores[0], [state.players[1].id]: scores[1] },
  };
  const text =
    outcome === 'gin'
      ? `${me.name} went GIN!`
      : outcome === 'undercut'
        ? `${me.name} knocked but was undercut by ${state.players[opp].name}!`
        : `${me.name} knocked with ${String(mine.value)}.`;
  return ok({
    ...withoutKnock(state),
    players,
    result,
    rounds: [...state.rounds, round],
    phase: 'roundOver',
    turn: seat,
    ready: [false, false],
    lastAction: { text, by: seat },
  });
};

/**
 * The layoffs the engine used to make by itself (`bestMeldingWithLayoffs`), as the actions that
 * make them, then `finishLayoff`: what a harness, a story or a driver plays through the phase to
 * land where the automatic layoff landed. Empty outside the phase.
 */
const bestLayoffActions = (state: State): ReadonlyArray<Action> => {
  const k = state.knock ?? null;
  if (state.phase !== 'layoff' || k === null) return [];
  const theirs = bestMeldingWithLayoffs(state.hands[otherPlayer(k.by)], k.melding.melds);
  return [
    ...theirs.laidOff.map((e): Action => ({ type: 'layOff', cardId: e.card.id, onto: e.onto })),
    { type: 'finishLayoff' },
  ];
};

const discardPhase = (state: State, seat: Seat, action: Action, now: Now): Applied => {
  if (action.type === 'undoDraw') return undoDraw(state, seat);
  if (action.type !== 'discard' && action.type !== 'knock')
    return err('Discard a card, knock, or undo your draw.');
  const me = state.players[seat];
  const hand = state.hands[seat];
  const card = cardById(hand, action.cardId);
  if (!card) return err("That card isn't in your hand.");
  if (hand.length !== HAND_SIZE + 1) return err('You must draw before discarding.');
  if (card.id === state.drawnFromDiscard)
    return err("You can't discard the card you just took from the discard pile.");
  const remaining = without(hand, card.id);
  const discarded: State = {
    ...state,
    hands: setAt(state.hands, seat, remaining),
    discard: [...state.discard, card],
    drawnFromDiscard: null,
    pendingDraw: null,
  };
  if (action.type === 'knock') return knock(discarded, seat, card, remaining, now);
  const moved: State = {
    ...discarded,
    lastAction: { text: `${me.name} discarded the ${pretty(card)}.`, card: card.id, by: seat },
  };
  return ok(
    moved.stock.length <= 2
      ? finishVoid(moved, now)
      : { ...moved, turn: otherPlayer(seat), phase: 'draw' },
  );
};

/** The reducer. `rng` deals the next hand and draws the dealer; `now` stamps `startedAt` and `ts`. */
const applyAction = (state: State, seat: Seat, action: Action, rng: Rng, now: Now): Applied => {
  if (action.type === 'setMelds') return setMelds(state, seat, action.melds);
  if (state.phase === 'gameOver')
    return action.type === 'ready'
      ? readyAfterGame(state, seat, rng, now)
      : err('The game is over.');
  if (state.phase === 'roundOver')
    return action.type === 'ready'
      ? readyAfterRound(state, seat, rng)
      : err('Waiting for both players to continue.');
  if (seat !== state.turn) return err("It's not your turn.");
  switch (state.phase) {
    case 'upcard':
      return upcardPhase(state, seat, action);
    case 'draw':
      return drawPhase(state, seat, action);
    case 'discard':
      return discardPhase(state, seat, action, now);
    case 'layoff':
      return layoffPhase(state, seat, action, now);
  }
};

/**
 * Who may act (the two-seat contract's `actorOf`, DRY round 2, F1): between hands the first seat
 * not yet ready, since `ready` is the only action then and either seat may send it; otherwise the
 * turn. Gin never has nobody to act (both ready at gameOver deals the rematch), so it is never
 * null. The seeded parity policy (test/parity/gin.policy.ts `actor`) applies the same rule over
 * the legacy-shaped state.
 */
const actorOf = (state: State): Seat =>
  state.phase === 'roundOver' || state.phase === 'gameOver' ? (state.ready[0] ? 1 : 0) : state.turn;

/** Legal action list for a view (used by UI + tests), in the legacy order. */
const legalActions = (view: View): ReadonlyArray<Action> => {
  if (view.phase === 'roundOver' || view.phase === 'gameOver')
    return view.ready[view.me.idx] ? [] : [{ type: 'ready' }];
  if (!view.isMyTurn) return [];
  if (view.phase === 'layoff') {
    const lo = view.layoff;
    if (lo === undefined) return [];
    const laid = new Set(lo.laidOff.map((e) => e.card.id));
    const takeBacks = lo.laidOff.flatMap((e): ReadonlyArray<Action> =>
      canTakeBack(lo.melds, lo.laidOff, e.card.id) ? [{ type: 'takeBack', cardId: e.card.id }] : [],
    );
    const layOffs = view.me.hand
      .filter((c) => !laid.has(c.id))
      .flatMap((c): ReadonlyArray<Action> =>
        lo.extended.flatMap((m, onto): ReadonlyArray<Action> =>
          fitsOnto(c, m) ? [{ type: 'layOff', cardId: c.id, onto }] : [],
        ),
      );
    return [...takeBacks, ...layOffs, { type: 'finishLayoff' }];
  }
  if (view.phase === 'upcard') return [{ type: 'takeUpcard' }, { type: 'passUpcard' }];
  if (view.phase === 'draw')
    return !view.forceStock && view.discardTop
      ? [{ type: 'drawStock' }, { type: 'drawDiscard' }]
      : [{ type: 'drawStock' }];
  const undo: ReadonlyArray<Action> = view.canUndo ? [{ type: 'undoDraw' }] : [];
  const perCard = view.me.hand.flatMap((c): ReadonlyArray<Action> => {
    const o = view.discardOptions?.[c.id];
    // A card without an option cannot happen on the discarder's own view (the legacy threw).
    if (o === undefined || 'locked' in o) return [];
    return o.canKnock
      ? [
          { type: 'discard', cardId: c.id },
          { type: 'knock', cardId: c.id },
        ]
      : [{ type: 'discard', cardId: c.id }];
  });
  return [...undo, ...perCard];
};

export {
  inPlay,
  keptHand,
  laidEntries,
  bestLayoffActions,
  STOCK_DRAW_FINAL_MSG,
  otherPlayer,
  createGame,
  dealHand,
  applyAction,
  actorOf,
  legalActions,
};
