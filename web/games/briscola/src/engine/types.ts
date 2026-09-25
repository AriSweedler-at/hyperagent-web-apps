// Shapes of the briscola engine (docs/design/briscola-rules.md §2; rules E1-E3, E12, E13, E24).
// One N-seat engine for 2, 3 and 4 players (D1): seats are 0..n-1, play runs to the next index,
// and with four the even seats are one side (D6). Key order here is the wire and save order:
// setup.ts and apply.ts build every literal in it and decode.ts declares the fields in it, so a
// decoded value re-encodes byte for byte (E20). The player, the clock and the refusal text are
// web/shared/lib/game.ts's (the two-seat contract, DRY round 2 F1), re-exported under the names the
// modules import; `Seat` is this engine's own, four wide, so `game.ts`'s `Seat`, `Pair`, `SEATS`,
// `otherSeat` and `setAt` do not apply (index.ts says what of `TwoSeatEngine` fits).
import type { Now, Player, RuleError } from '../../../../shared/lib/game.ts';

export type { Now, Player, RuleError };

export type Suit = 'C' | 'D' | 'S' | 'B'; // coppe, denari, spade, bastoni
/** 1 asso, 2..7, 8 fante, 9 cavallo, 10 re: the indices regional Italian decks print. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
/** `id` is `LABEL[r] + s` (`AC`, `7D`, `FS`, `CB`, `RB`), the key every action and pack uses (D10). */
export type Card = Readonly<{ id: string; r: Rank; s: Suit }>;
export type Cards = ReadonlyArray<Card>;

export const RANKS: ReadonlyArray<Rank> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const LABEL: Readonly<Record<Rank, string>> = {
  1: 'A',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: 'F',
  9: 'C',
  10: 'R',
};
/** `makeDeck` order, suit-major (E1). */
export const SUITS: ReadonlyArray<Suit> = ['C', 'D', 'S', 'B'];
/** E2: asso 11, tre 10, re 4, cavallo 3, fante 2; the deck holds 120. */
export const POINTS: Readonly<Record<Rank, number>> = {
  1: 11,
  2: 0,
  3: 10,
  4: 0,
  5: 0,
  6: 0,
  7: 0,
  8: 2,
  9: 3,
  10: 4,
};
/** E3: A 3 R C F 7 6 5 4 2, high to low; strictly greater wins. The engine never compares by `r`. */
export const STRENGTH: Readonly<Record<Rank, number>> = {
  1: 10,
  2: 1,
  3: 9,
  4: 2,
  5: 3,
  6: 4,
  7: 5,
  8: 6,
  9: 7,
  10: 8,
};
export const DECK_POINTS = 120;
export const HAND_SIZE = 3;

export type Seat = 0 | 1 | 2 | 3;
export type SeatCount = 2 | 3 | 4;
/** A scoring unit: the seat itself for 2 and 3 players, `seat % 2` for 4 (E12). */
export type Side = 0 | 1 | 2;
export type GamesToWin = 1 | 2 | 3;

export const SEAT_COUNTS: ReadonlyArray<SeatCount> = [2, 3, 4];
export const GAMES_TO_WIN: ReadonlyArray<GamesToWin> = [1, 2, 3];
export const DEFAULT_GAMES_TO_WIN: GamesToWin = 2;
export const DEFAULT_REMOVED_TWO: Suit = 'C';

export type GameOptions = Readonly<{
  seatCount: SeatCount;
  /** D7, default 2 ("Best of 3"). */
  gamesToWin: GamesToWin;
  /** D5: read only when `seatCount === 3`; stored always, default coppe. */
  removedTwo: Suit;
  /** D24 / E14, default false. */
  exchange: boolean;
  /** E15, default false; stored false unless `seatCount === 2`. */
  scoperta: boolean;
  /** E16, default false; stored false unless `seatCount === 4`. */
  partnerPeek: boolean;
}>;
/**
 * `createGame`'s input: every option but the names is optional. `seatCount` is not one of them: it
 * is `players.length`, which the `Players` tuple union fixes at 2, 3 or 4 (D1: the two are equal by
 * construction, so one of them is not an input).
 */
export type CreateGameOptions = Partial<Omit<GameOptions, 'seatCount'>>;

/** Two, three or four players in seat order: the host is seat 0 (D1, E23). */
export type Players =
  | readonly [Player, Player]
  | readonly [Player, Player, Player]
  | readonly [Player, Player, Player, Player];

