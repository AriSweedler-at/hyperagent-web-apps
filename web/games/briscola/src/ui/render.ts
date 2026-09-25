// Where the briscola page's DOM writes for the game screens live (docs/design/briscola.md §5.2 "The
// DOM", §5.4 "Interaction", §5.6 "Testability"; docs/ARCHITECTURE.md "Module boundaries": ui/
// reaches the document only through the shared DOM edge). `paint(doc, app)` is idempotent and runs
// after every intent: the screen switch and the waiting statuses, the home screen (ui/home.ts), the
// card pack's tokens, the curtain (ui/local.ts), the table, the result sheet, the endgame and the
// overlays, each written from the App (ui/state.ts) alone, so the same App always paints the same
// DOM. Backgammon's ui/render.ts is the shape; the table is this game's.
//
// The table is keyed (§5.2): every container carries `data-key` and is rebuilt from ui/table.ts's
// builders only when its key changes (web/shared/ui/keyed.ts `ensureKeyed`), so a lift never
// rebuilds the hand and a play changes exactly two keys; `selected`, `playable`, `taking`,
// `arriving`, `to-move`, `gone`, `empty`, `tappable`, `inert`, `active` and `hidden-cards` toggle
// outside the key on every paint. The settle beat (§5.4, ui/state.ts `settle`) is paint-driven:
// while a trick is held or in flight the seats, the score strip, my taken count and the strips of
// chips read as before the trick was scored (the chip the cards fly to is laid hidden for the
// flight), and the stock and the briscola as before the draw through every stage, so the counters
// visibly tick after the cards land; the flights themselves (ui/motion.ts) leave once
// per stage, which `#tableScreen[data-beat]` remembers. `bindAll` turns the table's and the
// overlays' controls into intents (one delegated click on `#hand`; Enter/Space on a focused slot is
// the same tap, §5.5); the input wiring of the home screen and the curtain is beside their paints.
// The phone's menu sheet is the one thing toggled here rather than painted from the App (see
// `bindMenu`). The cards' names come from the App's language pack (docs/design/language-packs.md
// §5): every face-up card's `aria-label`, the `.card-name` caption under each play and under the
// stock for the briscola, the `#cardTip` over a hovered or long-pressed hand card (`paintTip`, from
// `table.tip`; `bindTip` turns the hand's pointer events into its intents) and the card view's
// line (`paintCardView`, from `table.cardView`).
import {
  closestFrom,
  dataOf,
  escapeHtml,
  hasClass,
  keyOf,
  listen,
  listenId,
  pointerTypeOf,
  preventDefault,
  queryAllIn,
  queryIn,
  rectOf,
  requireId,
  setAttr,
  setDisabled,
  setHidden,
  setHtml,
  setStyle,
  setText,
  targetIdOf,
  toggleClass,
  trustedHtml,
  type DocumentLike,
  type Element,
  type PageLike,
} from '../../../../shared/edge/dom.ts';
import { defaultPackFor, packByName, type CardPack } from '../../../../shared/lib/cards/packs.ts';
import { resolveAspect, resolveBack } from '../../../../shared/lib/cards/resolve.ts';
import { langByName, type LanguagePack } from '../../../../shared/lib/lang/packs.ts';
import { suitSymbolId } from '../../../../shared/lib/cards/suits.ts';
import { backImageCss } from '../../../../shared/ui/cardFace.ts';
import { paintHistory } from '../../../../shared/ui/history.ts';
import { HISTORY_IDS } from '../../../../shared/ui/ids.ts';
import { paintRecentGames } from '../../../../shared/ui/recentGames.ts';
import { reducedMotion } from '../../../../shared/edge/motion.ts';
import { ensureKeyed } from '../../../../shared/ui/keyed.ts';
import {
  bindButtons,
  bindSheets as bindShellSheets,
  paintHandoff as paintShellHandoff,
  paintScreen as paintShellScreen,
  paintSheet,
  paintSound as paintShellSound,
  paintWaiting as paintShellWaiting,
  type Sheet,
} from '../../../../shared/ui/shellPaint.ts';
import {
  HAND_SIZE,
  SUIT_NAME,
  cardById,
  exchangeCardFor,
  matchWinner,
  nameOf,
  resultText,
  seatsOfSide,
  sideList,
  sideOf,
  type Seat,
  type SeatCount,
  type Side,
  type TrickRecord,
  type View,
} from '../engine/index.ts';
import { HISTORY_COPY } from './history.ts';
import {
  MY_TRICKS,
  drawFlights,
  durationsFor,
  flyCards,
  handCard,
  seatCards,
  seatTaken,
  trickFlights,
  type Flight,
  type Target,
} from './motion.ts';
import {
  DECK_KIND,
  briscolaHtml,
  cardHtml,
  cardLabelEn,
  cardNameOf,
  cellOfSeat,
  chipCount,
  chipsHtml,
  gameBadgeText,
  handHtml,
  handKey,
  leadCue,
  matchLabel,
  scoreCells,
  scoreKey,
  scoreMode,
  scoreStripHtml,
  seatCellId,
  seatCells,
  seatHtml,
  seatKey,
  slotLabel,
  stockHtml,
  stockKey,
  stockLabel,
  stripKey,
  trickHtml,
  trickKey,
  trumpBadge,
  whoName,
  type RelativeCell,
  type SeatCell,
} from './table.ts';
import { aboutHtml } from './about.ts';
import { bindDrag } from './dragger.ts';
import { bindHome, paintHome } from './home.ts';
import { RULES_SLOT_IDS, rulesItemsHtml } from './rules.ts';
import { bindLocal, paintCurtain } from './local.ts';
import {
  SCREENS,
  handoffLabel,
  liveView,
  resultOpen,
  waitingToDealMsg,
  type App,
  type Intent,
  type Settle,
  type SettleStage,
} from './state.ts';

export type { PageLike };
export type Dispatch = (intent: Intent) => void;

