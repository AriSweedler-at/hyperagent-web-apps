// The table's pure builders (docs/design/briscola.md §5.2 "The DOM", §5.5, §5.6, §5.7): the markup
// strings the painter writes into the keyed containers of `#tableScreen`, the keys that say when a
// container must be rebuilt, and the small copy the containers carry (the lead cue, the stock
// label, the score cells). Everything is a function of a `View`'s parts, a few UI
// facts (the kept slots, the lifted card, the taking seat, the chip in flight) and the chosen card
// pack, tested as strings like backgammon's ui/board.ts. It imports the engine and the shared card packs only:
// the reducer imports this module, never the reverse, and the DOM is the painter's.
//
// Faces and backs come only through the shared packs (web/shared/ui/cardFace.ts, D11): a face is
// `faceHtml(resolveFace(pack, 'italian40', id))`, so any pack that draws `italian40` paints here
// unchanged; a card the pack has no picture for is the glyph, and a pack with no back takes the
// deck default's (`resolveBack`, the painter's `--back`). `faceHtml` owns the card's opening tag,
// so the hand's button semantics (`role`, `tabindex`, `aria-label`, `aria-pressed`, §5.5) sit on
// the `.slot` that holds the card, and a fan card's `data-seat` (§5.6 `#trick .card[data-seat]`)
// is written into that tag by `withDataSeat`, the one attribute a face never carries itself.
// Names are the shell's normalised ones but are escaped anyway: a name is a player's text. A
// card's name comes from the chosen language pack (web/shared/lib/lang/packs.ts, docs/design/
// language-packs.md): the face's `aria-label` wherever a `lang` is passed, and a `.card-name`
// caption under each play of the trick (the owner: the suits are unfamiliar, so the table says
// what was played) and under the stock for the briscola.
import { DECKS, cardIds } from '../../../../shared/lib/cards/decks.ts';
import type { CardPack } from '../../../../shared/lib/cards/packs.ts';
import { resolveFace, type RatioUrl } from '../../../../shared/lib/cards/resolve.ts';
import { cardName, type LanguagePack } from '../../../../shared/lib/lang/packs.ts';
import { escapeHtml } from '../../../../shared/edge/dom.ts';
import { backHtml, faceHtml } from '../../../../shared/ui/cardFace.ts';
import {
  SUIT_NAME,
  cardById,
  nameOf,
  seatsOfSide,
  sideList,
  sidesOf,
  type Card,
  type Cards,
  type Played,
  type Player,
  type Seat,
  type SeatCount,
  type Suit,
  type View,
} from '../engine/index.ts';

/** The deck kind every briscola pack must draw (D10). */
export const DECK_KIND = 'italian40' as const;

// ---- cards -----------------------------------------------------------------------------------------

const ITALIAN = DECKS[DECK_KIND];

/** The file a browser without `image-set()` fetches (cardFace.ts's plain fallback, the 2x where the pack has one): the one worth fetching ahead. */
const preloadUrl = (urls: ReadonlyArray<RatioUrl>): string | null =>
  (urls.find((u) => u.ratio === 2) ?? urls[0])?.url ?? null;

/**
 * The pack's pictures to fetch at table boot (the page review: a just-drawn card showed blank for
 * one round trip on its first appearance): one `<img>` per picture the pack's faces name, each
 * once (a sprite pack has one sheet for many cards), nothing for glyph faces (the renderer draws
 * them). Painted hidden onto the body once per pack (render.ts `paintPack`).
 */
export const facePreloadHtml = (pack: CardPack): string => {
  const urls = cardIds(DECK_KIND).flatMap((id) => {
    const spec = resolveFace(pack, DECK_KIND, id);
    const url =
      spec?.kind === 'image'
        ? preloadUrl(spec.urls)
        : spec?.kind === 'sprite'
          ? preloadUrl(spec.sheets)
          : null;
    return url === null ? [] : [url];
  });
  return [...new Set(urls)]
    .map((url) => `<img src="${escapeHtml(url)}" alt="" decoding="async">`)
    .join('');
};

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

/** The card's name in the language pack ("re di denari"); '' for a stranger, which never reaches a caption. */
export const cardNameOf = (lang: LanguagePack, id: string): string =>
  cardName(lang, DECK_KIND, id) ?? '';

