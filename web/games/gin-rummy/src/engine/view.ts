// The redacted per-player view (docs/MIGRATION.md step 10; docs/ARCHITECTURE.md "Module
// boundaries": `viewFor` is the only redaction). Ported from the legacy GinEngine block
// (test/fixtures/legacy/gin-engine.cjs) key for key, in the legacy order, so the parity replay can
// compare both engines' views as JSON text. A viewer sees their own hand, its melding (their
// declared arrangement when it still fits and scores the same as the solver's), every equally
// scoring arrangement to choose from, what each discard would leave, and only a count of the
// other hand.
import { idsOf } from './cards.ts';
import { inPlay, otherPlayer } from './game.ts';
import { meldSig, meldingFromGroups } from './melds.ts';
import { allOptimalMeldings, meldSolver, type MeldSolver } from './melds.algorithms.ts';
import {
  HAND_SIZE,
  KNOCK_LIMIT,
  type Arrangement,
  type Cards,
  type DiscardOption,
  type Melding,
  type PlayerState,
  type Seat,
  type State,
  type View,
} from './types.ts';

const EMPTY: Melding = { melds: [], deadwood: [], value: 0 };

/** The solver's own pick leads the options when the capped search did not list it. */
const withAuto = (
  options: ReadonlyArray<Arrangement>,
  auto: Melding,
): ReadonlyArray<Arrangement> => {
  const sig = meldSig(auto.melds);
  return options.some((o) => o.sig === sig)
    ? options
    : [{ melds: auto.melds, deadwood: auto.deadwood, value: auto.value, sig }, ...options];
};

const option = (deadwood: number): DiscardOption => ({
  deadwood,
  canKnock: deadwood <= KNOCK_LIMIT,
  isGin: deadwood === 0,
});

/** What each card's discard would leave; the card just taken from the discard pile is locked. */
const discardOptionsFor = (
  state: State,
  hand: Cards,
  solver: MeldSolver,
): Readonly<Record<string, DiscardOption>> =>
  Object.fromEntries(
    hand.map((c): readonly [string, DiscardOption] => [
      c.id,
      c.id === state.drawnFromDiscard
        ? { locked: true }
        : option(solver.value(solver.maskOf([c.id]))),
    ]),
  );

const copyPlayer = (p: PlayerState): PlayerState => ({ id: p.id, name: p.name, total: p.total });

const viewFor = (state: State, seat: Seat): View => {
  const opp = otherPlayer(seat);
  const hand = state.hands[seat];
  const solver = hand.length > 0 ? meldSolver(hand) : null;
  const autoBest = solver ? solver.melding(0) : EMPTY;
  // Honour the player's chosen arrangement while it still fits and scores the same.
  const prefGroups = state.meldPref[seat];
  const prefMelding = prefGroups && hand.length > 0 ? meldingFromGroups(hand, prefGroups) : null;
  const melding = prefMelding?.value === autoBest.value ? prefMelding : autoBest;
  const meldOptions =
    inPlay(state.phase) && hand.length > 0 ? withAuto(allOptimalMeldings(hand, 12), autoBest) : [];
  const discarding =
    state.phase === 'discard' && state.turn === seat && hand.length === HAND_SIZE + 1;
  const discardOptions =
    discarding && solver !== null ? discardOptionsFor(state, hand, solver) : null;
  const lastDrawn = state.lastDrawn;
  const me = state.players[seat];
  const other = state.players[opp];
  return {
    me: {
      idx: seat,
      id: me.id,
      name: me.name,
      total: me.total,
      hand,
      melds: melding.melds,
      deadwood: melding.deadwood,
      deadwoodValue: melding.value,
    },
    opp: {
      idx: opp,
      id: other.id,
      name: other.name,
      total: other.total,
      cardCount: state.hands[opp].length,
    },
    players: [copyPlayer(state.players[0]), copyPlayer(state.players[1])],
    phase: state.phase,
    turn: state.turn,
    isMyTurn: state.turn === seat,
    dealer: state.dealer,
    upcardStage: state.upcardStage,
    stockCount: state.stock.length,
    discardTop: state.discard.at(-1) ?? null,
    discardCount: state.discard.length,
    drawnFromDiscard: state.drawnFromDiscard,
    forceStock: state.forceStock,
    lastAction: state.lastAction,
    handNumber: state.handNumber,
    target: state.target,
    rounds: state.rounds,
    result: state.result,
    ready: state.ready,
    winner: state.winner,
    startedAt: state.startedAt,
    discardOptions,
    lastDrawnId:
      lastDrawn?.p === seat && hand.some((c) => c.id === lastDrawn.id) ? lastDrawn.id : null,
    // Only a draw from the discard pile undoes (docs/design/gin-arrangement-and-discards.md §4).
    canUndo:
      state.phase === 'discard' && state.turn === seat && state.pendingDraw?.from === 'discard',
    meldOptions,
    activeMeldSig: meldSig(melding.melds),
    knockLimit: KNOCK_LIMIT,
    discardIds: idsOf(state.discard),
  };
};

export { viewFor };