export { RULES_SLOT_IDS } from './rules.ts';

/** Fill both rules slots from ui/rules.ts (once, at boot), the jargon in each body linked to its rule. */
export const renderRules = (doc: DocumentLike): void => {
  const markup = trustedHtml(rulesItemsHtml());
  RULES_SLOT_IDS.forEach((id) => {
    setHtml(requireId(doc, id), markup);
  });
};

/** Fill `#aboutCopy` from ui/about.ts (once, at boot), its jargon linked to the rules. */
export const renderAbout = (doc: DocumentLike): void => {
  setHtml(requireId(doc, 'aboutCopy'), trustedHtml(aboutHtml()));
};

// ---- the shell (web/shared/ui/shellPaint.ts, each over the App's shell slice) ---------------------

export { hideToast, showToast } from '../../../../shared/ui/shellPaint.ts';

/** `showScreen(id)`: every screen but `id` gets `hidden`; the table locks the body to the viewport. */
export const paintScreen = (doc: PageLike, app: App): void => {
  paintShellScreen(doc, SCREENS, app.shell.screen, 'tableScreen');
};

/** `#roomCode`, `#hostWaitStatus` (+ its pulse), `#startGameBtn`, `#guestWaitStatus` (+ its pulse). */
export const paintWaiting = (doc: DocumentLike, app: App): void => {
  paintShellWaiting(doc, app.shell);
};

/** `fx.renderToggle()`: `#soundBtn`'s glyph, tooltip and pressed state (it is a toggle). */
export const paintSound = (doc: DocumentLike, enabled: boolean): void => {
  paintShellSound(doc, enabled);
  setAttr(requireId(doc, 'soundBtn'), 'aria-pressed', enabled ? 'true' : 'false');
};

/** `#handoffBtn` (the 🌐 beside the menu button): a two-seat pass-and-play game can go on as a hosted room (D17); the tooltip names who hosts and who joins. */
export const paintHandoff = (doc: DocumentLike, app: App): void => {
  const game = app.shell.role === 'local' ? app.shell.game : null;
  paintShellHandoff(doc, game !== null && game.options.seatCount === 2 ? handoffLabel(game) : null);
};

/** A seat's connection dot's whole class attribute (`#oppDot` at two players); pass-and-play hides it. */
export const connDotClass = (app: App): string =>
  `conn-dot ${app.shell.oppConnected ? 'on' : 'off'}${app.shell.role === 'local' ? ' hidden' : ''}`;

// ---- the card pack (D11, D13) -------------------------------------------------------------------------

/**
 * The chosen pack's tokens: `body[data-card-pack]` names it (§5.6), and the table takes its aspect
 * (`--aspect`: the card box is `--card-w` wide and `--card-w / --aspect` tall), its back's picture
 * (`--back`, one picture at every size) and the colour beneath it. Written on `#tableScreen`, whose
 * own rule declares the deck's defaults, and on the body, so a card in flight (ui/motion.ts clones
 * it onto the body) is painted with the same back. Once per pack: the body attribute is the key.
 */
export const paintPack = (doc: PageLike, packName: CardPack['name']): void => {
  if (dataOf(doc.body, 'card-pack') === packName) return;
  setAttr(doc.body, 'data-card-pack', packName);
  const pack = packByName(packName);
  const back = resolveBack(pack, packByName(defaultPackFor(DECK_KIND)));
  [doc.body, requireId(doc, 'tableScreen')].forEach((el) => {
    setStyle(el, '--aspect', String(resolveAspect(pack, DECK_KIND)));
    setStyle(el, '--back', backImageCss(back));
    setStyle(el, '--back-colour', back.colour);
  });
};

// ---- the settle beat's picture (§5.4) -----------------------------------------------------------------

/**
 * What the settle beat changes in the picture this paint shows: the trick's cards stay on the table
 * with their taker marked while held (`hold`) and in flight (`fly`), the taken counts, the chips,
 * the scores and the other hands read as BEFORE the trick was scored through those two stages
 * (`before`), and the stock and the briscola read as before the draw through every stage
 * (`undrawn`), so the counters tick and the stock thins as the cards land, not before. Through
 * `fly` the winner's strip carries one more chip, hidden, for the cards to land on (`arriving`).
 */
type Beat = Readonly<{
  stage: SettleStage | null;
  trick: TrickRecord | null;
  before: boolean;
  undrawn: boolean;
}>;

const NO_BEAT: Beat = { stage: null, trick: null, before: false, undrawn: false };

const beatOf = (settle: Settle | null): Beat =>
  settle === null
    ? NO_BEAT
    : { stage: settle.stage, trick: settle.trick, before: settle.stage !== 'draw', undrawn: true };

/** A seat's tricks, less the one just taken while it is held or in flight. */
const tricksShown = (v: View, b: Beat, seat: Seat): number =>
  (v.tricks[seat] ?? 0) - (b.before && b.trick?.winner === seat ? 1 : 0);
/** The trick is flying to this seat: its strip lays the chip the cards land on. */
const chipArriving = (b: Beat, seat: Seat): boolean =>
  b.stage === 'fly' && b.trick?.winner === seat;
/** A seat's points, less the trick's while it is held or in flight. */
const takenShown = (v: View, b: Beat, seat: Seat): number =>
  (v.taken[seat] ?? 0) - (b.before && b.trick?.winner === seat ? b.trick.points : 0);
/** A seat's cards in hand, less the one not yet drawn while the trick is held or in flight. */
const handCountShown = (b: Beat, seat: Seat, count: number): number =>
  count - (b.before && b.trick?.drew.includes(seat) === true ? 1 : 0);
/** The stock as before the draw through the beat. */
const stockShown = (v: View, b: Beat): number =>
  v.stockCount + (b.undrawn ? (b.trick?.drew.length ?? 0) : 0);
