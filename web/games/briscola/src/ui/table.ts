// The table's pure builders (docs/design/briscola.md §5.2 "The DOM", §5.5, §5.6, §5.7): the markup
// strings the painter writes into the keyed containers of `#tableScreen`, the keys that say when a
// container must be rebuilt, and the small copy the containers carry (the lead cue, the stock
// label, the game badge, the last trick's line). Everything is a function of a `View`'s parts, a
// few UI facts (the kept slots, the lifted card, the taking seat) and the chosen card pack, tested
// as strings like backgammon's ui/board.ts. It imports the engine and the shared card packs only:
// the reducer imports this module, never the reverse, and the DOM is the painter's.
//
// Faces and backs come only through the shared packs (web/shared/ui/cardFace.ts, D11): a face is
// `faceHtml(resolveFace(pack, 'italian40', id))`, so any pack that draws `italian40` paints here
// unchanged; a card the pack has no picture for is the glyph, and a pack with no back takes the
// deck default's (`resolveBack`, the painter's `--back`). `faceHtml` owns the card's opening tag,
// so the hand's button semantics (`role`, `tabindex`, `aria-label`, `aria-pressed`, §5.5) sit on
// the `.slot` that holds the card, and a fan card's `data-seat` (§5.6 `#trick .card[data-seat]`)
// is written into that tag by `withDataSeat`, the one attribute a face never carries itself.
// Names are the shell's normalised ones but are escaped anyway: a name is a player's text.
import { DECKS } from '../../../../shared/lib/cards/decks.ts';
import type { CardPack } from '../../../../shared/lib/cards/packs.ts';
import { resolveFace } from '../../../../shared/lib/cards/resolve.ts';
import { escapeHtml } from '../../../../shared/edge/dom.ts';
import { backHtml, faceHtml } from '../../../../shared/ui/cardFace.ts';
import {
  SUIT_NAME,
  cardById,
  nameOf,
  seatsOfSide,
  sideList,
  type Card,
  type Cards,
  type GamesToWin,
  type Match,
  type Played,
  type Player,
  type Seat,
  type SeatCount,
  type Suit,
  type TrickRecord,
  type View,
} from '../engine/index.ts';

/** The deck kind every briscola pack must draw (D10). */
export const DECK_KIND = 'italian40' as const;

// ---- cards -----------------------------------------------------------------------------------------

const ITALIAN = DECKS[DECK_KIND];

/** The English rank for an accessible label (§5.5): the figures keep their Italian names. */
const RANK_EN: Readonly<Record<number, string>> = {
  1: 'Ace',
  8: 'Fante',
  9: 'Cavallo',
  10: 'Re',
};

/** "7 of cups", "Re of swords", "Cavallo of coins", "Ace of batons" (§5.5). */
export const cardLabelEn = (card: Card): string =>
  `${RANK_EN[card.r] ?? String(card.r)} of ${ITALIAN.suits.find((s) => s.id === card.s)?.english ?? SUIT_NAME[card.s]}`;

/**
 * A face-up card through the pack, `extra` classes appended (`mid`, `tiny`, `selected`,
 * `playable`, `taking`); an id outside the deck (never on the wire) paints a back so a bug shows
 * as a back, not a crash.
 */
export const cardHtml = (pack: CardPack, id: string, extra = ''): string => {
  const spec = resolveFace(pack, DECK_KIND, id);
  return spec === null ? backHtml(extra) : faceHtml(spec, extra === '' ? {} : { extra });
};

/** `data-seat` written into the card's opening tag: the one attribute `faceHtml` cannot carry. */
export const withDataSeat = (markup: string, seat: Seat): string =>
  markup.replace(/^<div /, `<div data-seat="${String(seat)}" `);

const classes = (...names: ReadonlyArray<string>): string =>
  names.filter((n) => n !== '').join(' ');

// ---- the seats' frame (§5 perspective, §5.2 `seatCells`) -------------------------------------------

export type RelativeCell = 'R1' | 'R2' | 'R3';
export type SeatCells = Readonly<Record<RelativeCell, Seat | null>>;

