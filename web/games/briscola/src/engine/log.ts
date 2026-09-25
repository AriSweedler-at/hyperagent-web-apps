// The log's sentences (docs/design/briscola-rules.md D23, E6, E8, E12-E14, E18, E23): English with
// the Italian card names, every name the shell's normalised one, a four-player side read "Ari and
// Jeff" in seat order. `play` lines are `lastAction` only; the rest are log entries. Kept apart from
// the reducer so the copy can be read, and pinned, in one place.
import { cardName } from './cards.ts';
import { seatsOfSide } from './seats.ts';
import type {
  Card,
  GameResult,
  LogEntry,
  LogKind,
  Match,
  Player,
  Seat,
  SeatCount,
  Side,
} from './types.ts';

export const entry = (seat: Seat | null, kind: LogKind, text: string, at: number): LogEntry => ({
  seat,
  kind,
  text,
  at,
});

export const nameOf = (players: ReadonlyArray<Player>, seat: Seat): string =>
  players[seat]?.name ?? `Seat ${String(seat)}`;

/** E23: "Ari" at two and three players; "Ari and Jeff" (seat order) for a four-player side. */
export const sideName = (players: ReadonlyArray<Player>, n: SeatCount, side: Side): string =>
  seatsOfSide(n, side)
    .map((seat) => nameOf(players, seat))
    .join(' and ');

export const gameText = (gameNo: number): string => `Game ${String(gameNo)} begins`;

/** E4: "Ari dealt · the briscola is the sette di coppe". */
export const dealText = (dealer: string, trumpCard: Card): string =>
  `${dealer} dealt · the briscola is the ${cardName(trumpCard)}`;

/** E6: "Ari led the asso di coppe" for the first card of a trick, "Jeff played the tre di spade" after. */
export const playText = (name: string, card: Card, led: boolean): string =>
  `${name} ${led ? 'led' : 'played'} the ${cardName(card)}`;

/** E8: "Jeff took the trick · 14 points", "· briscola taken" appended when the last drawer took the trump card. */
export const trickText = (winner: string, points: number, trumpTaken: boolean): string =>
  `${winner} took the trick · ${String(points)} points${trumpTaken ? ' · briscola taken' : ''}`;

/** E14: "Ari exchanged the sette di coppe for the asso di coppe". */
export const exchangeText = (name: string, gave: Card, took: Card): string =>
  `${name} exchanged the ${cardName(gave)} for the ${cardName(took)}`;

/** The winner's figure first, then the other sides in side order: "67–53", "50–40–30". */
const scoreline = (figures: ReadonlyArray<number>, first: Side | null): string =>
  (first === null
    ? figures
    : [
        ...figures.filter((_, side) => side === first),
        ...figures.filter((_, side) => side !== first),
      ]
  )
    .map(String)
    .join('–');

/**
 * E12: "Ari wins 67–53", "Ari and Jeff win 65–55", "A draw, 60–60", "Ari wins 50–40–30", with
 * " and takes the match 2–0" ("take" for a pair) when this game decided it. The winner's figure
 * comes first, then the other sides in side order; a draw lists every side in side order.
 */
export const resultText = (
  players: ReadonlyArray<Player>,
  n: SeatCount,
  result: GameResult,
  match: Match,
  decided: boolean,
): string => {
  if (result.winner === null) return `A draw, ${scoreline(result.totals, null)}`;
  const who = sideName(players, n, result.winner);
  const plural = seatsOfSide(n, result.winner).length > 1;
  const took = decided
    ? ` and ${plural ? 'take' : 'takes'} the match ${scoreline(match.wins, result.winner)}`
    : '';
  return `${who} ${plural ? 'win' : 'wins'} ${scoreline(result.totals, result.winner)}${took}`;
};