/** The trump card still on the table until the beat has drawn it. */
const trumpOnTableShown = (v: View, b: Beat): boolean =>
  v.trumpOnTable || (b.undrawn && b.trick?.trumpTaken === true);

/** The view's tallies as before the held trick: what `scoreCells` reads through the hold and the flight. */
const scoreSource = (v: View, b: Beat): View => {
  if (!b.before || b.trick === null) return v;
  const winner = b.trick.winner;
  const side = sideOf(v.options.seatCount, winner);
  const pts = b.trick.points;
  return {
    ...v,
    taken: v.taken.map((t, i) => (i === winner ? t - pts : t)),
    tricks: v.tricks.map((t, i) => (i === winner ? t - 1 : t)),
    sides: v.sides.map((s, i) => (i === side ? s - pts : s)),
  };
};

/**
 * The card the beat is drawing into my hand, hidden (`arriving`) until its flight lands: the card
 * of my hand the view the previous paint showed (`table.lastPainted`, my view before the trick)
 * did not have; null outside a beat, on a cold paint, or when the stock was out.
 */
const drawnCardId = (app: App, v: View, b: Beat): string | null => {
  const prev = app.table.lastPainted;
  if (b.stage === null || prev?.me.idx !== v.me.idx) return null;
  if (prev.gameNo !== v.gameNo || prev.startedAt !== v.startedAt) return null;
  return v.me.hand.find((c) => !prev.me.hand.some((p) => p.id === c.id))?.id ?? null;
};

// ---- the topbar: the trump badge and the game badge (§5.2) ------------------------------------------

/** `#trumpBadge`: the suit's mark (`s-<suit>`), its sprite symbol, its Italian name and the English aria label (§5.5). */
export const paintTrump = (doc: DocumentLike, v: View): void => {
  const badge = requireId(doc, 'trumpBadge');
  const suit = v.trumpCard.s;
  const mark = trumpBadge(suit);
  Object.values(SUIT_NAME).forEach((name) => {
    toggleClass(badge, `s-${name}`, `s-${name}` === mark.cls);
  });
  setAttr(badge, 'aria-label', mark.aria);
  setAttr(badge, 'title', mark.aria);
  const use = queryIn(badge, 'use');
  if (use !== null) setAttr(use, 'href', `#${suitSymbolId(suit)}`);
  setText(requireId(doc, 'trumpName'), mark.name);
};

// ---- the seats (§5.2 `paintSeats`) ------------------------------------------------------------------------

const CELLS: ReadonlyArray<RelativeCell> = ['R1', 'R2', 'R3'];

/** The relative cell a seat sits in for me (`cellOfSeat` is null for my own seat, which never flies to a cell). */
const cellFor = (n: SeatCount, me: Seat, seat: Seat): RelativeCell =>
  cellOfSeat(n, me, seat) ?? 'R2';

/**
 * The three relative cells: `#seats[data-players]`, each cell's `hidden` and `data-seat`, its inside
 * keyed on what it shows (the name, the cards held or their count, the chips, the dot, the pack),
 * `to-move` on the actor's cell between beats and `gone` on a disconnected online seat. At two
 * players the one cell across carries `#oppDot` (tools/games.ts `SHELL.briscola.connDot`) and
 * `#oppName` (the two-seat shell's name for the other seat, which the shell specs read).
 */
export const paintSeats = (doc: DocumentLike, app: App, v: View, b: Beat, pack: CardPack): void => {
  const n = v.options.seatCount;
  const me = v.me.idx;
  const cells = seatCells(n, me);
  const online = app.shell.role === 'host' || app.shell.role === 'guest';
  setAttr(requireId(doc, 'seats'), 'data-players', String(n));
  CELLS.forEach((cell) => {
    const el = requireId(doc, seatCellId(cell));
    const seat = cells[cell];
    setHidden(el, seat === null);
    if (seat === null) return;
    setAttr(el, 'data-seat', String(seat));
    const other = v.others.find((o) => o.idx === seat);
    const data: SeatCell = {
      name: nameOf(v.players, seat),
      handCount: handCountShown(b, seat, other?.handCount ?? 0),
      hand: other?.hand ?? null,
      tricks: tricksShown(v, b, seat),
      arriving: chipArriving(b, seat),
      connected: online ? app.shell.oppConnected : null,
      ...(n === 2 && cell === 'R2' ? { dotId: 'oppDot', nameId: 'oppName' } : {}),
    };
    ensureKeyed(el, seatKey(data, pack.name), () => seatHtml(pack, data));
    toggleClass(el, 'to-move', b.stage === null && v.phase === 'trick' && v.turn === seat);
    toggleClass(el, 'gone', online && !app.shell.oppConnected);
    const dot = queryIn(el, '.conn-dot');
    if (online && dot !== null) {
      setAttr(dot, 'class', connDotClass(app));
      setAttr(dot, 'title', app.shell.oppConnected ? 'Connected' : 'Disconnected');
    }
  });
};

// ---- the stock and the briscola (§5.2 `paintStock`, T3) --------------------------------------------------

/**
 * `#stock` (`data-count`, its label, a `mid` back keyed on the count and the pack, `empty` once only
 * the trump card is left) and `#briscola` (the trump card keyed on its id, `gone` once drawn with
 * its box kept, `tappable` while the exchange is offered to me), both as before the beat's draw.
 */