/** The two reserved literals are never emitted in v1 (E24): the deal and the draw resolve inside the step that causes them. */
export type Phase = 'deal' | 'trick' | 'draw' | 'over';
export type Played = Readonly<{ seat: Seat; card: Card }>;
/** The last completed trick, public in every view: what flew where and who drew (E8, E9). */
export type TrickRecord = Readonly<{
  /** 1-based. */
  no: number;
  leader: Seat;
  /** In play order, `seatCount` long. */
  cards: ReadonlyArray<Played>;
  winner: Seat;
  points: number;
  /** Draw order, the winner first; [] once the stock is out. */
  drew: ReadonlyArray<Seat>;
  /** The last drawer took the trump card. */
  trumpTaken: boolean;
}>;
/** E14, public. */
export type Exchange = Readonly<{ seat: Seat; gave: Card; took: Card }>;
/** The trick's points by class (design §4): 0, 1–9, 10–19, 20 and up (22 is the most a trick holds). */
export type ValueClass = 'pointless' | 'small' | 'big' | 'huge';
/** The class of the card that took a trick (design §4); `pip` is the 7, 6, 5, 4 or 2. */
export type WinningClass = 'asso' | 'tre' | 're' | 'cavallo' | 'fante' | 'pip';
/** What `trickFacts` reads off a complete trick (design §4, §5), stored on the `trick` event. */
export type TrickFacts = Readonly<{
  winningCard: Card;
  winningClass: WinningClass;
  /** The winning card is a trump. */
  briscola: boolean;
  /** A trump took an opponent's asso or tre of the led suit, a card that would otherwise have won. */
  steal: boolean;
  /** A trump won over another trump. */
  overtrump: boolean;
  valueClass: ValueClass;
}>;
/** `wins` per side (E13). */
export type Match = Readonly<{
  gamesToWin: GamesToWin;
  wins: ReadonlyArray<number>;
  draws: number;
}>;
/** `totals` per side (E12). */
export type GameResult = Readonly<{
  winner: Side | null;
  totals: ReadonlyArray<number>;
  draw: boolean;
}>;
export type GameRecord = Readonly<{
  gameNo: number;
  dealer: Seat;
  trump: Suit;
  winner: Side | null;
  totals: ReadonlyArray<number>;
  endedAt: number;
}>;
export const EVENT_KINDS = ['game', 'deal', 'trick', 'exchange', 'result'] as const;
/** What the engine records (E18): a play mid-trick is not an event, the trick that resolves it is. */
export type EventKind = (typeof EVENT_KINDS)[number];
/**
 * One event of the match's stream (design/briscola-sound-history §3.5, §5): `id` is its index in
 * `events`, so a painter keys a row and a cue memory on it; `seat` is who it is about (the dealer,
 * the winner, the exchanger; null for a game's opening and its result); `data` is the kind's own.
 * The sentence is not stored: log.ts's `summaryOf` and `detailOf` derive it, so sound and history
 * read the same event.
 */
type Event<K extends EventKind, D> = Readonly<{
  id: number;
  kind: K;
  seat: Seat | null;
  at: number;
  data: D;
}>;
/** D6: a later game of the match announces itself before its deal. */
export type GameData = Readonly<{ gameNo: number; dealer: Seat }>;
/** E4: the deal, and the card turned. */
export type DealData = Readonly<{ dealer: Seat; trumpCard: Card }>;
/**
 * E8 with design §4's facts: `TrickRecord` (`lastTrick`, what the settle beat animates) plus the
 * winner's side, the facts `trickFacts` reads and the seats whose carico went to another side.
 * `trumpTaken` here is the seat that took the trump card off the table, null when nobody did
 * (`TrickRecord.trumpTaken` is the flag).
 */
export type TrickData = Readonly<{
  no: number;
  leader: Seat;
  cards: ReadonlyArray<Played>;
  winner: Seat;
  winnerSide: Side;
  points: number;
  valueClass: ValueClass;
  winningCard: Card;
  winningClass: WinningClass;
  briscola: boolean;
  steal: boolean;
  overtrump: boolean;
  carichiLost: ReadonlyArray<Seat>;
  drew: ReadonlyArray<Seat>;
  trumpTaken: Seat | null;
}>;
/** E14: the exchange as `exchanges` records it. */
export type ExchangeData = Exchange;
/** E12/E13: the game's result, whether it decided the match, and the match's wins after it. */
export type ResultData = Readonly<{
  winner: Side | null;
  totals: ReadonlyArray<number>;
  draw: boolean;
  decided: boolean;
  wins: ReadonlyArray<number>;
}>;
export type GameEvent =
  | Event<'game', GameData>
  | Event<'deal', DealData>
  | Event<'trick', TrickData>
  | Event<'exchange', ExchangeData>
  | Event<'result', ResultData>;
