// Seat and side arithmetic (docs/design/briscola-rules.md D1, D6, E12, E17): seats are 0..n-1 and
// play runs to the next index; a side is the scoring unit, the seat itself at every count (the
// owner, 2026-09-25: "When we play 4 player, there are no teams. It is just a free for all. That is
// the Lavi way"; the partnership `seat % 2` of D6 is a future mode, kept out of the arithmetic
// rather than behind a flag). Every list a rule walks in play order starts here, so the deal, the
// draw and `others` agree on the direction.
import type { Seat, SeatCount, Side } from './types.ts';

const SEATS: ReadonlyArray<Seat> = [0, 1, 2, 3];

/** The seats at an n-player table, in seat order. */
export const seatsOf = (n: SeatCount): ReadonlyArray<Seat> => SEATS.slice(0, n);

/** The seat after `seat` in play order; the cast is safe because `% n` stays below 4. */
export const nextSeat = (n: SeatCount, seat: Seat): Seat => ((seat + 1) % n) as Seat;

/** The n seats in play order starting at `from`: `from, from + 1, …` around the table. */
export const seatsFrom = (n: SeatCount, from: Seat): ReadonlyArray<Seat> =>
  seatsOf(n).map((_, k) => ((from + k) % n) as Seat);

/** E12: the seat itself at every count (a free-for-all at four; `n` is kept for the day teams return). */
export const sideOf = (_n: SeatCount, seat: Seat): Side => seat;

/** How many sides score: one per seat. */
export const sidesOf = (n: SeatCount): SeatCount => n;

/** The sides at an n-player table, in side order. */
export const sideList = (n: SeatCount): ReadonlyArray<Side> =>
  (SEATS as ReadonlyArray<Side>).slice(0, sidesOf(n));

/** The seats of `side`, in seat order: the one seat. */
export const seatsOfSide = (n: SeatCount, side: Side): ReadonlyArray<Seat> =>
  seatsOf(n).filter((seat) => sideOf(n, seat) === side);