export const paintStock = (
  doc: DocumentLike,
  app: App,
  v: View,
  b: Beat,
  pack: CardPack,
  lang: LanguagePack,
): void => {
  const count = stockShown(v, b);
  const stock = requireId(doc, 'stock');
  setAttr(stock, 'data-count', String(count));
  setAttr(stock, 'aria-label', `Stock, ${String(count)} cards`);
  ensureKeyed(stock, `${stockKey(count, v.stockTop)}|${pack.name}|${lang.name}`, () =>
    stockHtml(pack, count, v.stockTop, lang),
  );
  toggleClass(stock, 'empty', count <= 1);
  setText(requireId(doc, 'stockCount'), stockLabel(count));
  const briscola = requireId(doc, 'briscola');
  const onTable = trumpOnTableShown(v, b);
  ensureKeyed(briscola, `${v.trumpCard.id}|${pack.name}|${lang.name}`, () =>
    briscolaHtml(pack, v.trumpCard, lang),
  );
  // The briscola's name under the stock's count (its own box is rotated), gone with the card.
  setText(requireId(doc, 'briscolaName'), onTable ? cardNameOf(lang, v.trumpCard.id) : '');
  toggleClass(briscola, 'gone', !onTable);
  toggleClass(briscola, 'tappable', liveView(app) !== null && v.canExchange);
};

// ---- the trick fan (§5.2 `#trick`, §5.3) ---------------------------------------------------------------

/**
 * The fan: the trick in play, or the held trick with its taker's card `taking` through the hold and
 * the flight (the same key as the completed trick, so the hold rebuilds nothing; `taking` toggles
 * outside it); `arriving` hides the cards while their clones fly to the winner; the leader's cue
 * (`data-lead`, `:empty::before`) while the trick is empty; the drag's `drop-ready`/`drop` marks.
 */
const paintTrick = (
  doc: DocumentLike,
  app: App,
  v: View,
  b: Beat,
  pack: CardPack,
  lang: LanguagePack,
): void => {
  const trick = requireId(doc, 'trick');
  const me = v.me.idx;
  setAttr(trick, 'data-players', String(v.options.seatCount));
  const cards = b.before && b.trick !== null ? b.trick.cards : v.trick;
  const taking = b.before ? (b.trick?.winner ?? null) : null;
  setAttr(
    trick,
    'data-lead',
    cards.length === 0 && v.phase === 'trick' ? leadCue(v.players, me, v.leader) : '',
  );
  ensureKeyed(trick, `${trickKey(cards)}|${pack.name}|${lang.name}`, () =>
    trickHtml(cards, { players: v.players, me, pack, taking, lang }),
  );
  queryAllIn(trick, '.card').forEach((card) => {
    toggleClass(card, 'taking', taking !== null && dataOf(card, 'seat') === String(taking));
    toggleClass(card, 'arriving', b.stage === 'fly');
  });
  toggleClass(trick, 'drop-ready', app.table.drag !== null);
  toggleClass(trick, 'drop', app.table.drag?.over === true);
};

// ---- the score strip and the status line (D9, §5.2) ------------------------------------------------------

/** `#scoreStrip[data-mode]` and its cells, keyed on the mode, the numbers and the names (a new table's names must repaint a 0–0 strip). */
const paintScore = (doc: DocumentLike, v: View, b: Beat): void => {
  const mode = scoreMode(v.options.seatCount);
  const strip = requireId(doc, 'scoreStrip');
  setAttr(strip, 'data-mode', mode);
  const cells = scoreCells(scoreSource(v, b));
  ensureKeyed(strip, `${scoreKey(mode, cells)}|${cells.map((c) => c.name).join(',')}`, () =>
    scoreStripHtml(cells),
  );
};

export const DRAWING_STATUS = 'Drawing…';

/** "Bob takes the trick · 13 points" / "You take the trick · 13 points" (the hold and the flight). */
export const takesText = (
  players: View['players'],
  me: Seat,
  trick: Pick<TrickRecord, 'winner' | 'points'>,
): string =>
  `${whoName(players, me, trick.winner)} take${trick.winner === me ? '' : 's'} the trick · ${String(trick.points)} points`;

/** The game's result as one line (E12): "Ann wins 71–49", "A draw, 60–60", "Ann and Cara win 65–55 and take the match 2–0". */
export const resultLine = (v: View): string => {
  const r = v.result;
  if (r === null) return '';
  return resultText(v.players, v.options.seatCount, {
    winner: r.winner,
    totals: r.totals,
    draw: r.draw,
    decided: v.matchOver,
    wins: v.match.wins,
  });
};

/** The exchange's clause on my turn (D24): "· you may swap your 7 of cups for it". */
const exchangeClause = (v: View): string => {
  const card = exchangeCardFor(v.trumpCard);
  return card === null ? '' : ` · you may swap your ${cardLabelEn(card)} for it`;
};

/**
 * `#statusText` (§5.8 copy): the taker through the hold and the flight, "Drawing…" through the
 * draws, the result once the game is over, else whose turn it is, with "Last three tricks" once the
 * stock is out and the hands are full.
 */
export const statusText = (app: App, v: View): string => {
  const b = beatOf(app.table.settle);
  if (b.before && b.trick !== null) return takesText(v.players, v.me.idx, b.trick);
  if (b.stage === 'draw') return DRAWING_STATUS;
  if (v.phase === 'over') return resultLine(v);
  const lastThree = v.stockCount === 0 && v.trick.length === 0 && v.me.hand.length === HAND_SIZE;
  if (v.isMyTurn)
    return `${lastThree ? 'Last three tricks — your turn' : 'Your turn — play a card'}${v.canExchange ? exchangeClause(v) : ''}`;
  return `${lastThree ? 'Last three tricks — ' : ''}${nameOf(v.players, v.actor ?? v.turn)} to play`;
};

// ---- the hand and the actions row (§5.2 `#hand`, §5.4, §5.5) --------------------------------------------

/** A held slot's toggles outside the key: the card's lift, playability and drag, the slot's button semantics, the drawn card's `arriving`. */
const paintSlot = (
  slot: Element,
  o: Readonly<{
    selected: string | null;
    playable: ReadonlyArray<string>;
    dragging: string | null;
    drawn: string | null;
    faceDown: boolean;
  }>,
): void => {
  const card = queryIn(slot, '.card');
  if (card === null) return;
  const id = dataOf(card, 'card') ?? '';
  const lifted = o.selected === id;
  const canPlay = o.playable.includes(id);
  toggleClass(card, 'selected', lifted);
  toggleClass(card, 'playable', canPlay);
  toggleClass(card, 'dragging', o.dragging === id);
  toggleClass(card, 'arriving', id === o.drawn);
  const button = lifted || canPlay;
  setAttr(slot, 'role', button ? 'button' : null);
  setAttr(slot, 'tabindex', button ? '0' : null);
  setAttr(slot, 'aria-pressed', button ? String(lifted) : null);
  const c = cardById(id);
  if (c !== null && !o.faceDown)
    setAttr(slot, 'aria-label', slotLabel(c, lifted ? 'lifted' : canPlay ? 'play' : null));
};