/**
 * Which absolute seat each relative cell shows for `me` at an n-player table: r1 (plays after me)
 * at the right, r2 across the top (my partner at four), r3 at the left; at two the one opponent
 * sits across the top, at three the two sit left and right.
 */
export const seatCells = (n: SeatCount, me: Seat): SeatCells => {
  const at = (k: number): Seat => ((me + k) % n) as Seat;
  switch (n) {
    case 2:
      return { R1: null, R2: at(1), R3: null };
    case 3:
      return { R1: at(1), R2: null, R3: at(2) };
    case 4:
      return { R1: at(1), R2: at(2), R3: at(3) };
  }
};

/** The relative cell a seat sits in for `me`, or null for my own seat. */
export const cellOfSeat = (n: SeatCount, me: Seat, seat: Seat): RelativeCell | null => {
  const cells = seatCells(n, me);
  return (['R1', 'R2', 'R3'] as ReadonlyArray<RelativeCell>).find((c) => cells[c] === seat) ?? null;
};

/** The id of a relative cell's element: `seatR1`, `seatR2`, `seatR3`. */
export const seatCellId = (cell: RelativeCell): string => `seat${cell}`;

// ---- the hand (§5.2 `#hand`, §5.4 `slots`, §5.5) ---------------------------------------------------

/** The hand's three cells: an id where a card sits, null where one went (`settleSlots` keeps it). */
export type HandSlots = ReadonlyArray<string | null>;

export type HandOptions = Readonly<{
  /** The lifted card (§5.4 "lift then play"), or none. */
  selected: string | null;
  /** `view.legal`: my cards while I am the actor, else []. */
  playable: ReadonlyArray<string>;
  /** Under the curtain the held cards paint as backs (`#hand.hidden-cards`, D17). */
  faceDown?: boolean;
}>;

const EMPTY_MARK = '∅';

/** `#hand`'s key: the three slots' ids (`∅` where empty), the pack, and whether the cards are down. */
export const handKey = (slots: HandSlots, packName: string, faceDown = false): string =>
  `${slots.map((id) => id ?? EMPTY_MARK).join(',')}|${packName}${faceDown ? '|down' : ''}`;

/** The slot's accessible label: what the card is, and what a tap does now (§5.5). */
export const slotLabel = (card: Card, state: 'play' | 'lifted' | null): string =>
  state === null ? cardLabelEn(card) : `${cardLabelEn(card)}, ${state}`;

const slotHtml = (pack: CardPack, id: string | null, o: HandOptions): string => {
  const card = id === null ? null : cardById(id);
  if (id === null || card === null) return '<div class="slot empty"></div>';
  if (o.faceDown === true) return `<div class="slot">${backHtml()}</div>`;
  const selected = o.selected === id;
  const playable = o.playable.includes(id);
  const button = selected || playable;
  const label = slotLabel(card, selected ? 'lifted' : playable ? 'play' : null);
  const attrs = button
    ? ` role="button" tabindex="0" aria-pressed="${selected ? 'true' : 'false'}"`
    : '';
  return `<div class="slot"${attrs} aria-label="${escapeHtml(label)}">${cardHtml(
    pack,
    id,
    classes(selected ? 'selected' : '', playable ? 'playable' : ''),
  )}</div>`;
};

/**
 * Exactly three `.slot`s (`#hand[data-slots="3"]`), so a played card's slot stays where it was
 * and the other two never move; `.slot.empty` where a card went, a long card in each held slot.
 * `selected` and `playable` are painted here for a fresh build and toggled by the painter
 * outside the key after (a lift never rebuilds the hand).
 */
export const handHtml = (pack: CardPack, slots: HandSlots, o: HandOptions): string =>
  [0, 1, 2].map((i) => slotHtml(pack, slots[i] ?? null, o)).join('');

/**
 * The kept picture of the hand (§5.4 `settleSlots`): a card that left leaves a hole, a card that
 * arrived fills the first hole; a hand that does not fit the picture (a deal, a resume, `setup`)
 * fills left to right.
 */
