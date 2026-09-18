// The pieces the screens share (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html
// lines 2428-2538 (bundle section "// src/view/components.ts"); every class, id, tooltip and text
// is the bundle's. Dice, the hand-shape glyph rows the ladder uses, lives and losses, the seat
// cards (with a bot's rename/configure controls for the host in the lobby), the table-talk log
// and the numbered step header.
import { describeProfile, strategyFor } from '../bots/registry.ts';
import { isOut, keepsScore, seat } from '../domain/game.ts';
import type {
  BotProfile,
  Category,
  DieValue,
  LogEntry,
  Player,
  PublicState,
  Seat,
} from '../domain/types.ts';
import type { Dispatch, Ui } from './types.ts';
import { cls, h, blurTarget, targetValue, type VNode } from './vdom.ts';

export type DieOptions = Readonly<{
  /** A size class: `sm`, `xs`, or '' for the default. */
  size?: string;
  clickable?: boolean;
  selected?: boolean;
  tip?: string;
  onClick?: () => void;
}>;

/** A die face, or a hidden one for `null`. */
const die = (value: DieValue | null, o: DieOptions = {}): VNode =>
  h('div', {
    class: cls(
      'die',
      o.size,
      value === null ? 'hidden-face' : `v${String(value)}`,
      o.clickable && 'clickable',
      o.selected && 'selected',
    ),
    attrs: {
      role: 'img',
      'aria-label': value === null ? 'hidden die' : `die showing ${String(value)}`,
    },
    ...(o.tip ? { tip: o.tip } : {}),
    ...(o.onClick ? { on: { click: o.onClick } } : {}),
  });

const diceRow = (values: ReadonlyArray<DieValue | null>, size = ''): VNode =>
  h(
    'div',
    { class: 'dice' },
    values.map((v) => die(v, { size })),
  );

/** The abstract dice of a hand shape on the ladder's category rows. */
export type ShapeSym = 'pine' | 'kayak' | 'blank' | 'step1' | 'step2' | 'step3' | 'step4' | 'step5';

const SHAPE_GLYPH: Readonly<Record<ShapeSym, string>> = {
  pine: '\u{1F332}',
  kayak: '\u{1F6F6}',
  blank: '',
  step1: '',
  step2: '',
  step3: '',
  step4: '',
  step5: '',
};
const SHAPE_LABEL: Readonly<Record<ShapeSym, string>> = {
  pine: 'a die of the main number',
  kayak: 'a die of the second number',
  blank: 'any other die',
  step1: 'lowest die of a run',
  step2: 'second die of a run',
  step3: 'middle die of a run',
  step4: 'fourth die of a run',
  step5: 'highest die of a run',
};
const CATEGORY_SHAPE: Readonly<Record<Category, ReadonlyArray<ShapeSym>>> = {
  five: ['pine', 'pine', 'pine', 'pine', 'pine'],
  quads: ['pine', 'pine', 'pine', 'pine', 'blank'],
  fullhouse: ['pine', 'pine', 'pine', 'kayak', 'kayak'],
  straight: ['step1', 'step2', 'step3', 'step4', 'step5'],
  trips: ['pine', 'pine', 'pine', 'blank', 'blank'],
  twopair: ['pine', 'pine', 'kayak', 'kayak', 'blank'],
  pair: ['pine', 'pine', 'blank', 'blank', 'blank'],
  high: ['pine', 'blank', 'blank', 'blank', 'blank'],
};

const shapeDie = (sym: ShapeSym, size = 'sm'): VNode =>
  h(
    'div',
    {
      class: cls('die', size, 'abs', `abs-${sym}`),
      attrs: { role: 'img', 'aria-label': SHAPE_LABEL[sym] },
    },
    SHAPE_GLYPH[sym],
  );

const shapeRow = (cat: Category, size = 'sm'): VNode =>
  h(
    'div',
    { class: 'dice shape' },
    CATEGORY_SHAPE[cat].map((sym) => shapeDie(sym, size)),
  );

const kayak = (lost: boolean): VNode =>
  h('span', { style: lost ? 'opacity:.28;filter:grayscale(1)' : undefined }, '\u{1F6F6}');

const kayaks = (lives: number, max: number): VNode =>
  h(
    'div',
    { class: 'lives', tip: 'Kayaks left — lose one each time a call goes against you' },
    Array.from({ length: Math.max(0, max) }, (_, i) => kayak(i >= lives)),
  );

const lostPill = (losses: number): VNode =>
  h(
    'div',
    {
      class: cls('lost', losses === 0 && 'clean'),
      tip: 'Rounds lost — the score at this table. Fewest wins.',
    },
    losses === 0 ? 'no rounds lost' : `${String(losses)} lost`,
  );

const seatStatus = (game: PublicState, i: Seat, p: Player): string => {
  const r = game.round;
  if (game.phase === 'lobby') return p.bot ? `Computer \xB7 ${describeProfile(p.bot)}` : 'Ready';
  if (isOut(game, p)) return 'Out';
  const holding = r?.holder === i && !game.reveal;
  if (holding) return r.bid === null ? 'Opening the round' : r.touched ? 'Shuffling…' : 'Deciding…';
  return r?.bidder === i && !game.reveal ? 'Bid on the table' : '';
};

/** How the seats are drawn for this viewer. */
export type SeatOptions = Readonly<{
  mySeat: Seat | null;
  canRemoveBots: boolean;
  dispatch: Dispatch;
}>;