/**
 * `#hand`: three slots keyed on the kept picture (`table.slots`), the pack and whether the cards are
 * down (`hidden-cards`, under the curtain); `active` while I may play, `inert` otherwise; each held
 * slot's marks refreshed outside the key. `#myName`, my strip of chips (`#myTricks`: one per trick
 * taken, `data-count` and `--n`, the arriving one laid through the flight) and `#myTaken` above it.
 */
export const paintHand = (
  doc: DocumentLike,
  app: App,
  v: View,
  b: Beat,
  pack: CardPack,
  lang: LanguagePack,
): void => {
  const hand = requireId(doc, 'hand');
  const live = liveView(app) !== null;
  const faceDown = app.table.curtain !== null;
  const slots = app.table.slots;
  const selected = app.table.selected;
  const playable = live ? v.legal : [];
  ensureKeyed(hand, `${handKey(slots, pack.name, faceDown)}|${lang.name}`, () =>
    handHtml(pack, slots, { selected, playable, faceDown, lang }),
  );
  toggleClass(hand, 'active', live);
  toggleClass(hand, 'inert', !live);
  toggleClass(hand, 'hidden-cards', faceDown);
  const drawn = drawnCardId(app, v, b);
  const dragging = app.table.drag?.card ?? null;
  queryAllIn(hand, '.slot').forEach((slot) => {
    paintSlot(slot, { selected, playable, dragging, drawn, faceDown });
  });
  setText(requireId(doc, 'myName'), v.me.name);
  const me = v.me.idx;
  const strip = { tricks: tricksShown(v, b, me), arriving: chipArriving(b, me) };
  const tricks = requireId(doc, 'myTricks');
  const chips = chipCount(strip);
  setAttr(tricks, 'data-count', String(chips));
  setStyle(tricks, '--n', String(chips));
  ensureKeyed(tricks, stripKey(strip, pack.name), () => chipsHtml(strip.tricks, strip.arriving));
  setText(requireId(doc, 'myTaken'), `You: ${String(takenShown(v, b, me))}`);
};

/** `#waitNote`: whose card the table waits for. */
export const waitNoteText = (v: View): string =>
  `Waiting for ${nameOf(v.players, v.actor ?? v.turn)}…`;

/** `#playBtn` live for a lifted legal card; `#waitNote` on another seat's turn; the result chip once the sheet is put away. */
const paintActions = (doc: DocumentLike, app: App, v: View, b: Beat): void => {
  const live = liveView(app) !== null;
  const selected = app.table.selected;
  setDisabled(
    requireId(doc, 'playBtn'),
    !(live && selected !== null && v.legal.includes(selected)),
  );
  const wait = requireId(doc, 'waitNote');
  const waiting =
    v.phase === 'trick' && !v.isMyTurn && app.table.curtain === null && b.stage === null;
  toggleClass(wait, 'hidden', !waiting);
  setText(wait, waitNoteText(v));
  toggleClass(
    requireId(doc, 'resultChipBtn'),
    'hidden',
    !(v.phase === 'over' && app.table.resultDismissed && b.stage === null),
  );
};

// ---- the result sheet, the endgame (§5.1) ----------------------------------------------------------------

/** A side's name: "Ann" at two and three players, "Ann & Cara" for a four-player team (the strip's spelling). */
export const sideLabel = (players: View['players'], n: SeatCount, side: Side): string =>
  seatsOfSide(n, side)
    .map((seat) => nameOf(players, seat))
    .join(' & ');

/** The winner's figure first, then the other sides in side order: "71–49", "50–40–30". */
const scoreline = (totals: ReadonlyArray<number>, first: Side): string =>
  [totals[first] ?? 0, ...totals.filter((_, side) => side !== first)].map(String).join('–');

/**
 * `#rsTitle` / `#rsSub`: "Ann wins the game" · "71–49"; "Ann & Cara win the game" · "65–55"; "A
 * draw" · "60–60 · nobody scores this game"; at three players the sub lists every side by points
 * ("Bob 52 · Ann 41 · Cara 27").
 */
export const resultSheetText = (v: View): Readonly<{ title: string; sub: string }> => {
  const r = v.result;
  const n = v.options.seatCount;
  if (r === null) return { title: 'Game over', sub: '' };
  if (r.winner === null)
    return { title: 'A draw', sub: `${r.totals.map(String).join('–')} · nobody scores this game` };
  const plural = seatsOfSide(n, r.winner).length > 1;
  const title = `${sideLabel(v.players, n, r.winner)} win${plural ? '' : 's'} the game`;
  const sub =
    n === 3
      ? [...sideList(n)]
          .sort((a, b) => (r.totals[b] ?? 0) - (r.totals[a] ?? 0))
          .map((side) => `${sideLabel(v.players, n, side)} ${String(r.totals[side] ?? 0)}`)
          .join(' · ')
      : scoreline(r.totals, r.winner);
  return { title, sub };
};

/** `#rsScore`: one `.score-row` per side in side order, its name and its points this game. */
export const sideRowsHtml = (v: View): string => {
  const n = v.options.seatCount;
  const totals = v.result?.totals ?? v.sides;
  return sideList(n)
    .map(
      (side) =>
        `<div class="score-row"><span class="who">${escapeHtml(sideLabel(v.players, n, side))}</span><span>${String(totals[side] ?? 0)}</span></div>`,
    )
    .join('');
};

