// The history rows over the engine's event stream (docs/design/briscola-sound-history.md §6): one
// `<details>` per event, the summary with its actor as the chip, the detail pairs as a `<dl>`, a
// trick's value class on the row, newest last; the list keyed by the last event's id so the same
// list is not rebuilt and open rows stay open; names escaped.
import { describe, expect, test } from 'vitest';

import { fakeEl } from '../../../../shared/edge/page.fake.ts';
import {
  cardById,
  detailOf,
  summaryOf,
  type Card,
  type GameEvent,
  type Player,
} from '../engine/index.ts';
import {
  EMPTY_HISTORY_MSG,
  historyHtml,
  historyKey,
  historyRowHtml,
  paintHistory,
} from './history.ts';

const PLAYERS: ReadonlyArray<Player> = [
  { id: 'p1', name: 'Ari' },
  { id: 'p2', name: 'Jeff' },
];
const card = (id: string): Card => {
  const c = cardById(id);
  if (c === null) throw new Error(`no card ${id}`);
  return c;
};

const DEAL: GameEvent = {
  id: 0,
  kind: 'deal',
  seat: 0,
  at: 1,
  data: { dealer: 0, trumpCard: card('7B') },
};
const TRICK: GameEvent = {
  id: 1,
  kind: 'trick',
  seat: 1,
  at: 2,
  data: {
    no: 1,
    leader: 0,
    cards: [
      { seat: 0, card: card('AC') },
      { seat: 1, card: card('2B') },
    ],
    winner: 1,
    winnerSide: 1,
    points: 11,
    valueClass: 'big',
    winningCard: card('2B'),
    winningClass: 'pip',
    briscola: true,
    steal: true,
    overtrump: false,
    carichiLost: [0],
    drew: [1, 0],
    trumpTaken: null,
  },
};
const GAME: GameEvent = { id: 2, kind: 'game', seat: null, at: 3, data: { gameNo: 2, dealer: 1 } };
const RESULT: GameEvent = {
  id: 3,
  kind: 'result',
  seat: null,
  at: 4,
  data: { winner: 1, totals: [53, 67], draw: false, decided: false, wins: [0, 1] },
};
const EVENTS: ReadonlyArray<GameEvent> = [DEAL, TRICK, GAME, RESULT];

describe('historyRowHtml', () => {
  test('a trick row: kind, id, seat and value class; the actor as the chip; every detail pair', () => {
    const html = historyRowHtml(TRICK, PLAYERS, 2);
    expect(
      html.startsWith(
        '<details class="history-row" data-kind="trick" data-id="1" data-seat="1" data-value="big"><summary><span class="who">Jeff</span> took the trick · 11 points · stolen with a briscola</summary><dl class="history-detail">',
      ),
    ).toBe(true);
    expect(html.endsWith('</dl></details>')).toBe(true);
    detailOf(TRICK, PLAYERS, 2).forEach(([label, value]) => {
      expect(html).toContain(`<dt>${label}</dt><dd>${value}</dd>`);
    });
    expect(html.match(/<dt>/g)).toHaveLength(detailOf(TRICK, PLAYERS, 2).length);
  });

  test('an event without an actor has no chip and no data-seat; the deal is chipped by its dealer', () => {
    expect(historyRowHtml(GAME, PLAYERS, 2)).toBe(
      '<details class="history-row" data-kind="game" data-id="2"><summary>Game 2 begins</summary><dl class="history-detail"><dt>Dealer</dt><dd>Jeff</dd></dl></details>',
    );
    expect(historyRowHtml(RESULT, PLAYERS, 2)).toContain(
      `data-kind="result" data-id="3"><summary>${summaryOf(RESULT, PLAYERS, 2)}</summary>`,
    );
    expect(historyRowHtml(DEAL, PLAYERS, 2)).toContain(
      '<summary><span class="who">Ari</span> dealt · the briscola is the sette di bastoni</summary>',
    );
  });

  test('a name is escaped in the chip and in the detail', () => {
    const odd: ReadonlyArray<Player> = [
      { id: 'p1', name: '<i>A</i>' },
      { id: 'p2', name: 'B&C' },
    ];
    const html = historyRowHtml(TRICK, odd, 2);
    expect(html).toContain('<span class="who">B&amp;C</span>');
    expect(html).toContain('<dd>&lt;i&gt;A&lt;/i&gt; · asso di coppe</dd>');
    expect(html).not.toContain('<i>');
  });
});

describe('historyHtml and historyKey', () => {
  test('newest last, one row per event; the empty note before anything happened', () => {
    const html = historyHtml(EVENTS, PLAYERS, 2);
    expect(html.match(/<details /g)).toHaveLength(4);
    expect(html.indexOf('data-id="0"')).toBeLessThan(html.indexOf('data-id="3"'));
    expect(html).toBe(EVENTS.map((e) => historyRowHtml(e, PLAYERS, 2)).join(''));
    expect(historyHtml([], PLAYERS, 2)).toBe(`<div class="empty-note">${EMPTY_HISTORY_MSG}</div>`);
  });

  test('the key is the last event id, match-wide', () => {
    expect(historyKey([])).toBe('none');
    expect(historyKey([DEAL])).toBe('e0');
    expect(historyKey(EVENTS)).toBe('e3');
  });
});

describe('paintHistory', () => {
  test('builds once per key: the same list is left alone (open rows survive), a new event rebuilds', () => {
    const list = fakeEl('historyList');
    paintHistory(list.el, [DEAL], PLAYERS, 2);
    expect(list.attr('data-key')).toBe('e0');
    expect(list.text()).toBe(historyHtml([DEAL], PLAYERS, 2));
    // A browser would keep an opened <details> here; the fake shows the content untouched.
    list.el.insertAdjacentHTML('beforeend', '<!--open-->');
    paintHistory(list.el, [DEAL], PLAYERS, 2);
    expect(list.text().endsWith('<!--open-->')).toBe(true);
    paintHistory(list.el, [DEAL, TRICK], PLAYERS, 2);
    expect(list.attr('data-key')).toBe('e1');
    expect(list.text()).toBe(historyHtml([DEAL, TRICK], PLAYERS, 2));
    paintHistory(list.el, [], PLAYERS, 2);
    expect(list.attr('data-key')).toBe('none');
    expect(list.text()).toContain(EMPTY_HISTORY_MSG);
  });
});

describe('a summary that does not open with its actor', () => {
  test('is printed whole, with no chip', () => {
    // The dealer in the data is Ari, the row's seat says Jeff: nothing to lift out of the line.
    const odd: GameEvent = { ...DEAL, seat: 1 };
    expect(historyRowHtml(odd, PLAYERS, 2)).toContain(
      '<summary>Ari dealt · the briscola is the sette di bastoni</summary>',
    );
  });
});
