// Seat and side arithmetic (docs/design/briscola-rules.md D1, D6, E12, E17): seats are 0..n-1 and
// play runs to the next index; a side is the scoring unit, the seat itself at two and three
// players and `seat % 2` at four (seats 0+2 against 1+3, partners opposite). Every list a rule
// walks in play order starts here, so the deal, the draw and `others` agree on the direction.
import type { Seat, SeatCount, Side } from './types.ts';

const SEATS: ReadonlyArray<Seat> = [0, 1, 2, 3];

/** The seats at an n-player table, in seat order. */
export const seatsOf = (n: SeatCount): ReadonlyArray<Seat> => SEATS.slice(0, n);

/** The seat after `seat` in play order; the cast is safe because `% n` stays below 4. */
export const nextSeat = (n: SeatCount, seat: Seat): Seat => ((seat + 1) % n) as Seat;

/** The n seats in play order starting at `from`: `from, from + 1, …` around the table. */
export const seatsFrom = (n: SeatCount, from: Seat): ReadonlyArray<Seat> =>
  seatsOf(n).map((_, k) => ((from + k) % n) as Seat);

/** E12: the seat itself for 2 and 3 players, `seat % 2` for four. */
export const sideOf = (n: SeatCount, seat: Seat): Side =>
  // The cast is safe: below four players a seat is 0..2, and `% 2` is 0 or 1.
  (n === 4 ? seat % 2 : seat) as Side;

/** How many sides score: 3 at three players, 2 otherwise. */
export const sidesOf = (n: SeatCount): 2 | 3 => (n === 3 ? 3 : 2);

/** The sides at an n-player table, in side order. */
export const sideList = (n: SeatCount): ReadonlyArray<Side> =>
  (SEATS as ReadonlyArray<Side>).slice(0, sidesOf(n));

/** The seats of `side`, in seat order (`[side, side + 2]` at four players). */
export const seatsOfSide = (n: SeatCount, side: Side): ReadonlyArray<Seat> =>
  seatsOf(n).filter((seat) => sideOf(n, seat) === side);