/** `#rsMatch`: "Games: Ann 1 · Bob 0 · draws 1 · best of 3" (D7). */
export const matchText = (v: View): string => {
  const n = v.options.seatCount;
  const wins = sideList(n).map(
    (side) => `${sideLabel(v.players, n, side)} ${String(v.match.wins[side] ?? 0)}`,
  );
  const draws = v.match.draws === 0 ? [] : [`draws ${String(v.match.draws)}`];
  return `Games: ${[...wins, ...draws, matchLabel(v.match.gamesToWin)].join(' · ')}`;
};

/** A guest's "Next game" waits for the host to deal (D20); the host and the phone deal at once. */
export const nextWaits = (app: App): boolean => app.shell.role === 'guest';
export const nextLabel = (app: App, v: View): string =>
  nextWaits(app) ? waitingToDealMsg(nameOf(v.players, 0)) : v.matchOver ? 'Rematch' : 'Next game';

/** `#resultOverlay` at `phase 'over'` once the last trick has settled (ui/state.ts `resultOpen`), the match end being the endgame screen's. */
const paintResult = (doc: DocumentLike, app: App, v: View): void => {
  paintSheet(doc, 'resultOverlay', resultOpen(app) && !v.matchOver);
  if (v.phase !== 'over') return;
  const text = resultSheetText(v);
  setText(requireId(doc, 'rsTitle'), text.title);
  setText(requireId(doc, 'rsSub'), text.sub);
  ensureKeyed(
    requireId(doc, 'rsScore'),
    `${String(v.startedAt)}:${String(v.gameNo)}:${String(v.endedAt)}`,
    () => sideRowsHtml(v),
  );
  setText(requireId(doc, 'rsMatch'), matchText(v));
  const next = requireId(doc, 'rsNextBtn');
  setText(next, nextLabel(app, v));
  setDisabled(next, nextWaits(app));
};

/** `#resultTitle`: "Bravi! Ann takes the match 2–0" / "Bravi! Ann & Cara take the match 2–1" (D23). */
export const matchTitle = (v: View): string => {
  const n = v.options.seatCount;
  const w = matchWinner(v.match);
  if (w === null) return 'Match over';
  const plural = seatsOfSide(n, w).length > 1;
  return `Bravi! ${sideLabel(v.players, n, w)} ${plural ? 'take' : 'takes'} the match ${scoreline(v.match.wins, w)}`;
};

/** `#resultSub`: "3 games", "4 games · 1 draw". */
export const matchSubText = (v: View): string => {
  const games = `${String(v.games.length)} game${v.games.length === 1 ? '' : 's'}`;
  const d = v.match.draws;
  return d === 0 ? games : `${games} · ${String(d)} draw${d === 1 ? '' : 's'}`;
};

/** `#matchScore`: one row per finished game, "Game 1 · Ann · 71–49" (a draw names nobody). */
export const gamesHtml = (v: View): string => {
  const n = v.options.seatCount;
  return v.games
    .map((g) => {
      const who = g.winner === null ? 'a draw' : sideLabel(v.players, n, g.winner);
      const totals =
        g.winner === null ? g.totals.map(String).join('–') : scoreline(g.totals, g.winner);
      return `<div class="score-row"><span>Game ${String(g.gameNo)}</span><span class="who">${escapeHtml(who)}</span><span>${totals}</span></div>`;
    })
    .join('');
};

const paintEndgame = (doc: DocumentLike, app: App, v: View): void => {
  setText(requireId(doc, 'resultTitle'), matchTitle(v));
  setText(requireId(doc, 'resultSub'), matchSubText(v));
  ensureKeyed(
    requireId(doc, 'matchScore'),
    `${String(v.startedAt)}:${String(v.games.length)}`,
    () => gamesHtml(v),
  );
  const next = requireId(doc, 'nextGameBtn');
  setText(next, nextLabel(app, v));
  setDisabled(next, nextWaits(app));
};

// ---- the sheets: rules, history ------------------------------------------------------------------------------

const paintOverlays = (doc: DocumentLike, app: App): void => {
  const v = app.shell.view;
  paintSheet(doc, 'rulesOverlay', app.shell.rulesOpen);
  paintSheet(doc, 'historyOverlay', app.table.historyOpen);
  // One `<details>` per event (the shared panel over ui/history.ts's copy), the match's start
  // naming the stream: a repaint with nothing new leaves open rows open, a new event is appended
  // after them, and a new match (whose ids start over) rebuilds the list.
  if (app.table.historyOpen) {
    paintHistory(
      doc,
      HISTORY_IDS.list,
      v?.events ?? [],
      HISTORY_COPY,
      { players: v?.players ?? [], n: v?.options.seatCount ?? 2 },
      String(v?.startedAt ?? ''),
    );
    // The finished matches under this match's events (web/shared/ui/recentGames.ts).
    paintRecentGames(doc, app.shell.recentGames);
  }
};

// ---- the whole table, the beat's flights and the whole paint ------------------------------------------------

const paintTable = (
  doc: DocumentLike,
  app: App,
  v: View,
  b: Beat,
  pack: CardPack,
  lang: LanguagePack,
): void => {
  paintTrump(doc, v);
  setText(requireId(doc, 'gameBadge'), gameBadgeText(v.gameNo, v.match));
  paintSeats(doc, app, v, b, pack);
  paintStock(doc, app, v, b, pack, lang);
  paintTrick(doc, app, v, b, pack, lang);
  paintScore(doc, v, b);
  setText(requireId(doc, 'statusText'), statusText(app, v));
  paintHand(doc, app, v, b, pack, lang);
  paintActions(doc, app, v, b);
};

