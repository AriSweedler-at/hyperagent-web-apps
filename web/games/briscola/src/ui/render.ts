// Where the briscola page's DOM writes for the game screens live (docs/design/briscola.md §5.2 "The
// DOM", §5.4 "Interaction", §5.6 "Testability"; docs/ARCHITECTURE.md "Module boundaries": ui/
// reaches the document only through the shared DOM edge). `paint(doc, app)` is idempotent and runs
// after every intent: the screen switch and the waiting statuses, the home screen (ui/home.ts), the
// card pack's tokens, the curtain (ui/local.ts), the table, the result sheet (where every game
// ends, with Play again; the shell's end screen is never shown) and the overlays, each written
// from the App (ui/state.ts) alone, so the same App always paints the same DOM. Backgammon's
// ui/render.ts is the shape; the table is this game's.
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
  appendHtml,
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
  type Rect,
  removeElement,
  requireId,
  setAttr,
  setChecked,
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
import type { Speed } from '../../../../shared/lib/speed.ts';
import { resolveAspect, resolveBack } from '../../../../shared/lib/cards/resolve.ts';
import { langByName, type LanguagePack } from '../../../../shared/lib/lang/packs.ts';
import { suitSymbolId } from '../../../../shared/lib/cards/suits.ts';
import { backImageCss } from '../../../../shared/ui/cardFace.ts';
import { paintHistory } from '../../../../shared/ui/history.ts';
import { HISTORY_IDS } from '../../../../shared/ui/ids.ts';
import { paintRecentGames } from '../../../../shared/ui/recentGames.ts';
import { reducedMotion } from '../../../../shared/edge/motion.ts';
import type { IntentSlot } from '../protocol.ts';
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
  nameOf,
  resultText,
  seatsFrom,
  seatsOfSide,
  sideList,
  sideOf,
  trickWinner,
  type Played,
  type Seat,
  type SeatCount,
  type Side,
  type TrickRecord,
  type View,
} from '../engine/index.ts';
import { HISTORY_COPY } from './history.ts';
import { clashGeometry } from './motion.ts';
import { isClashStage } from './state.ts';
import { TEMPO_SCALE, sparkleOffsets, type Variant } from './variant.ts';
import {
  MY_TRICKS,
  dealFlights,
  drawFlights,
  drawsAfter,
  drawsBefore,
  myDrawFlight,
  durationsFor,
  flyCards,
  handCard,
  handSlot,
  newPlays,
  playFlight,
  seatCardAt,
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
  handHtml,
  handKey,
  leadCue,
  scoreCells,
  scoreKey,
  scoreMode,
  facePreloadHtml,
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
import { deckHtml, deckKey, deckOf, deckSubText } from './deck.ts';
import { bindDrag } from './dragger.ts';
import { bindHome, paintHome } from './home.ts';
import { RULES_SLOT_IDS, rulesItemsHtml } from './rules.ts';
import { bindLocal, paintCurtain } from './local.ts';
import {
  SCREENS,
  handoffLabel,
  awaitingDraw,
  liveView,
  pausedMsg,
  resultOpen,
  seatsDown,
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

/**
 * Whether a seat's channel is up, as this device knows it (n-seat-sessions.md §7): the host reads
 * every guest seat off `shell.seats`; a guest reads the host off `oppConnected` and the other
 * guests off the last lobby frame, which the host re-sends on every seat lost or back mid-game
 * (the view carries no channel state); a seat no frame has listed reads as up.
 */
export const seatConnected = (app: App, seat: Seat): boolean =>
  app.shell.role === 'guest'
    ? seat === 0
      ? app.shell.oppConnected
      : (app.shell.seats[seat - 1]?.connected ?? true)
    : (app.shell.seats[seat - 1]?.connected ?? app.shell.oppConnected);

/** A seat's connection dot's whole class attribute (`#oppDot` at two players; `connected` the seat's, the legacy pair's without); pass-and-play hides it. */
export const connDotClass = (app: App, connected: boolean = app.shell.oppConnected): string =>
  `conn-dot ${connected ? 'on' : 'off'}${app.shell.role === 'local' ? ' hidden' : ''}`;

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

/**
 * The pack's faces fetched once the table is up, not on a card's first appearance (the page
 * review: a just-drawn card showed blank for a round trip): one hidden `.face-preload` block of
 * `<img>`s appended to the body per pack (`body[data-faces]` is the key; a switch appends another,
 * the pictures cached, the block inert), only while `#tableScreen` is the screen. Never at home or
 * in the join flow: under the e2e proxy forty requests at boot starved the guest's join (CI run
 * 36210397787, `shell-handoff.spec.ts` on the proxy project).
 */
export const paintFacePreload = (doc: PageLike, app: App, pack: CardPack): void => {
  if (app.shell.screen !== 'tableScreen' || dataOf(doc.body, 'faces') === pack.name) return;
  setAttr(doc.body, 'data-faces', pack.name);
  appendHtml(
    doc.body,
    trustedHtml(
      `<div class="face-preload" hidden aria-hidden="true">${facePreloadHtml(pack)}</div>`,
    ),
  );
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
  /** My draw waits for a tap (docs/design/briscola-battle.md §3.1 DRAW): the slot pulses, the stock is tappable. */
  awaiting: boolean;
  /** My back is flying to its slot and turning over (`drawMine`). */
  flipping: boolean;
  /** The clash's variant while the beat runs (§3.3): the fan's data attributes and the impact frame read it. */
  clash: Variant | null;
  /** The two fighters are charging, striking, frozen or posing (charge → aftermath): `winner`/`loser`/`bystander` on the plays. */
  fighting: boolean;
  /** The impact frame shows (`impact`, `aftermath`). */
  impacted: boolean;
}>;

const NO_BEAT: Beat = {
  stage: null,
  trick: null,
  before: false,
  undrawn: false,
  awaiting: false,
  flipping: false,
  clash: null,
  fighting: false,
  impacted: false,
};

const beatOf = (settle: Settle | null): Beat =>
  settle === null
    ? NO_BEAT
    : {
        stage: settle.stage,
        trick: settle.trick,
        before: isClashStage(settle.stage) || settle.stage === 'fly',
        undrawn: true,
        awaiting: awaitingDraw(settle),
        flipping: settle.stage === 'drawMine',
        clash: settle.variant,
        fighting: isClashStage(settle.stage) && settle.stage !== 'follow',
        impacted: settle.stage === 'impact' || settle.stage === 'aftermath',
      };

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
  // Through `drawRest` my card has landed and turned: it shows.
  if (b.stage === null || b.stage === 'drawRest' || prev?.me.idx !== v.me.idx) return null;
  if (prev.gameNo !== v.gameNo || prev.startedAt !== v.startedAt) return null;
  return v.me.hand.find((c) => !prev.me.hand.some((p) => p.id === c.id))?.id ?? null;
};

// ---- the topbar: the trump badge (§5.2) --------------------------------------------------------------

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
 * `to-move` on the actor's cell between beats and `gone` on a disconnected online seat (each
 * seat's own channel, `seatConnected`). At two players the one cell across carries `#oppDot`
 * (tools/games.ts `SHELL.briscola.connDot`) and `#oppName` (the two-seat shell's name for the
 * other seat, which the shell specs read).
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
    // A cell with no seat carries no `data-seat` (a stale one from an earlier deal matched a seat's selector twice) and drops its key, so the next seat it shows is built afresh.
    if (seat === null) {
      setAttr(el, 'data-seat', null);
      setAttr(el, 'data-key', null);
      return;
    }
    setAttr(el, 'data-seat', String(seat));
    const other = v.others.find((o) => o.idx === seat);
    const connected = seatConnected(app, seat);
    const data: SeatCell = {
      name: nameOf(v.players, seat),
      handCount: handCountShown(b, seat, other?.handCount ?? 0),
      hand: other?.hand ?? null,
      tricks: tricksShown(v, b, seat),
      arriving: chipArriving(b, seat),
      connected: online ? connected : null,
      ...(n === 2 && cell === 'R2' ? { dotId: 'oppDot', nameId: 'oppName' } : {}),
    };
    ensureKeyed(el, seatKey(data, pack.name), () => seatHtml(pack, data));
    toggleClass(el, 'to-move', b.stage === null && v.phase === 'trick' && v.turn === seat);
    toggleClass(el, 'gone', online && !connected);
    // The live intent mirror (docs/design/briscola-battle.md §4.4): the slot-th back of that seat
    // lifts by class, outside the key (a hover never rebuilds the cell); nothing mid-beat; an
    // out-of-range slot toggles nothing.
    const mirror = b.stage === null ? (app.table.mirror[seat] ?? null) : null;
    queryAllIn(el, '.seat-cards > .card').forEach((card, i) => {
      toggleClass(card, 'intent-hover', mirror?.slot === i && mirror.mode === 'hover');
      toggleClass(card, 'intent-raised', mirror?.slot === i && mirror.mode === 'raised');
    });
    const dot = queryIn(el, '.conn-dot');
    if (online && dot !== null) {
      setAttr(dot, 'class', connDotClass(app, connected));
      setAttr(dot, 'title', connected ? 'Connected' : 'Disconnected');
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
  // My draw waits (§3.1 DRAW): the stock is the tap's target; the briscola when only it is left for me.
  toggleClass(stock, 'tappable', b.awaiting && count > 1);
  setText(requireId(doc, 'stockCount'), stockLabel(count));
  const briscola = requireId(doc, 'briscola');
  const onTable = trumpOnTableShown(v, b);
  ensureKeyed(briscola, `${v.trumpCard.id}|${pack.name}|${lang.name}`, () =>
    briscolaHtml(pack, v.trumpCard, lang),
  );
  // The briscola's name under the stock's count (its own box is rotated), gone with the card.
  setText(requireId(doc, 'briscolaName'), onTable ? cardNameOf(lang, v.trumpCard.id) : '');
  toggleClass(briscola, 'gone', !onTable);
  toggleClass(
    briscola,
    'tappable',
    (liveView(app) !== null && v.canExchange) || (b.awaiting && count <= 1 && onTable),
  );
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
  const cards = fanShown(v, b);
  // The winner is marked (`taking`: the lift and the cream outline) through the whole beat, from the
  // completing card's flight to the pack, so the frame the beat opens on is the one the goldens pin
  // (the trick held, the taker marked); the clash's own marks start at the charge.
  const taking = b.before ? (b.trick?.winner ?? null) : null;
  // The fan is rebuilt at the phase changes of the beat (charge → impact → the pack), so the marks the
  // fighters wear are in its markup and element identity holds through the charge and the strike; at
  // `follow` (the completing card landing) the markup and the key are the goldens'.
  const phase = fanPhase(b);
  const fighters =
    phase === 'fight' || phase === 'hit'
      ? b.trick === null
        ? null
        : { winner: b.trick.winner, loser: runnerUp(v.trumpCard.s, b.trick) }
      : null;
  setAttr(
    trick,
    'data-lead',
    cards.length === 0 && v.phase === 'trick' ? leadCue(v.players, me, v.leader) : '',
  );
  ensureKeyed(
    trick,
    `${trickKey(cards)}|${pack.name}|${lang.name}${phase === null ? '' : `|${phase}`}`,
    () => trickHtml(cards, { players: v.players, me, pack, taking, lang, fighters }),
  );
  queryAllIn(trick, '.card').forEach((card) => {
    toggleClass(card, 'taking', taking !== null && dataOf(card, 'seat') === String(taking));
    // A play's clone still in the air keeps its card hidden through a repaint (`data-flying`, ui/motion.ts).
    toggleClass(card, 'arriving', b.stage === 'fly' || dataOf(card, 'flying') !== null);
  });
  paintClash(trick, v, b);
  toggleClass(trick, 'drop-ready', app.table.drag !== null);
  toggleClass(trick, 'drop', app.table.drag?.over === true);
};

/** The fan's build phase through a beat: `fight` the charge and the strike (the fighters marked), `hit` the impact and the aftermath, `pack` the flight to the chip; null at `follow` (the fan as the goldens pin it), outside a beat and through the draws. */
const fanPhase = (b: Beat): 'fight' | 'hit' | 'pack' | null =>
  b.stage === null
    ? null
    : b.impacted
      ? 'hit'
      : b.stage === 'fly'
        ? 'pack'
        : b.fighting
          ? 'fight'
          : null;

/** The cards the fan shows: the held trick through the clash and the pack, nothing through the draws (a peer's play mid-beat flies in at the beat's end, §3.7), the trick in play outside a beat. */
const fanShown = (v: View, b: Beat): ReadonlyArray<Played> =>
  b.stage === null ? v.trick : b.before && b.trick !== null ? b.trick.cards : [];

// ---- the clash (docs/design/briscola-battle.md §3.1 CHARGE → AFTERMATH, §3.3, §3.5; §7 PR-F) ------------

/** The runner-up: the card that would have taken the trick without the winner's (`trickWinner` over the rest). Null in a fan of one. */
const runnerUp = (trump: View['trumpCard']['s'], trick: TrickRecord): Seat | null => {
  const rest = trick.cards.filter((p) => p.seat !== trick.winner);
  return rest.length === 0 ? null : trickWinner(trump, rest);
};

/** The seat whose card a play wrapper holds, as the card's `data-seat` spells it. */
const seatOfPlay = (play: Element): string | null => {
  const card = queryIn(play, '.card');
  return card === null ? null : dataOf(card, 'seat');
};

/** The play wrapper of a seat's card in the fan. */
const playOf = (trick: Element, seat: Seat): Element | null =>
  queryAllIn(trick, '.play').find((p) => seatOfPlay(p) === String(seat)) ?? null;

/** The impact frames' families by the winning suit (impact/impact-sprite.svg `impact-<family>-<a|b>`). */
export const IMPACT_SUIT: Readonly<Record<Variant['suit'], string>> = {
  C: 'coppe',
  D: 'denari',
  S: 'spade',
  B: 'bastoni',
};

/** The impact frame's markup: the winning suit's symbol (A or B) from the inlined sprite, then the sparkles at their offsets (a briscola's ring or scatter). */
export const clashFxHtml = (c: Variant): string =>
  `<svg class="fx" viewBox="0 0 100 100" aria-hidden="true"><use href="#impact-${IMPACT_SUIT[c.suit]}-${c.frame}"/></svg>${sparkleOffsets(
    c.sparkle,
  )
    .map(
      ([x, y], k) =>
        `<svg class="sparkle" viewBox="0 0 100 100" aria-hidden="true" style="--k:${String(k)};--sx:${String(x)};--sy:${String(y)}"><use href="#sparkle"/></svg>`,
    )
    .join('')}`;

/**
 * The fan through the clash: `#trick[data-stage]` and the variant's slots as data attributes
 * (`data-charge/angle/sign/tempo/pose/after/side/value/shake`, the CSS's keyframes read them) with
 * the charge's distance and lean as custom properties; the plays marked `winner`, `loser` or
 * `bystander` from the charge to the aftermath; the fighters' axis (`--ux --uy --gap`) measured
 * once as the charge opens (their rest boxes), so the strike meets at the midpoint; `.clash-fx`
 * appended at the impact at that midpoint (`--cx --cy`; the fan's centre when nothing measures)
 * and removed when the pack begins. Outside a beat every mark is off and the fan's markup is the
 * goldens'.
 */
const paintClash = (trick: Element, v: View, b: Beat): void => {
  const c = b.clash;
  const fighting = b.fighting && c !== null && b.trick !== null;
  const was = dataOf(trick, 'stage');
  setAttr(trick, 'data-stage', b.stage);
  const winner = fighting ? b.trick.winner : null;
  const loser = fighting ? runnerUp(v.trumpCard.s, b.trick) : null;
  queryAllIn(trick, '.play').forEach((play) => {
    const seat = seatOfPlay(play);
    toggleClass(play, 'winner', winner !== null && seat === String(winner));
    toggleClass(play, 'loser', loser !== null && seat === String(loser));
    toggleClass(play, 'bystander', fighting && seat !== String(winner) && seat !== String(loser));
  });
  const slots: ReadonlyArray<readonly [string, string | null]> = [
    ['data-charge', c === null || !fighting ? null : String(c.chargeDist)],
    ['data-angle', c === null || !fighting ? null : String(c.chargeAngle)],
    ['data-sign', c === null || !fighting ? null : c.chargeSign > 0 ? '+' : '-'],
    ['data-tempo', c === null || !fighting ? null : c.tempo],
    ['data-pose', c === null || !fighting ? null : c.pose],
    ['data-after', c === null || !fighting ? null : c.after],
    ['data-side', c === null || !fighting ? null : c.side],
    ['data-value', c === null || !fighting ? null : c.valueClass],
    ['data-shake', c === null || !fighting ? null : String(c.shakePx)],
  ];
  slots.forEach(([name, value]) => {
    setAttr(trick, name, value);
  });
  if (c !== null && fighting) {
    setStyle(trick, '--charge-dist', String(c.chargeDist));
    setStyle(trick, '--lean', `${String(c.chargeAngle * c.chargeSign)}deg`);
    setStyle(trick, '--tempo', String(TEMPO_SCALE[c.tempo]));
  }
  // The axis, once, as the charge opens: the fighters still at rest.
  if (b.stage === 'charge' && was !== 'charge' && winner !== null && loser !== null) {
    const a = playOf(trick, winner);
    const l = playOf(trick, loser);
    const g = a === null || l === null ? null : clashGeometry(rectOf(a), rectOf(l));
    const box = rectOf(trick);
    const measured = g !== null && g.gap > 0 && (box.width > 0 || box.height > 0);
    setStyle(trick, '--ux', measured ? g.ux.toFixed(3) : '1');
    setStyle(trick, '--uy', measured ? g.uy.toFixed(3) : '0');
    setStyle(trick, '--gap', measured ? `${g.gap.toFixed(1)}px` : 'var(--mid-w)');
    setStyle(trick, '--cx', measured ? `${(g.cx - box.left).toFixed(1)}px` : '50%');
    setStyle(trick, '--cy', measured ? `${(g.cy - box.top).toFixed(1)}px` : '50%');
  }
  // The frame, once per trick (`#trick[data-fx]` remembers it, the latch a repaint at the impact reads); gone with the pack.
  const fxKey = b.impacted && c !== null && b.trick !== null ? String(b.trick.no) : null;
  if (fxKey !== null && c !== null) {
    if (dataOf(trick, 'fx') !== fxKey) {
      appendHtml(
        trick,
        trustedHtml(
          `<div class="clash-fx" data-suit="${IMPACT_SUIT[c.suit]}" data-frame="${c.frame}" data-sparkle="${c.sparkle}" data-steal="${String(c.steal)}">${clashFxHtml(c)}</div>`,
        ),
      );
      setAttr(trick, 'data-fx', fxKey);
    }
  } else if (dataOf(trick, 'fx') !== null) {
    const fx = queryIn(trick, '.clash-fx');
    if (fx !== null) removeElement(fx);
    setAttr(trick, 'data-fx', null);
  }
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
/** The status while my draw waits for the tap (§3.8): the stock, the slot or the felt all take it. */
export const DRAW_TAP_STATUS = 'Drawing… tap the stock';

/** "Bob takes the trick · 13 points" / "You take the trick · 13 points" (the hold and the flight). */
export const takesText = (
  players: View['players'],
  me: Seat,
  trick: Pick<TrickRecord, 'winner' | 'points'>,
): string =>
  `${whoName(players, me, trick.winner)} take${trick.winner === me ? '' : 's'} the trick · ${String(trick.points)} points`;

/** The game's result as one line (E12): "Ann wins 71–49", "A draw, 60–60", "Ann and Cara win 65–55"; never the engine's match clause (one game per sitting). */
export const resultLine = (v: View): string => {
  const r = v.result;
  if (r === null) return '';
  return resultText(v.players, v.options.seatCount, {
    winner: r.winner,
    totals: r.totals,
    draw: r.draw,
    decided: false,
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
 * draws, the result once the game is over, who is to reconnect while a seat is down (the trick
 * paused, ui/state.ts `seatsDown`), else whose turn it is, with "Last three tricks" once the
 * stock is out and the hands are full.
 */
export const statusText = (app: App, v: View): string => {
  const b = beatOf(app.table.settle);
  if (b.before && b.trick !== null) return takesText(v.players, v.me.idx, b.trick);
  if (b.awaiting) return DRAW_TAP_STATUS;
  if (b.stage !== null) return DRAWING_STATUS;
  if (v.phase === 'over') return resultLine(v);
  const down = seatsDown(app);
  if (down.length > 0) return pausedMsg(down);
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
    awaiting: boolean;
    flipping: boolean;
  }>,
): void => {
  const card = queryIn(slot, '.card');
  if (card === null) return;
  const id = dataOf(card, 'card') ?? '';
  const lifted = o.selected === id;
  const canPlay = o.playable.includes(id);
  const drawn = id === o.drawn;
  toggleClass(card, 'selected', lifted);
  toggleClass(card, 'playable', canPlay);
  toggleClass(card, 'dragging', o.dragging === id);
  // The drawn card hides until its flight lands: through the wait outright, in `drawMine` while
  // its clone is in the air (`data-flying`, ui/motion.ts; the launch marks it before any frame).
  // A card under its clone (a draw or the deal in flight) stays hidden through a repaint.
  toggleClass(card, 'arriving', dataOf(card, 'flying') !== null || (drawn && !o.flipping));
  // Tap to draw (§3.1 DRAW): the slot my card will fill pulses; after the tap the card turns over.
  toggleClass(slot, 'awaiting', drawn && o.awaiting);
  toggleClass(card, 'flipping', drawn && o.flipping);
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
    paintSlot(slot, {
      selected,
      playable,
      dragging,
      drawn,
      faceDown,
      awaiting: b.awaiting,
      flipping: b.flipping,
    });
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

// ---- the result sheet (§5.1) -----------------------------------------------------------------------------

/** A side's name: "Ann" at two and three players, "Ann & Cara" for a four-player team (the strip's spelling). */
export const sideLabel = (players: View['players'], n: SeatCount, side: Side): string =>
  seatsOfSide(n, side)
    .map((seat) => nameOf(players, seat))
    .join(' & ');

/** The winner's figure first, then the other sides in side order: "71–49", "50–40–30". */
const scoreline = (totals: ReadonlyArray<number>, first: Side): string =>
  [totals[first] ?? 0, ...totals.filter((_, side) => side !== first)].map(String).join('–');

/**
 * `#rsTitle` / `#rsSub`: "Ann wins the game" · "71–49"; "A draw" · "60–60 · nobody scores this
 * game"; at three and four players (a free-for-all, every seat its own side) the sub lists every
 * side by points ("Bob 52 · Ann 41 · Cara 27"); "Ann & Cara win the game" is kept for the day
 * teams return.
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
    n >= 3
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

/** `#rsReplayBtn`'s words: the owner's "replay button at the end" (2026-09-25). */
export const PLAY_AGAIN_LABEL = 'Play again';

/** A guest's Play again waits for the host to deal (D20); the host and the phone deal at once. */
export const replayWaits = (app: App): boolean => app.shell.role === 'guest';
export const replayLabel = (app: App, v: View): string =>
  replayWaits(app) ? waitingToDealMsg(nameOf(v.players, 0)) : PLAY_AGAIN_LABEL;

/** `#resultOverlay` at `phase 'over'` once the last trick has settled (ui/state.ts `resultOpen`): where every game ends, decided or drawn. */
const paintResult = (doc: DocumentLike, app: App, v: View): void => {
  paintSheet(doc, 'resultOverlay', resultOpen(app));
  if (v.phase !== 'over') return;
  const text = resultSheetText(v);
  setText(requireId(doc, 'rsTitle'), text.title);
  setText(requireId(doc, 'rsSub'), text.sub);
  ensureKeyed(
    requireId(doc, 'rsScore'),
    `${String(v.startedAt)}:${String(v.gameNo)}:${String(v.endedAt)}`,
    () => sideRowsHtml(v),
  );
  const replay = requireId(doc, 'rsReplayBtn');
  setText(replay, replayLabel(app, v));
  setDisabled(replay, replayWaits(app));
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

// ---- the deck sheet (ui/deck.ts; the owner's ask of 2026-09-25, gin's discards sheet on the forty) ----------

/**
 * `#deckOverlay` while the table has a view: the count line, the four suit rows keyed on what is
 * gone, what is mine, the toggle and the pack (a trick taken or a toggle rebuilds them, a lift does
 * not), and the toggle's box as the App has it.
 */
const paintDeck = (doc: DocumentLike, app: App, pack: CardPack): void => {
  const v = app.shell.view;
  const open = app.table.deckOpen && v !== null;
  paintSheet(doc, 'deckOverlay', open);
  if (!open) return;
  const deck = deckOf(v, app.table.deckWithHand);
  setText(requireId(doc, 'deckSub'), deckSubText(deck));
  ensureKeyed(requireId(doc, 'deckList'), `${deckKey(deck)}|${pack.name}`, () =>
    deckHtml(pack, deck),
  );
  setChecked(requireId(doc, 'deckIncludeHand'), app.table.deckWithHand);
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

/**
 * The stage's flights (ui/motion.ts): the trick to its winner as the flight starts; the backs of
 * the seats drawing before me as the draws start; mine after my tap; the seats after me once my
 * card has landed (docs/design/briscola-battle.md §3.1 DRAW); nothing while held.
 */
const flightsFor = (
  v: View,
  b: Beat,
  drawn: string | null,
  speed: Speed,
): ReadonlyArray<Flight> => {
  if (b.trick === null) return [];
  const to = landings(v, drawn);
  const d = durationsFor(speed, reducedMotion());
  const me = v.me.idx;
  switch (b.stage) {
    case 'fly':
      return trickFlights(b.trick, to.taken(b.trick.winner), d);
    case 'draw':
      return drawFlights(b.trick, to.card, d, drawsBefore(b.trick.drew, me));
    case 'drawMine': {
      const mine = myDrawFlight(b.trick, me, to.card(me), d);
      return mine === null ? [] : [mine];
    }
    case 'drawRest':
      return drawFlights(b.trick, to.card, d, drawsAfter(b.trick.drew, me));
    // The clash is the CSS's over the fan's marks; the completing card's flight was the paint's (`playFlights`).
    case 'follow':
    case 'charge':
    case 'strike':
    case 'impact':
    case 'aftermath':
    case null:
      return [];
  }
};

/**
 * Where a card about to reach the fan stood on the screen the LAST paint left (`prev`'s
 * geometry): my hand slot's card, or the seat's newest tiny back. Null when nothing measurable
 * stands there (a fake, a hidden tab), or when the card is the drag's: its ghost lands it.
 */
const playSource = (doc: PageLike, prev: View, seat: Seat, cardId: string): Rect | null => {
  const me = prev.me.idx;
  const el =
    seat === me
      ? queryIn(requireId(doc, 'hand'), `.card[data-card="${cardId}"]`)
      : queryIn(
          requireId(doc, seatCellId(cellFor(prev.options.seatCount, me, seat))),
          '.seat-cards .card:last-child',
        );
  if (el === null || hasClass(el, 'dragging')) return null;
  const r = rectOf(el);
  return r.width > 0 || r.height > 0 ? r : null;
};

/**
 * The play and follow flights of this paint (docs/design/briscola-battle.md §3.1, PR-D), planned
 * BEFORE the table repaints (the sources go with it): every card the fan is about to show that
 * the last paint's view had not, from where it stood to its place at its tilt, the trick's first
 * at PLAY's pace, the rest at FOLLOW's, the completing card fastest. `#tableScreen[data-flown]`
 * remembers the fan last flown, so a repaint of the same fan (a lift, a tip) launches nothing; a
 * cold paint (no last view) or a new game flies nothing.
 */
const playFlights = (doc: PageLike, app: App): ReadonlyArray<Flight> => {
  const v = app.shell.view;
  const prev = app.table.lastPainted;
  if (v === null || prev === null) return [];
  if (prev.gameNo !== v.gameNo || prev.startedAt !== v.startedAt) return [];
  const b = beatOf(app.table.settle);
  const completing = b.before && b.trick !== null;
  const shown = fanShown(v, b);
  const key = `${String(v.startedAt)}:${String(v.gameNo)}:${b.trick === null ? 'open' : String(b.trick.no)}:${trickKey(shown)}`;
  const screen = requireId(doc, 'tableScreen');
  if (dataOf(screen, 'flown') === key) return [];
  setAttr(screen, 'data-flown', key);
  const reduced = reducedMotion();
  return newPlays(prev.trick, shown).flatMap((p, k) => {
    const from = playSource(doc, prev, p.seat, p.card.id);
    const i = shown.findIndex((q) => q.card.id === p.card.id);
    return from === null
      ? []
      : [
          playFlight(
            p,
            from,
            i,
            shown.length,
            completing && i === shown.length - 1,
            app.table.speed,
            reduced,
            k,
          ),
        ];
  });
};

/**
 * The deal's flights (docs/design/briscola-battle.md §7 PR-H): at a freshly dealt table (no trick
 * yet, my hand full), one back from the stock per card, the leader first and on round the table,
 * three rounds, to my slots left to right and the seats' backs in order (ui/motion.ts
 * `dealFlights`). `#tableScreen[data-dealt]` remembers the game last dealt, so the repaints that
 * follow (the curtain, a lift) launch nothing; a game resumed past its first play deals nothing.
 */
const dealt = (doc: PageLike, v: View, speed: Speed): ReadonlyArray<Flight> => {
  if (v.trickNo !== 0 || v.trick.length !== 0 || v.me.hand.length !== HAND_SIZE) return [];
  const screen = requireId(doc, 'tableScreen');
  const key = `${String(v.startedAt)}:${String(v.gameNo)}`;
  if (dataOf(screen, 'dealt') === key) return [];
  setAttr(screen, 'data-dealt', key);
  const n = v.options.seatCount;
  const me = v.me.idx;
  return dealFlights(
    seatsFrom(n, v.leader),
    (seat, k) => (seat === me ? handSlot(k) : seatCardAt(cellFor(n, me, seat), k)),
    speed,
    reducedMotion(),
  );
};

/**
 * The game screens from a view: the table, its result sheet and the beat's flights, launched once
 * per stage (`#tableScreen[data-beat]` remembers the stage last flown, so a repaint mid-flight
 * launches nothing), after the plays measured before the repaint (`plays`).
 */
const paintGame = (
  doc: PageLike,
  app: App,
  pack: CardPack,
  lang: LanguagePack,
  plays: ReadonlyArray<Flight>,
): void => {
  const v = app.shell.view;
  const screen = requireId(doc, 'tableScreen');
  // The beat's clock for the CSS (`--beat-*` under `[data-speed]`, theme.css), the same switch the reducer's timers read.
  setAttr(screen, 'data-speed', app.table.speed);
  if (v === null) {
    paintSheet(doc, 'resultOverlay', false);
    setAttr(screen, 'data-beat', null);
    return;
  }
  const b = beatOf(app.table.settle);
  paintTable(doc, app, v, b, pack, lang);
  paintResult(doc, app, v);
  const beat =
    b.trick === null || b.stage === null
      ? null
      : `${String(v.startedAt)}:${String(v.gameNo)}:${String(b.trick.no)}:${b.stage}`;
  const staged =
    dataOf(screen, 'beat') === beat
      ? []
      : flightsFor(v, b, drawnCardId(app, v, b), app.table.speed);
  setAttr(screen, 'data-beat', beat);
  flyCards(doc, [...plays, ...staged, ...dealt(doc, v, app.table.speed)]);
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
  // Measured before the table repaints: the played card's slot and the seat's back go with it.
  const plays = playFlights(doc, app);
  paintCurtain(doc, app);
  paintHandoff(doc, app);
  paintGame(doc, app, pack, lang, plays);
  paintFacePreload(doc, app, pack);
  paintOverlays(doc, app);
  paintTip(doc, app, lang);
  paintCardView(doc, app, pack, lang);
  paintDeck(doc, app, pack);
};

// ---- input wiring (§5.4, §5.5) ------------------------------------------------------------------------------

// A sheet is an overlay a flag shows; the same flag's intent answers its close button, a tap on its
// backdrop (the overlay element itself, never its children) and Escape. The list is this game's; the
// result sheet's "Look at the table" is its close.
const SHEETS: ReadonlyArray<Sheet<Intent>> = [
  { overlay: 'rulesOverlay', close: 'closeRulesBtn', intent: { type: 'rules/close' } },
  { overlay: 'historyOverlay', close: 'closeHistoryBtn', intent: { type: 'history/close' } },
  { overlay: 'deckOverlay', close: 'closeDeckBtn', intent: { type: 'deck/close' } },
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

/** A hand slot's index in the kept picture as `Table.hover` names it, or null off the three. */
const slotIndexOf = (hand: Element, e: Readonly<Event>): IntentSlot | null => {
  const slot = closestFrom(e, '.slot');
  const i = slot === null ? -1 : queryAllIn(hand, '.slot').indexOf(slot);
  return i === 0 || i === 1 || i === 2 ? i : null;
};

/**
 * The live intent's hover half (docs/design/briscola-battle.md §4.2): a fine pointer over a hand
 * slot, or focus on one (keyboard parity), names the slot for the reducer to mirror; a touch names
 * nothing (its `pointerover` precedes every tap, W3C Pointer Events §3.3.3, so it would mirror a
 * phantom hover). The lift itself is `Table.selected`, which the reducer already holds.
 */
export const bindHover = (doc: PageLike, dispatch: Dispatch): void => {
  const hand = requireId(doc, 'hand');
  const fine = (e: Readonly<Event>): boolean => pointerTypeOf(e) !== 'touch';
  listen(hand, 'pointerover', (e) => {
    if (fine(e)) dispatch({ type: 'hover/set', slot: slotIndexOf(hand, e) });
  });
  listen(hand, 'pointerout', (e) => {
    if (fine(e)) dispatch({ type: 'hover/set', slot: null });
  });
  listen(hand, 'focusin', (e) => {
    dispatch({ type: 'hover/set', slot: slotIndexOf(hand, e) });
  });
  listen(hand, 'focusout', () => {
    dispatch({ type: 'hover/set', slot: null });
  });
};

/** The table's and the sheets' controls, each an intent (the shell's leave button too, though the menu's row is the one reached). */
export const bindTable = (doc: PageLike, dispatch: Dispatch): void => {
  // A card's tap, or, on the felt and the empty slots, the draw's tap (the reducer drops it outside the wait).
  listenId(doc, 'hand', 'click', (e) => {
    dispatch(handIntentOf(e) ?? { type: 'draw/tap' });
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
  // Tap to draw (docs/design/briscola-battle.md §3.1 DRAW): the stock while my draw waits; dropped otherwise.
  listenId(doc, 'stock', 'click', () => {
    dispatch({ type: 'draw/tap' });
  });
  listenId(doc, 'briscola', 'click', () => {
    dispatch({ type: 'exchange/click' });
  });
  // The controls whose click is one constant; `skipDisabled`: a click on a control carrying
  // `disabled` dispatches nothing (the paint disables the play button and Play again).
  bindButtons(
    doc,
    dispatch,
    [
      ['playBtn', { type: 'play/click' }],
      ['deckBtn', { type: 'deck/open' }],
      ['resultChipBtn', { type: 'result/open' }],
      ['rsReplayBtn', { type: 'replay/click' }],
      ['leaveBtn', { type: 'leave/request' }],
      ['soundBtn', { type: 'sound/toggle' }],
      ['handoffBtn', { type: 'handoff/click' }],
      ['rulesBtnGame', { type: 'rules/open' }],
      ['historyBtn', { type: 'history/open' }],
    ],
    { skipDisabled: true },
  );
  // The deck sheet's toggle (ui/deck.ts): the box's change is the intent; the paint writes it back.
  listenId(doc, 'deckIncludeHand', 'change', () => {
    dispatch({ type: 'deck/toggleHand' });
  });
  bindMenu(doc, dispatch);
  bindTip(doc, dispatch);
  bindHover(doc, dispatch);
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