/**
 * A face-up card through the pack, `extra` classes appended (`mid`, `tiny`, `selected`,
 * `playable`, `taking`), its name from `lang` as the face's `aria-label` when one is given; an id
 * outside the deck (never on the wire) paints a back so a bug shows as a back, not a crash.
 */
export const cardHtml = (pack: CardPack, id: string, extra = '', lang?: LanguagePack): string => {
  const spec = resolveFace(pack, DECK_KIND, id);
  if (spec === null) return backHtml(extra);
  const name = lang === undefined ? undefined : cardNameOf(lang, id);
  return faceHtml(spec, {
    ...(extra === '' ? {} : { extra }),
    ...(name === undefined ? {} : { name }),
  });
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
  /** The language the faces are named in (`aria-label`); absent, the faces carry no name. */
  lang?: LanguagePack;
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
    o.lang,
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
  /** The language of the faces' labels and the `.card-name` caption under each play; absent, neither. */
  lang?: LanguagePack;
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

/** The caption under a play (docs/design/language-packs.md §5): the card's name in the pack's language. */
const captionHtml = (lang: LanguagePack | undefined, id: string): string =>
  lang === undefined ? '' : `<span class="card-name">${cardNameOf(lang, id)}</span>`;

const playHtml = (o: TrickOptions, p: Played, i: number): string => {
  const who = whoName(o.players, o.me, p.seat);
  const label = `${cardLabelEn(p.card)}, played by ${p.seat === o.me ? 'you' : who}`;
  return `<div class="play" role="group" aria-label="${escapeHtml(label)}" style="--i:${String(i)}">${withDataSeat(
    cardHtml(o.pack, p.card.id, classes('mid', p.seat === o.taking ? 'taking' : ''), o.lang),
    p.seat,
  )}<span class="who">${escapeHtml(who)}</span>${captionHtml(o.lang, p.card.id)}</div>`;
};

/**
 * The fan in play order, the leader's card first: each play is a `.play` column (`--i` for the
 * CSS's z-order, overlap and tilt) holding the `mid` face with `data-seat`, a `.who` chip
 * beneath and, with a `lang`, the card's name as a `.card-name` caption; the taking card wears
 * `taking`.
 */
export const trickHtml = (trick: ReadonlyArray<Played>, o: TrickOptions): string =>
  trick.map((p, i) => playHtml(o, p, i)).join('');

// ---- the seats (§5.2 `paintSeats`) ---------------------------------------------------------------------

/** What one relative cell shows of a seat; `hand` only under scoperta or the partner peek (E15/E16). */
export type SeatCell = Readonly<{
  name: string;
  handCount: number;
  hand: Cards | null;
  /** The tricks taken, one chip each (through the hold and the flight, as before the trick, render.ts `tricksShown`). */
  tricks: number;
  /** The trick in flight to this seat: one more chip, painted so the flight can land on it (`arriving`, hidden until it does). */
  arriving?: boolean;
  /** Online: whether the seat's channel is open; null for a local seat (the dot hides). */
  connected: boolean | null;
  /** The dot's id where a page fixes one (`SHELL.briscola.connDot`, `#oppDot` in the 2-player cell). */
  dotId?: string;
  /** The name's id where a page fixes one (`#oppName` in the 2-player cell: what the shell specs read as the opponent's name). */
  nameId?: string;
}>;

/** "2 tricks", "1 trick", nothing at 0 (the score strip's `.sc-tricks`). */
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

/**
 * The taken tricks as a row of face-down chips (docs/design/briscola-battle.md §7 G; the owner:
 * "the tricks should stack up and make a row and get larger as you take more"): one `chip` back
 * per trick, the pack's back at chip size, each stepping right of the one before (theme.css
 * `.seat-taken`, layout.ts `chipStep`), so the row grows with every trick and the newest lies on
 * top. `arriving` appends the chip the trick in flight lands on, hidden until it does
 * (ui/motion.ts `hideArrival`); the same chips fill `#myTricks` in the hand header.
 */
export const chipsHtml = (tricks: number, arriving = false): string =>
  Array.from({ length: tricks + (arriving ? 1 : 0) }, () => backHtml('chip')).join('');

/** The chips a strip shows: its tricks, and the one arriving. */
export const chipCount = (cell: Pick<SeatCell, 'tricks' | 'arriving'>): number =>
  cell.tricks + (cell.arriving === true ? 1 : 0);

/** The strip's key: how many chips it shows (an arriving chip counts), and the pack that draws their backs. */
export const stripKey = (cell: Pick<SeatCell, 'tricks' | 'arriving'>, packName: string): string =>
  `${String(chipCount(cell))}|${packName}`;

/** The cell's key: name, what is held (ids where shown), the chips, the dot's state and the pack. */
export const seatKey = (cell: SeatCell, packName: string): string =>
  `${cell.name}|${cell.hand === null ? String(cell.handCount) : cell.hand.map((c) => c.id).join(',')}|${String(chipCount(cell))}|${cell.connected === null ? '-' : cell.connected ? 'on' : 'off'}|${packName}`;

/**
 * The inside of a `.seat` cell: the name, the held cards, the taken strip (`.seat-taken
 * [data-count]`, its chips and `--n` for the CSS's step; where a won trick flies to) and the
 * connection dot (`on`/`off`, hidden for a local seat). The cell's own marks (`hidden`,
 * `data-seat`, `to-move`, `gone`) are the painter's toggles.
 */
export const seatHtml = (pack: CardPack, cell: SeatCell): string => {
  const dot =
    cell.connected === null
      ? '<span class="conn-dot" hidden></span>'
      : `<span class="conn-dot ${cell.connected ? 'on' : 'off'}"></span>`;
  const dotWithId =
    cell.dotId === undefined ? dot : dot.replace('<span ', `<span id="${cell.dotId}" `);
  const nameId = cell.nameId === undefined ? '' : ` id="${cell.nameId}"`;
  const chips = chipCount(cell);
  return `<span class="seat-name"${nameId}>${escapeHtml(cell.name)}</span><span class="seat-cards">${seatCardsHtml(pack, cell)}</span><span class="seat-taken" data-count="${String(chips)}" style="--n:${String(chips)}">${chipsHtml(cell.tricks, cell.arriving)}</span>${dotWithId}`;
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
export const stockHtml = (
  pack: CardPack,
  count: number,
  top: Card | null,
  lang?: LanguagePack,
): string =>
  count <= 1 ? '' : top === null ? backHtml('mid') : cardHtml(pack, top.id, 'mid', lang);

/**
 * The inside of `#briscola`: the trump card as a `mid` face (named in `lang`), laid across under the
 * stock by the CSS; `gone` (its box kept) and `tappable` (E14) are the painter's toggles. Keyed by
 * the card's id; its caption is `#briscolaName` under the stock's label (the box is rotated).
 */
export const briscolaHtml = (pack: CardPack, trumpCard: Card, lang?: LanguagePack): string =>
  cardHtml(pack, trumpCard.id, 'mid', lang);

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

// ---- the score strip (D9, §5.2 `#scoreStrip`) -----------------------------------------------------------

export type ScoreMode = 'players' | 'teams';
export type ScoreCell = Readonly<{
  name: string;
  points: number;
  tricks: number;
  mine: boolean;
  leading: boolean;
}>;

/** Per player while every seat is its own side (`#scoreStrip[data-mode]`; no teams at four since 2026-09-25); `teams` waits for the day they return. */
export const scoreMode = (n: SeatCount): ScoreMode => (sidesOf(n) === n ? 'players' : 'teams');

type ScoreSource = Pick<View, 'players' | 'options' | 'taken' | 'tricks' | 'sides'> &
  Readonly<{ me: Pick<View['me'], 'idx' | 'side'> }>;

/**
 * The cells in side order: "Ann (you)" / "Bob" with `taken` and `tricks` per seat (a side is one
 * seat; a team's "Ann & Cara" is kept for the day teams return); `mine` marks my cell, `leading`
 * the one strictly ahead (nobody at a tie, so nobody at 0–0). At four seats the "(you)" suffix goes
 * (four cells across a phone ellipsised it to "Bob (y…", the live check of 2026-09-25): the `mine`
 * hairline alone marks my cell.
 */
export const scoreCells = (v: ScoreSource): ReadonlyArray<ScoreCell> => {
  const n = v.options.seatCount;
  const cells = sideList(n).map((side): Omit<ScoreCell, 'leading'> => {
    const seats = seatsOfSide(n, side);
    const mine = side === v.me.side;
    const name =
      seats.length > 1
        ? seats.map((seat) => nameOf(v.players, seat)).join(' & ')
        : `${nameOf(v.players, seats[0] ?? 0)}${mine && n < 4 ? ' (you)' : ''}`;
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