/** Where a seat's won trick lands and where its drawn card lands: the newest chip of my strip and my hand, or the seat's cell. */
const landings = (
  v: View,
  drawn: string | null,
): Readonly<{ taken: (seat: Seat) => Target; card: (seat: Seat) => Target }> => {
  const n = v.options.seatCount;
  const me = v.me.idx;
  return {
    taken: (seat) => (seat === me ? MY_TRICKS : seatTaken(cellFor(n, me, seat))),
    card: (seat) => (seat === me ? handCard(drawn ?? '') : seatCards(cellFor(n, me, seat))),
  };
};

/** The stage's flights (ui/motion.ts): the trick to its winner as the flight starts, a back to each drawer as the draws start; nothing while held. */
const flightsFor = (v: View, b: Beat, drawn: string | null): ReadonlyArray<Flight> => {
  if (b.trick === null) return [];
  const to = landings(v, drawn);
  const d = durationsFor(reducedMotion());
  switch (b.stage) {
    case 'fly':
      return trickFlights(b.trick, to.taken(b.trick.winner), d);
    case 'draw':
      return drawFlights(b.trick, to.card, d);
    case 'hold':
    case null:
      return [];
  }
};

/**
 * The game screens from a view: the endgame once the match is over and settled, else the table, its
 * result sheet and the beat's flights, launched once per stage (`#tableScreen[data-beat]` remembers
 * the stage last flown, so a repaint mid-flight launches nothing).
 */
const paintGame = (doc: PageLike, app: App, pack: CardPack, lang: LanguagePack): void => {
  const v = app.shell.view;
  const screen = requireId(doc, 'tableScreen');
  if (v === null) {
    paintSheet(doc, 'resultOverlay', false);
    setAttr(screen, 'data-beat', null);
    return;
  }
  const b = beatOf(app.table.settle);
  if (v.matchOver && b.stage === null) {
    paintEndgame(doc, app, v);
    paintSheet(doc, 'resultOverlay', false);
    setAttr(screen, 'data-beat', null);
    return;
  }
  paintTable(doc, app, v, b, pack, lang);
  paintResult(doc, app, v);
  const beat =
    b.trick === null || b.stage === null
      ? null
      : `${String(v.startedAt)}:${String(v.gameNo)}:${String(b.trick.no)}:${b.stage}`;
  if (dataOf(screen, 'beat') === beat) return;
  setAttr(screen, 'data-beat', beat);
  flyCards(doc, flightsFor(v, b, drawnCardId(app, v, b)));
};

// ---- the card names: the tip over a hand card and the card view (docs/design/language-packs.md §5) ----

/**
 * `#cardTip`: the name of the hand card `table.tip` shows, in the App's language, placed at the
 * card's top centre (the CSS lifts it clear); hidden while no tip is shown, while the card has
 * left the hand, or while the hand is down. Fixed on the body, so it clears the table's overflow.
 */
export const paintTip = (doc: DocumentLike, app: App, lang: LanguagePack): void => {
  const tip = requireId(doc, 'cardTip');
  const t = app.table.tip;
  const card =
    t === null || !t.shown || app.table.curtain !== null
      ? null
      : queryIn(requireId(doc, 'hand'), `.card[data-card="${t.card}"]`);
  toggleClass(tip, 'hidden', card === null);
  if (t === null || card === null) return;
  const r = rectOf(card);
  setText(tip, cardNameOf(lang, t.card));
  setAttr(tip, 'data-card', t.card);
  setStyle(tip, 'left', `${String(r.left + r.width / 2)}px`);
  setStyle(tip, 'top', `${String(r.top)}px`);
};

/** `#cardViewOverlay`: the card `table.cardView` names, large through the pack (keyed on the card, the pack and the language), its name beneath. */
export const paintCardView = (
  doc: DocumentLike,
  app: App,
  pack: CardPack,
  lang: LanguagePack,
): void => {
  const id = app.table.cardView;
  paintSheet(doc, 'cardViewOverlay', id !== null);
  if (id === null) return;
  ensureKeyed(requireId(doc, 'cardViewFace'), `${id}|${pack.name}|${lang.name}`, () =>
    cardHtml(pack, id, '', lang),
  );
  setText(requireId(doc, 'cardViewName'), cardNameOf(lang, id));
};

/** Everything, from the App alone. */
export const paint = (doc: PageLike, app: App): void => {
  const pack = packByName(app.table.cardPack);
  const lang = langByName(app.table.lang);
  paintScreen(doc, app);
  paintWaiting(doc, app);
  paintHome(doc, app);
  paintPack(doc, app.table.cardPack);
  paintCurtain(doc, app);
  paintHandoff(doc, app);
  paintGame(doc, app, pack, lang);
  paintOverlays(doc, app);
  paintTip(doc, app, lang);
  paintCardView(doc, app, pack, lang);
};

// ---- input wiring (§5.4, §5.5) ------------------------------------------------------------------------------

// A sheet is an overlay a flag shows; the same flag's intent answers its close button, a tap on its
// backdrop (the overlay element itself, never its children) and Escape. The list is this game's; the
// result sheet's "Look at the table" is its close.
const SHEETS: ReadonlyArray<Sheet<Intent>> = [
  { overlay: 'rulesOverlay', close: 'closeRulesBtn', intent: { type: 'rules/close' } },
  { overlay: 'historyOverlay', close: 'closeHistoryBtn', intent: { type: 'history/close' } },
  { overlay: 'resultOverlay', close: 'rsPeekBtn', intent: { type: 'result/peek' } },
  { overlay: 'cardViewOverlay', close: 'closeCardViewBtn', intent: { type: 'cardView/close' } },
];

/**
 * The intent a tap (or Enter/Space) on `#hand` raises, from the element it landed on: the card under
 * the pointer, or the card of the focused slot (the slot is the accessible button, ui/table.ts). Null
 * for the felt between the cards and for an empty slot.
 */
export const handIntentOf = (e: Readonly<Event>): Intent | null => {
  const slot = closestFrom(e, '.slot');
  const card = closestFrom(e, '.card') ?? (slot === null ? null : queryIn(slot, '.card'));
  const id = card === null ? null : dataOf(card, 'card');
  return id === null ? null : { type: 'card/tap', cardId: id };
};

