// The per-seat view (docs/design/briscola-rules.md D9, D21, E15-E17): `viewFor(state, seat)` is
// the only redaction. It carries the viewer's own hand, every other seat as a count (its hand too
// under scoperta, or the partner's once the stock is out under the partner peek), the trick, the
// trump card, the stock's count (and its top card under scoperta), the running score per seat and
// per side, the last trick and the events; never `piles`, never `stock`. `legal` is filled for the
// actor alone. `others` runs in play order from the viewer so a painter seats them without
// arithmetic. The literal is built in types.ts's key order so a `state` frame re-encodes byte for
// byte.
import { actorOf, canExchange } from './apply.ts';
import { idsOf } from './cards.ts';
import { matchOver, sideTotals, takenOf, tricksOf } from './score.ts';
import { seatsFrom, sideOf } from './seats.ts';
import type { Action, Cards, Played, Player, Seat, SeatView, State, View } from './types.ts';

const NOBODY: Player = { id: '', name: '' };

/** The player at `seat`; a seat outside the table (never asked for) reads as nobody. */
const playerAt = (state: State, seat: Seat): Player => state.players[seat] ?? NOBODY;
const handAt = (state: State, seat: Seat): Cards => state.hands[seat] ?? [];

/** E15/E16: whether `viewer` may see `other`'s cards now. */
const revealed = (state: State, viewer: Seat, other: Seat): boolean => {
  const n = state.options.seatCount;
  return (
    state.options.scoperta ||
    (state.options.partnerPeek &&
      state.stock.length === 0 &&
      sideOf(n, viewer) === sideOf(n, other) &&
      viewer !== other)
  );
};

const seatView = (state: State, viewer: Seat, other: Seat): SeatView => {
  const player = playerAt(state, other);
  const hand = handAt(state, other);
  const base = {
    idx: other,
    id: player.id,
    name: player.name,
    side: sideOf(state.options.seatCount, other),
    handCount: hand.length,
  };
  return revealed(state, viewer, other) ? { ...base, hand } : base;
};

export const viewFor = (state: State, seat: Seat): View => {
  const n = state.options.seatCount;
  const actor = actorOf(state);
  const isMyTurn = actor === seat;
  const me = playerAt(state, seat);
  const hand = handAt(state, seat);
  const [top] = state.stock;
  return {
    me: { idx: seat, id: me.id, name: me.name, side: sideOf(n, seat), hand },
    others: seatsFrom(n, seat)
      .slice(1)
      .map((other) => seatView(state, seat, other)),
    players: state.players,
    options: state.options,
    gameNo: state.gameNo,
    phase: state.phase,
    dealer: state.dealer,
    leader: state.leader,
    turn: state.turn,
    actor,
    isMyTurn,
    trumpCard: state.trumpCard,
    trumpOnTable: state.stock.length > 0,
    stockCount: state.stock.length,
    // E15: the top of the stock is public under scoperta; when only the trump card is left it is public anyway.
    stockTop: state.options.scoperta && state.stock.length > 1 && top !== undefined ? top : null,
    trick: state.trick,
    legal: isMyTurn ? idsOf(hand) : [],
    canExchange: canExchange(state, seat),
    exchanges: state.exchanges,
    taken: takenOf(state.piles),
    tricks: tricksOf(n, state.piles),
    sides: sideTotals(n, state.piles),
    trickNo: state.trickNo,
    lastTrick: state.lastTrick,
    match: state.match,
    matchOver: matchOver(state.match),
    result: state.result,
    games: state.games,
    events: state.events,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
  };
};

/**
 * E6: the card played last, for the status line ("Ari led the asso di coppe", `playText`): the last
 * of the trick on the table, else the last of the trick just taken; null after a deal. Derived, so
 * neither the state nor the wire carries it.
 */
export const lastPlayed = (game: Pick<State, 'trick' | 'lastTrick'>): Played | null =>
  game.trick.at(-1) ?? game.lastTrick?.cards.at(-1) ?? null;

/** Every action the viewer may send now (the replay policy and the `__briscola.legal()` hook use it). */
export const legalActions = (view: View): ReadonlyArray<Action> => {
  if (view.phase === 'over') return view.matchOver ? [] : [{ type: 'next' }];
  if (!view.isMyTurn) return [];
  const plays: ReadonlyArray<Action> = view.legal.map((cardId) => ({ type: 'play', cardId }));
  return view.canExchange ? [...plays, { type: 'exchange' }] : plays;
};