const botControls = (i: Seat, name: string, bot: BotProfile, dispatch: Dispatch): VNode =>
  h(
    'div',
    { class: 'bot-controls' },
    h('input', {
      id: `botName-${String(i)}`,
      class: 'bot-name',
      tip: 'Rename this computer (blank = a lake name)',
      attrs: { maxlength: '16', placeholder: 'Name' },
      props: { value: name },
      on: {
        change: (e) => {
          dispatch({ type: 'lobby.renameBot', seat: i, name: targetValue(e) });
        },
        keydown: (e) => {
          if (e.key === 'Enter') blurTarget(e);
        },
      },
    }),
    h(
      'div',
      { class: 'row', style: 'gap:6px;align-items:center' },
      h(
        'span',
        { class: 'bot-strategy', id: `botStrategy-${String(i)}`, tip: strategyFor(bot).blurb },
        bot.random ? `\u{1F3B2} ${strategyFor(bot).name}` : strategyFor(bot).name,
      ),
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'btn-ghost small',
          id: `btnConfig-${String(i)}`,
          style: 'padding:2px 8px;font-size:12px',
          tip: 'Choose its strategy — or the self-taught computer',
          on: {
            click: () => {
              dispatch({ type: 'config.open', target: { kind: 'seat', seat: i } });
            },
          },
        },
        '⚙ Configure',
      ),
    ),
    h(
      'div',
      { class: 'small muted', style: 'font-size:11.5px;line-height:1.3' },
      bot.random ? `Drawn at random. ${strategyFor(bot).blurb}` : strategyFor(bot).blurb,
    ),
  );

const seatCard = (game: PublicState, i: Seat, p: Player, o: SeatOptions): VNode => {
  const r = game.round;
  const holding = !!r && r.holder === i && !game.reveal && game.phase === 'playing';
  return h(
    'div',
    {
      class: cls(
        'seat',
        i === o.mySeat && 'me',
        holding && 'holder',
        isOut(game, p) && game.phase !== 'lobby' && 'out',
      ),
      attrs: { 'data-seat': String(i) },
    },
    h(
      'div',
      { class: 'nm' },
      h('span', {
        class: cls('dot', !p.connected && 'off'),
        tip: p.connected ? 'Connected' : 'Disconnected',
      }),
      p.name,
      i === game.hostSeat &&
        h('span', { class: 'small muted', tip: 'Runs the table' }, ' \u{1F451}'),
      p.bot &&
        h(
          'span',
          { class: 'small', tip: `Computer player (${describeProfile(p.bot)})` },
          ' \u{1F916}',
        ),
      i === o.mySeat && h('span', { class: 'small muted' }, ' (you)'),
    ),
    game.phase !== 'lobby' && (keepsScore(game) ? lostPill(p.losses) : kayaks(p.lives, game.lives)),
    p.bot && game.phase === 'lobby' && o.canRemoveBots
      ? botControls(i, p.name, p.bot, o.dispatch)
      : h('div', { class: 'status' }, seatStatus(game, i, p)),
    holding && h('span', { class: 'cupbadge' }, '\u{1F964}'),
    p.bot &&
      game.phase === 'lobby' &&
      o.canRemoveBots &&
      h(
        'button',
        {
          class: 'btn-ghost small remove-bot',
          style: 'padding:2px 6px;font-size:11px;align-self:flex-start',
          on: {
            click: () => {
              o.dispatch({ type: 'lobby.removeBot', seat: i });
            },
          },
        },
        '✕ remove',
      ),
  );
};

/** Every seat; with `fillEmpty`, placeholders up to six. */
const seats = (game: PublicState, o: SeatOptions, fillEmpty: boolean): VNode =>
  h(
    'div',
    { class: 'seats' },
    game.players.map((p, i) => seatCard(game, seat(i), p, o)),
    fillEmpty &&
      Array.from({ length: Math.max(0, 6 - game.players.length) }, (_, k) =>
        h(
          'div',
          { class: 'seat empty-seat' },
          game.players.length + k < 2 ? 'Waiting for a player…' : 'Open seat',
        ),
      ),
  );

const clockTime = (at: number | null): string =>
  at === null
    ? ''
    : new Date(at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

const logView = (entries: ReadonlyArray<LogEntry>, id = 'log'): VNode =>
  h(
    'div',
    { class: 'log', id },
    entries.map((e) =>
      h('div', { class: cls(e.big && 'big') }, h('span', { class: 't' }, clockTime(e.at)), e.text),
    ),
  );

const stepHeader = (n: number, title: string, blurb: string): ReadonlyArray<VNode> => [
  h('h4', {}, h('span', { class: 'num' }, String(n)), title),
  h('p', {}, blurb),
];

const seatOptions = (ui: Ui, dispatch: Dispatch): SeatOptions => ({
  mySeat: ui.mySeat,
  canRemoveBots: ui.role === 'host',
  dispatch,
});

export {
  die,
  diceRow,
  SHAPE_GLYPH,
  SHAPE_LABEL,
  CATEGORY_SHAPE,
  shapeDie,
  shapeRow,
  kayak,
  kayaks,
  lostPill,
  seatStatus,
  seatCard,
  botControls,
  seats,
  clockTime,
  logView,
  stepHeader,
  seatOptions,
};