/**
 * The phone's menu sheet (`#menuOverlay`): rules, history and leaving, which the topbar holds as its
 * own buttons from 900px. It carries no state the App needs (each row dispatches what the topbar
 * button would), so it is the one sheet toggled here rather than painted: opened by `#menuBtn`,
 * closed by its Close, its backdrop, Escape and every row.
 */
const bindMenu = (doc: PageLike, dispatch: Dispatch): void => {
  const setMenu = (open: boolean): void => {
    paintSheet(doc, 'menuOverlay', open);
  };
  listenId(doc, 'menuBtn', 'click', () => {
    setMenu(true);
  });
  listenId(doc, 'closeMenuBtn', 'click', () => {
    setMenu(false);
  });
  listenId(doc, 'menuOverlay', 'click', (e) => {
    if (targetIdOf(e) === 'menuOverlay') setMenu(false);
  });
  const rows: ReadonlyArray<readonly [string, Intent]> = [
    ['menuRulesBtn', { type: 'rules/open' }],
    ['menuHistoryBtn', { type: 'history/open' }],
    ['menuLeaveBtn', { type: 'leave/request' }],
  ];
  rows.forEach(([id, intent]) => {
    listenId(doc, id, 'click', () => {
      setMenu(false);
      dispatch(intent);
    });
  });
  listen(doc, 'keydown', (e) => {
    if (keyOf(e) === 'Escape' && !hasClass(requireId(doc, 'menuOverlay'), 'hidden')) setMenu(false);
  });
};

/** The hand card under a pointer event, or null for the felt, an empty slot or the hand face down (never a back). */
const tipCardOf = (doc: DocumentLike, e: Readonly<Event>): string | null => {
  if (hasClass(requireId(doc, 'hand'), 'hidden-cards')) return null;
  const card = closestFrom(e, '.card[data-card]');
  return card === null ? null : dataOf(card, 'card');
};

/**
 * The card-name tip's pointer wiring over `#hand` (docs/design/language-packs.md §5): a fine
 * pointer arms it on `pointerover` and drops it on `pointerout` or a press; a touch arms it on
 * `pointerdown` (the long press) and drops it when the finger lifts, the lift swallowing the click
 * it fires so the card is not lifted too. The timers are the reducer's (`tip/arm`, `tip/show`).
 */
export const bindTip = (doc: PageLike, dispatch: Dispatch): void => {
  const hand = requireId(doc, 'hand');
  const touch = (e: Readonly<Event>): boolean => pointerTypeOf(e) === 'touch';
  listen(hand, 'pointerover', (e) => {
    const card = tipCardOf(doc, e);
    if (card !== null && !touch(e)) dispatch({ type: 'tip/arm', card, press: false });
  });
  listen(hand, 'pointerout', () => {
    dispatch({ type: 'tip/hide' });
  });
  listen(hand, 'pointerdown', (e) => {
    const card = tipCardOf(doc, e);
    if (card !== null && touch(e)) dispatch({ type: 'tip/arm', card, press: true });
    else dispatch({ type: 'tip/hide' });
  });
  listen(hand, 'pointerup', (e) => {
    dispatch(touch(e) ? { type: 'tip/hide', swallow: true } : { type: 'tip/hide' });
  });
  listen(hand, 'pointercancel', () => {
    dispatch({ type: 'tip/hide' });
  });
};

/** The table's, the sheets' and the endgame's controls, each an intent. */
export const bindTable = (doc: PageLike, dispatch: Dispatch): void => {
  listenId(doc, 'hand', 'click', (e) => {
    const intent = handIntentOf(e);
    if (intent !== null) dispatch(intent);
  });
  // Enter/Space on a focused slot is its tap (§5.5); the page must not scroll on Space.
  listenId(doc, 'hand', 'keydown', (e) => {
    const k = keyOf(e);
    if (k !== 'Enter' && k !== ' ') return;
    const intent = handIntentOf(e);
    if (intent === null) return;
    preventDefault(e);
    dispatch(intent);
  });
  // A tap on the table plays the lifted card; a tap on the trump card offers the exchange (D24).
  listenId(doc, 'trick', 'click', () => {
    dispatch({ type: 'table/tap' });
  });
  listenId(doc, 'briscola', 'click', () => {
    dispatch({ type: 'exchange/click' });
  });
  // The controls whose click is one constant; `skipDisabled`: a click on a control carrying
  // `disabled` dispatches nothing (the paint disables the play button and Next).
  bindButtons(
    doc,
    dispatch,
    [
      ['playBtn', { type: 'play/click' }],
      ['resultChipBtn', { type: 'result/open' }],
      ['rsNextBtn', { type: 'next/click' }],
      ['nextGameBtn', { type: 'next/click' }],
      ['leaveBtn', { type: 'leave/request' }],
      ['soundBtn', { type: 'sound/toggle' }],
      ['handoffBtn', { type: 'handoff/click' }],
      ['rulesBtnGame', { type: 'rules/open' }],
      ['historyBtn', { type: 'history/open' }],
    ],
    { skipDisabled: true },
  );
  bindMenu(doc, dispatch);
  bindTip(doc, dispatch);
};

/**
 * Every control of the page (home, curtain, table, sheets), once, at boot. The glossary links are
 * bound by the boot through web/shared/edge/glossary.ts (an edge, out of ui/'s reach). Escape closes
 * the open sheet, else drops what the table holds up (`escape`: a drag, a lift).
 */
export const bindAll = (doc: PageLike, dispatch: Dispatch): void => {
  bindHome(doc, dispatch);
  bindLocal(doc, dispatch);
  bindTable(doc, dispatch);
  bindDrag(doc, dispatch);
  bindShellSheets(doc, SHEETS, dispatch, { escapeFallback: { type: 'escape' } });
};