export const settleSlots = (prev: HandSlots, hand: Cards): HandSlots => {
  const ids = hand.map((c) => c.id);
  const kept = [0, 1, 2].map((i) => {
    const id = prev[i] ?? null;
    return id !== null && ids.includes(id) ? id : null;
  });
  const arrived = ids.filter((id) => !kept.includes(id));
  const fits = arrived.length <= kept.filter((id) => id === null).length;
  if (!fits) return [0, 1, 2].map((i) => ids[i] ?? null);
  return kept.reduce<Readonly<{ slots: HandSlots; rest: ReadonlyArray<string> }>>(
    (acc, id) =>
      id !== null
        ? { slots: [...acc.slots, id], rest: acc.rest }
        : { slots: [...acc.slots, acc.rest[0] ?? null], rest: acc.rest.slice(1) },
    { slots: [], rest: arrived },
  ).slots;
};

// ---- the trick (§5.2 `#trick`, §5.3 the fan) -------------------------------------------------------

export type TrickOptions = Readonly<{
  players: ReadonlyArray<Player>;
  me: Seat;
  pack: CardPack;
  /** The seat whose card is taking the trick (`.taking`, the hold of the settle beat), or none. */
  taking: Seat | null;
}>;

/** "You" for my seat, else the seat's name. */
export const whoName = (players: ReadonlyArray<Player>, me: Seat, seat: Seat): string =>
  seat === me ? 'You' : nameOf(players, seat);

/** `#trick`'s key: `seat:card` pairs in play order (a play changes exactly this and the hand's). */
export const trickKey = (trick: ReadonlyArray<Played>): string =>
  trick.map((p) => `${String(p.seat)}:${p.card.id}`).join(',');

/** `#trick::before`'s cue while the trick is empty (`data-cue`): "You lead" / "Bob leads". */
export const leadCue = (players: ReadonlyArray<Player>, me: Seat, leader: Seat): string =>
  leader === me ? 'You lead' : `${nameOf(players, leader)} leads`;

const playHtml = (o: TrickOptions, p: Played, i: number): string => {
  const who = whoName(o.players, o.me, p.seat);
  const label = `${cardLabelEn(p.card)}, played by ${p.seat === o.me ? 'you' : who}`;
  return `<div class="play" role="group" aria-label="${escapeHtml(label)}" style="--i:${String(i)}">${withDataSeat(
    cardHtml(o.pack, p.card.id, classes('mid', p.seat === o.taking ? 'taking' : '')),
    p.seat,
  )}<span class="who">${escapeHtml(who)}</span></div>`;
};

/**
 * The fan in play order, the leader's card first: each play is a `.play` column (`--i` for the
 * CSS's z-order, overlap and tilt) holding the `mid` face with `data-seat` and a `.who` chip
 * beneath; the taking card wears `taking`.
 */
export const trickHtml = (trick: ReadonlyArray<Played>, o: TrickOptions): string =>
  trick.map((p, i) => playHtml(o, p, i)).join('');

// ---- the seats (§5.2 `paintSeats`) ---------------------------------------------------------------------

/** What one relative cell shows of a seat; `hand` only under scoperta or the partner peek (E15/E16). */
export type SeatCell = Readonly<{
  name: string;
  handCount: number;
  hand: Cards | null;
  tricks: number;
  /** Online: whether the seat's channel is open; null for a local seat (the dot hides). */
  connected: boolean | null;
  /** The dot's id where a page fixes one (`SHELL.briscola.connDot`, `#oppDot` in the 2-player cell). */
  dotId?: string;
}>;

/** "2 tricks", "1 trick", nothing at 0 (the stack the flights land on is still there). */
export const tricksText = (tricks: number): string =>
  tricks === 0 ? '' : tricks === 1 ? '1 trick' : `${String(tricks)} tricks`;

