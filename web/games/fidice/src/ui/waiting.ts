// The waiting rooms' DOM on the shell path (docs/design/fidice-shell-adoption.md §7 D7, D10;
// docs/design/n-seat-sessions.md §7): the shared painter's statuses and seat lists
// (web/shared/ui/shellPaint.ts `paintWaiting`) with the legacy lobby's bot controls
// (src/view/screens/lobby.ts) under the humans: the room's computers listed after the seats, each
// with its name (the waiting room's, or `Computer N` until the deal names it from the pool), the
// one strategy every computer plays (D7), and for the host a rename input, a strategy button and a
// remove button; `#btnAddBot` adds one and `#watchCb` stands the host up (D6). The shared painter
// would rebuild the lists from the seats alone, so it is handed a page without them and the lists
// are painted here through the same keyed slot, keyed on the humans and the computers together.
// Not a reducer module: it reads small views and dispatches its own intent shapes, which ui/state.ts
// spells the same (eslint.config.js: only render, home and local import the reducer).
import {
  byId,
  closestFrom,
  dataOf,
  escapeHtml,
  listen,
  listenId,
  readChecked,
  requireId,
  setChecked,
  targetValueOf,
  type DocumentLike,
  type Element,
  type PageLike,
} from '../../../../shared/edge/dom.ts';
import { ensureKeyed } from '../../../../shared/ui/keyed.ts';
import {
  SEAT_LIST_IDS,
  paintWaiting as paintShellWaiting,
  seatListHtml,
  seatListKey,
  seatRows,
  type WaitingView,
} from '../../../../shared/ui/shellPaint.ts';
import { choiceLabel } from '../bots/registry.ts';

/** The room's computers as the waiting room shows them, beside the shell's fields. */
export type BotsView = Readonly<{
  bots: number;
  botNames: ReadonlyArray<string | null>;
  botChoice: string;
  watch: boolean;
  /** This device hosts the room: the controls show. */
  host: boolean;
}>;
export type RoomView = WaitingView & BotsView;

/** One computer's row: its index among the computers, its name (null until the deal draws one), its strategy's label. */
export type BotRow = Readonly<{ index: number; name: string | null; strategy: string }>;

export const botRows = (v: BotsView): ReadonlyArray<BotRow> =>
  Array.from({ length: v.bots }, (_, index) => ({
    index,
    name: v.botNames[index] ?? null,
    strategy: choiceLabel(v.botChoice),
  }));

/** `Computer 2`: a computer nobody has named. */
export const botPlaceholder = (index: number): string => `Computer ${String(index + 1)}`;

/**
 * A computer's `<li>` after the humans' rows (`data-seat` continues the numbering, `data-bot` is
 * its index): the host gets the rename input (`data-bot-name`, committed on change), the strategy
 * button (`data-bot-config`) and the remove button (`data-bot-remove`); a guest reads the name and
 * the strategy.
 */
export const botRowHtml = (row: BotRow, seat: number, controls: boolean): string => {
  const name = row.name ?? '';
  const label = `${escapeHtml(row.name ?? botPlaceholder(row.index))} · computer · ${escapeHtml(row.strategy)}`;
  const body = controls
    ? `<input type="text" data-bot-name data-bot="${String(row.index)}" maxlength="16" placeholder="${escapeHtml(botPlaceholder(row.index))}" value="${escapeHtml(name)}" aria-label="Computer ${String(row.index + 1)} name"> · ${escapeHtml(row.strategy)} <button type="button" class="btn btn-ghost btn-sm" data-bot-config data-bot="${String(row.index)}" title="Strategy" aria-label="Strategy">⚙</button><button type="button" class="btn btn-ghost btn-sm" data-bot-remove data-bot="${String(row.index)}" title="Remove" aria-label="Remove">✕</button>`
    : label;
  return `<li data-seat="${String(seat)}" data-bot="${String(row.index)}" data-connected="true">${body}</li>`;
};

/** The key the lists rebuild on: the humans' rows and the computers' as painted. */
export const roomListKey = (v: RoomView): string =>
  `${seatListKey(seatRows(v))}|${JSON.stringify(botRows(v))}|${v.host ? 'host' : 'guest'}`;

/**
 * `#roomCode`, the two statuses and `#startGameBtn` through the shared painter (over a page without
 * the seat lists), then the lists: the humans' rows, the computers under them (the host's with
 * controls on `#seatList` alone), the watch box as the room has it.
 */
export const paintWaiting = (doc: DocumentLike, v: RoomView): void => {
  paintShellWaiting(
    { getElementById: (id) => (SEAT_LIST_IDS.includes(id) ? null : doc.getElementById(id)) },
    v,
  );
  const humans = seatRows(v);
  const bots = botRows(v);
  const key = roomListKey(v);
  SEAT_LIST_IDS.forEach((id) => {
    const list = byId(doc, id);
    if (list === null) return;
    const controls = v.host && id === 'seatList';
    ensureKeyed(list, key, () =>
      [
        seatListHtml(humans),
        ...bots.map((row, i) => botRowHtml(row, humans.length + i, controls)),
      ].join(''),
    );
  });
  setChecked(requireId(doc, 'watchCb'), v.watch);
};

/** The intents the waiting room's controls raise, as ui/state.ts spells them. */
export type WaitingIntent =
  | Readonly<{ type: 'bots/add' }>
  | Readonly<{ type: 'bots/remove'; index: number }>
  | Readonly<{ type: 'bots/rename'; index: number; name: string }>
  | Readonly<{ type: 'config/open'; target: Readonly<{ kind: 'bot'; index: number }> }>
  | Readonly<{ type: 'watch/toggle'; on: boolean }>;

const botIndexOf = (el: Element): number => Number(dataOf(el, 'bot') ?? '0');

/** `#btnAddBot`, `#watchCb`, and the computers' controls delegated on `#seatList`. */
export const bindWaiting = (doc: PageLike, dispatch: (intent: WaitingIntent) => void): void => {
  listenId(doc, 'btnAddBot', 'click', () => {
    dispatch({ type: 'bots/add' });
  });
  const watchCb = requireId(doc, 'watchCb');
  listen(watchCb, 'change', () => {
    dispatch({ type: 'watch/toggle', on: readChecked(watchCb) });
  });
  const list = requireId(doc, 'seatList');
  listen(list, 'click', (e) => {
    const remove = closestFrom(e, '[data-bot-remove]');
    if (remove !== null) {
      dispatch({ type: 'bots/remove', index: botIndexOf(remove) });
      return;
    }
    const config = closestFrom(e, '[data-bot-config]');
    if (config !== null)
      dispatch({ type: 'config/open', target: { kind: 'bot', index: botIndexOf(config) } });
  });
  listen(list, 'change', (e) => {
    const input = closestFrom(e, '[data-bot-name]');
    if (input !== null)
      dispatch({ type: 'bots/rename', index: botIndexOf(input), name: targetValueOf(e) });
  });
};
