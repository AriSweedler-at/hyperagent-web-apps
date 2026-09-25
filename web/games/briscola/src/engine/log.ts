// The copy of the event stream (docs/design/briscola-rules.md D23, E6, E8, E12-E14, E18, E23):
// English with the Italian card names, every name the shell's normalised one, a four-player side
// read "Ari and Jeff" in seat order. Nothing here is stored: `summaryOf(event, players, n)` is a
// history row's one line and `detailOf` its expanded label/value pairs, both derived from the
// same event the sounds read (design/briscola-sound-history §3.5, §5), so the copy can be read,
// and pinned, in one place. `playText` serves the status line over `lastPlayed` (E6). Kept apart
// from the reducer, which stores facts, not sentences.
import { cardName, isCarico } from './cards.ts';
import { nextSeat, seatsOfSide, sideList, sideOf } from './seats.ts';
import {
  STRENGTH,
  type Card,
  type GameEvent,
  type Played,
  type Player,
  type ResultData,
  type Seat,
  type SeatCount,
  type Side,
  type TrickData,
} from './types.ts';

/** A history row's expanded lines: label, value; the labels repeat ("Then", "Lost") where the trick does. */
export type Detail = ReadonlyArray<readonly [label: string, value: string]>;

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

/**
 * E8: "Jeff took the trick · 14 points", "· stolen with a briscola" appended when a trump took an
 * opponent's carico of the led suit, "· briscola taken" when the last drawer took the trump card.
 */
export const trickText = (
  winner: string,
  points: number,
  steal: boolean,
  trumpTaken: boolean,
): string =>
  `${winner} took the trick · ${String(points)} points${steal ? ' · stolen with a briscola' : ''}${
    trumpTaken ? ' · briscola taken' : ''
  }`;

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
  result: ResultData,
): string => {
  if (result.winner === null) return `A draw, ${scoreline(result.totals, null)}`;
  const who = sideName(players, n, result.winner);
  const plural = seatsOfSide(n, result.winner).length > 1;
  const took = result.decided
    ? ` and ${plural ? 'take' : 'takes'} the match ${scoreline(result.wins, result.winner)}`
    : '';
  return `${who} ${plural ? 'win' : 'wins'} ${scoreline(result.totals, result.winner)}${took}`;
};

/** The history row's line, by kind (E18). */
export const summaryOf = (
  event: GameEvent,
  players: ReadonlyArray<Player>,
  n: SeatCount,
): string => {
  switch (event.kind) {
    case 'game':
      return gameText(event.data.gameNo);
    case 'deal':
      return dealText(nameOf(players, event.data.dealer), event.data.trumpCard);
    case 'trick':
      return trickText(
        nameOf(players, event.data.winner),
        event.data.points,
        event.data.steal,
        event.data.trumpTaken !== null,
      );
    case 'exchange':
      return exchangeText(nameOf(players, event.data.seat), event.data.gave, event.data.took);
    case 'result':
      return resultText(players, n, event.data);
  }
};

const listNames = (players: ReadonlyArray<Player>, seats: ReadonlyArray<Seat>): string =>
  seats.map((seat) => nameOf(players, seat)).join(', ');

/** The trump suit a trick's detail can name: a trump was played iff a trump won (E7). */
const trumpOf = (trick: TrickData): string | null => (trick.briscola ? trick.winningCard.s : null);

/** "Ari · asso di coppe", "Jeff · due di bastoni (briscola)". */
const playLine = (players: ReadonlyArray<Player>, trick: TrickData, p: Played): string =>
  `${nameOf(players, p.seat)} · ${cardName(p.card)}${p.card.s === trumpOf(trick) ? ' (briscola)' : ''}`;

/**
 * The card the winner beat: the strongest of the others by E7's order (a trump, then the led suit
 * by STRENGTH); null when none of them contended (every other card was of a third suit).
 */
const runnerUp = (trick: TrickData): Card | null => {
  const led = trick.cards[0]?.card.s;
  const trump = trumpOf(trick);
  const power = (c: Card): number =>
    c.s === trump ? 20 + STRENGTH[c.r] : c.s === led ? STRENGTH[c.r] : 0;
  const best = trick.cards
    .map((p) => p.card)
    .filter((c) => c.id !== trick.winningCard.id)
    .reduce<Card | null>((b, c) => (b === null || power(c) > power(b) ? c : b), null);
  return best !== null && power(best) > 0 ? best : null;
};

/** E8's expanded row: every card in play order, who beat what, the points, the carichi that changed sides, the draw. */
const trickDetail = (players: ReadonlyArray<Player>, n: SeatCount, trick: TrickData): Detail => {
  const led = trick.cards[0]?.card.s;
  const beaten = runnerUp(trick);
  const stolenFrom = trick.cards
    .filter((p) => p.card.s === led && isCarico(p.card) && sideOf(n, p.seat) !== trick.winnerSide)
    .map((p) => p.seat);
  return [
    ...trick.cards.map((p, i) => [i === 0 ? 'Led' : 'Then', playLine(players, trick, p)] as const),
    [
      'Won by',
      beaten === null
        ? cardName(trick.winningCard)
        : `${cardName(trick.winningCard)} over the ${cardName(beaten)}`,
    ],
    ['Points', String(trick.points)],
    ...(trick.steal ? [['Stolen from', listNames(players, stolenFrom)] as const] : []),
    ...trick.carichiLost.map(
      (seat) =>
        [
          'Lost',
          listNames(players, [seat]) +
            trick.cards
              .filter((p) => p.seat === seat && isCarico(p.card))
              .map((p) => ` · ${cardName(p.card)}`)
              .join(''),
        ] as const,
    ),
    ...(trick.drew.length > 0 ? [['Drew', listNames(players, trick.drew)] as const] : []),
    ...(trick.trumpTaken === null
      ? []
      : [['Briscola taken by', nameOf(players, trick.trumpTaken)] as const]),
  ];
};

/** The history row's expanded lines, by kind; the summary alone says the rest. */
export const detailOf = (
  event: GameEvent,
  players: ReadonlyArray<Player>,
  n: SeatCount,
): Detail => {
  switch (event.kind) {
    case 'game':
      return [['Dealer', nameOf(players, event.data.dealer)]];
    case 'deal':
      return [
        ['Dealer', nameOf(players, event.data.dealer)],
        ['Briscola', cardName(event.data.trumpCard)],
        ['Leads', nameOf(players, nextSeat(n, event.data.dealer))],
      ];
    case 'trick':
      return trickDetail(players, n, event.data);
    case 'exchange':
      return [
        ['Gave', cardName(event.data.gave)],
        ['Took', cardName(event.data.took)],
      ];
    case 'result':
      return [
        ...sideList(n).map(
          (side) => [sideName(players, n, side), String(event.data.totals[side] ?? 0)] as const,
        ),
        [
          'Match',
          sideList(n)
            .map((side) => `${sideName(players, n, side)} ${String(event.data.wins[side] ?? 0)}`)
            .join(' · '),
        ],
      ];
  }
};