/** One tiny back per card held, or tiny faces where the hand is shown. */
export const seatCardsHtml = (
  pack: CardPack,
  cell: Pick<SeatCell, 'handCount' | 'hand'>,
): string =>
  cell.hand === null
    ? Array.from({ length: cell.handCount }, () => backHtml('tiny')).join('')
    : cell.hand.map((c) => cardHtml(pack, c.id, 'tiny')).join('');

/** The cell's key: name, what is held (ids where shown), the trick count, the dot's state and the pack. */
export const seatKey = (cell: SeatCell, packName: string): string =>
  `${cell.name}|${cell.hand === null ? String(cell.handCount) : cell.hand.map((c) => c.id).join(',')}|${String(cell.tricks)}|${cell.connected === null ? '-' : cell.connected ? 'on' : 'off'}|${packName}`;

/**
 * The inside of a `.seat` cell: the name, the held cards, the taken stack (`.seat-taken
 * [data-count]`, where a won trick flies to) and the connection dot (`on`/`off`, hidden for a local
 * seat). The cell's own marks (`hidden`, `data-seat`, `to-move`, `gone`) are the painter's toggles.
 */
export const seatHtml = (pack: CardPack, cell: SeatCell): string => {
  const dot =
    cell.connected === null
      ? '<span class="conn-dot" hidden></span>'
      : `<span class="conn-dot ${cell.connected ? 'on' : 'off'}"></span>`;
  const dotWithId =
    cell.dotId === undefined ? dot : dot.replace('<span ', `<span id="${cell.dotId}" `);
  return `<span class="seat-name">${escapeHtml(cell.name)}</span><span class="seat-cards">${seatCardsHtml(pack, cell)}</span><span class="seat-taken" data-count="${String(cell.tricks)}">${tricksText(cell.tricks)}</span>${dotWithId}`;
};

// ---- the stock and the briscola (§5.2 `.stock-area`, T3) ----------------------------------------------

/** "Stock · 34" (`#stockCount`; the count includes the trump card while it lies on the table). */
export const stockLabel = (count: number): string => `Stock · ${String(count)}`;

/** `#stock`'s key: the count, and the top card where scoperta shows it. */
export const stockKey = (count: number, top: Card | null): string =>
  `${String(count)}:${top?.id ?? ''}`;

/**
 * The inside of `#stock`: a `mid` back while cards lie over the trump card (the top card's face
 * under scoperta, E15), nothing once only the trump card is left (`#stock.empty`, the painter's
 * dashed outline) or the stock is out.
 */
export const stockHtml = (pack: CardPack, count: number, top: Card | null): string =>
  count <= 1 ? '' : top === null ? backHtml('mid') : cardHtml(pack, top.id, 'mid');

/**
 * The inside of `#briscola`: the trump card as a `mid` face, laid across under the stock by the
 * CSS; `gone` (its box kept) and `tappable` (E14) are the painter's toggles. Keyed by the card's id.
 */
export const briscolaHtml = (pack: CardPack, trumpCard: Card): string =>
  cardHtml(pack, trumpCard.id, 'mid');

export type TrumpBadge = Readonly<{
  /** `s-coppe`: the suit mark's class (§5.7 `s-${suit}` over the Italian name). */
  cls: string;
  /** "coppe": `#trumpName`. */
  name: string;
  /** "Briscola: cups": the badge's `aria-label` (§5.5, English). */
  aria: string;
}>;

export const trumpBadge = (suit: Suit): TrumpBadge => ({
  cls: `s-${SUIT_NAME[suit]}`,
  name: SUIT_NAME[suit],
  aria: `Briscola: ${ITALIAN.suits.find((s) => s.id === suit)?.english ?? SUIT_NAME[suit]}`,
});

// ---- the score strip and the game badge (D9, §5.2 `#scoreStrip`, `#gameBadge`) -------------------------

export type ScoreMode = 'players' | 'teams';
export type ScoreCell = Readonly<{
  name: string;
  points: number;
  tricks: number;
  mine: boolean;
  leading: boolean;
}>;

/** Per player at two and three, per team at four (`#scoreStrip[data-mode]`). */
export const scoreMode = (n: SeatCount): ScoreMode => (n === 4 ? 'teams' : 'players');