/** The event of one kind, for a decoder or a copy function per kind. */
export type EventOf<K extends EventKind> = Extract<GameEvent, Readonly<{ kind: K }>>;

/** The host's full state (E4); `viewFor` redacts (E17). Derived, never stored: taken, tricks, the trump suit. */
export type State = Readonly<{
  /** `seatCount` long, seat order. */
  players: ReadonlyArray<Player>;
  options: GameOptions;
  /** 1-based. */
  gameNo: number;
  phase: Phase;
  dealer: Seat;
  /** Who led (or leads) the trick on the table. */
  leader: Seat;
  /** Who plays next; equals `leader` when `trick` is empty. */
  turn: Seat;
  /** The card on the table; after an exchange, the card swapped in. Its suit is the trump suit (E5). */
  trumpCard: Card;
  /** Per seat, deal order kept (the UI sorts for display). */
  hands: ReadonlyArray<Cards>;
  /** Top first; the trump card is its last element while on the table (E4). */
  stock: Cards;
  /** The trick in progress, shorter than `seatCount`. */
  trick: ReadonlyArray<Played>;
  /** Per seat, the cards taken, trick by trick. */
  piles: ReadonlyArray<Cards>;
  /** Tricks completed this game. */
  trickNo: number;
  lastTrick: TrickRecord | null;
  exchanges: ReadonlyArray<Exchange>;
  match: Match;
  /** Non-null iff `phase === 'over'`. */
  result: GameResult | null;
  /** Finished games, this one included once over. */
  games: ReadonlyArray<GameRecord>;
  /** The match's events in order, `events[i].id === i`; a game after the first opens with a `game` event. */
  events: ReadonlyArray<GameEvent>;
  startedAt: number;
  endedAt: number | null;
}>;

export const ACTION_TYPES = ['play', 'exchange', 'next'] as const;
export type Action =
  | Readonly<{ type: 'play'; cardId: string }>
  | Readonly<{ type: 'exchange' }>
  | Readonly<{ type: 'next' }>;

/** What one seat may know of another (E17): `hand` is present only under scoperta or the partner peek. */
export type SeatView = Readonly<{
  idx: Seat;
  id: string;
  name: string;
  side: Side;
  handCount: number;
  hand?: Cards;
}>;
export type View = Readonly<{
  me: Readonly<{ idx: Seat; id: string; name: string; side: Side; hand: Cards }>;
  /** The other seats in play order from me: `(me + 1) % n` first. */
  others: ReadonlyArray<SeatView>;
  players: ReadonlyArray<Player>;
  options: GameOptions;
  gameNo: number;
  phase: Phase;
  dealer: Seat;
  leader: Seat;
  turn: Seat;
  /** Null in 'over' (any seat may send `next`) and the reserved phases. */
  actor: Seat | null;
  isMyTurn: boolean;
  trumpCard: Card;
  /** `stock.length > 0`. */
  trumpOnTable: boolean;
  /** The trump card included: 34 / 30 / 28 at the deal, then multiples of n. */
  stockCount: number;
  /** Scoperta only (E15), else null. */
  stockTop: Card | null;
  trick: ReadonlyArray<Played>;
  /** My hand's ids when I am the actor in 'trick' (E6), else []. */
  legal: ReadonlyArray<string>;
  /** E14's conditions, for me, now. */
  canExchange: boolean;
  exchanges: ReadonlyArray<Exchange>;
  /** Points per seat, `pointsOf(piles[seat])` (D9). */
  taken: ReadonlyArray<number>;
  /** `piles[seat].length / n`. */
  tricks: ReadonlyArray<number>;
  /** Points per side: 2 entries for 2 and 4 players, 3 for three. */
  sides: ReadonlyArray<number>;
  trickNo: number;
  lastTrick: TrickRecord | null;
  match: Match;
  matchOver: boolean;
  result: GameResult | null;
  games: ReadonlyArray<GameRecord>;
  /** `State.events`: every event is public (the cards played, the deal's card, the exchange). */
  events: ReadonlyArray<GameEvent>;
  startedAt: number;
  endedAt: number | null;
}>;