type ScoreSource = Pick<View, 'players' | 'options' | 'taken' | 'tricks' | 'sides'> &
  Readonly<{ me: Pick<View['me'], 'idx' | 'side'> }>;

/**
 * The cells in side order: "Ann (you)" / "Bob" with `taken` and `tricks` per seat, or "Ann & Cara"
 * with the side's points and its seats' tricks summed; `mine` marks my cell, `leading` the one
 * strictly ahead (nobody at a tie, so nobody at 0–0).
 */
export const scoreCells = (v: ScoreSource): ReadonlyArray<ScoreCell> => {
  const n = v.options.seatCount;
  const cells = sideList(n).map((side): Omit<ScoreCell, 'leading'> => {
    const seats = seatsOfSide(n, side);
    const mine = side === v.me.side;
    const name =
      n === 4
        ? seats.map((seat) => nameOf(v.players, seat)).join(' & ')
        : `${nameOf(v.players, seats[0] ?? 0)}${mine ? ' (you)' : ''}`;
    return {
      name,
      points: v.sides[side] ?? 0,
      tricks: seats.reduce<number>((sum, seat) => sum + (v.tricks[seat] ?? 0), 0),
      mine,
    };
  });
  const top = Math.max(...cells.map((c) => c.points));
  const leaders = cells.filter((c) => c.points === top).length;
  return cells.map((c) => ({ ...c, leading: leaders === 1 && c.points === top }));
};

/** `#scoreStrip`'s key: the mode and every cell's numbers (the names change with the game, not the paint). */
export const scoreKey = (mode: ScoreMode, cells: ReadonlyArray<ScoreCell>): string =>
  `${mode}|${cells.map((c) => `${String(c.points)}:${String(c.tricks)}`).join(',')}`;

const scoreCellHtml = (c: ScoreCell): string =>
  `<div class="score-cell${c.mine ? ' mine' : ''}${c.leading ? ' leading' : ''}"><span class="sc-name">${escapeHtml(c.name)}</span><span class="sc-points">${String(c.points)}</span><span class="sc-tricks">${tricksText(c.tricks)}</span></div>`;

export const scoreStripHtml = (cells: ReadonlyArray<ScoreCell>): string =>
  cells.map(scoreCellHtml).join('');

/** "one game", "best of 3", "best of 5" (D3, D7). */
export const matchLabel = (gamesToWin: GamesToWin): string =>
  gamesToWin === 1 ? 'one game' : `best of ${String(gamesToWin * 2 - 1)}`;

/** "Game 1 · 0–0 · best of 3", "Game 3 · 1–0 · 1 draw · best of 3" (`#gameBadge`; wins in side order). */
export const gameBadgeText = (gameNo: number, match: Match): string =>
  [
    `Game ${String(gameNo)}`,
    match.wins.map(String).join('–'),
    ...(match.draws === 0
      ? []
      : [`${String(match.draws)} ${match.draws === 1 ? 'draw' : 'draws'}`]),
    matchLabel(match.gamesToWin),
  ].join(' · ');

// ---- the last trick (§5.2 `#lastTrickOverlay`) ---------------------------------------------------------

/** "Trick 5" (`#ltTitle`). */
export const lastTrickTitle = (trick: Pick<TrickRecord, 'no'>): string =>
  `Trick ${String(trick.no)}`;

/** "Bob took it · 13 points" / "You took it · 13 points" (`#ltSub`, and the curtain's `#curtainLast`). */
export const lastTrickText = (
  players: ReadonlyArray<Player>,
  me: Seat,
  trick: Pick<TrickRecord, 'winner' | 'points'>,
): string => `${whoName(players, me, trick.winner)} took it · ${String(trick.points)} points`;

/** The previous trick as the fan with the winner's card taking (`#ltCards`). */
export const lastTrickHtml = (
  trick: Pick<TrickRecord, 'cards' | 'winner'>,
  o: Omit<TrickOptions, 'taking'>,
): string => trickHtml(trick.cards, { ...o, taking: trick.winner });
